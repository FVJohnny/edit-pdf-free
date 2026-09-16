import { test, expect } from '@playwright/test';
import { startBlank, loadFixture, settle, ENCRYPTED_PDF, MAIN_PDF } from './helpers.js';

test.describe('Document loading', () => {
    test('loads a multi-page PDF: pages render, text overlays exist', async ({ page }) => {
        await loadFixture(page);
        await expect(page.locator('.pdf-viewer > div')).toHaveCount(4);
        expect(await page.locator('.editable-text').count()).toBeGreaterThan(50);
        // container height must exactly match its canvas (overlay alignment)
        const delta = await page.evaluate(() => {
            const div = document.querySelector('.pdf-viewer > div');
            return Math.abs(div.getBoundingClientRect().height -
                div.querySelector('canvas').getBoundingClientRect().height);
        });
        expect(delta).toBeLessThan(1);
    });

    test('starts a blank PDF from the upload zone', async ({ page }) => {
        await startBlank(page);
        await expect(page.locator('#saveBtn')).toBeEnabled();
        await expect(page.locator('#pageIndicator')).toHaveText(/Page 1 \/ 1/);
    });

    test('encrypted PDF prompts for password and opens with the right one', async ({ page }) => {
        await page.goto('/');
        await page.setInputFiles('#pdfInput', ENCRYPTED_PDF);
        const input = page.locator('.modal-input');
        await expect(input).toBeVisible({ timeout: 10000 });
        await input.fill('1234');
        await page.click('.modal-actions .modal-btn--confirm');
        await expect(page.locator('.pdf-viewer > div').first()).toBeVisible({ timeout: 15000 });
    });

    test('size indicator shows a plausible size after load', async ({ page }) => {
        await loadFixture(page);
        await expect(page.locator('#sizeIndicator, .size-indicator')).toHaveText(/KB|MB/, { timeout: 10000 });
    });
});

test('saving remains disabled until document rendering is complete',async({page})=>{
    await page.route('**/vendor/pdf.worker.min.js',async route=>{await new Promise(resolve=>setTimeout(resolve,700));await route.continue();});
    await page.goto('/');await page.setInputFiles('#pdfInput',MAIN_PDF);
    await expect(page.locator('#pdfViewer')).toHaveAttribute('aria-busy','true');await expect(page.locator('#saveBtn')).toBeDisabled();
    await expect(page.locator('#pdfViewer')).toHaveAttribute('aria-busy','false');await expect(page.locator('canvas.pdf-page')).toHaveCount(4);await expect(page.locator('#saveBtn')).toBeEnabled();
});

test('Open New opens the chooser and permits selecting the same PDF again',async({page})=>{
    const workers=[];page.on('worker',worker=>{if(worker.url().includes('pdf.worker'))workers.push(worker);});
    await loadFixture(page);let closed=false;workers[0].on('close',()=>{closed=true;});
    const chooser=page.waitForEvent('filechooser');await page.click('#newFileBtn');await (await chooser).setFiles(MAIN_PDF);
    await expect(page.locator('#pdfViewer')).toHaveAttribute('aria-busy','false');await expect(page.locator('canvas.pdf-page')).toHaveCount(4);await expect(page.locator('#saveBtn')).toBeEnabled();await expect.poll(()=>closed).toBe(true);
});
