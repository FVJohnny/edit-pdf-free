// Gap-closing spec: features from the CLAUDE.md test plan that the first
// suite iteration did not cover.
import { test, expect } from '@playwright/test';
import {
    startBlank, loadFixture, canvasPoint, drag, drawStroke, exitDrawMode,
    selectStroke, ENCRYPTED_PDF, IMAGE_PNG, EXIF_JPG, settle,
} from './helpers.js';

async function addText(page, relX, relY, textContent) {
    await page.click('#addTextBtn');
    const p = await canvasPoint(page, relX, relY);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.type(textContent);
    await page.keyboard.press('Enter');
    return page.locator('.editable-text.modified', { hasText: textContent });
}

test.describe('Coverage gaps', () => {
    test('cross-page drag: text reparents onto the next page; undo returns it', async ({ page }) => {
        await loadFixture(page);
        // show the page 1 → page 2 boundary
        await page.evaluate(() => {
            const v = document.querySelector('.pdf-viewer');
            const p1 = v.querySelector(':scope > div');
            v.scrollTop = p1.offsetTop + p1.offsetHeight - v.clientHeight / 2;
        });
        await page.waitForTimeout(200);
        // pick a page-1 text currently visible in the top half of the viewer
        const span = await page.evaluateHandle(() => {
            const v = document.querySelector('.pdf-viewer');
            const p1 = v.querySelector(':scope > div');
            const vr = v.getBoundingClientRect();
            return [...p1.querySelectorAll('.editable-text')].find(el => {
                const r = el.getBoundingClientRect();
                return r.top > vr.top + 40 && r.bottom < vr.top + vr.height / 2 && r.width > 30;
            });
        });
        const sb = await span.asElement().boundingBox();
        // drop point on page 2's visible strip
        const p2 = await page.evaluate(() => {
            const pages = document.querySelectorAll('.pdf-viewer > div');
            const r = pages[1].getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + 120 };
        });
        await drag(page, { x: sb.x + 10, y: sb.y + sb.height / 2 }, p2, 12);
        const parentIdx = await span.asElement().evaluate(el => {
            const pages = [...document.querySelectorAll('.pdf-viewer > div')];
            return pages.indexOf(el.closest('.pdf-viewer > div'));
        });
        expect(parentIdx).toBe(1);
        await page.click('#undoBtn');
        const parentAfterUndo = await span.asElement().evaluate(el => {
            const pages = [...document.querySelectorAll('.pdf-viewer > div')];
            return pages.indexOf(el.closest('.pdf-viewer > div'));
        });
        expect(parentAfterUndo).toBe(0);
    });

    test('multi-image import shows compression modal; Balanced places both images', async ({ page }) => {
        await startBlank(page);
        // the modal only appears from 300KB total up — pad the PNG with
        // trailing bytes (decoders ignore data after IEND)
        const fs = require('fs');
        const big = Buffer.concat([fs.readFileSync(IMAGE_PNG), Buffer.alloc(320 * 1024)]);
        await page.setInputFiles('#imageInput', [
            { name: 'big1.png', mimeType: 'image/png', buffer: big },
            { name: 'big2.png', mimeType: 'image/png', buffer: big },
        ]);
        const choice = page.locator('.modal-choice', { hasText: /Balanced/i });
        await expect(choice).toBeVisible();
        await choice.click();
        await expect(page.locator('.draggable-image')).toHaveCount(2, { timeout: 15000 });
        // cascade offset: the two images are not stacked exactly
        const a = await page.locator('.draggable-image').nth(0).boundingBox();
        const b = await page.locator('.draggable-image').nth(1).boundingBox();
        expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThan(10);
    });

    test('minimap: rotate page swaps its orientation', async ({ page }) => {
        await loadFixture(page);
        const before = await page.evaluate(() => {
            const c = document.querySelector('canvas.pdf-page');
            return c.getBoundingClientRect().width / c.getBoundingClientRect().height;
        });
        await page.hover('.pdf-minimap-page');
        await page.locator('.pdf-minimap-page').first().locator('.minimap-rotate').click({ force: true });
        await expect.poll(async () => page.evaluate(() => {
            const c = document.querySelector('canvas.pdf-page');
            const r = c.getBoundingClientRect();
            return r.width / r.height;
        }), { timeout: 20000 }).toBeGreaterThan(1 / before * 0.9);
    });

    test('minimap: delete page removes it; undo restores', async ({ page }) => {
        await loadFixture(page);
        await page.hover('.pdf-minimap-page >> nth=1');
        await page.locator('.pdf-minimap-page').nth(1).locator('.minimap-delete').click({ force: true });
        await expect(page.locator('.pdf-viewer > div')).toHaveCount(3);
        await page.click('#undoBtn');
        await expect(page.locator('.pdf-viewer > div')).toHaveCount(4);
    });

    test('sharp zoom: the canvas backing re-renders denser after zooming in', async ({ page }) => {
        await loadFixture(page);
        const ratioAt = () => page.evaluate(() => {
            const c = document.querySelector('canvas.pdf-page');
            return c.width / parseFloat(c.style.width);
        });
        const base = await ratioAt();
        for (let i = 0; i < 5; i++) await page.click('#zoomInBtn'); // 150%
        await expect(page.locator('#zoomLabel')).toHaveText('150%');
        await expect.poll(ratioAt, { timeout: 10000 }).toBeGreaterThan(base * 1.2);
    });

    test('autosave: after editing, a reload offers session recovery with edits baked', async ({ page }) => {
        await loadFixture(page);
        const span = page.locator('.editable-text').filter({ hasText: 'PDF Bookmark Sample' }).first();
        await span.click();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('RECUPERADO');
        await page.keyboard.press('Enter');
        // autosave rides on the (debounced) size estimator
        await page.waitForTimeout(3000);
        await page.goto('/');
        const recover = page.locator('.upload-recover-btn');
        await expect(recover).toBeVisible({ timeout: 8000 });
        await recover.click();
        await expect(page.locator('.pdf-viewer > div')).toHaveCount(4, { timeout: 15000 });
        // the edit is baked into the rendered page (dark pixels where it sits)
        await settle(page);
        const hasText = await page.evaluate(() => {
            const c = document.querySelector('canvas.pdf-page');
            const d = c.getContext('2d').getImageData(
                Math.round(c.width * 0.25), Math.round(c.height * 0.27),
                Math.round(c.width * 0.5), Math.round(c.height * 0.08)).data;
            let dark = 0;
            for (let i = 0; i < d.length; i += 4) if (d[i] < 100) dark++;
            return dark > 20;
        });
        expect(hasText).toBe(true);
    });

    test('Shift+resize keeps the image aspect ratio', async ({ page }) => {
        await startBlank(page);
        await page.setInputFiles('#imageInput', IMAGE_PNG);
        const img = page.locator('.draggable-image');
        await expect(img).toBeVisible();
        const before = await img.boundingBox();
        const ratioBefore = before.width / before.height;
        const h = await page.locator('.img-resize-se').boundingBox();
        await page.keyboard.down('Shift');
        await drag(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 },
            { x: h.x + h.width / 2 + 120, y: h.y + h.height / 2 + 20 });
        await page.keyboard.up('Shift');
        const after = await img.boundingBox();
        expect(after.width).toBeGreaterThan(before.width + 60);
        expect(Math.abs(after.width / after.height - ratioBefore)).toBeLessThan(ratioBefore * 0.04);
    });

    test('download image button produces a file', async ({ page }) => {
        await startBlank(page);
        await page.setInputFiles('#imageInput', IMAGE_PNG);
        const img = page.locator('.draggable-image');
        await img.click();
        const downloadPromise = page.waitForEvent('download');
        await page.click('#imgDownload');
        const download = await downloadPromise;
        expect(await download.path()).toBeTruthy();
    });

    test('encrypted PDF: wrong password re-prompts, right one opens', async ({ page }) => {
        await page.goto('/');
        await page.setInputFiles('#pdfInput', ENCRYPTED_PDF);
        const input = page.locator('.modal-input');
        await expect(input).toBeVisible({ timeout: 10000 });
        await input.fill('nope');
        await page.click('.modal-actions .modal-btn--confirm');
        // re-prompted — the dismissed modal lingers ~300ms for its fade-out,
        // so target the newest one explicitly
        await expect(page.locator('.modal-label').last()).toHaveText(/Incorrect|again/i, { timeout: 10000 });
        await expect(page.locator('.modal-label')).toHaveCount(1); // old one fully gone
        await page.locator('.modal-input').fill('1234');
        await page.click('.modal-actions .modal-btn--confirm');
        await expect(page.locator('.pdf-viewer > div').first()).toBeVisible({ timeout: 15000 });
    });

    test('find: Enter cycles through matches (active highlight moves)', async ({ page }) => {
        await loadFixture(page);
        await page.keyboard.press('ControlOrMeta+f');
        const box = page.locator('#searchInput');
        await box.fill('the');
        await page.waitForTimeout(400);
        expect(await page.locator('.search-hit').count()).toBeGreaterThan(1);
        await box.press('Enter');
        const first = await page.evaluate(() =>
            [...document.querySelectorAll('.search-hit')].findIndex(el => el.classList.contains('search-active')));
        await box.press('Enter');
        const second = await page.evaluate(() =>
            [...document.querySelectorAll('.search-hit')].findIndex(el => el.classList.contains('search-active')));
        expect(second).not.toBe(first);
    });

    test('multi-select delete removes the group; one undo restores all', async ({ page }) => {
        await startBlank(page);
        const a = await addText(page, 0.2, 0.3, 'grupoA');
        const b = await addText(page, 0.5, 0.45, 'grupoB');
        await page.keyboard.press('Escape');
        await a.click({ modifiers: ['Shift'] });
        await b.click({ modifiers: ['Shift'] });
        await page.keyboard.press('Delete');
        await expect(a).toBeHidden();
        await expect(b).toBeHidden();
        await page.click('#undoBtn');
        await expect(a).toBeVisible();
        await expect(b).toBeVisible();
    });

    test('Escape exits draw mode; Delete key removes the selected stroke', async ({ page }) => {
        await startBlank(page);
        await page.click('#drawBtn');
        await expect(page.locator('#drawPalette')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#drawPalette')).toBeHidden();
        await drawStroke(page, 'rect', [0.3, 0.3], [0.5, 0.4]);
        await expect(page.locator('.stroke-selected')).toHaveCount(1);
        await page.keyboard.press('Delete');
        await expect(page.locator('.draw-overlay path.stroke-path')).toHaveCount(0);
        await expect(page.locator('.shape-handles')).toHaveCount(0);
    });

    test('delete text via the toolbar trash; undo restores it', async ({ page }) => {
        await startBlank(page);
        const span = await addText(page, 0.3, 0.3, 'borrame');
        await span.click();
        await expect(page.locator('#formatToolbar')).toBeVisible();
        await page.click('#fmtDelete');
        await expect(span).toBeHidden();
        await page.click('#undoBtn');
        await expect(span).toBeVisible();
    });

    test('blank page inserts at the CURRENT position, not the document end', async ({ page }) => {
        await loadFixture(page);
        await page.click('#addPageAfterBtn'); // current page is 1 → blank at index 1
        await expect(page.locator('.pdf-viewer > div')).toHaveCount(5);
        const blankIdx = await page.evaluate(() =>
            [...document.querySelectorAll('.pdf-viewer > div')]
                .findIndex(d => d.dataset.blankPage === 'true'));
        expect(blankIdx).toBe(1);
    });
});
