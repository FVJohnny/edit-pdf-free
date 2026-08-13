// End-to-end workflow: many features combined in one document, saved,
// reloaded and verified — the closest thing to a real editing session.
import { test, expect } from '@playwright/test';
import {
    loadFixture, canvasPoint, drag, drawStroke, exitDrawMode,
    drawSignatureSquiggle, saveAndReload, pickPopoverColor, closePopover,
    countPixels, IMAGE_PNG,
} from './helpers.js';

test('full editing session: text + styles + draw + shapes + image + signature + pages → save → verify', async ({ page }) => {
    test.setTimeout(90_000);
    await loadFixture(page);

    // 1. Edit an existing text
    const title = page.locator('.editable-text').filter({ hasText: 'PDF Bookmark Sample' }).first();
    await title.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Sesion Completa');
    await page.keyboard.press('Enter');

    // 2. Add a new red bold text
    await page.click('#addTextBtn');
    const p = await canvasPoint(page, 0.55, 0.15);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.type('Nuevo rojo');
    await page.click('#fmtBold');
    await page.click('#fmtColor');
    await pickPopoverColor(page, 2); // red
    await closePopover(page);
    await page.keyboard.press('Escape');

    // 3. Pen stroke + filled rect
    await drawStroke(page, 'pen', [0.1, 0.55], [0.35, 0.6]);
    await exitDrawMode(page);
    await drawStroke(page, 'rect', [0.55, 0.55], [0.75, 0.68]);
    await page.click('#strokeFillInput');
    await pickPopoverColor(page, 4, 50); // yellow 50%
    await closePopover(page);

    // 4. Import an image and move it
    await page.setInputFiles('#imageInput', IMAGE_PNG);
    const choice = page.locator('.modal-choice', { hasText: /Original/i });
    try { await choice.click({ timeout: 2000 }); } catch (_) {}
    const img = page.locator('.draggable-image').last();
    const ib = await img.boundingBox();
    await drag(page, { x: ib.x + ib.width / 2, y: ib.y + ib.height / 2 },
        { x: ib.x + ib.width / 2 + 100, y: ib.y + ib.height / 2 + 120 });

    // 5. Signature
    await page.click('#signBtn');
    await drawSignatureSquiggle(page);
    await page.click('.modal-btn--confirm');
    await expect(page.locator('.draggable-image.selected')).toHaveCount(1);

    // 6. Add a blank page after page 1
    await page.click('#addPageAfterBtn');
    await expect(page.locator('.pdf-viewer > div')).toHaveCount(5);

    // 7. Undo/redo spot-check keeps the document consistent
    await page.click('#undoBtn'); // remove blank page
    await expect(page.locator('.pdf-viewer > div')).toHaveCount(4);
    await page.click('#redoBtn');
    await expect(page.locator('.pdf-viewer > div')).toHaveCount(5);

    // 8. Save → reload → verify everything landed
    await saveAndReload(page);
    await expect(page.locator('.pdf-viewer > div')).toHaveCount(5);

    // edited title text should render (dark pixels where the title sits)
    const titleArea = await page.evaluate(() => {
        const c = document.querySelector('canvas.pdf-page');
        const d = c.getContext('2d').getImageData(
            Math.round(c.width * 0.3), Math.round(c.height * 0.28),
            Math.round(c.width * 0.4), Math.round(c.height * 0.06)).data;
        let dark = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 1] < 100) dark++;
        return dark;
    });
    expect(titleArea).toBeGreaterThan(20);

    // pen stroke: red pixels along its band
    expect(await countPixels(page, [0.08, 0.53, 0.3, 0.1], [232, 68, 68], 70)).toBeGreaterThan(15);

    // rect fill: pale yellow pixels at its center region
    expect(await countPixels(page, [0.6, 0.57, 0.1, 0.08], [255, 244, 157], 70)).toBeGreaterThan(30);
});
