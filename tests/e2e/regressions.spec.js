// One test per bug found & fixed in the 2026-08-13 mobile-debugging sessions.
// Rule: every future bug gets a test here (or in a feature spec) before the
// fix is considered done.
import { test, expect } from '@playwright/test';
import {
    startBlank, canvasPoint, drag, drawStroke, exitDrawMode, selectStroke,
    drawSignatureSquiggle, savePdf, pickPopoverColor, closePopover,
} from './helpers.js';

test.describe('Regressions', () => {
    test('draw overlay matches the canvas box exactly (strokes vs selection drift)', async ({ page }) => {
        // Bug: canvas was inline with its own margin — the container grew
        // ~25px taller and the SVG overlay stretched, drawing strokes below
        // their recorded coordinates.
        await startBlank(page);
        await page.click('#drawBtn');
        const geo = await page.evaluate(() => {
            const c = document.querySelector('canvas.pdf-page').getBoundingClientRect();
            const o = document.querySelector('.draw-overlay').getBoundingClientRect();
            return { dh: Math.abs(c.height - o.height), dy: Math.abs(c.top - o.top) };
        });
        expect(geo.dh).toBeLessThan(1);
        expect(geo.dy).toBeLessThan(1);
    });

    test('selection box follows a dragged shape (was left behind)', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'rect', [0.3, 0.3], [0.45, 0.4]);
        const box1 = await page.locator('.shape-selection-rect').boundingBox();
        const sel = await page.locator('.shape-selection-rect').boundingBox();
        await drag(page, { x: sel.x + sel.width / 2, y: sel.y + sel.height / 2 },
            { x: sel.x + sel.width / 2 + 140, y: sel.y + sel.height / 2 + 90 });
        const path = await page.locator('.draw-overlay path.stroke-path').boundingBox();
        const box2 = await page.locator('.shape-selection-rect').boundingBox();
        expect(box2.x - box1.x).toBeGreaterThan(100); // it moved
        expect(Math.abs(box2.x - path.x)).toBeLessThan(16); // and hugs the shape
        expect(Math.abs(box2.y - path.y)).toBeLessThan(16);
    });

    test('deleting a shape leaves no orphan selection UI', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'star', [0.3, 0.3], [0.5, 0.5]);
        await page.click('#strokeDelete');
        await expect(page.locator('.shape-handles')).toHaveCount(0);
        await expect(page.locator('.shape-selection-rect')).toHaveCount(0);
        await expect(page.locator('#strokeToolbar')).toBeHidden();
    });

    test('tapping empty space then selecting a stroke never leaves two selections', async ({ page }) => {
        // Bug: the image toolbar's self-dismiss hid the toolbar but left the
        // image outlined "selected" forever.
        await startBlank(page);
        await page.click('#signBtn');
        await drawSignatureSquiggle(page);
        await page.click('.modal-btn--confirm');
        await expect(page.locator('.draggable-image.selected')).toHaveCount(1);
        const canvas = await page.locator('canvas.pdf-page').boundingBox();
        await page.mouse.click(canvas.x + canvas.width - 30, canvas.y + canvas.height - 30);
        await expect(page.locator('.draggable-image.selected')).toHaveCount(0);
        await drawStroke(page, 'pen', [0.2, 0.2], [0.4, 0.25]);
        await exitDrawMode(page);
        await selectStroke(page);
        await expect(page.locator('.stroke-selected')).toHaveCount(1);
        await expect(page.locator('.draggable-image.selected')).toHaveCount(0);
    });

    test('new text placement is synchronous — editor + toolbar in the same gesture', async ({ page }) => {
        // Bug: an await before focus() broke iOS gesture semantics; the
        // toolbar appeared and instantly closed.
        await startBlank(page);
        await page.click('#addTextBtn');
        const p = await canvasPoint(page, 0.4, 0.4);
        await page.mouse.click(p.x, p.y);
        await expect(page.locator('#formatToolbar')).toBeVisible();
        expect(await page.evaluate(() =>
            document.querySelector('.editable-text.modified')?.isContentEditable)).toBe(true);
    });

    test('signature modal: Cancel button closes it (Clear used to steal the handler)', async ({ page }) => {
        await startBlank(page);
        await page.click('#signBtn');
        await page.click('.modal-actions .modal-btn--cancel');
        await expect(page.locator('.modal--signature')).toHaveCount(0);
    });

    test('signature canvas: white paper, transparent bitmap, fits modal width', async ({ page }) => {
        await startBlank(page);
        await page.click('#signBtn');
        const r = await page.evaluate(() => {
            const c = document.querySelector('.signature-canvas');
            const m = document.querySelector('.modal--signature');
            return {
                bg: getComputedStyle(c).backgroundColor,
                alpha: c.getContext('2d').getImageData(2, 2, 1, 1).data[3],
                overflow: c.getBoundingClientRect().right - m.getBoundingClientRect().right,
            };
        });
        expect(r.bg).toBe('rgb(255, 255, 255)');
        expect(r.alpha).toBe(0);
        expect(r.overflow).toBeLessThanOrEqual(0);
    });

    test('toolbar color swatches actually show the color (tooltip ::after clash)', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'pen', [0.2, 0.5], [0.4, 0.5]);
        await exitDrawMode(page);
        await selectStroke(page);
        const sw = await page.evaluate(() => {
            const el = document.getElementById('strokeColorInput');
            const s = getComputedStyle(el, '::before');
            return { bg: s.backgroundColor, opacity: s.opacity };
        });
        expect(sw.bg).toBe('rgb(232, 68, 68)');
        expect(sw.opacity).toBe('1');
    });

    test('opacity slider gradient tracks the selected color, not white', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'pen', [0.2, 0.5], [0.4, 0.5]);
        await exitDrawMode(page);
        await selectStroke(page);
        await page.click('#strokeColorInput');
        await page.locator('.color-popover .cp-swatch').nth(7).click(); // blue
        const bg = await page.locator('.color-popover .cp-alpha').evaluate(el => el.style.background);
        expect(bg).toContain('rgb(31, 107, 255)');
        await closePopover(page);
    });

    test('color popover closes on any outside tap, even ones the editor swallows', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'pen', [0.2, 0.5], [0.4, 0.5]); // still in draw mode
        await page.click('#strokeColorInput'); // palette color? use stroke toolbar
        // popover open; pointerdown on the page (draw overlay stops propagation)
        const p = await canvasPoint(page, 0.7, 0.7);
        await page.mouse.click(p.x, p.y);
        await expect(page.locator('.color-popover')).toBeHidden();
    });

    test('saving works without crypto.subtle (plain-HTTP contexts)', async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(Crypto.prototype, 'subtle',
                { get: () => undefined, configurable: true });
        });
        await startBlank(page);
        await page.click('#signBtn');
        await drawSignatureSquiggle(page);
        await page.click('.modal-btn--confirm');
        const file = await savePdf(page);
        expect(file).toBeTruthy();
        // and no error toast
        const toast = await page.locator('.toast').textContent().catch(() => '');
        expect(toast || '').not.toContain('Error');
    });

    test('a stroke with an unparseable color does not abort the save', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'pen', [0.2, 0.5], [0.4, 0.5]);
        await exitDrawMode(page);
        await selectStroke(page);
        await page.evaluate(async () => {
            const draw = await import('/js/draw.js');
            const s = draw.getSelectedStroke();
            s.color = 'color(srgb 1 0 0)'; // legacy corrupted format
        });
        const file = await savePdf(page);
        expect(file).toBeTruthy();
    });

    test('long-press style selection: viewer content is not natively selectable', async ({ page }) => {
        await startBlank(page);
        const us = await page.evaluate(() =>
            getComputedStyle(document.querySelector('.pdf-viewer')).userSelect);
        expect(us).toBe('none');
    });

    test('text being edited IS selectable (the one exception)', async ({ page }) => {
        await startBlank(page);
        await page.click('#addTextBtn');
        const p = await canvasPoint(page, 0.4, 0.4);
        await page.mouse.click(p.x, p.y);
        const us = await page.evaluate(() =>
            getComputedStyle(document.querySelector('.editable-text.editing')).userSelect);
        expect(us).toBe('text');
    });

    test('pen strokes get a selection box but no resize dots', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'pen', [0.2, 0.4], [0.5, 0.5]);
        await expect(page.locator('.shape-selection-rect')).toBeVisible();
        await expect(page.locator('.shape-handle')).toHaveCount(0);
    });

    test('loading a new document clears any floating stroke toolbar', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'pen', [0.2, 0.4], [0.4, 0.45]);
        await exitDrawMode(page);
        await selectStroke(page);
        await expect(page.locator('#strokeToolbar')).toBeVisible();
        await page.click('#newFileBtn');
        // confirm-discard modal may appear
        const confirm = page.locator('.modal-actions .modal-btn--confirm');
        if (await confirm.isVisible().catch(() => false)) await confirm.click();
        await expect(page.locator('#strokeToolbar')).toBeHidden();
    });
});
