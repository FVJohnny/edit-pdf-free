/** Assemble pages in the loaded document, retaining catalog and page identities. */
export async function assembleDocument(bytes, order) {
    const { PDFDocument, PDFName, PDFPage, PDFObjectCopier, PDFString } =
        PDFLib;
    const N = PDFName.of;
    const doc = await PDFDocument.load(bytes, {
        ignoreEncryption: true,
        updateMetadata: false
    });
    const originals = doc.getPages();
    const labels = readNumberTree(doc, doc.catalog.get(N('PageLabels')));
    const removed = new Set(
        originals
            .filter(
                (_, i) =>
                    !order.some(
                        (p) => p.kind === 'original' && p.sourcePageIndex === i
                    )
            )
            .map((p) => p.ref.toString())
    );
    // Materialize inherited page attributes before changing their parent tree.
    for (const page of originals)
        for (const key of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) {
            const value = page.node.getInheritableAttribute(N(key));
            if (value && !page.node.has(N(key))) page.node.set(N(key), value);
        }
    const merged = new Map();
    let sourceNumber = 0;
    for (const entry of order.filter((p) => p.kind === 'merged')) {
        const id = entry.entry.sourceId;
        if (merged.has(id)) continue;
        const src = await PDFDocument.load(entry.entry.sourceBytes, {
            ignoreEncryption: true,
            updateMetadata: false
        });
        resolveNamedDestinations(src);
        const copier = PDFObjectCopier.for(src.context, doc.context);
        const pages = src.getPages().map((p) => {
            const ref = copier.copy(p.ref);
            return PDFPage.of(doc.context.lookup(ref), ref, doc);
        });
        merged.set(id, pages);
        sourceNumber++;
        pages.forEach((p, i) => {
            if (
                !order.some(
                    (e) =>
                        e.kind === 'merged' &&
                        e.entry.sourceId === id &&
                        e.entry.sourcePageIndex === i
                )
            )
                removed.add(p.ref.toString());
        });
        const sourceForm = src.catalog.lookupMaybe(
            N('AcroForm'),
            PDFLib.PDFDict
        );
        if (sourceForm) {
            let form = doc.catalog.lookupMaybe(N('AcroForm'), PDFLib.PDFDict);
            if (!form) {
                form = doc.context.obj({ Fields: [] });
                doc.catalog.set(N('AcroForm'), doc.context.register(form));
            }
            const fields = form.lookup(N('Fields'), PDFLib.PDFArray);
            mergeFormResources(
                src,
                doc,
                sourceForm,
                form,
                copier,
                sourceNumber
            );
            const incoming = copier.copy(
                sourceForm.lookup(N('Fields'), PDFLib.PDFArray)
            );
            const wrapper = doc.context.obj({
                T: PDFString.of(`Merged ${sourceNumber}`),
                Kids: incoming
            });
            const wrapperRef = doc.context.register(wrapper);
            for (let i = 0; i < incoming.size(); i++)
                doc.context
                    .lookup(incoming.get(i))
                    .set(N('Parent'), wrapperRef);
            fields.push(wrapperRef);
            // Preserve appearances and explicitly supply the donor's default appearance.
            const da = sourceForm.get(N('DA'));
            if (da) wrapper.set(N('DA'), copier.copy(da));
        }
        const sourceOutline = src.catalog.get(N('Outlines'));
        if (sourceOutline) {
            let root = doc.catalog.lookupMaybe(N('Outlines'), PDFLib.PDFDict);
            if (!root) {
                root = doc.context.obj({ Type: 'Outlines' });
                doc.catalog.set(N('Outlines'), doc.context.register(root));
            }
            const rootRef = doc.catalog.get(N('Outlines'));
            const childRef = copier.copy(sourceOutline);
            const child = doc.context.lookup(childRef);
            child.delete(N('Type'));
            child.set(
                N('Title'),
                PDFString.of(`Merged document ${sourceNumber}`)
            );
            child.set(N('Parent'), rootRef);
            const last = root.get(N('Last'));
            if (last) {
                doc.context.lookup(last).set(N('Next'), childRef);
                child.set(N('Prev'), last);
            } else root.set(N('First'), childRef);
            root.set(N('Last'), childRef);
            root.set(
                N('Count'),
                doc.context.obj(
                    (root
                        .lookupMaybe(N('Count'), PDFLib.PDFNumber)
                        ?.asNumber() || 0) +
                        1 +
                        Math.max(
                            0,
                            child
                                .lookupMaybe(N('Count'), PDFLib.PDFNumber)
                                ?.asNumber() || 0
                        )
                )
            );
        }
    }
    for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);
    for (const p of order) {
        if (p.kind === 'original') doc.addPage(originals[p.sourcePageIndex]);
        else if (p.kind === 'blank')
            doc.addPage([p.entry.pdfWidth, p.entry.pdfHeight]);
        else if (p.kind === 'merged')
            doc.addPage(merged.get(p.entry.sourceId)[p.entry.sourcePageIndex]);
    }
    if (labels.length) {
        const nums = [];
        order.forEach((entry, i) => {
            let label = doc.context.obj({ S: 'D', St: i + 1 });
            if (entry.kind === 'original') {
                const found = labels
                    .filter(([start]) => start <= entry.sourcePageIndex)
                    .at(-1);
                if (found) {
                    label = doc.context.lookup(found[1]).clone(doc.context);
                    const st =
                        label
                            .lookupMaybe(N('St'), PDFLib.PDFNumber)
                            ?.asNumber() || 1;
                    label.set(
                        N('St'),
                        doc.context.obj(st + entry.sourcePageIndex - found[0])
                    );
                }
            }
            nums.push(i, label);
        });
        doc.catalog.set(N('PageLabels'), doc.context.obj({ Nums: nums }));
    }
    resolveNamedDestinations(doc);
    pruneDeletedPageReferences(doc, removed);
    return doc;
}

