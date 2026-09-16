import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import fs from 'node:fs/promises';
import { loadFixture, savePdf, settle, canvasPoint } from './helpers.js';

test('editing retains metadata, fillable fields, external links, internal destinations and bookmarks', async ({
    page
}, info) => {
    const d = await PDFDocument.create();
    d.setTitle('Preserved title');
    d.setAuthor('Original author');
    const p = d.addPage([500, 400]),
        p2 = d.addPage([500, 400]);
    p.drawText('Edit this heading', {
        x: 40,
        y: 320,
        size: 18,
        font: await d.embedFont(StandardFonts.Helvetica)
    });
    const field = d.getForm().createTextField('Customer');
    field.setText('Ada');
    field.addToPage(p, { x: 50, y: 180, width: 180, height: 25 });
    const external = d.context.register(
        d.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [40, 300, 220, 345],
            Border: [0, 0, 0],
            A: { S: 'URI', URI: PDFString.of('https://example.com') }
        })
    );
    p.node.addAnnot(external);
    const internal = d.context.register(
        d.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [40, 120, 140, 150],
            Border: [0, 0, 0],
            Dest: [p2.ref, 'Fit']
        })
    );
    p.node.addAnnot(internal);
    const root = d.context.obj({ Type: 'Outlines' }),
        rootRef = d.context.register(root);
    const child = d.context.register(
        d.context.obj({
            Title: PDFString.of('Second page'),
            Parent: rootRef,
            Dest: [p2.ref, 'Fit']
        })
    );
    root.set(PDFName.of('First'), child);
    root.set(PDFName.of('Last'), child);
    root.set(PDFName.of('Count'), d.context.obj(1));
    d.catalog.set(PDFName.of('Outlines'), rootRef);
    const file = info.outputPath('structured.pdf');
    await fs.writeFile(file, await d.save());
    await loadFixture(page, file);
    await page
        .locator('.editable-text')
        .filter({ hasText: 'Edit this heading' })
        .click();
    await page.keyboard.type('Edited heading');
    await page.keyboard.press('Enter');
    const saved = await PDFDocument.load(
        await fs.readFile(await savePdf(page))
    );
    expect(saved.getTitle()).toBe('Preserved title');
    expect(saved.getAuthor()).toBe('Original author');
    expect(saved.getForm().getTextField('Customer').getText()).toBe('Ada');
    const annots = saved
        .getPage(0)
        .node.Annots()
        .asArray()
        .map((ref) => saved.context.lookup(ref));
    expect(
        annots.some(
            (a) =>
                saved.context
                    .lookup(a.get(PDFName.of('A')))
                    ?.lookup(PDFName.of('URI'))
                    ?.decodeText() === 'https://example.com'
        )
    ).toBe(true);
    expect(
        annots
            .find((a) => a.has(PDFName.of('Dest')))
            .lookup(PDFName.of('Dest'))
            .get(0)
            .toString()
    ).toBe(saved.getPage(1).ref.toString());
    const outline = saved.catalog
        .lookup(PDFName.of('Outlines'))
        .lookup(PDFName.of('First'));
    expect(outline.lookup(PDFName.of('Title')).decodeText()).toBe(
        'Second page'
    );
    expect(outline.lookup(PDFName.of('Dest')).get(0).toString()).toBe(
        saved.getPage(1).ref.toString()
    );
});

