/**
 * PDF Saver — modifies the original PDF with user edits and downloads the result.
 *
 * Coordinate conversion: all item positions are stored in canvas pixels (see types.js).
 * To convert back to PDF coordinates for saving:
 *   pdfX = canvasX / scale
 *   pdfY = pageHeight - canvasY / scale  (PDF Y is bottom-up, canvas Y is top-down)
 *
 * Text saving strategy:
 *   1. Remove original characters with the local MuPDF engine (preserve graphics)
 *   2. If the text hasn't changed style, try to redraw using the original PDF font
 *      (via CMap glyph encoding) — this preserves font fidelity
 *   3. If that fails (or style was changed), fall back to a standard PDF font
 *      (Helvetica, Times, Courier family)
 */
import { showToast, showPrompt, showChoices } from './ui.js';
import { assembleDocument } from './document-structure.js';
import {
    FONT_BASELINE_RATIO,
} from './utils/constants.js';
import { layoutWidth, layoutHeight } from './utils/canvas.js';
import { buildShapePath } from './draw.js';
import { removeOriginalText, textRegions, isTextModified, imageRegions } from './text-removal.js';

// ============================================
// Save modified PDF
// ============================================
export async function savePDF(pdfBytes, textItems, imageItems, pageOrder, drawnStrokes, originalFileName) {
    try {
        if (typeof PDFLib === 'undefined') {
            alert('PDF library is still loading. Please wait a moment and try again.');
            return;
        }
        const reports = await inspectTextFonts(pdfBytes, textItems.filter(isTextModified), pageOrder);
        const blocked = reports.filter(r=>r.unrenderable.length);
        if(blocked.length){
            showToast('These characters cannot be exported in the available fonts: '+[...new Set(blocked.flatMap(r=>r.unrenderable))].join(' ')+'. Change the text or font before saving.');
            return;
        }
        const substitutions = reports.filter(r=>r.substitution);
        if(substitutions.length){
            const details=substitutions.map(r=>`${r.font}: ${r.missing.join(' ')||'original encoding unavailable'}`).join(' · ');
            const proceed=await showChoices('Review font substitutions', details,[{label:'Save with substitute fonts',hint:'The highlighted text will use the matching standard font family.',value:true}]);
            if(!proceed)return;
        }
        const warnings = new Set();
        const modifiedPdfBytes = await buildPdfBytes(pdfBytes, textItems, imageItems, pageOrder, drawnStrokes, {warnings});
        await downloadPdf(modifiedPdfBytes, originalFileName, warnings.size ? ' Some text required a substitute font.' : '');
    } catch (error) {
        console.error('Error saving PDF:', error);
        // Surface the actual reason — "please try again" hides bugs users
        // could otherwise report precisely.
        showToast('Error saving PDF: ' + (error?.message || error));
    }
}

/**
 * Build the modified PDF and return its bytes without downloading.
 * Also used by the toolbar size indicator to show the exact output size.
 *
 * The loaded document retains its catalog and page references in on-screen
 * order — pageOrder is one entry per viewer page container:
 *   { kind: 'original', sourcePageIndex }        — page of the loaded PDF
 *   { kind: 'blank',    entry: {pdfWidth, pdfHeight} }
 *   { kind: 'merged',   entry: {sourceId, sourceBytes, sourcePageIndex} }
 * This is what makes page reordering and deletion work: whatever the DOM says,
 * the saved document matches, and item page indices are DOM indices.
 */
export async function buildPdfBytes(pdfBytes, textItems, imageItems, pageOrder, drawnStrokes, options = {}) {
    // A save/preview must use one stable edit snapshot even if the user types,
    // drags or switches documents while the worker is processing.
    textItems = textItems.map(item => ({ ...item,
        renderNativePreview: item.nativePreview && !item.previewLifted && !item.element?.isContentEditable && !item.element?.classList.contains('dragging'),
        subItems: item.subItems?.map(sub => ({...sub})) }));
    imageItems = imageItems.map(item => ({...item}));
    drawnStrokes = drawnStrokes?.map(stroke => ({...stroke, points: stroke.points.map(p => ({...p}))}));
    let doc = await assembleDocument(pdfBytes, pageOrder || []);
    if (typeof fontkit !== 'undefined') doc.registerFontkit(fontkit);

    // Items use finalPageIndex / originPageIndex (0-based DOM container indices,
    // set by the caller — they match the page order assembled above).
    const regions = textRegions(textItems, options.backgroundOnly);
    const imageCuts=imageRegions(imageItems,options.backgroundOnly);
    if (Object.keys(regions).length || Object.keys(imageCuts).length) {
        // Text can live in nested Form XObjects (embedded/merged PDFs). Keep
        // those font resources reachable when redaction removes their last use.
        for (const index of Object.keys(regions)) preserveNestedFonts(doc, doc.getPages()[Number(index)]);
        const {bytes:cleaned, styles, imageResources} = await removeOriginalText(await doc.save(), regions,imageCuts);
        for(const item of imageItems)item.originalResource=imageResources?.[JSON.stringify([item.originPageIndex,item.imageTransform])];
        options.onOriginalStyles?.(styles);
        for (const item of textItems) {
            const parts = item.subItems || [item];
            for (const sub of parts) {
                const color = styles[JSON.stringify([item.originPageIndex, sub.transform, sub.width])];
                if (color) { sub.textColor = color; sub.textOpacity = color.opacity; }
            }
            if (item.subItems?.length) item.textColor = item.subItems[0].textColor;
        }
        doc = await PDFLib.PDFDocument.load(cleaned, {updateMetadata:false});
        if (typeof fontkit !== 'undefined') doc.registerFontkit(fontkit);
    }
    if (options.backgroundOnly) {
        const native=textItems.filter(item=>item.renderNativePreview&&item.originalCovered&&!item.deleted);
        if(native.length)await processModifiedText(doc,doc.getPages(),native.map(item=>({...item,previewRedraw:true})),await embedStandardFonts(doc),{});
        return doc.save();
    }
    const pages = doc.getPages();

    const fonts = await embedStandardFonts(doc);
    const fontInfoCache = {};

    await processModifiedText(doc, pages, textItems, fonts, fontInfoCache, options.warnings);
    await processImportedImages(doc, pages, imageItems);
    processMovedImages(doc, pages, imageItems);
    processDrawnStrokes(doc, pages, drawnStrokes || []);

    return doc.save();
}