function pruneDeletedPageReferences(doc, removed) {
    if (!removed.size) return;
    const { PDFName, PDFArray, PDFDict } = PDFLib,
        N = PDFName.of;
    const resolve = (x) => (x ? doc.context.lookup(x) : null);
    const deadDest = (ref) => {
        const d = resolve(ref);
        return d instanceof PDFArray && removed.has(d.get(0)?.toString());
    };
    function cleanAction(dict) {
        if (deadDest(dict.get(N('Dest')))) dict.delete(N('Dest'));
        const action = resolve(dict.get(N('A')));
        if (
            action instanceof PDFDict &&
            action.get(N('S'))?.toString() === '/GoTo' &&
            deadDest(action.get(N('D')))
        )
            dict.delete(N('A'));
    }
    const destinationIsDead = (ref) => {
        const value = resolve(ref);
        return deadDest(value instanceof PDFDict ? value.get(N('D')) : value);
    };
    const direct = resolve(doc.catalog.get(N('Dests')));
    if (direct instanceof PDFDict)
        for (const [name, value] of direct.entries())
            if (destinationIsDead(value)) direct.delete(name);
    function pruneNames(ref) {
        const node = resolve(ref);
        if (!(node instanceof PDFDict)) return false;
        const pairs = resolve(node.get(N('Names'))),
            kids = resolve(node.get(N('Kids')));
        if (pairs instanceof PDFArray)
            for (let i = pairs.size() - 2; i >= 0; i -= 2)
                if (destinationIsDead(pairs.get(i + 1))) {
                    pairs.remove(i + 1);
                    pairs.remove(i);
                }
        if (kids instanceof PDFArray)
            for (let i = kids.size() - 1; i >= 0; i--)
                if (!pruneNames(kids.get(i))) kids.remove(i);
        // Limits are optional. Removing them avoids stale ranges after pruning.
        node.delete(N('Limits'));
        return !!(pairs?.size() || kids?.size());
    }
    const names = resolve(doc.catalog.get(N('Names')));
    if (
        names instanceof PDFDict &&
        names.has(N('Dests')) &&
        !pruneNames(names.get(N('Dests')))
    )
        names.delete(N('Dests'));
    for (const p of doc.getPages()) {
        const annots = p.node.Annots();
        if (!annots) continue;
        for (let i = annots.size() - 1; i >= 0; i--) {
            const a = resolve(annots.get(i));
            cleanAction(a);
            if (
                a.get(N('Subtype'))?.toString() === '/Link' &&
                !a.has(N('A')) &&
                !a.has(N('Dest'))
            )
                annots.remove(i);
        }
    }
    // Keep outline labels/children, but remove destinations to deleted pages.
    const visited = new Set();
    function outlines(ref) {
        const d = resolve(ref);
        if (!(d instanceof PDFDict) || visited.has(d)) return;
        visited.add(d);
        cleanAction(d);
        outlines(d.get(N('First')));
        outlines(d.get(N('Next')));
    }
    outlines(doc.catalog.get(N('Outlines')));
    // Fields whose only widget was on a deleted page must not remain interactive.
    function fields(array) {
        if (!(array instanceof PDFArray)) return;
        for (let i = array.size() - 1; i >= 0; i--) {
            const f = resolve(array.get(i)),
                kids = resolve(f.get(N('Kids')));
            fields(kids);
            if (
                removed.has(f.get(N('P'))?.toString()) ||
                (kids instanceof PDFArray && !kids.size())
            )
                array.remove(i);
        }
    }
    const form = resolve(doc.catalog.get(N('AcroForm')));
    if (form) fields(resolve(form.get(N('Fields'))));
}