async function structureFixture(info, name) {
    const d = await PDFDocument.create(),
        p = d.addPage([500, 400]),
        second = d.addPage([500, 400]),
        N = PDFName.of;
    p.drawText(name + ' first', { x: 40, y: 330, size: 16 });
    second.drawText(name + ' second', { x: 40, y: 330, size: 16 });
    const field = d.getForm().createTextField('Customer');
    field.setText(name);
    field.addToPage(p, { x: 50, y: 180, width: 180, height: 25 });
    d.catalog.set(
        N('Names'),
        d.context.obj({
            Dests: { Names: [PDFString.of('second'), [second.ref, 'Fit']] }
        })
    );
    p.node.addAnnot(
        d.context.register(
            d.context.obj({
                Type: 'Annot',
                Subtype: 'Link',
                Rect: [20, 20, 50, 50],
                Dest: PDFString.of('second')
            })
        )
    );
    const root = d.context.obj({ Type: 'Outlines', Count: 1 }),
        ref = d.context.register(root);
    const child = d.context.register(
        d.context.obj({
            Title: PDFString.of(name + ' bookmark'),
            Parent: ref,
            Dest: PDFString.of('second')
        })
    );
    root.set(N('First'), child);
    root.set(N('Last'), child);
    d.catalog.set(N('Outlines'), ref);
    d.catalog.set(
        N('PageLabels'),
        d.context.obj({ Nums: [0, { S: 'r', St: 1 }] })
    );
    await d.attach(
        new TextEncoder().encode('Original attachment'),
        name + '.txt',
        { mimeType: 'text/plain' }
    );
    const file = info.outputPath(name + '.pdf');
    await fs.writeFile(file, await d.save());
    return file;
}
test('merge keeps both forms with duplicate names, donor bookmark and named internal link', async ({
    page
}, info) => {
    await loadFixture(page, await structureFixture(info, 'Main'));
    await page.setInputFiles(
        '#mergePdfInput',
        await structureFixture(info, 'Donor')
    );
    await expect(page.locator('.pdf-viewer > div')).toHaveCount(4);
    const d = await PDFDocument.load(await fs.readFile(await savePdf(page))),
        N = PDFName.of;
    expect(d.getForm().getTextField('Customer').getText()).toBe('Main');
    expect(d.getForm().getTextField('Merged 1.Customer').getText()).toBe(
        'Donor'
    );
    const outline = d.catalog.lookup(N('Outlines')).lookup(N('Last')),
        child = outline.lookup(N('First'));
    expect(child.lookup(N('Dest')).get(0).toString()).toBe(
        d.getPage(3).ref.toString()
    );
    expect(child.get(N('Parent')).toString()).toBe(
        d.catalog.lookup(N('Outlines')).get(N('Last')).toString()
    );
    const link = d
        .getPage(2)
        .node.Annots()
        .asArray()
        .map((r) => d.context.lookup(r))
        .find((a) => a.get(N('Subtype')).toString() === '/Link');
    expect(link.lookup(N('Dest')).get(0).toString()).toBe(
        d.getPage(3).ref.toString()
    );
    expect(d.catalog.lookup(N('Names')).has(N('EmbeddedFiles'))).toBe(true);
});
test('deleting a destination page prunes its links and retains the surviving field', async ({
    page
}, info) => {
    await loadFixture(page, await structureFixture(info, 'Keep'));
    await page.locator('.pdf-minimap-page').nth(1).hover();
    await page
        .locator('.pdf-minimap-page')
        .nth(1)
        .locator('.minimap-delete')
        .click();
    await expect(page.locator('.pdf-viewer > div')).toHaveCount(1);
    const d = await PDFDocument.load(await fs.readFile(await savePdf(page))),
        N = PDFName.of;
    expect(d.getForm().getTextField('Customer').getText()).toBe('Keep');
    expect(
        d
            .getPage(0)
            .node.Annots()
            .asArray()
            .some(
                (r) =>
                    d.context.lookup(r).get(N('Subtype')).toString() === '/Link'
            )
    ).toBe(false);
    expect(
        d.catalog.lookup(N('Outlines')).lookup(N('First')).has(N('Dest'))
    ).toBe(false);
    expect(d.catalog.lookup(N('Names')).has(N('Dests'))).toBe(false);
});
test('reordering pages keeps form widgets, link targets, bookmarks and original page labels attached', async ({
    page
}, info) => {
    await loadFixture(page, await structureFixture(info, 'Order'));
    const first = page.locator('.pdf-minimap-page').first(),
        last = page.locator('.pdf-minimap-page').last();
    await canvasPoint(page, .5, .25);
    await settle(page);
    const thumb = await first.boundingBox();
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
    const from = await first.locator('.minimap-handle').boundingBox(),
        to = await last.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height + 4, {
        steps: 10
    });
    await page.mouse.up();
    await expect(
        page.locator('.pdf-viewer > div').first().locator('.editable-text')
    ).toContainText('Order second');
    const d = await PDFDocument.load(await fs.readFile(await savePdf(page))),
        N = PDFName.of;
    const dest = d.catalog
        .lookup(N('Outlines'))
        .lookup(N('First'))
        .lookup(N('Dest'));
    expect(dest.get(0).toString()).toBe(d.getPage(0).ref.toString());
    expect(d.getForm().getTextField('Customer').getText()).toBe('Order');
    expect(
        d.catalog
            .lookup(N('PageLabels'))
            .lookup(N('Nums'))
            .lookup(1)
            .lookup(N('St'))
            .asNumber()
    ).toBe(2);
});
