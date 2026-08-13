// Shared helpers for the e2e suite. All interactions go through real input
// events (mouse/touch) — the same way a user drives the app.
import { expect } from '@playwright/test';
import path from 'path';

// Playwright transpiles these specs to CJS (no import.meta) — __dirname works.
export const FIXTURES = path.join(__dirname, '..', 'fixtures');
export const MAIN_PDF = path.join(FIXTURES, 'with-colored-texts-and-images.pdf');
export const IMAGE_PNG = path.join(FIXTURES, 'test-image-2.png');
export const EXIF_JPG = path.join(FIXTURES, 'exif-rotated-photo.jpg');
export const ENCRYPTED_PDF = path.join(FIXTURES, 'encrypted-1234.pdf');

/** Open the app and start a blank one-page PDF. */
export async function startBlank(page) {
    await page.goto('/');
    await page.evaluate(() => window.indexedDB?.deleteDatabase?.('pdf-editor-autosave'));
    await page.click('.upload-blank-btn');
    await expect(page.locator('.pdf-viewer > div')).toHaveCount(1);
    await settle(page);
}

/** Open the app and load the main multi-page fixture. */
export async function loadFixture(page, file = MAIN_PDF) {
    await page.goto('/');
    await page.evaluate(() => window.indexedDB?.deleteDatabase?.('pdf-editor-autosave'));
    await page.setInputFiles('#pdfInput', file);
    await expect(page.locator('.pdf-viewer > div').first()).toBeVisible({ timeout: 15000 });
    await settle(page);
}

/** Wait until every scroll (smooth scroll-into-view included) has stopped. */
export async function settle(page) {
    await page.waitForFunction(() => {
        const v = document.querySelector('.pdf-viewer');
        const key = (window.scrollY || 0) + ':' + (v ? v.scrollTop : 0);
        if (window.__settleKey === key) {
            return Date.now() - window.__settleT > 350;
        }
        window.__settleKey = key;
        window.__settleT = Date.now();
        return false;
    }, { timeout: 10000, polling: 100 });
}

/**
 * Client coordinates for a relative point on a page canvas. Pages are taller
 * than the viewport, so this scrolls the viewer until the point is actually
 * on screen (and below the sticky editor bars) before returning it.
 */
export async function canvasPoint(page, relX, relY, pageIndex = 0) {
    const vp = page.viewportSize();
    const TOP = 240;                 // below the pinned toolbar/tools bars
    const BOTTOM = vp.height - 40;
    for (let i = 0; i < 5; i++) {
        const box = await page.locator('canvas.pdf-page').nth(pageIndex).boundingBox();
        const x = box.x + box.width * relX;
        const y = box.y + box.height * relY;
        if (y >= TOP && y <= BOTTOM) return { x, y };
        await page.evaluate(([delta]) => {
            document.querySelector('.pdf-viewer').scrollTop += delta;
        }, [y < TOP ? y - TOP - 120 : y - BOTTOM + 120]);
        await page.waitForTimeout(150);
    }
    const box = await page.locator('canvas.pdf-page').nth(pageIndex).boundingBox();
    return { x: box.x + box.width * relX, y: box.y + box.height * relY };
}

/** Drag with the mouse between two client points. */
export async function drag(page, from, to, steps = 8) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
        await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    }
    await page.mouse.up();
}

/** Enable a draw tool and drag out a stroke/shape on the first page. */
export async function drawStroke(page, tool, from, to) {
    const group = ['pen', 'highlighter'].includes(tool) ? 'drawBtn' : 'shapesBtn';
    const palette = page.locator('#drawPalette');
    if (!(await palette.isVisible())) await page.click('#' + group);
    else if ((await palette.getAttribute('data-group')) !== (group === 'drawBtn' ? 'draw' : 'shapes')) {
        await page.click('#' + group);
    }
    await page.click(`.draw-tool[data-tool="${tool}"]`);
    // Scroll so the START point is clear of the sticky bars (the drag's later
    // moves reach the app through document listeners regardless), then take
    // BOTH points from a single box snapshot — computing them separately can
    // scroll in between and leave the first point stale.
    await canvasPoint(page, from[0], from[1]);
    const box = await page.locator('canvas.pdf-page').first().boundingBox();
    const a = { x: box.x + box.width * from[0], y: box.y + box.height * from[1] };
    const b = { x: box.x + box.width * to[0], y: box.y + box.height * to[1] };
    await drag(page, a, b);
    return { a, b };
}

/** Exit any draw mode via the palette's Done button (if visible). */
export async function exitDrawMode(page) {
    const done = page.locator('#drawDone');
    if (await done.isVisible()) await done.click();
}