/** Resolve names to page-reference destinations before copying/pruning links. */
function resolveNamedDestinations(doc) {
    const { PDFName, PDFArray, PDFDict } = PDFLib,
        N = PDFName.of,
        lookup = (x) => (x ? doc.context.lookup(x) : null);
    const destinations = new Map();
    const key = (x) => x?.decodeText?.() ?? x?.toString().replace(/^\//, '');
    const direct = lookup(doc.catalog.get(N('Dests')));
    if (direct instanceof PDFDict)
        for (const [name, value] of direct.entries())
            destinations.set(key(name), value);
    const names = lookup(doc.catalog.get(N('Names')));
    function tree(ref) {
        const node = lookup(ref);
        if (!(node instanceof PDFDict)) return;
        const entries = lookup(node.get(N('Names')));
        if (entries instanceof PDFArray)
            for (let i = 0; i < entries.size(); i += 2)
                destinations.set(key(entries.get(i)), entries.get(i + 1));
        const kids = lookup(node.get(N('Kids')));
        if (kids instanceof PDFArray) kids.asArray().forEach(tree);
    }
    if (names) tree(names.get(N('Dests')));
    function dest(value) {
        let d = lookup(value);
        if (d instanceof PDFArray) return d;
        d = lookup(destinations.get(key(d)));
        return d instanceof PDFDict ? d.get(N('D')) : d;
    }
    function fix(d) {
        if (!(d instanceof PDFDict)) return;
        const resolved = dest(d.get(N('Dest')));
        if (resolved) d.set(N('Dest'), resolved);
        const action = lookup(d.get(N('A')));
        if (
            action instanceof PDFDict &&
            action.get(N('S'))?.toString() === '/GoTo'
        ) {
            const target = dest(action.get(N('D')));
            if (target) action.set(N('D'), target);
        }
    }
    for (const page of doc.getPages())
        page.node
            .Annots()
            ?.asArray()
            .forEach((r) => fix(lookup(r)));
    const visited = new Set();
    function outline(ref) {
        const d = lookup(ref);
        if (!(d instanceof PDFDict) || visited.has(d)) return;
        visited.add(d);
        fix(d);
        outline(d.get(N('First')));
        outline(d.get(N('Next')));
    }
    outline(doc.catalog.get(N('Outlines')));
}
function readNumberTree(doc, ref) {
    const node = ref && doc.context.lookup(ref);
    if (!node) return [];
    const N = PDFLib.PDFName.of,
        nums = node.lookupMaybe(N('Nums'), PDFLib.PDFArray),
        result = [];
    if (nums)
        for (let i = 0; i < nums.size(); i += 2)
            result.push([
                nums.lookup(i, PDFLib.PDFNumber).asNumber(),
                nums.get(i + 1)
            ]);
    const kids = node.lookupMaybe(N('Kids'), PDFLib.PDFArray);
    if (kids)
        for (const kid of kids.asArray())
            result.push(...readNumberTree(doc, kid));
    return result.sort((a, b) => a[0] - b[0]);
}
/** Donor fields keep their font resources even when both documents use /Helv. */
function mergeFormResources(src, doc, sourceForm, form, copier, serial) {
    const { PDFName, PDFDict, PDFArray, PDFString } = PDFLib,
        N = PDFName.of;
    const dr = sourceForm.lookupMaybe(N('DR'), PDFDict);
    if (!dr) return;
    let target = form.lookupMaybe(N('DR'), PDFDict);
    if (!target) {
        target = doc.context.obj({});
        form.set(N('DR'), target);
    }
    const renames = new Map();
    for (const [category, resources] of dr.entries()) {
        const source = src.context.lookup(resources);
        if (!(source instanceof PDFDict)) continue;
        let dest = target.lookupMaybe(category, PDFDict);
        if (!dest) {
            dest = doc.context.obj({});
            target.set(category, dest);
        }
        for (const [name, value] of source.entries()) {
            let fresh = `Merged${serial}_${name.decodeText()}`;
            while (dest.has(N(fresh))) fresh += '_';
            dest.set(N(fresh), copier.copy(value));
            if (category.toString() === '/Font')
                renames.set(name.toString(), '/' + fresh);
        }
    }
    const visited = new Set();
    function rewrite(dict) {
        if (!(dict instanceof PDFDict) || visited.has(dict)) return;
        visited.add(dict);
        const da = dict.get(N('DA'));
        if (da) {
            let text = src.context.lookup(da).decodeText();
            text = text.replace(
                /\/[^\s/<>\[\]()]+/g,
                (name) => renames.get(name) || name
            );
            dict.set(N('DA'), PDFString.of(text));
            copier.copy(dict).set(N('DA'), PDFString.of(text));
        }
        const kids =
            dict.lookupMaybe(N('Kids'), PDFArray) ||
            dict.lookupMaybe(N('Fields'), PDFArray);
        kids?.asArray().forEach((ref) => rewrite(src.context.lookup(ref)));
    }
    rewrite(sourceForm);
}
