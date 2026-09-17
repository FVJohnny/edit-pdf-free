import { test, expect } from '@playwright/test';
import { PDFDocument, rgb } from 'pdf-lib';
import fs from 'node:fs/promises';
import { loadFixture, countPixels, pixelAt, saveAndReload, settle } from './helpers.js';

async function fixture(info) {
    const doc = await PDFDocument.create(), page = doc.addPage([500, 300]);
    page.drawRectangle({ x: 0, y: 0, width: 500, height: 300, color: rgb(.2, .6, .9) });
    page.drawText('MOVE ME', { x: 40, y: 235, size: 20, color: rgb(1, 0, 0) });
    const image = await doc.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAD0lEQVR4nGP4z8AARAwMAAz8Af9c/RSVAAAAAElFTkSuQmCC', 'base64'));
    page.drawImage(image, { x: 230, y: 220, width: 100, height: 50 });
    page.drawLine({ start: { x: 20, y: 240 }, end: { x: 450, y: 240 }, thickness: 2, color: rgb(0, 1, 0) });
    const path = info.outputPath('drag-background.pdf');
    await fs.writeFile(path, await doc.save());
    return path;
}

for (const kind of ['text', 'image', 'group']) {
    test(`${kind} drag never shows a second copy while the removal engine is starting`, async ({ page }, info) => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        await page.route('**/mupdf-wasm.wasm', async route => { await gate; await route.continue(); });
        await loadFixture(page, await fixture(info));
        const text = page.locator('.editable-text').filter({ hasText: 'MOVE ME' });
        const image = page.locator('.draggable-image').first();
        if (kind === 'group') {
            await text.click({ modifiers: ['Shift'] });
            await image.click({ modifiers: ['Shift'] });
            await expect(page.locator('.multi-selected')).toHaveCount(2);
        }
        const lead = kind === 'image' ? image : text;
        await lead.scrollIntoViewIfNeeded();
        await settle(page);
        const box = await lead.boundingBox();
        try {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 90, { steps: 4 });
            await expect(lead).toHaveClass(/dragging/);
            // The source is still painted while WASM is deliberately held. Only
            // the selection outline may move; two painted copies must never appear.
            expect(await countPixels(page, [.07, .14, .23, .1], [255, 0, 0], 20)).toBeGreaterThan(30);
            if (kind !== 'image') expect(await text.evaluate(el => getComputedStyle(el).color)).toBe('rgba(0, 0, 0, 0)');
            if (kind !== 'text') expect(await image.evaluate(el => getComputedStyle(el).backgroundImage)).toBe('none');
            release();
            // Keep the pointer down through the handover: the original canvas
            // and the high-resolution surface must both stop painting the source.
            if (kind !== 'image') {
                await expect.poll(() => countPixels(page, [.07, .14, .23, .1], [255, 0, 0], 20)).toBe(0);
                await expect.poll(() => text.evaluate(el => getComputedStyle(el).color)).toBe('rgb(255, 0, 0)');
            }
            if (kind !== 'text') await expect.poll(() => image.evaluate(el => getComputedStyle(el).backgroundImage)).not.toBe('none');
            expect(await pixelAt(page, .8, .2)).toEqual([0, 255, 0]);
            await page.mouse.up();
            await saveAndReload(page);
            await expect(page.locator('.editable-text').filter({ hasText: 'MOVE ME' })).toHaveCount(1);
            await expect(page.locator('.draggable-image')).toHaveCount(1);
        } finally { release(); }
    });
}