/** Expose nested form fonts to the replacement writer without changing content. */
function preserveNestedFonts(doc, page) {
    const { PDFName, PDFDict } = PDFLib;
    const N = PDFName.of;
    const resolve = value => value ? doc.context.lookup(value) : null;
    const resources = page.node.Resources();
    if (!resources) return;
    const pageResources = resources.clone(doc.context);
    const currentFonts = resolve(resources.get(N('Font')));
    const fonts = currentFonts instanceof PDFDict ? currentFonts.clone(doc.context) : doc.context.obj({});
    const known = new Set(fonts.entries().map(([,ref]) => resolve(ref)));
    const visited = new Set();
    let serial = 0;
    function visit(res) {
        if (!(res instanceof PDFDict) || visited.has(res)) return;
        visited.add(res);
        const nestedFonts = resolve(res.get(N('Font')));
        if (nestedFonts instanceof PDFDict) for (const [,ref] of nestedFonts.entries()) {
            const font = resolve(ref);
            if (known.has(font)) continue;
            known.add(font);
            let name;
            do { name = N(`EPFNested${++serial}`); } while (fonts.has(name));
            fonts.set(name, ref);
        }
        const xObjects = resolve(res.get(N('XObject')));
        if (xObjects instanceof PDFDict) for (const [,ref] of xObjects.entries()) {
            const stream = resolve(ref);
            if (stream?.dict?.get(N('Subtype'))?.toString() === '/Form') {
                visit(resolve(stream.dict.get(N('Resources'))));
            }
        }
    }
    visit(resources);
    pageResources.set(N('Font'), fonts);
    page.node.set(N('Resources'), pageResources);
}

// ============================================
// Embed standard fonts
// ============================================
async function embedStandardFonts(doc) {
    const S = PDFLib.StandardFonts;
    return {
        helvetica:            await doc.embedFont(S.Helvetica),
        helveticaBold:        await doc.embedFont(S.HelveticaBold),
        helveticaOblique:     await doc.embedFont(S.HelveticaOblique),
        helveticaBoldOblique: await doc.embedFont(S.HelveticaBoldOblique),
        timesRoman:           await doc.embedFont(S.TimesRoman),
        timesRomanBold:       await doc.embedFont(S.TimesRomanBold),
        timesRomanItalic:     await doc.embedFont(S.TimesRomanItalic),
        timesRomanBoldItalic: await doc.embedFont(S.TimesRomanBoldItalic),
        courier:              await doc.embedFont(S.Courier),
        courierBold:          await doc.embedFont(S.CourierBold),
        courierOblique:       await doc.embedFont(S.CourierOblique),
        courierBoldOblique:   await doc.embedFont(S.CourierBoldOblique),
    };
}

/** Pick the correct standard font variant based on family + weight/style overrides. */
function getFallbackFont(item, fonts) {
    const isBold = (item.fontWeightOverride ?? item.fontWeight) === '700';
    const isItalic = (item.fontStyleOverride ?? item.fontStyle) === 'italic';
    const family = item.fontFamilyOverride || item.fontFamily || '';

    if (family.includes('Times')) {
        if (isBold && isItalic) return fonts.timesRomanBoldItalic;
        if (isBold) return fonts.timesRomanBold;
        if (isItalic) return fonts.timesRomanItalic;
        return fonts.timesRoman;
    }
    if (family.includes('Courier')) {
        if (isBold && isItalic) return fonts.courierBoldOblique;
        if (isBold) return fonts.courierBold;
        if (isItalic) return fonts.courierOblique;
        return fonts.courier;
    }
    if (isBold && isItalic) return fonts.helveticaBoldOblique;
    if (isBold) return fonts.helveticaBold;
    if (isItalic) return fonts.helveticaOblique;
    return fonts.helvetica;
}

