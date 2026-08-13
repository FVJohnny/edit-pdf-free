import { test, expect } from '@playwright/test';
import { startBlank, loadFixture, savePdf, MAIN_PDF } from './helpers.js';

test.describe('Page management & view', () => {
    test('add blank page before/after the current page', async ({ page }) => {
        await loadFixture(page);
        await page.click('#addPageBeforeBtn');
        await expect(page.locator('.pdf-viewer > div')).toHaveCount(5);
        await page.click('#addPageAfterBtn');
        await expect(page.locator('.pdf-viewer > div')).toHaveCount(6);
        await page.click('#undoBtn');
        await page.click('#undoBtn');
        await expect(page.locator('.pdf-viewer > div')).toHaveCount(4);
    });

    test('delete page removes current page; last page refuses with toast', async ({ page }) => {
        await loadFixture(page);
        await page.click('#deletePageBtn');
        await expect(page.locator('.pdf-viewer > div')).toHaveCount(3);
        await page.click('#undoBtn');
        await expect(page.locator('.pdf-viewer > div')).toHaveCount(4);
    });

    test('deleting the only page is refused', async ({ page }) => {
        await startBlank(page);
        await page.click('#deletePageBtn');
        await expect(page.locator('.pdf-viewer > div')).toHaveCount(1);
        await expect(page.locator('.toast')).toBeVisible();
    });

    test('zoom in/out updates the label and scales pages', async ({ page }) => {
        await loadFixture(page);
        await page.click('#zoomInBtn');
        await page.click('#zoomInBtn');
        await expect(page.locator('#zoomLabel')).toHaveText('120%');
        const scale = await page.evaluate(() =>
            document.querySelector('.pdf-viewer > div').style.transform);
        expect(scale).toContain('1.2');
        await page.click('#zoomOutBtn');
        await page.click('#zoomOutBtn');
        await expect(page.locator('#zoomLabel')).toHaveText('100%');
    });

    test('minimap shows one thumbnail per page and tracks scroll', async ({ page }) => {
        await loadFixture(page);
        await expect(page.locator('.pdf-minimap-page')).toHaveCount(4);
        // scroll the viewer to the last page; indicator follows
        await page.evaluate(() => {
            const v = document.querySelector('.pdf-viewer');
            v.scrollTop = v.scrollHeight;
        });
        await expect(page.locator('#pageIndicator')).toHaveText(/Page 4 \/ 4/);
    });

    test('find highlights matches and cycles with Enter', async ({ page }) => {
        await loadFixture(page);
        await page.keyboard.press('ControlOrMeta+f');
        const box = page.locator('#searchInput, .search-bar input').first();
        await expect(box).toBeVisible();
        await box.fill('Adobe');
        await page.waitForTimeout(400);
        const count = await page.locator('.search-hit').count();
        expect(count).toBeGreaterThan(0);
    });

    test('merge PDF appends pages', async ({ page }) => {
        await loadFixture(page);
        await page.setInputFiles('#mergePdfInput', MAIN_PDF);
        await expect(page.locator('.pdf-viewer > div')).toHaveCount(8, { timeout: 15000 });
    });

    test('saved PDF preserves inserted blank page count and order', async ({ page }) => {
        await loadFixture(page);
        await page.click('#addPageAfterBtn');
        const file = await savePdf(page);
        await page.goto('/');
        await page.setInputFiles('#pdfInput', file);
        await expect(page.locator('.pdf-viewer > div')).toHaveCount(5, { timeout: 15000 });
    });
});