/**
 * Select a stroke by clicking a point ON its geometry (mid-length of the
 * SVG path — works for every shape). Clicking "Done" dismisses the
 * selection, so tests re-select this way.
 */
export async function selectStroke(page, index = 0) {
    const path = page.locator('.draw-overlay path.stroke-path').nth(index);
    await path.scrollIntoViewIfNeeded();
    const pt = await page.evaluate(([index]) => {
        const p = document.querySelectorAll('.draw-overlay path.stroke-path')[index];
        const canvas = p.closest('.pdf-viewer > div').querySelector('canvas');
        const r = canvas.getBoundingClientRect();
        const scale = r.width / (parseFloat(canvas.style.width) || canvas.width);
        const lp = p.getPointAtLength(p.getTotalLength() / 2);
        return { x: r.left + lp.x * scale, y: r.top + lp.y * scale };
    }, [index]);
    await page.mouse.click(pt.x, pt.y);
    await expect(page.locator('#strokeToolbar')).toBeVisible();
}

/** Count pixels within tolerance of a target color inside a relative region. */
export async function countPixels(page, rect, target, tol = 60, pageIndex = 0) {
    return page.evaluate(([r, target, tol, pageIndex]) => {
        const c = document.querySelectorAll('canvas.pdf-page')[pageIndex];
        const ctx = c.getContext('2d');
        const d = ctx.getImageData(
            Math.round(c.width * r[0]), Math.round(c.height * r[1]),
            Math.max(1, Math.round(c.width * r[2])), Math.max(1, Math.round(c.height * r[3]))).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
            if (Math.abs(d[i] - target[0]) <= tol &&
                Math.abs(d[i + 1] - target[1]) <= tol &&
                Math.abs(d[i + 2] - target[2]) <= tol) n++;
        }
        return n;
    }, [rect, target, tol, pageIndex]);
}

/** Click Save PDF, confirm the filename modal, and capture the download. */
export async function savePdf(page) {
    const downloadPromise = page.waitForEvent('download');
    await page.click('#saveBtn');
    await page.click('.modal-actions .modal-btn--confirm');
    const download = await downloadPromise;
    return download.path();
}

/** Save, then load the saved file back into a fresh editor. */
export async function saveAndReload(page) {
    const file = await savePdf(page);
    await page.goto('/');
    await page.evaluate(() => window.indexedDB?.deleteDatabase?.('pdf-editor-autosave'));
    await page.setInputFiles('#pdfInput', file);
    await expect(page.locator('.pdf-viewer > div').first()).toBeVisible({ timeout: 15000 });
    await settle(page);
}

/** Read the rendered page pixel (backing-store accurate) at a relative point. */
export async function pixelAt(page, relX, relY, pageIndex = 0) {
    return page.evaluate(([relX, relY, pageIndex]) => {
        const canvas = document.querySelectorAll('canvas.pdf-page')[pageIndex];
        const ctx = canvas.getContext('2d');
        const d = ctx.getImageData(
            Math.round(canvas.width * relX), Math.round(canvas.height * relY), 1, 1).data;
        return [d[0], d[1], d[2]];
    }, [relX, relY, pageIndex]);
}

/** Assert a pixel is approximately a color (tolerance per channel). */
export function expectColorClose(actual, expected, tolerance = 30) {
    for (let i = 0; i < 3; i++) {
        expect(Math.abs(actual[i] - expected[i]), `channel ${i} of [${actual}] vs [${expected}]`).toBeLessThanOrEqual(tolerance);
    }
}

/** Draw a squiggle in the signature modal canvas. */
export async function drawSignatureSquiggle(page) {
    const box = await page.locator('.signature-canvas').boundingBox();
    const from = { x: box.x + box.width * 0.15, y: box.y + box.height * 0.5 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
        await page.mouse.move(from.x + box.width * 0.06 * i, from.y + Math.sin(i) * box.height * 0.15);
    }
    await page.mouse.up();
}

/** Pick a swatch (0-11) in the open color popover; optionally set alpha %. */
export async function pickPopoverColor(page, swatchIndex, alphaPercent = null) {
    const pop = page.locator('.color-popover');
    await expect(pop).toBeVisible();
    await pop.locator('.cp-swatch').nth(swatchIndex).click();
    if (alphaPercent !== null) {
        await pop.locator('.cp-alpha').fill(String(alphaPercent));
    }
}

/** Close the popover by clicking neutral space (commits the change). */
export async function closePopover(page) {
    await page.mouse.click(10, 10);
    await expect(page.locator('.color-popover')).toBeHidden();
}
