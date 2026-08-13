import { test, expect } from '@playwright/test';
import { startBlank, drawSignatureSquiggle, saveAndReload, selectStroke } from './helpers.js';

test.describe('Signature', () => {
    test('modal opens with a white canvas that fits the modal', async ({ page }) => {
        await startBlank(page);
        await page.click('#signBtn');
        const canvas = page.locator('.signature-canvas');
        await expect(canvas).toBeVisible();
        expect(await canvas.evaluate(el => getComputedStyle(el).backgroundColor))
            .toBe('rgb(255, 255, 255)');
        const [cBox, mBox] = await Promise.all([
            canvas.boundingBox(), page.locator('.modal--signature').boundingBox()]);
        expect(cBox.x + cBox.width).toBeLessThanOrEqual(mBox.x + mBox.width + 1);
    });

    test('Cancel closes the modal without placing anything; Clear only clears', async ({ page }) => {
        await startBlank(page);
        await page.click('#signBtn');
        await drawSignatureSquiggle(page);
        await page.click('.signature-clear'); // must clear, NOT close
        await expect(page.locator('.modal--signature')).toBeVisible();
        await expect(page.locator('.modal-btn--confirm')).toBeDisabled();
        await page.click('.modal-actions .modal-btn--cancel'); // must close
        await expect(page.locator('.modal--signature')).toHaveCount(0);
        await expect(page.locator('.draggable-image')).toHaveCount(0);
    });

    test('placing a signature creates a draggable image; bitmap stays transparent', async ({ page }) => {
        await startBlank(page);
        await page.click('#signBtn');
        // corner of the bitmap must be transparent (white paper is CSS-only)
        const cornerAlpha = await page.evaluate(() => {
            const c = document.querySelector('.signature-canvas');
            return c.getContext('2d').getImageData(2, 2, 1, 1).data[3];
        });
        expect(cornerAlpha).toBe(0);
        await drawSignatureSquiggle(page);
        await page.click('.modal-btn--confirm');
        await expect(page.locator('.draggable-image')).toHaveCount(1);
        await expect(page.locator('.draggable-image')).toHaveClass(/selected/);
    });

    test('placing a signature drops any selected stroke (exclusive selection)', async ({ page }) => {
        await startBlank(page);
        await page.click('#drawBtn');
        const box = await page.locator('canvas.pdf-page').boundingBox();
        await page.mouse.move(box.x + 100, box.y + 100);
        await page.mouse.down();
        await page.mouse.move(box.x + 250, box.y + 160, { steps: 6 });
        await page.mouse.up();
        await page.click('#drawDone');
        await selectStroke(page); // Done dismisses the selection — re-select
        await expect(page.locator('.stroke-selected')).toHaveCount(1);
        await page.click('#signBtn');
        await drawSignatureSquiggle(page);
        await page.click('.modal-btn--confirm');
        await expect(page.locator('.stroke-selected')).toHaveCount(0);
        await expect(page.locator('.shape-handles')).toHaveCount(0);
        await expect(page.locator('.draggable-image')).toHaveClass(/selected/);
    });

    test('signature survives save+reload', async ({ page }) => {
        await startBlank(page);
        await page.click('#signBtn');
        await drawSignatureSquiggle(page);
        await page.click('.modal-btn--confirm');
        const img = page.locator('.draggable-image');
        const before = await img.boundingBox();
        const canvas = await page.locator('canvas.pdf-page').boundingBox();
        const relX = (before.x + before.width / 2 - canvas.x) / canvas.width;
        const relY = (before.y + before.height / 2 - canvas.y) / canvas.height;
        await saveAndReload(page);
        const hasInk = await page.evaluate(([relX, relY]) => {
            const c = document.querySelector('canvas.pdf-page');
            const w = Math.round(c.width * 0.2), h = Math.round(c.height * 0.06);
            const d = c.getContext('2d').getImageData(
                Math.round(c.width * relX - w / 2), Math.round(c.height * relY - h / 2), w, h).data;
            for (let i = 0; i < d.length; i += 4) {
                if (d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120) return true; // dark ink
            }
            return false;
        }, [relX, relY]);
        expect(hasInk).toBe(true);
    });
});
