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
    await saveAndReload(page);
    await expect(
        page.locator('.editable-text').filter({ hasText: 'CAB' })
    ).toHaveCount(1);
    expect(await pixelAt(page, 55 / 500, 120 / 400)).toEqual([0, 0, 0]);
    expect(await pixelAt(page, 65 / 500, 120 / 400)).toEqual([255, 255, 255]);
});