// ============================================
// Process modified text items
// ============================================
async function processModifiedText(doc, pages, textItems, fonts, fontInfoCache, warnings) {
    // Group modified items by final page index (in the saved doc, 0-based).
    const byPage = {};
    for (const item of textItems) {
        if (!item.previewRedraw && !isTextModified(item)) continue;
        const pageIdx = item.finalPageIndex;
        if (pageIdx == null || pageIdx < 0) continue;
        if (!byPage[pageIdx]) byPage[pageIdx] = [];
        byPage[pageIdx].push(item);
    }

    for (const [pageIdx, items] of Object.entries(byPage)) {
        const page = pages[parseInt(pageIdx)];
        if (!page) continue;

        for (const item of items) {
            // The page the text originally lived on (covers go there); for
            // cross-page moves the redraw happens on `page` (the target).
            // A deleted origin page (originPage null) means: no covers needed,
            // and the original font resources are gone → fallback font.
            const originPage = item.originPageIndex != null && item.originPageIndex >= 0
                ? pages[item.originPageIndex] || null
                : null;
            // Item coordinates are anchored to the origin page's coordinate
            // system. When the target page height differs, shift Y so the
            // css-pixel position maps correctly onto the target page.
            const originHeightPts = originPage
                ? originPage.getHeight()
                : (item.originCanvas ? layoutHeight(item.originCanvas) / item.scale : page.getHeight());
            const pageHeightDiff = page.getHeight() - originHeightPts;
            // Original position and size in PDF coordinates
            const pdfX = item.transform[4];
            const pdfY = item.transform[5];
            const pdfFontSize = Math.sqrt(item.transform[0] ** 2 + item.transform[1] ** 2);

            // Apply font size override (stored in canvas pixels, convert to PDF points)
            const fontSize = item.fontSizeOverride
                ? item.fontSizeOverride / item.scale
                : pdfFontSize;

            // Convert drag offset from screen pixels to PDF points
            // Note: Y is negated because PDF Y goes up, screen Y goes down
            let dragOffsetX = (item.moveOffsetX || 0) / item.scale;
            let dragOffsetY = -(item.moveOffsetY || 0) / item.scale + pageHeightDiff;
            if (item.viewportTransform && item.originPageIndex === item.finalPageIndex) {
                const [a,b,c,d] = item.viewportTransform, det = a*d-b*c;
                const dx=item.moveOffsetX || 0, dy=item.moveOffsetY || 0;
                dragOffsetX=(d*dx-c*dy)/det;
                dragOffsetY=(-b*dx+a*dy)/det;
            }
            // On screen the span TOP stays fixed when the font size changes, so
            // the visual baseline moves down as text grows — mirror that here.
            const baselineShift = (fontSize - pdfFontSize) * FONT_BASELINE_RATIO;
            const basis = item.transform.slice(0,4).map(v=>v/pdfFontSize);
            const newX = pdfX + dragOffsetX - baselineShift*basis[2];
            const newY = pdfY + dragOffsetY - baselineShift*basis[3];

            const fallbackFont = getFallbackFont(item, fonts);
            if (item.deleted) continue;

            const textColor = item.textColorOverride || item.textColor || { r: 0, g: 0, b: 0 };
            const textOpacity = item.textOpacityOverride ?? item.textColor?.opacity ?? 1;
            // Explicit family/weight/style choices select a new font. Color,
            // opacity and alignment can retain the embedded original.
            const hasStyleOverride = item.fontWeightOverride || item.fontStyleOverride ||
                item.fontFamilyOverride;

            // Original-font info is parsed from the ORIGIN page's resources;
            // when drawing on a different page the font ref must be registered
            // in the target page's resources under a usable name.
            const getDrawableFontInfo = async (fontName, sourceFontName, sourceGlyphs) => {
                if (!originPage) return null; // origin page deleted → fallback font
                const fontInfo = await getFontInfo(doc, originPage, item.originPageIndex ?? '', fontName, fontInfoCache, sourceFontName, sourceGlyphs);
                if (!fontInfo || page === originPage) return fontInfo;
                const drawName = ensureFontOnPage(doc, originPage, page, fontInfo.pdfFontName);
                return drawName ? { ...fontInfo, pdfFontName: drawName } : null;
            };

            // For merged multi-line items, draw each line at its original Y position.
            // Group sub-items by baseline Y to identify distinct lines.
            if (item.subItems && item.currentText.includes('\n')) {
                const lines = item.currentText.split('\n');

                // Group sub-items into lines by baseline Y proximity
                const subLines = [];
                for (const sub of item.subItems) {
                    const subY = sub.transform[5];
                    const existing = subLines.find(g =>
                        Math.abs(g.baselineY - subY) < 2
                    );
                    if (existing) {
                        existing.subs.push(sub);
                    } else {
                        subLines.push({ baselineY: subY, subs: [sub] });
                    }
                }
                // Sort by Y descending (PDF Y goes up, so first line has highest Y)
                subLines.sort((a, b) => b.baselineY - a.baselineY);

                for (let li = 0; li < lines.length; li++) {
                    const lineText = lines[li].replace(/[\r]/g, '');
                    if (!lineText) continue;

                    // Use the corresponding sub-line's position, or fall back to first
                    const subLine = subLines[li] || subLines[subLines.length - 1];
                    const lineSub = subLine.subs[0];
                    const origLineFontSize = Math.sqrt(lineSub.transform[0] ** 2 + lineSub.transform[1] ** 2);
                    const lineFontSize = item.fontSizeOverride
                        ? item.fontSizeOverride / item.scale
                        : origLineFontSize;
                    let linePdfX = lineSub.transform[4] + dragOffsetX;
                    // Same top-anchored baseline correction as single items
                    const extraLines = Math.max(0, li-subLines.length+1);
                    const leading = subLines.length > 1 ? subLines[subLines.length-2].baselineY-subLines[subLines.length-1].baselineY : lineFontSize*1.2;
                    let linePdfY = subLine.baselineY + dragOffsetY - extraLines*leading
                        - (lineFontSize - origLineFontSize) * FONT_BASELINE_RATIO;
                    const fontInfo = !hasStyleOverride ? await getDrawableFontInfo(lineSub.fontName, lineSub.sourceFontName, lineSub.sourceGlyphs) : null;
                    const align = item.alignOverride || 'left';
                    if (align !== 'left') {
                        const measure = t => fontInfo?.measure?.(t,lineFontSize) ?? fallbackFont.widthOfTextAtSize(t,lineFontSize);
                        const width = Math.max(item.width || 0, ...lines.map(measure));
                        const shift = (width-measure(lineText))/(align === 'center' ? 2 : 1);
                        linePdfX += shift*basis[0]; linePdfY += shift*basis[1];
                    }

                    if (!hasStyleOverride) {
                        if (fontInfo && await tryDrawWithOriginalFont(doc, page, fontInfo, lineText, lineFontSize, linePdfX, linePdfY, textColor, basis, textOpacity)) {
                            continue;
                        }
                    }

                    if (!hasStyleOverride && item.originalText) warnings?.add(item.sourceFontName || item.fontName);
                    page.drawText(lineText, {
                        x: linePdfX, y: linePdfY,
                        size: lineFontSize,
                        font: fallbackFont,
                        color: PDFLib.rgb(textColor.r, textColor.g, textColor.b),
                        rotate: PDFLib.radians(Math.atan2(basis[1], basis[0])),
                        opacity: textOpacity,
                    });
                }
                continue;
            }

            // Single item — may contain user-inserted line breaks (Shift+Enter).
            // The on-screen span uses line-height:1, so each line advances by
            // exactly one font size.
            const lines = item.currentText.replace(/\r/g, '').split('\n');

            // Center/right alignment: offset each line within the block width
            // (the widest of the original text box and the new lines).
            const originalInfo = !hasStyleOverride ? await getDrawableFontInfo(item.fontName, item.sourceFontName, item.sourceGlyphs) : null;
            const align = item.alignOverride || 'left';
            let lineWidths = null;
            let blockWidth = 0;
            if (align !== 'left') {
                lineWidths = lines.map(l => l ? (originalInfo?.measure?.(l,fontSize) ?? fallbackFont.widthOfTextAtSize(l, fontSize)) : 0);
                blockWidth = Math.max(item.width || 0, ...lineWidths);
            }

            for (let li = 0; li < lines.length; li++) {
                const lineText = lines[li];
                if (!lineText) continue;
                let lineY = newY - li * fontSize*basis[3];
                let lineX = newX - li * fontSize*basis[2];
                if (align !== 'left') {
                    const shift=(blockWidth-lineWidths[li])/(align === 'center' ? 2 : 1);
                    lineX += shift*basis[0]; lineY += shift*basis[1];
                }

                // Try original font first (only if no style overrides)
                if (!hasStyleOverride) {
                    const fontInfo = originalInfo;
                    if (fontInfo && await tryDrawWithOriginalFont(doc, page, fontInfo, lineText, fontSize, lineX, lineY, textColor, basis, textOpacity)) {
                        continue;
                    }
                }

                if (!hasStyleOverride && item.originalText) warnings?.add(item.sourceFontName || item.fontName);
                page.drawText(lineText, {
                    x: lineX, y: lineY,
                    size: fontSize,
                    font: fallbackFont,
                    color: PDFLib.rgb(textColor.r, textColor.g, textColor.b),
                        rotate: PDFLib.radians(Math.atan2(basis[1], basis[0])),
                    opacity: textOpacity,
                });
            }
        }
    }
}

