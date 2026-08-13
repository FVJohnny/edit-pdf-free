// Touch-only behaviors, run under the mobile emulation project. @touch
import { test, expect } from '@playwright/test';
import { startBlank } from './helpers.js';

/** The vertical band of the first page canvas that is actually visible
 *  (below the sticky bars, above the viewport bottom). */
async function visibleCanvasBand(page) {
    return page.evaluate(() => {
        // normalize scroll state: first page centered in the viewport
        document.querySelector('.pdf-viewer').scrollTop = 0;
        // behavior:'instant' overrides the page's scroll-behavior:smooth so
        // the very next getBoundingClientRect reads the final position
        document.querySelector('canvas.pdf-page').scrollIntoView({ block: 'center', behavior: 'instant' });
        const c = document.querySelector('canvas.pdf-page').getBoundingClientRect();
        let barsBottom = 0;
        for (const el of document.querySelectorAll('.toolbar, .pdf-tools')) {
            barsBottom = Math.max(barsBottom, el.getBoundingClientRect().bottom);
        }
        return {
            x: c.left + c.width / 2,
            top: Math.max(c.top + 10, barsBottom + 15),
            bottom: Math.min(c.bottom - 10, window.innerHeight - 25),
        };
    });
}

test.describe('Touch @touch', () => {
    test('drawing with a finger does not scroll the page @touch', async ({ page }) => {
        await startBlank(page);
        await page.click('#drawBtn');
        const band = await visibleCanvasBand(page);
        expect(band.bottom - band.top).toBeGreaterThan(120); // sanity: room to draw
        const scrollBefore = await page.evaluate(() =>
            (document.querySelector('.pdf-viewer').scrollTop) + window.scrollY);
        // vertical finger drag across the overlay — would scroll if unhandled
        const client = await page.context().newCDPSession(page);
        const y0 = band.top + 10;
        const span = Math.min(band.bottom - y0 - 10, 200);
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: band.x, y: y0 }] });
        for (let i = 1; i <= 8; i++) {
            await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: band.x, y: y0 + (span * i) / 8 }] });
        }
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const scrollAfter = await page.evaluate(() =>
            (document.querySelector('.pdf-viewer').scrollTop) + window.scrollY);
        expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(5);
        // and a stroke was actually drawn
        await expect(page.locator('.draw-overlay path.stroke-path')).toHaveCount(1);
    });

    test('tap near a stroke selects it on touch @touch', async ({ page }) => {
        await startBlank(page);
        await page.click('#drawBtn');
        const band = await visibleCanvasBand(page);
        const y = band.top + 40;
        const client = await page.context().newCDPSession(page);
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: band.x - 100, y }] });
        for (let i = 1; i <= 6; i++) {
            await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: band.x - 100 + i * 33, y }] });
        }
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.click('#drawDone');
        // deselect with a tap far from the stroke
        await page.touchscreen.tap(band.x, Math.min(band.bottom - 10, y + 220));
        await expect(page.locator('.stroke-selected')).toHaveCount(0);
        // tap 15px BELOW the line — the halo must select it
        const path = await page.locator('.draw-overlay path.stroke-path').boundingBox();
        await page.touchscreen.tap(path.x + path.width / 2, path.y + path.height + 15);
        await expect(page.locator('.stroke-selected')).toHaveCount(1);
    });
});
