import { test, expect } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import fs from 'node:fs/promises';
import { loadFixture, saveAndReload, pixelAt } from './helpers.js';

test('Type3 font without BaseFont is retained with exact glyph programs in preview and export', async ({
    page
}, info) => {
    const d = await PDFDocument.create(),
        p = d.addPage([500, 400]),
        N = PDFName.of;
    const stream = (s) =>
        d.context.register(d.context.stream(new TextEncoder().encode(s)));
    const font = d.context.register(
        d.context.obj({
            Type: 'Font',
            Subtype: 'Type3',
            FontBBox: [0, 0, 650, 700],
            FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
            FirstChar: 65,
            LastChar: 67,
            Widths: [650, 650, 650],
            FontDescriptor: d.context.register(
                d.context.obj({
                    Type: 'FontDescriptor',
                    FontName: 'VectorLetters',
                    Flags: 4,
                    ItalicAngle: 0,
                    CapHeight: 700,
                    Ascent: 700,
                    Descent: 0
                })
            ),
            Encoding: { Type: 'Encoding', Differences: [65, 'A', 'B', 'C'] },
            CharProcs: {
                A: stream('650 0 d0 0 0 600 700 re f'),
                B: stream('650 0 d0 0 0 600 350 re f'),
                C: stream('650 0 d0 0 0 300 700 re f')
            },
            ToUnicode: stream(
                '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Vector def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 3 beginbfchar <41> <0041> <42> <0042> <43> <0043> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end'
            )
        })
    );
    p.node.set(N('Resources'), d.context.obj({ Font: { F1: font } }));
    p.node.addContentStream(
        stream('BT /F1 30 Tf 1 0 0 1 50 270 Tm <414243> Tj ET')
    );
    const file = info.outputPath('vector-font.pdf');
    await fs.writeFile(file, await d.save());
    await loadFixture(page, file);
    const span = page.locator('.editable-text').filter({ hasText: 'ABC' });
    await span.click();
    await expect(page.locator('#editNotice')).toContainText(
        'Original font available: VectorLetters'
    );
    await page.keyboard.type('CAB');
    await page.keyboard.press('Enter');
    const changed = page.locator('.editable-text').filter({ hasText: 'CAB' });
    await expect(changed).toHaveAttribute('data-native-preview', 'true');
    // Letter C is half-width, full-height. Check actual PDF-rendered glyph pixels.
    await expect
        .poll(() => pixelAt(page, 55 / 500, 120 / 400))
        .toEqual([0, 0, 0]);
    expect(await pixelAt(page, 65 / 500, 120 / 400)).toEqual([255, 255, 255]);
    // A confirmed Type3 edit is baked into the page preview. Picking it up
    // again must remove that painted copy before showing the moving overlay.
    const box = await changed.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 5 });
    await expect.poll(() => pixelAt(page, 55 / 500, 120 / 400)).toEqual([255, 255, 255]);
    await expect.poll(() => changed.evaluate(el => getComputedStyle(el).color)).not.toBe('rgba(0, 0, 0, 0)');
    await expect(changed).not.toHaveAttribute('data-native-preview', 'true');
    await page.mouse.up();
    await expect(changed).toHaveAttribute('data-native-preview', 'true');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => pixelAt(page, 55 / 500, 120 / 400)).toEqual([0, 0, 0]);

    // Hold the worker for a confirmation preview, then pick the text up again
    // before that preview can paint. A stale confirmation must not repaint it
    // underneath the moving overlay, even when no native-preview attribute has
    // been applied yet.
    await changed.click();
    await expect.poll(() => pixelAt(page, 55 / 500, 120 / 400)).toEqual([255, 255, 255]);
    await expect(page.locator('canvas.pdf-detail')).toBeVisible();
    const oldDetail = await page.locator('canvas.pdf-detail').elementHandle();
    let release, requested;
    const gate = new Promise(resolve => { release = resolve; });
    const request = new Promise(resolve => { requested = resolve; });
    await page.route('**/vendor/pdf.worker.min.js', async route => { requested(); await gate; await route.continue(); });
    await page.keyboard.press('Enter');
    try {
        await request;
        const again = await changed.boundingBox();
        await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
        await page.mouse.down();
        await page.mouse.move(again.x + again.width / 2 + 120, again.y + again.height / 2 + 60, { steps: 5 });
        release();
        await expect.poll(() => oldDetail.evaluate(el => el.isConnected)).toBe(false);
        expect(await pixelAt(page, 55 / 500, 120 / 400)).toEqual([255, 255, 255]);
        await expect(changed).not.toHaveAttribute('data-native-preview', 'true');
        await expect.poll(() => changed.evaluate(el => getComputedStyle(el).color)).not.toBe('rgba(0, 0, 0, 0)');
        await page.mouse.up();
        await expect(changed).toHaveAttribute('data-native-preview', 'true');
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect.poll(() => pixelAt(page, 55 / 500, 120 / 400)).toEqual([0, 0, 0]);
    } finally { release(); }
    await saveAndReload(page);
    await expect(
        page.locator('.editable-text').filter({ hasText: 'CAB' })
    ).toHaveCount(1);
    expect(await pixelAt(page, 55 / 500, 120 / 400)).toEqual([0, 0, 0]);
    expect(await pixelAt(page, 65 / 500, 120 / 400)).toEqual([255, 255, 255]);
});