/**
 * Try to draw text using the original PDF font by encoding characters as hex glyph IDs.
 * Returns true if successful, false if any character can't be mapped.
 *
 * The PDF content stream format is:
 *   q BT                    — save state, begin text
 *   r g b rg                — set fill color
 *   /FontName size Tf       — set font
 *   x y Td                  — move to position
 *   <hex> Tj                — draw text using hex-encoded glyph IDs
 *   ET Q                    — end text, restore state
 */
async function tryDrawWithOriginalFont(doc, page, fontInfo, text, fontSize, x, y, color, basis = [1,0,0,1], opacity = 1) {
    let alpha = '';
    if (opacity < 1) {
        const state = doc.context.register(doc.context.obj({ Type:'ExtGState', ca:opacity, CA:opacity }));
        alpha = `${page.node.newExtGState('TextAlpha', state).toString()} gs `;
    }
    if (fontInfo.encode) {
        try {
            const hex = fontInfo.encode(text);
            addContentStream(doc,page,`q ${alpha}BT ${color.r} ${color.g} ${color.b} rg /${fontInfo.pdfFontName} ${fontSize} Tf ${basis.join(" ")} ${x} ${y} Tm <${hex}> Tj ET Q`);
            return true;
        } catch (_) { return false; }
    }
    const hexChars = [];
    const keys = Object.keys(fontInfo.unicodeToGlyph).sort((a,b)=>b.length-a.length);
    for (let offset=0; offset<text.length;) {
        const key = keys.find(key=>text.startsWith(key,offset));
        const glyphHex = key && fontInfo.unicodeToGlyph[key];
        if (!glyphHex) {
            // A full embedded font may contain characters absent from ToUnicode.
            // Re-embed that same font only when it actually supplies every glyph.
            if (!fontInfo.embeddedBytes || typeof fontkit === 'undefined') return false;
            try {
                fontInfo.program ||= fontkit.create(fontInfo.embeddedBytes);
                if (![...text].every(c => fontInfo.program.hasGlyphForCodePoint(c.codePointAt(0)))) return false;
                fontInfo.reembedded ||= await doc.embedFont(fontInfo.embeddedBytes, { subset: true });
                page.drawText(text, { x, y, size: fontSize, font: fontInfo.reembedded, opacity, rotate: PDFLib.radians(Math.atan2(basis[1],basis[0])), color: PDFLib.rgb(color.r,color.g,color.b) });
                return true;
            } catch (_) { return false; }
        }
        hexChars.push(glyphHex);
        offset += key.length;
    }
    if (hexChars.length === 0) return false;

    const hexString = hexChars.join('');
    const content = `q\n${alpha}BT\n${color.r} ${color.g} ${color.b} rg\n` +
        `/${fontInfo.pdfFontName} ${fontSize} Tf\n` +
        `${basis.join(" ")} ${x} ${y} Tm\n<${hexString}> Tj\nET\nQ\n`;
    addContentStream(doc, page, content);
    return true;
}

