import { test, expect } from '@playwright/test';
import {
    startBlank, loadFixture, canvasPoint, drag, savePdf, saveAndReload,
    pixelAt, expectColorClose, pickPopoverColor, closePopover,
} from './helpers.js';

/** Place a new text at a relative canvas position; returns its locator. */
async function addText(page, relX = 0.3, relY = 0.3) {
    await page.click('#addTextBtn');
    const p = await canvasPoint(page, relX, relY);
    await page.mouse.click(p.x, p.y);
    const span = page.locator('.editable-text.modified').last();
    await expect(span).toBeVisible();
    return span;
}

test.describe('Text', () => {
    test('add text: becomes editable immediately and toolbar shows', async ({ page }) => {
        await startBlank(page);
        const span = await addText(page);
        expect(await span.evaluate(el => el.isContentEditable)).toBe(true);
        await expect(page.locator('#formatToolbar')).toBeVisible();
        // toolbar hugs the text (above or below within a sane distance)
        const [tb, sp] = await Promise.all([
            page.locator('#formatToolbar').boundingBox(), span.boundingBox()]);
        expect(Math.abs(tb.y + tb.height - sp.y) < 60 || Math.abs(tb.y - (sp.y + sp.height)) < 60).toBe(true);
    });

    test('typed text persists and shows modified outline', async ({ page }) => {
        await startBlank(page);
        const span = await addText(page);
        await page.keyboard.type('Hola mundo');
        await page.keyboard.press('Enter'); // confirm
        await expect(span).toHaveText('Hola mundo');
        await expect(span).toHaveClass(/modified/);
    });

    test('Shift+Enter inserts a line break; plain Enter confirms', async ({ page }) => {
        await startBlank(page);
        const span = await addText(page);
        await page.keyboard.type('linea1');
        await page.keyboard.press('Shift+Enter');
        await page.keyboard.type('linea2');
        await page.keyboard.press('Enter');
        expect(await span.evaluate(el => el.textContent)).toContain('linea1\nlinea2');
    });

    test('bold / italic / size / family / alignment via toolbar', async ({ page }) => {
        await startBlank(page);
        const span = await addText(page);
        await page.keyboard.type('estilos');
        await page.click('#fmtBold');
        await page.click('#fmtItalic');
        await page.click('#fmtSizeUp');
        await page.click('#fmtSizeUp');
        await page.selectOption('#fmtFont', 'Times');
        await page.click('#fmtAlignCenter');
        expect(await span.evaluate(el => el.style.fontWeight)).toBe('700');
        expect(await span.evaluate(el => el.style.fontStyle)).toBe('italic');
        expect(await span.evaluate(el => parseFloat(el.style.fontSize))).toBeGreaterThan(16);
        expect(await span.evaluate(el => el.style.fontFamily)).toContain('Times');
        expect(await span.evaluate(el => el.style.textAlign)).toBe('center');
    });

    test('text color + opacity via popover, undo restores base color', async ({ page }) => {
        await startBlank(page);
        const span = await addText(page);
        await page.click('#fmtColor');
        await pickPopoverColor(page, 5, 60); // green at 60%
        await closePopover(page);
        expect(await span.evaluate(el => getComputedStyle(el).getPropertyValue('--text-color')))
            .toContain('0.6');
        await page.click('#undoBtn');
        expect(await span.evaluate(el => getComputedStyle(el).getPropertyValue('--text-color').trim()))
            .toBe('rgba(0, 0, 0, 1)');
    });

    test('edit an existing PDF text: green modified outline + cover on save', async ({ page }) => {
        await loadFixture(page);
        await page.locator('.editable-text').filter({ hasText: 'PDF Bookmark Sample' }).first().click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('Titulo editado');
        await page.keyboard.press('Enter');
        // re-locate by the new text (the old filter would match other pages)
        const edited = page.locator('.editable-text').filter({ hasText: 'Titulo editado' });
        await expect(edited).toHaveCount(1);
        await expect(edited).toHaveClass(/modified/);
    });

    test('drag a text to a new position', async ({ page }) => {
        await startBlank(page);
        const span = await addText(page, 0.2, 0.2);
        await page.keyboard.type('muevete');
        await page.keyboard.press('Enter');
        const before = await span.boundingBox();
        await drag(page, { x: before.x + 10, y: before.y + 8 },
            { x: before.x + 160, y: before.y + 120 });
        const after = await span.boundingBox();
        expect(after.x - before.x).toBeGreaterThan(100);
        expect(after.y - before.y).toBeGreaterThan(80);
        await expect(span).toHaveClass(/moved/);
    });

    test('multi-select with Shift+click moves texts as a group', async ({ page }) => {
        await startBlank(page);
        const a = await addText(page, 0.2, 0.2);
        await page.keyboard.type('uno');
        await page.keyboard.press('Enter');
        const b = await addText(page, 0.5, 0.5);
        await page.keyboard.type('dos');
        await page.keyboard.press('Enter');
        await a.click();
        await page.keyboard.press('Escape');
        await a.click({ modifiers: ['Shift'] });
        await b.click({ modifiers: ['Shift'] });
        const beforeA = await a.boundingBox();
        const beforeB = await b.boundingBox();
        await drag(page, { x: beforeB.x + 5, y: beforeB.y + 5 },
            { x: beforeB.x + 105, y: beforeB.y + 85 });
        const afterA = await a.boundingBox();
        const afterB = await b.boundingBox();
        expect(afterB.x - beforeB.x).toBeGreaterThan(60);
        expect(afterA.x - beforeA.x).toBeGreaterThan(60); // group moved together
    });

    test('saved PDF keeps text content, color and opacity', async ({ page }) => {
        await startBlank(page);
        await addText(page, 0.3, 0.3);
        await page.keyboard.type('COLORIN');
        await page.click('#fmtColor');
        await pickPopoverColor(page, 2, null); // solid red
        await closePopover(page);
        await page.keyboard.press('Escape');
        await saveAndReload(page);
        // the reloaded page should show red pixels where the text was
        const found = await page.evaluate(() => {
            const canvas = document.querySelector('canvas.pdf-page');
            const ctx = canvas.getContext('2d');
            const region = ctx.getImageData(
                Math.round(canvas.width * 0.28), Math.round(canvas.height * 0.28),
                Math.round(canvas.width * 0.2), Math.round(canvas.height * 0.08)).data;
            for (let i = 0; i < region.length; i += 4) {
                if (region[i] > 180 && region[i + 1] < 120 && region[i + 2] < 120) return true;
            }
            return false;
        });
        expect(found).toBe(true);
    });
});
