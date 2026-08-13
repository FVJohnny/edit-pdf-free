// Touch-only behaviors, run under the mobile emulation project. @touch
// Everything here uses REAL touch events (CDP/touchscreen), not mouse — the
// app has touch-specific code paths (arm-to-edit, enlarged handles) that
// mouse interactions never exercise.
import { test, expect } from '@playwright/test';
import { startBlank, IMAGE_PNG } from './helpers.js';

/** Finger drag between two client points via CDP touch events. */
async function touchDrag(page, from, to, steps = 8) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }],
        });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach().catch(() => {});
}

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

test.describe('Touch interactions @touch', () => {
    test('text: first tap arms it (toolbar, no editing), second tap edits @touch', async ({ page }) => {
        await startBlank(page);
        // place a text (tap → synchronous placement), confirm, deselect
        await page.click('#addTextBtn');
        const band = await visibleCanvasBand(page);
        await page.touchscreen.tap(band.x, band.top + 60);
        await page.keyboard.type('toque doble');
        await page.keyboard.press('Enter');
        await page.touchscreen.tap(band.x, band.top + 250); // dismiss
        const span = page.locator('.editable-text.modified', { hasText: 'toque doble' });
        await expect(page.locator('#formatToolbar')).toBeHidden();

        // first tap: arms — toolbar shows but NOT editing yet
        const sb = await span.boundingBox();
        await page.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height / 2);
        await expect(page.locator('#formatToolbar')).toBeVisible();
        expect(await span.evaluate(el => el.isContentEditable)).toBe(false);

        // second tap: edits
        await page.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height / 2);
        expect(await span.evaluate(el => el.isContentEditable)).toBe(true);
    });

    test('text: an armed text drags with the finger @touch', async ({ page }) => {
        await startBlank(page);
        await page.click('#addTextBtn');
        const band = await visibleCanvasBand(page);
        await page.touchscreen.tap(band.x, band.top + 60);
        await page.keyboard.type('arrastra');
        await page.keyboard.press('Enter');
        await page.touchscreen.tap(band.x, band.top + 250); // dismiss
        const span = page.locator('.editable-text.modified', { hasText: 'arrastra' });
        const before = await span.boundingBox();
        await page.touchscreen.tap(before.x + 5, before.y + before.height / 2); // arm
        await touchDrag(page,
            { x: before.x + 10, y: before.y + before.height / 2 },
            { x: before.x + 90, y: before.y + before.height / 2 + 70 });
        const after = await span.boundingBox();
        expect(after.x - before.x).toBeGreaterThan(50);
        expect(after.y - before.y).toBeGreaterThan(40);
    });

    test('image: tap selects; finger drag moves; enlarged corner handle resizes @touch', async ({ page }) => {
        await startBlank(page);
        await page.setInputFiles('#imageInput', IMAGE_PNG);
        const img = page.locator('.draggable-image');
        await expect(img).toBeVisible();
        // deselect, then tap to select
        const band = await visibleCanvasBand(page);
        await page.touchscreen.tap(band.x, band.bottom - 15);
        await expect(img).not.toHaveClass(/selected/);
        let b = await img.boundingBox();
        await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
        await expect(img).toHaveClass(/selected/);

        // finger drag moves it
        b = await img.boundingBox();
        await touchDrag(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 },
            { x: b.x + b.width / 2 + 70, y: b.y + b.height / 2 + 50 });
        const moved = await img.boundingBox();
        expect(moved.x - b.x).toBeGreaterThan(40);

        // corner handle (22px on touch) resizes with the finger
        await page.touchscreen.tap(moved.x + moved.width / 2, moved.y + moved.height / 2);
        const h = await page.locator('.img-resize-se').boundingBox();
        expect(h.width).toBeGreaterThanOrEqual(20); // enlarged touch target
        await touchDrag(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 },
            { x: h.x + h.width / 2 + 60, y: h.y + h.height / 2 + 45 });
        const resized = await img.boundingBox();
        expect(resized.width - moved.width).toBeGreaterThan(35);
    });

    test('shape: finger resize works even 10px off the corner handle @touch', async ({ page }) => {
        await startBlank(page);
        await page.click('#shapesBtn');
        const band = await visibleCanvasBand(page);
        await touchDrag(page, { x: band.x - 80, y: band.top + 40 },
            { x: band.x + 60, y: band.top + 150 });
        await expect(page.locator('.shape-handle')).toHaveCount(4);
        const path = page.locator('.draw-overlay path.stroke-path');
        const before = await path.boundingBox();
        const se = await page.locator('.shape-handle[data-role="se"]').boundingBox();
        expect(se.width).toBeGreaterThanOrEqual(20); // enlarged touch target
        await touchDrag(page,
            { x: se.x + se.width / 2 - 10, y: se.y + se.height / 2 - 10 },
            { x: se.x + se.width / 2 + 70, y: se.y + se.height / 2 + 50 });
        const after = await path.boundingBox();
        expect(after.width - before.width).toBeGreaterThan(40);
        expect(Math.abs(after.x - before.x)).toBeLessThan(10); // resized, not moved
    });

    test('color popover and floating toolbar fit the phone viewport @touch', async ({ page }) => {
        await startBlank(page);
        await page.click('#drawBtn');
        const band = await visibleCanvasBand(page);
        await touchDrag(page, { x: band.x - 80, y: band.top + 40 },
            { x: band.x + 60, y: band.top + 60 });
        const vp = page.viewportSize();
        // stroke toolbar within viewport
        const tb = await page.locator('#strokeToolbar').boundingBox();
        expect(tb.x).toBeGreaterThanOrEqual(0);
        expect(tb.x + tb.width).toBeLessThanOrEqual(vp.width + 1);
        // popover opens fully on-screen
        await page.touchscreen.tap(...Object.values(await (async () => {
            const b = await page.locator('#strokeColorInput').boundingBox();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        })()));
        const pop = page.locator('.color-popover');
        await expect(pop).toBeVisible();
        const pb = await pop.boundingBox();
        expect(pb.x).toBeGreaterThanOrEqual(0);
        expect(pb.x + pb.width).toBeLessThanOrEqual(vp.width + 1);
        expect(pb.y).toBeGreaterThanOrEqual(0);
        expect(pb.y + pb.height).toBeLessThanOrEqual(vp.height + 1);
    });
});