// ============================================
// Process imported images
// ============================================
async function processImportedImages(doc, pages, imageItems) {
    const imported = imageItems.filter(img => img.type === 'imported-image' && !img.deleted);
    // The same image imported several times embeds once and is drawn many times
    const embedCache = new Map();
    for (const img of imported) {
        const pageIdx = img.finalPageIndex;
        const page = pageIdx != null && pageIdx >= 0 ? pages[pageIdx] : null;
        if (!page) continue;
        const pageHeight = page.getHeight();

        const cacheKey = await imageBytesKey(img.importedImageBytes);
        let embeddedImage = embedCache.get(cacheKey);
        if (!embeddedImage) {
            embeddedImage = img.importedImageType === 'image/png'
                ? await doc.embedPng(img.importedImageBytes)
                : await doc.embedJpg(img.importedImageBytes);
            embedCache.set(cacheKey, embeddedImage);
        }

        // Final position = original placement + any drag offset
        const finalCssLeft = img.cssLeft + img.moveOffsetX;
        const finalCssTop = img.cssTop + img.moveOffsetY;
        const finalWidth = img.resizedWidth || img.cssWidth;
        const finalHeight = img.resizedHeight || img.cssHeight;

        page.drawImage(embeddedImage, {
            x: finalCssLeft / img.scale,
            y: pageHeight - (finalCssTop + finalHeight) / img.scale,
            width: finalWidth / img.scale,
            height: finalHeight / img.scale,
        });
    }
}

/** Content hash for dedupe of identical imported images. */
async function imageBytesKey(bytes) {
    // crypto.subtle only exists in secure contexts (HTTPS/localhost) — over
    // plain HTTP (e.g. testing via LAN IP) fall back to a simple FNV-1a hash;
    // dedupe quality barely matters, but saving must never fail.
    if (crypto.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    }
    let h1 = 0x811c9dc5, h2 = 0xcbf29ce4;
    for (let i = 0; i < bytes.length; i++) {
        h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ bytes[i], 0x01000197) >>> 0;
    }
    return bytes.length + '-' + h1.toString(16) + h2.toString(16);
}

// ============================================
// Process moved/resized/deleted existing images
// ============================================
function processMovedImages(doc, pages, imageItems) {
    const modified = imageItems.filter(img =>
        img.type !== 'imported-image' &&
        (img.deleted || img.moveOffsetX !== 0 || img.moveOffsetY !== 0 || img.resizedWidth || img.resizedHeight)
    );

    for (const img of modified) {
        const pageIdx = img.finalPageIndex;
        const page = pageIdx != null && pageIdx >= 0 ? pages[pageIdx] : null;
        if (!page) continue;
        // Existing images always originate on an original PDF page; covers and
        // the XObject lookup use that page, the redraw goes on the target page.
        // If the origin page was deleted, there is nothing to cover — and the
        // image's data went with it, so a moved image can't be redrawn.
        const originPage = img.originPageIndex != null && img.originPageIndex >= 0
            ? pages[img.originPageIndex] || null
            : null;

        if (img.deleted || !originPage) continue;
        const resource=img.originalResource;
        const ref=resource&&originPage.node.Resources().lookup(PDFLib.PDFName.of('XObject')).get(PDFLib.PDFName.of(resource.name));
        if(!ref)throw new Error('The original image could not be retained for this edit.');
        const drawName=page===originPage?resource.name:addImageXObjectToPage(doc,page,ref);
        const matrix=pdfjsLib.Util.transform(img.viewportTransform,img.imageTransform);
        const sx=(img.resizedWidth||img.cssWidth)/img.cssWidth,sy=(img.resizedHeight||img.cssHeight)/img.cssHeight;
        const final=[matrix[0]*sx,matrix[1]*sy,matrix[2]*sx,matrix[3]*sy,
            img.cssLeft+(img.moveOffsetX||0)+(matrix[4]-img.cssLeft)*sx,
            img.cssTop+(img.moveOffsetY||0)+(matrix[5]-img.cssTop)*sy];
        const target=img.targetViewportTransform||img.viewportTransform;
        const pdfMatrix=pdfjsLib.Util.transform(pdfjsLib.Util.inverseTransform(target),final);
        let alpha='';
        if(resource.opacity<1){
            const state=doc.context.register(doc.context.obj({Type:'ExtGState',ca:resource.opacity,CA:resource.opacity}));
            alpha=page.node.newExtGState('ImageAlpha',state).toString()+' gs\n';
        }
        addContentStream(doc,page,`q\n${alpha}${pdfMatrix.join(' ')} cm\n/${drawName} Do\nQ\n`);
    }
}

// ============================================
// Process drawn strokes (free-hand drawing)
// ============================================

/**
 * Convert each stroke's canvas-pixel points to PDF points and draw a vector
 * SVG path on the right page. PDF Y is bottom-up while canvas Y is top-down,
 * so we flip Y when constructing the path data.
 */
function processDrawnStrokes(doc, pages, strokes) {
    for (const stroke of strokes) {
        if (!stroke.points || stroke.points.length === 0) continue;

        const pageIdx = stroke.finalPageIndex;
        const page = pageIdx != null && pageIdx >= 0 ? pages[pageIdx] : null;
        if (!page) continue;

        const pageWidth = page.getWidth();
        const pageHeight = page.getHeight();
        const canvas = stroke.canvas;
        if (!canvas) continue;

        // layout pixels per PDF point — same factor used elsewhere.
        const scale = layoutWidth(canvas) / pageWidth;

        // Build the SVG path in layout-pixel coords (top-down). pdf-lib's
        // drawSvgPath flips Y for us, so we anchor at (0, pageHeight) and
        // pass scale=1/scale to convert layout pixels → PDF points.
        // buildShapePath is the same builder the screen uses (pen/rect/arrow).
        const d = buildShapePath(stroke.shape || 'pen', stroke.points, stroke.size);
        // One stroke with an unparseable color (e.g. stale state from an old
        // session) must not abort the whole save — fall back to black.
        const sane = (c) => c && Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b)
            ? c : { r: 0, g: 0, b: 0 };
        const { r, g, b } = sane(hexToRgb(stroke.color || '#000000'));
        const fill = stroke.fillColor ? sane(hexToRgb(stroke.fillColor)) : null;
        page.drawSvgPath(d, {
            x: 0,
            y: pageHeight,
            scale: 1 / scale,
            borderColor: PDFLib.rgb(r, g, b),
            borderWidth: stroke.size,
            borderOpacity: stroke.opacity ?? 1,
            borderLineCap: PDFLib.LineCapStyle?.Round,
            // Fill opacity composes with the whole-stroke opacity, matching
            // the on-screen SVG (opacity attr × fill-opacity attr).
            ...(fill ? {
                color: PDFLib.rgb(fill.r, fill.g, fill.b),
                opacity: (stroke.fillOpacity ?? 1) * (stroke.opacity ?? 1),
            } : {}),
        });
    }
}

