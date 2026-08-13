import { test, expect } from '@playwright/test';
import {
    startBlank, canvasPoint, drag, drawStroke, exitDrawMode, selectStroke,
    saveAndReload, pickPopoverColor, closePopover, countPixels,
} from './helpers.js';

test.describe('Draw & shapes', () => {
    test('pen stroke draws where the cursor goes and stays selected', async ({ page }) => {
        await startBlank(page);
        const { a, b } = await drawStroke(page, 'pen', [0.2, 0.3], [0.5, 0.4]);
        const path = page.locator('.draw-overlay path.stroke-path');
        await expect(path).toHaveCount(1);
        const pb = await path.boundingBox();
        expect(Math.abs(pb.x - Math.min(a.x, b.x))).toBeLessThan(8);
        expect(Math.abs(pb.y - Math.min(a.y, b.y))).toBeLessThan(8);
        // pen keeps draw mode; the fresh stroke is selected with its box
        await expect(page.locator('.shape-selection-rect')).toBeVisible();
        await expect(page.locator('.shape-handle')).toHaveCount(0); // no dots for pen
    });

    test('highlighter is wide and translucent', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'highlighter', [0.2, 0.5], [0.5, 0.5]);
        const path = page.locator('.draw-overlay path.stroke-path');
        expect(parseFloat(await path.getAttribute('stroke-width'))).toBeGreaterThanOrEqual(16);
        expect(parseFloat(await path.getAttribute('opacity'))).toBeLessThanOrEqual(0.4);
    });

    test('shapes: rect, circle, arrow, star draw and auto-select with handles', async ({ page }) => {
        await startBlank(page);
        for (const [i, tool] of ['rect', 'circle', 'arrow', 'star'].entries()) {
            await drawStroke(page, tool, [0.1 + i * 0.2, 0.1], [0.22 + i * 0.2, 0.25]);
            await expect(page.locator('.shape-selection-rect')).toBeVisible();
            const dots = tool === 'arrow' ? 2 : 4;
            await expect(page.locator('.shape-handle')).toHaveCount(dots);
        }
        await expect(page.locator('.draw-overlay path.stroke-path')).toHaveCount(4);
    });

    test('selected shape drags from anywhere inside its selection box', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'rect', [0.3, 0.3], [0.5, 0.45]);
        const path = page.locator('.draw-overlay path.stroke-path');
        const before = await path.boundingBox();
        const box = await page.locator('.shape-selection-rect').boundingBox();
        await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 },
            { x: box.x + box.width / 2 + 120, y: box.y + box.height / 2 + 80 });
        const after = await path.boundingBox();
        expect(after.x - before.x).toBeGreaterThan(90);
        // selection box + handles follow
        const boxAfter = await page.locator('.shape-selection-rect').boundingBox();
        expect(Math.abs(boxAfter.x - after.x)).toBeLessThan(15);
    });

    test('corner handles resize; imprecise grabs near the corner still resize', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'rect', [0.3, 0.3], [0.45, 0.42]);
        const path = page.locator('.draw-overlay path.stroke-path');
        const before = await path.boundingBox();
        const se = await page.locator('.shape-handle[data-role="se"]').boundingBox();
        // grab 8px off the handle center — inside the enlarged hit area
        await drag(page, { x: se.x + se.width / 2 - 8, y: se.y + se.height / 2 - 8 },
            { x: se.x + se.width / 2 + 90, y: se.y + se.height / 2 + 70 });
        const after = await path.boundingBox();
        expect(after.width - before.width).toBeGreaterThan(60);
        expect(Math.abs(after.x - before.x)).toBeLessThan(10); // resized, not moved
    });

    test('line width slider updates stroke live with a single undo step', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'pen', [0.2, 0.6], [0.4, 0.65]);
        await exitDrawMode(page);
        await selectStroke(page); // Done dismisses the selection
        const path = page.locator('.draw-overlay path.stroke-path');
        await page.locator('#strokeWidthInput').fill('20');
        expect(await path.getAttribute('stroke-width')).toBe('20');
        await page.click('#undoBtn');
        expect(await path.getAttribute('stroke-width')).toBe('4');
        await page.click('#redoBtn');
        expect(await path.getAttribute('stroke-width')).toBe('20');
    });

    test('line color + opacity via popover; swatch preset resets opacity', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'pen', [0.2, 0.6], [0.4, 0.6]);
        await exitDrawMode(page);
        await selectStroke(page);
        const path = page.locator('.draw-overlay path.stroke-path');
        await page.click('#strokeColorInput');
        await pickPopoverColor(page, 7, 40); // blue at 40%
        expect(await path.getAttribute('stroke')).toBe('#1f6bff');
        expect(await path.getAttribute('opacity')).toBe('0.4');
        // picking a preset resets opacity to 100%
        await page.locator('.color-popover .cp-swatch').nth(2).click();
        expect(await path.getAttribute('opacity')).toBe('1');
        await closePopover(page);
    });

    test('fill color with its own opacity; 0% opacity means no fill', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'rect', [0.3, 0.3], [0.5, 0.45]);
        const path = page.locator('.draw-overlay path.stroke-path');
        await page.click('#strokeFillInput');
        await pickPopoverColor(page, 7, 50); // blue fill at 50%
        expect(await path.getAttribute('fill')).toBe('#1f6bff');
        expect(await path.getAttribute('fill-opacity')).toBe('0.5');
        await page.locator('.color-popover .cp-alpha').fill('0');
        expect(await path.getAttribute('fill')).toBe('none');
        await closePopover(page);
    });

    test('fill control hidden for pen strokes and arrows', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'pen', [0.2, 0.6], [0.4, 0.6]);
        await exitDrawMode(page);
        await selectStroke(page);
        await expect(page.locator('#strokeFillInput')).toBeHidden();
        await drawStroke(page, 'arrow', [0.5, 0.6], [0.7, 0.7]);
        await expect(page.locator('#strokeFillInput')).toBeHidden();
        await drawStroke(page, 'rect', [0.5, 0.2], [0.7, 0.3]);
        await expect(page.locator('#strokeFillInput')).toBeVisible();
    });

    test('tapping near (not on) a stroke selects it — halo', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'pen', [0.2, 0.5], [0.5, 0.5]);
        await exitDrawMode(page);
        await page.mouse.click(30, 30); // deselect
        await expect(page.locator('.stroke-selected')).toHaveCount(0);
        const path = await page.locator('.draw-overlay path.stroke-path').boundingBox();
        await page.mouse.click(path.x + path.width / 2, path.y + path.height + 15);
        await expect(page.locator('.stroke-selected')).toHaveCount(1);
    });

    test('deleting a stroke removes selection box and toolbar; undo/redo clean', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'rect', [0.3, 0.3], [0.5, 0.45]);
        await page.click('#strokeDelete');
        await expect(page.locator('.draw-overlay path.stroke-path')).toHaveCount(0);
        await expect(page.locator('.shape-handles')).toHaveCount(0);
        await expect(page.locator('#strokeToolbar')).toBeHidden();
        await page.click('#undoBtn');
        await expect(page.locator('.draw-overlay path.stroke-path')).toHaveCount(1);
        await page.click('#redoBtn');
        await expect(page.locator('.draw-overlay path.stroke-path')).toHaveCount(0);
        await expect(page.locator('.shape-handles')).toHaveCount(0);
    });

    test('undoing a fresh stroke removes its selection UI too', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'circle', [0.3, 0.3], [0.5, 0.45]);
        await expect(page.locator('.shape-handles')).toHaveCount(1);
        await page.click('#undoBtn');
        await expect(page.locator('.draw-overlay path.stroke-path')).toHaveCount(0);
        await expect(page.locator('.shape-handles')).toHaveCount(0);
        await expect(page.locator('#strokeToolbar')).toBeHidden();
    });

    test('strokes and shapes survive save+reload with correct colors', async ({ page }) => {
        await startBlank(page);
        await drawStroke(page, 'pen', [0.1, 0.15], [0.4, 0.2]); // default red pen
        await exitDrawMode(page);
        await drawStroke(page, 'rect', [0.55, 0.4], [0.75, 0.55]);
        await page.click('#strokeFillInput');
        await pickPopoverColor(page, 7, 50); // blue 50% fill
        await closePopover(page);
        await saveAndReload(page);
        // red pen pixels along its band
        expect(await countPixels(page, [0.1, 0.14, 0.3, 0.08], [232, 68, 68], 70)).toBeGreaterThan(20);
        // rect center: pale blue fill (blue at 50% over white)
        expect(await countPixels(page, [0.6, 0.44, 0.1, 0.07], [143, 181, 255], 70)).toBeGreaterThan(50);
    });
});
