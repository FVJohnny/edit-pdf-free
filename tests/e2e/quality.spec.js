import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import fs from 'node:fs/promises';
import {
    loadFixture,
    savePdf,
    saveAndReload,
    drag,
    IMAGE_PNG,
    pixelAt
} from './helpers.js';

async function textFixture(info) {
    const d = await PDFDocument.create(),
        p = d.addPage([500, 400]),
        font = await d.embedFont(StandardFonts.Helvetica);
    p.drawText('First paragraph line', { x: 40, y: 320, size: 16, font });
    p.drawText('Second paragraph line', { x: 40, y: 300, size: 16, font });
    p.drawText('Neighbour', { x: 330, y: 320, size: 16, font });
    const file = info.outputPath('paragraph.pdf');
    await fs.writeFile(file, await d.save());
    return file;
}
test('paragraph keeps original leading; edit warns before overlapping its neighbour', async ({
    page
}, info) => {
    await loadFixture(page, await textFixture(info));
    const span = page
        .locator('.editable-text')
        .filter({ hasText: 'First paragraph line' });
    await expect(span).toContainText('Second paragraph line');
    await span.click();
    await expect(page.locator('#editNotice')).toContainText(
        'Original font available'
    );
    await page.keyboard.type(
        'This paragraph is deliberately much longer than the available space beside its neighbour'
    );
    await expect(page.locator('#editNotice')).toContainText(
        'overlaps neighbouring'
    );
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Changed first line');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('Changed second line');
    await page.keyboard.press('Enter');
    await saveAndReload(page);
    const result = page
        .locator('.editable-text')
        .filter({ hasText: 'Changed first line' });
    await expect(result).toContainText('Changed second line');
    const leading = await result.evaluate(
        (el) => parseFloat(el.style.lineHeight) / parseFloat(el.style.fontSize)
    );
    expect(leading).toBeCloseTo(1.25, 1);
    await expect(
        page.locator('.editable-text').filter({ hasText: 'Neighbour' })
    ).toHaveCount(1);
});
test('unsupported characters are reported before downloading and do not disappear silently', async ({
    page
}, info) => {
    await loadFixture(page, await textFixture(info));
    await page
        .locator('.editable-text')
        .filter({ hasText: 'Neighbour' })
        .click();
    await page.keyboard.insertText('Missing 漢');
    await expect(page.locator('#editNotice')).toContainText(
        'Cannot export these characters: 漢'
    );
    await page.keyboard.press('Enter');
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await page.click('#saveBtn');
    await expect(page.locator('.toast')).toContainText('cannot be exported');
    expect(downloads).toHaveLength(0);
    await expect(page.locator('.modal-overlay.visible')).toHaveCount(0);
});
test('missing subset characters require confirmation before font substitution', async ({
    page
}) => {
    await loadFixture(page);
    await page
        .locator('.editable-text')
        .filter({ hasText: 'PDF Bookmark Sample' })
        .first()
        .click();
    await page.keyboard.insertText('PDF ŽÐþ');
    await expect(page.locator('#editNotice')).toContainText(
        'Font substitution needed'
    );
    await page.keyboard.press('Enter');
    await page.click('#saveBtn');
    await expect(
        page.getByText('Review font substitutions', { exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('.modal-overlay.visible')).toHaveCount(0);
    await saveAndReload(page);
    await expect(
        page.locator('.editable-text').filter({ hasText: 'PDF ŽÐþ' })
    ).toHaveCount(1);
});

for (const operation of ['move', 'delete', 'rotate-move'])
    test(`original image ${operation} preserves artwork and transparency in preview and export`, async ({
        page
    }, info) => {
        const d = await PDFDocument.create(),
            p = d.addPage([500, 400]);
        p.drawRectangle({
            x: 0,
            y: 0,
            width: 500,
            height: 400,
            color: rgb(0.2, 0.6, 0.9)
        });
        p.drawLine({
            start: { x: 30, y: 280 },
            end: { x: 470, y: 280 },
            thickness: 5,
            color: rgb(1, 0, 0)
        });
        const image = await d.embedPng(await fs.readFile(IMAGE_PNG));
        p.drawImage(image, {
            x: operation === 'rotate-move' ? 170 : 50,
            y: 240,
            width: 120,
            height: 80,
            opacity: 0.6,
            ...(operation === 'rotate-move' ? { rotate: degrees(90) } : {})
        });
        p.drawText('Editable label', { x: 250, y: 330, size: 16 });
        const file = info.outputPath('image.pdf');
        await fs.writeFile(file, await d.save());
        await loadFixture(page, file);
        const overlay = page.locator('.draggable-image').first();
        const before = await overlay.boundingBox();
        if (operation === 'delete') {
            await overlay.click();
            await page.click('#imgDelete');
        } else {
            await drag(
                page,
                {
                    x: before.x + before.width / 2,
                    y: before.y + before.height / 2
                },
                {
                    x: before.x + before.width / 2 + 250,
                    y: before.y + before.height / 2 + 140
                }
            );
            expect(
                await overlay.evaluate((el) => getComputedStyle(el).opacity)
            ).toBe('0.6');
        }
        // Also edit text: the second removal pass must retain the moved image resource.
        await page
            .locator('.editable-text')
            .filter({ hasText: 'Editable label' })
            .click();
        await page.keyboard.type('New label');
        await page.keyboard.press('Enter');
        await expect.poll(() => pixelAt(page, 0.2, 0.3)).toEqual([255, 0, 0]);
        await saveAndReload(page);
        expect(await pixelAt(page, 0.2, 0.3)).toEqual([255, 0, 0]);
        await expect(
            page.locator('.editable-text').filter({ hasText: 'New label' })
        ).toHaveCount(1);
        await expect(page.locator('.draggable-image')).toHaveCount(
            operation === 'delete' ? 0 : 1
        );
        if (operation !== 'delete') {
            const after = await page
                .locator('.draggable-image')
                .first()
                .boundingBox();
            expect(after.width).toBeCloseTo(before.width, 0);
            expect(after.height).toBeCloseTo(before.height, 0);
            expect(
                await page
                    .locator('.draggable-image')
                    .first()
                    .evaluate((el) => getComputedStyle(el).opacity)
            ).toBe('0.6');
        }
    });

test('repeated transparent image: moving one occurrence leaves the other and its alpha mask intact', async ({
    page
}, info) => {
    const d = await PDFDocument.create(),
        p = d.addPage([500, 400]);
    p.drawRectangle({
        x: 0,
        y: 0,
        width: 500,
        height: 400,
        color: rgb(0.2, 0.6, 0.9)
    });
    const image = await d.embedPng(
        Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAD0lEQVR4nGP4z8AARAwMAAz8Af9c/RSVAAAAAElFTkSuQmCC',
            'base64'
        )
    );
    p.drawImage(image, { x: 30, y: 270, width: 100, height: 50 });
    p.drawImage(image, { x: 300, y: 270, width: 100, height: 50 });
    const file = info.outputPath('repeated-alpha.pdf');
    await fs.writeFile(file, await d.save());
    await loadFixture(page, file);
    const first = page.locator('.draggable-image').first(),
        box = await first.boundingBox();
    await drag(
        page,
        { x: box.x + box.width * 0.25, y: box.y + box.height / 2 },
        { x: box.x + box.width * 0.25 + 100, y: box.y + box.height / 2 + 170 }
    );
    const moved = await first.boundingBox(),
        base = await page.locator('canvas.pdf-page').boundingBox();
    const alphaPoint = [
        (moved.x + moved.width * 0.85 - base.x) / base.width,
        (moved.y + moved.height * 0.5 - base.y) / base.height
    ];
    await saveAndReload(page);
    await expect(page.locator('.draggable-image')).toHaveCount(2);
    expect(await pixelAt(page, 0.09, 0.25)).toEqual([51, 153, 230]);
    expect(await pixelAt(page, 0.64, 0.25)).toEqual([255, 0, 0]);
    expect(await pixelAt(page, ...alphaPoint)).toEqual([51, 153, 230]);
});
test('undoing original image deletion restores the preview and exported image', async ({
    page
}, info) => {
    const d = await PDFDocument.create(),
        p = d.addPage([500, 400]),
        image = await d.embedPng(await fs.readFile(IMAGE_PNG));
    p.drawImage(image, { x: 50, y: 240, width: 120, height: 80 });
    const file = info.outputPath('undo-original-image.pdf');
    await fs.writeFile(file, await d.save());
    await loadFixture(page, file);
    const img = page.locator('.draggable-image');
    await img.click();
    await page.click('#imgDelete');
    await expect(img).toBeHidden();
    await page.click('#undoBtn');
    await expect(img).toBeVisible();
    // The overlay is revealed together with the clean page surface, avoiding
    // two copies when undo beats the asynchronous original-image removal.
    await expect.poll(() => img.evaluate((el) => getComputedStyle(el).backgroundImage)).not.toBe('none');
    await saveAndReload(page);
    await expect(page.locator('.draggable-image')).toHaveCount(1);
});

test('standard Symbol glyphs load locally and retain their font after editing and export',async({page},info)=>{
    const d=await PDFDocument.create(),p=d.addPage([500,400]),font=await d.embedFont(StandardFonts.Symbol);
    p.drawText('Ωπ',{x:50,y:280,size:30,font});
    const file=info.outputPath('symbol.pdf');await fs.writeFile(file,await d.save());
    const warnings=[];page.on('console',message=>{if(message.text().includes('failed to fetch file'))warnings.push(message.text());});
    await loadFixture(page,file);
    const text=page.locator('.editable-text').filter({hasText:'π'});await text.click();
    await expect(page.locator('#editNotice')).toContainText('Original font available: Symbol');
    await page.keyboard.insertText('ππ');await page.keyboard.press('Enter');await saveAndReload(page);
    await expect(page.locator('.editable-text').filter({hasText:'ππ'})).toHaveCount(1);expect(warnings).toEqual([]);
});