function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const num = parseInt(clean.length === 3
        ? clean.split('').map(c => c + c).join('')
        : clean, 16);
    return {
        r: ((num >> 16) & 0xff) / 255,
        g: ((num >> 8) & 0xff) / 255,
        b: (num & 0xff) / 255,
    };
}

// ============================================
// PDF low-level utilities
// ============================================

/** Append a raw content stream to a page (for drawing with original fonts or images). */
function addContentStream(doc, page, content) {
    const bytes = new TextEncoder().encode(content);
    const stream = doc.context.stream(bytes);
    const ref = doc.context.register(stream);
    page.node.addContentStream(ref);
}

/**
 * Register an existing image XObject ref in another page's resources under a
 * fresh unique name so a content stream on that page can draw it.
 * Returns the name (without leading slash), or null on failure.
 */
function addImageXObjectToPage(doc, page, ref) {
    try {
        const { PDFName, PDFDict } = PDFLib;
        let resources = page.node.get(PDFName.of('Resources'));
        resources = resources instanceof PDFDict ? resources : (resources ? doc.context.lookup(resources) : null);
        if (!resources) {
            resources = doc.context.obj({});
            page.node.set(PDFName.of('Resources'), resources);
        }
        let xObjects = resources.get(PDFName.of('XObject'));
        xObjects = xObjects instanceof PDFDict ? xObjects : (xObjects ? doc.context.lookup(xObjects) : null);
        if (!xObjects) {
            xObjects = doc.context.obj({});
            resources.set(PDFName.of('XObject'), xObjects);
        }
        let n = 1, name;
        do { name = `EPFX${n++}`; } while (xObjects.has(PDFName.of(name)));
        xObjects.set(PDFName.of(name), ref);
        return name;
    } catch (_) {
        return null;
    }
}

// ============================================
// CMap font info — parse ToUnicode CMap for original font rendering
// ============================================

/** Attach glyph advances for alignment without substituting the original font. */
function attachFontMeasurements(info, fontObject, doc) {
    try {
        const N = PDFLib.PDFName.of;
        const baseName=fontObject.get(N('BaseFont'))?.decodeText();
        if (Object.values(PDFLib.StandardFonts).includes(baseName)) return;
        let base=fontObject;
        const descendant=fontObject.get(N('DescendantFonts'));
        if(descendant)base=doc.context.lookup(doc.context.lookup(descendant).get(0));
        const first=base.get(N('FirstChar'))?.asNumber() || 0;
        const widths=base.lookupMaybe(N('Widths'),PDFLib.PDFArray);
        const cidWidths=base.lookupMaybe(N('W'),PDFLib.PDFArray);
        const defaultWidth=base.get(N('DW'))?.asNumber() ?? 1000;
        const width=code=>{
            if(widths)return widths.get(code-first)?.asNumber?.() ?? null;
            if(!cidWidths)return null;
            for(let i=0;i<cidWidths.size();) {
                const start=cidWidths.get(i++).asNumber(), next=cidWidths.get(i++);
                if(next instanceof PDFLib.PDFArray){
                    if(code>=start && code<start+next.size())return next.get(code-start).asNumber();
                }else{
                    const end=next.asNumber(), w=cidWidths.get(i++).asNumber();
                    if(code>=start && code<=end)return w;
                }
            }
            return defaultWidth;
        };
        const keys=Object.keys(info.unicodeToGlyph || {}).sort((a,b)=>b.length-a.length);
        info.measure=(text,size)=>{
            let total=0;
            for(let offset=0;offset<text.length;){
                const key=keys.find(k=>text.startsWith(k,offset));
                if(!key)return null;
                const advance=width(parseInt(info.unicodeToGlyph[key],16));
                if(advance==null)return null;
                total+=advance;offset+=key.length;
            }
            const fm=fontObject.lookupMaybe(N('FontMatrix'),PDFLib.PDFArray);
            const unit=fm?Math.hypot(fm.get(0).asNumber(),fm.get(1).asNumber()):.001;
            return total*unit*size;
        };
    } catch (_) { /* Measuring is optional; encoding still preserves the font. */ }
}

/** Resolve the actual PostScript font and its CMap or PDF.js source encoding.
 * Document-wide PDF.js font counters are never treated as page resource indices.
 */
