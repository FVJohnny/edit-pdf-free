import { test, expect } from '@playwright/test';
import {
    startBlank, loadFixture, drag, saveAndReload, IMAGE_PNG, EXIF_JPG, settle,
} from './helpers.js';

/** Import an image and dismiss the compression modal choosing Original. */
async function importImage(page, file) {
    await page.setInputFiles('#imageInput', file);
    // single image: no compression modal; multiple: choose "Original"
    const modal = page.locator('.modal-choice', { hasText: /Original/i });
    try { await modal.click({ timeout: 2000 }); } catch (_) { /* no modal shown */ }
    await expect(page.locator('.draggable-image').last()).toBeVisible();
    return page.locator('.draggable-image').last();
}

test.describe('Images', () => {
    test('import: image appears selected with dashed outline and handles', async ({ page }) => {
        await startBlank(page);
        const img = await importImage(page, IMAGE_PNG);
        await expect(img).toHaveClass(/selected/);
        expect(await img.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('dashed');
        await expect(page.locator('#imageToolbar')).toBeVisible();
    });

    test('drag moves the image; resize from corner scales it', async ({ page }) => {
        await startBlank(page);
        const img = await importImage(page, IMAGE_PNG);
        const before = await img.boundingBox();
        await drag(page, { x: before.x + before.width / 2, y: before.y + before.height / 2 },
            { x: before.x + before.width / 2 + 130, y: before.y + before.height / 2 + 90 });
        const moved = await img.boundingBox();
        expect(moved.x - before.x).toBeGreaterThan(100);

        await img.click();
        const handle = await page.locator('.img-resize-se').boundingBox();
        await drag(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
            { x: handle.x + handle.width / 2 + 80, y: handle.y + handle.height / 2 + 60 });
        const resized = await img.boundingBox();
        expect(resized.width - moved.width).toBeGreaterThan(50);
    });

    test('rotate button turns the image 90° (undoable)', async ({ page }) => {
        await startBlank(page);
        const img = await importImage(page, IMAGE_PNG);
        const before = await img.boundingBox();
        await img.click();
        await page.click('#imgRotate');
        // rotation re-encodes pixels asynchronously — poll until dims swap
        await expect.poll(async () => {
            const b = await img.boundingBox();
            return Math.abs(b.width - before.height) < 4 && Math.abs(b.height - before.width) < 4;
        }).toBe(true);
        await page.click('#undoBtn');
        await expect.poll(async () => {
            const b = await img.boundingBox();
            return Math.abs(b.width - before.width) < 4;
        }).toBe(true);
    });

    test('delete image via toolbar; undo restores it', async ({ page }) => {
        await startBlank(page);
        const img = await importImage(page, IMAGE_PNG);
        await img.click();
        await page.click('#imgDelete');
        // deletion hides the overlay (kept for undo), it does not remove it
        await expect(img).toBeHidden();
        await page.click('#undoBtn');
        await expect(img).toBeVisible();
    });

    test('existing PDF image can be dragged (original covered on save)', async ({ page }) => {
        await loadFixture(page);
        const img = page.locator('.draggable-image').first(); // Accelio logo
        const before = await img.boundingBox();
        await drag(page, { x: before.x + before.width / 2, y: before.y + before.height / 2 },
            { x: before.x + before.width / 2 + 150, y: before.y + before.height / 2 + 100 });
        const after = await img.boundingBox();
        expect(after.x - before.x).toBeGreaterThan(120);
        await expect(img).toHaveClass(/moved|modified|selected/);
    });

    test('EXIF-rotated photo imports upright', async ({ page }) => {
        await startBlank(page);
        const img = await importImage(page, EXIF_JPG);
        const box = await img.boundingBox();
        // the raw pixels are landscape; EXIF orientation 6 → must display portrait
        expect(box.height).toBeGreaterThan(box.width);
    });

    test('imported image survives save+reload at its position', async ({ page }) => {
        await startBlank(page);
        const img = await importImage(page, IMAGE_PNG);
        const before = await img.boundingBox();
        const canvas = await page.locator('canvas.pdf-page').boundingBox();
        const relX = (before.x + before.width / 2 - canvas.x) / canvas.width;
        const relY = (before.y + before.height / 2 - canvas.y) / canvas.height;
        await saveAndReload(page);
        const nonWhite = await page.evaluate(([relX, relY]) => {
            const c = document.querySelector('canvas.pdf-page');
            const d = c.getContext('2d').getImageData(
                Math.round(c.width * relX), Math.round(c.height * relY), 1, 1).data;
            return d[0] < 245 || d[1] < 245 || d[2] < 245;
        }, [relX, relY]);
        expect(nonWhite).toBe(true);
    });
});