async function getFontInfo(doc, page, pageKey, pdjsFontName, cache, sourceFontName, sourceGlyphs) {
    // Font resources belong to the source page; cache by page and actual name.
    const cacheKey = `${pageKey}:${sourceFontName || pdjsFontName}`;
    if (cache[cacheKey] !== undefined) return cache[cacheKey];

    try {
        const resources = page.node.Resources();
        if (!resources) throw new Error('no resources');
        const fontDictRef = resources.get(PDFLib.PDFName.of('Font'));
        if (!fontDictRef) throw new Error('no font dict');
        const fontDict = fontDictRef instanceof PDFLib.PDFDict
            ? fontDictRef : doc.context.lookup(fontDictRef);
        if (!fontDict) throw new Error('cannot resolve font dict');

        // Get ordered list of font names from the dictionary
        const fontNames = fontDict.entries().map(([key]) =>
            key.decodeText ? key.decodeText() : key.toString().replace('/', '')
        );

        // PDF.js font counters are document-wide, NOT page dictionary indices.
        // Match the actual PostScript name, including the subset prefix.
        const normalize = name => name.replace(/^\//, '').replace(/^[A-Z]{6}\+/, '').toLowerCase();
        let matches = fontNames.filter(name => {
            const obj = doc.context.lookup(fontDict.get(PDFLib.PDFName.of(name)));
            const base = obj?.get(PDFLib.PDFName.of('BaseFont')) || doc.context.lookup(obj?.get(PDFLib.PDFName.of('FontDescriptor')))?.get(PDFLib.PDFName.of('FontName'));
            return sourceFontName && base && normalize(base.decodeText()) === normalize(sourceFontName);
        });
        if (matches.length > 1) matches = matches.filter(name => {
            const obj = doc.context.lookup(fontDict.get(PDFLib.PDFName.of(name)));
            return (obj.get(PDFLib.PDFName.of('BaseFont')) || doc.context.lookup(obj.get(PDFLib.PDFName.of('FontDescriptor')))?.get(PDFLib.PDFName.of('FontName')))?.decodeText() === sourceFontName;
        });
        const seenFonts=new Set();
        matches=matches.filter(name=>{const object=doc.context.lookup(fontDict.get(PDFLib.PDFName.of(name)));if(seenFonts.has(object))return false;seenFonts.add(object);return true;});
        if (matches.length !== 1) throw new Error('original font cannot be identified uniquely');
        const pdfFontName = matches[0];
        const fontRef = fontDict.get(PDFLib.PDFName.of(pdfFontName));
        const fontObj = fontRef instanceof PDFLib.PDFDict
            ? fontRef : doc.context.lookup(fontRef);
        if (!fontObj) throw new Error('cannot resolve font');

        // Get the ToUnicode CMap (maps glyph codes ↔ Unicode code points)
        const toUnicodeRef = fontObj.get(PDFLib.PDFName.of('ToUnicode'));
        if (!toUnicodeRef) {
            // Standard PDF fonts have a known encoding even without ToUnicode.
            const base = fontObj.get(PDFLib.PDFName.of('BaseFont'))?.decodeText();
            if (Object.values(PDFLib.StandardFonts).includes(base)) {
                const standard = await doc.embedFont(base);
                const result = { pdfFontName, encode: text => standard.encodeText(text).toString().slice(1,-1), measure: (text,size) => standard.widthOfTextAtSize(text,size) };
                attachFontMeasurements(result, fontObj, doc);
                cache[cacheKey] = result;
                return result;
            }
            const subtype = fontObj.get(PDFLib.PDFName.of('Subtype'))?.toString();
            const encoding = fontObj.get(PDFLib.PDFName.of('Encoding'))?.toString();
            const digits = subtype !== '/Type0' ? 2 : /^\/Identity-[HV]$/.test(encoding) ? 4 : 0;
            if (digits && sourceGlyphs && Object.keys(sourceGlyphs).length) {
                const unicodeToGlyph = {};
                for (const [unicode, code] of Object.entries(sourceGlyphs)) {
                    if (code < 16**digits) {
                        const hex = code.toString(16).padStart(digits,'0');
                        unicodeToGlyph[unicode] = hex;
                        unicodeToGlyph[unicode.normalize('NFKC')] ||= hex;
                    }
                }
                const result = {pdfFontName, unicodeToGlyph};
                attachFontMeasurements(result, fontObj, doc);
                cache[cacheKey] = result;
                return result;
            }
            throw new Error('no usable original character encoding');
        }
        const toUnicodeStream = doc.context.lookup(toUnicodeRef) || toUnicodeRef;
        if (!toUnicodeStream) throw new Error('cannot resolve ToUnicode');

        const cmapBytes = PDFLib.decodePDFRawStream(toUnicodeStream).decode();

        const unicodeToGlyph = parseCMap(new TextDecoder('latin1').decode(cmapBytes));
        let embeddedBytes;
        try {
            let base = fontObj;
            const descendants = base.get(PDFLib.PDFName.of('DescendantFonts'));
            if (descendants) base = doc.context.lookup(doc.context.lookup(descendants).get(0));
            const descriptor = doc.context.lookup(base.get(PDFLib.PDFName.of('FontDescriptor')));
            const file = descriptor?.get(PDFLib.PDFName.of('FontFile2')) || descriptor?.get(PDFLib.PDFName.of('FontFile3'));
            if (file) embeddedBytes = PDFLib.decodePDFRawStream(doc.context.lookup(file)).decode();
        } catch (_) { /* CMap encoding can still preserve the original font. */ }
        const result = { pdfFontName, unicodeToGlyph, embeddedBytes };
        attachFontMeasurements(result, fontObj, doc);
                cache[cacheKey] = result;
        return result;
    } catch (_) {
        cache[cacheKey] = null;
        return null;
    }
}

/**
 * Register a font from the origin page's resources in another page's
 * resources under a fresh unique name so content on that page can use it.
 * Returns the name (without leading slash), or null on failure.
 */
function ensureFontOnPage(doc, originPage, targetPage, pdfFontName) {
    try {
        const { PDFName, PDFDict } = PDFLib;
        const originRes = originPage.node.Resources();
        if (!originRes) return null;
        let originFonts = originRes.get(PDFName.of('Font'));
        originFonts = originFonts instanceof PDFDict ? originFonts : doc.context.lookup(originFonts);
        if (!originFonts) return null;
        const fontRef = originFonts.get(PDFName.of(pdfFontName));
        if (!fontRef) return null;

        let resources = targetPage.node.get(PDFName.of('Resources'));
        resources = resources instanceof PDFDict ? resources : (resources ? doc.context.lookup(resources) : null);
        if (!resources) {
            resources = doc.context.obj({});
            targetPage.node.set(PDFName.of('Resources'), resources);
        }
        let fonts = resources.get(PDFName.of('Font'));
        fonts = fonts instanceof PDFDict ? fonts : (fonts ? doc.context.lookup(fonts) : null);
        if (!fonts) {
            fonts = doc.context.obj({});
            resources.set(PDFName.of('Font'), fonts);
        }
        // Reuse if this exact ref is already registered on the target page
        for (const [name, ref] of fonts.entries()) {
            if (ref === fontRef) return name.toString().slice(1);
        }
        let n = 1, name;
        do { name = `EPFF${n++}`; } while (fonts.has(PDFName.of(name)));
        fonts.set(PDFName.of(name), fontRef);
        return name;
    } catch (_) {
        return null;
    }
}

/**
 * Parse an Adobe CMap to build a unicode→glyph hex mapping.
 * CMaps contain two types of entries:
 *   - beginbfchar/endbfchar: individual <glyphHex> <unicodeHex> pairs
 *   - beginbfrange/endbfrange: <startGlyph> <endGlyph> <startUnicode> ranges
 */
function parseCMap(cmapText) {
    const map = {};
    const unicode = hex => {
        const units = hex.match(/.{4}/g);
        return units ? String.fromCharCode(...units.map(h => parseInt(h,16))) : '';
    };
    const put = (glyph, hex) => {
        const text = unicode(hex);
        // Multiple Unicode characters can represent one ligature. Keep that
        // mapping too; the encoder uses the longest matching sequence first.
        if (text) { map[text] = glyph.toUpperCase(); map[text.normalize('NFKC')] ||= glyph.toUpperCase(); }
    };
    for (const [,block] of cmapText.matchAll(/beginbfchar\s*([\s\S]*?)endbfchar/g)) {
        for (const [,glyph,hex] of block.matchAll(/<([a-f\d]+)>\s*<([a-f\d]+)>/gi)) put(glyph,hex);
    }
    for (const [,block] of cmapText.matchAll(/beginbfrange\s*([\s\S]*?)endbfrange/g)) {
        for (const [,start,end,target,list] of block.matchAll(/<([a-f\d]+)>\s*<([a-f\d]+)>\s*(?:<([a-f\d]+)>|\[([^\]]*)\])/gi)) {
            const first=parseInt(start,16), last=parseInt(end,16);
            if (last-first > 65536) continue;
            const values=list ? [...list.matchAll(/<([a-f\d]+)>/gi)].map(m=>m[1]) : null;
            for(let glyph=first;glyph<=last;glyph++) {
                const hex=values ? values[glyph-first] : (BigInt('0x'+target)+BigInt(glyph-first)).toString(16).padStart(target.length,'0');
                if(hex)put(glyph.toString(16).padStart(start.length,'0'),hex);
            }
        }
    }
    return map;
}

// ============================================
// Download
// ============================================
export async function downloadPdf(pdfBytes, originalFileName, notice = '') {
    const defaultFilename = originalFileName || 'edited-document';
    const fileName = await showPrompt('Save as', 'Enter filename (without .pdf extension)', defaultFilename);
    if (fileName === null) return;

    const finalFilename = (fileName.trim() || defaultFilename) + '.pdf';
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = finalFilename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    showToast('Saved as ' + finalFilename + notice);
}

// Cache parsed source font resources across keystrokes. Each document owns its cache.
const preflightCache = new WeakMap();
export async function inspectTextFonts(pdfBytes, items, order) {
    const key=order.map(p=>p.kind==='original'?`o${p.sourcePageIndex}`:p.kind==='merged'?`m${p.entry.sourceId}:${p.entry.sourcePageIndex}`:'b').join(',');
    let cached=preflightCache.get(pdfBytes);
    if(!cached||cached.key!==key){
        const promise=assembleDocument(pdfBytes,order).then(async doc=>{
            if(typeof fontkit!=='undefined')doc.registerFontkit(fontkit);
            for(const p of doc.getPages())preserveNestedFonts(doc,p);
            return {doc,pages:doc.getPages(),cache:{},fonts:await embedStandardFonts(doc)};
        });
        cached={key,promise};preflightCache.set(pdfBytes,cached);
    }
    const {doc,pages,cache,fonts}=await cached.promise;
    const reports=[];
    for(const item of items){
        if(item.deleted||!item.currentText?.trim())continue;
        const chosen=item.fontFamilyOverride||item.fontWeightOverride||item.fontStyleOverride;
        const original=item.originalText&&!chosen;
        const source=pages[item.originPageIndex];
        const info=original&&source?await getFontInfo(doc,source,item.originPageIndex,item.fontName,cache,item.sourceFontName,item.sourceGlyphs):null;
        const characters=[...new Set([...item.currentText].filter(c=>!/[\r\n]/.test(c)))];
        const missing=original?characters.filter(c=>!canUseOriginal(info,c)):[];
        const fallback=getFallbackFont(item,fonts);
        const unrenderable=(!original||missing.length)?characters.filter(c=>{try{fallback.encodeText(c);return false;}catch{return true;}}):[];
        reports.push({item, font:item.sourceFontName||'Original font',missing,unrenderable,substitution:!!original&&(!info||missing.length>0),original:!!original});
    }
    return reports;
}
function canUseOriginal(info,text){
    if(!info)return false;
    if(info.encode){try{info.encode(text);return true;}catch{return false;}}
    if(info.unicodeToGlyph?.[text])return true;
    if(info.embeddedBytes&&typeof fontkit!=='undefined'){
        try{info.program ||= fontkit.create(info.embeddedBytes);return info.program.hasGlyphForCodePoint(text.codePointAt(0));}catch{}
    }
    return false;
}
