import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'node:fs/promises';
import { loadFixture, saveAndReload } from './helpers.js';

test.use({ deviceScaleFactor: 2 });

test('Retina preview stays sharp on a long page at 100%, 160%, after editing and reopening', async ({
    page
}, testInfo) => {
    const doc = await PDFDocument.create(),
        p = doc.addPage([500, 1056]);
    p.drawRectangle({
        x: 0,
        y: 0,
        width: 500,
        height: 1056,
        color: rgb(0.02, 0.08, 0.12)
    });
    p.drawText('Sharp preview', {
        x: 40,
        y: 980,
        size: 18,
        font: await doc.embedFont(StandardFonts.Helvetica),
        color: rgb(1, 1, 1)
    });
    const file = testInfo.outputPath('long-page.pdf');
    await fs.writeFile(file, await doc.save());
    await loadFixture(page, file);
    await expect(page.locator('canvas.pdf-detail').first()).toBeAttached();
    const density = () =>
        page
            .locator('canvas.pdf-detail')
            .evaluateAll((cs) =>
                cs[0] ? cs[0].width / cs[0].getBoundingClientRect().width : 0
            );
    await expect.poll(density, { timeout: 10000 }).toBeGreaterThan(1.99);
    for (let i = 0; i < 6; i++) await page.click('#zoomInBtn');
    await expect(page.locator('#zoomLabel')).toHaveText('160%');
    await page.locator('.pdf-viewer').scrollIntoViewIfNeeded();
    await expect.poll(density, { timeout: 10000 }).toBeGreaterThan(1.99);
    await page
        .locator('.editable-text')
        .filter({ hasText: 'Sharp preview' })
        .click();
    await page.keyboard.type('Sharp edited');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
    expect(await density()).toBeGreaterThan(1.99);
    await saveAndReload(page);
    await expect(
        page.locator('.editable-text').filter({ hasText: 'Sharp edited' })
    ).toHaveCount(1);
    await expect.poll(density, { timeout: 10000 }).toBeGreaterThan(1.99);
});

test('long multipage document bounds canvas memory and releases offscreen detail surfaces', async ({
    page
}, info) => {
    const doc = await PDFDocument.create(),
        font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 12; i++) {
        const p = doc.addPage([500, 6000]);
        p.drawText('Top ' + i, { x: 40, y: 5950, size: 20, font });
        p.drawText('Bottom ' + i, { x: 40, y: 50, size: 20, font });
    }
    const file = info.outputPath('many-long-pages.pdf');
    await fs.writeFile(file, await doc.save());
    await loadFixture(page, file);
    await expect(page.locator('canvas.pdf-page')).toHaveCount(12);
    const pixels = () =>
        page
            .locator('canvas.pdf-page,canvas.pdf-detail')
            .evaluateAll((cs) =>
                cs.reduce((n, c) => n + c.width * c.height, 0)
            );
    await expect(page.locator('canvas.pdf-detail')).toHaveCount(1);
    expect(await pixels()).toBeLessThan(25e6);
    await page
        .locator('.editable-text')
        .filter({ hasText: /^Bottom 11$/ })
        .click();
    await expect(
        page.locator('.pdf-viewer > div').last().locator('.pdf-detail')
    ).toBeAttached();
    await expect(
        page.locator('.pdf-viewer > div').first().locator('.pdf-detail')
    ).toHaveCount(0);
    expect(await pixels()).toBeLessThan(25e6);
    await expect
        .poll(() =>
            page
                .locator('.pdf-detail')
                .last()
                .evaluate((c) => c.width / c.getBoundingClientRect().width)
        )
        .toBeGreaterThan(1.99);
});

test('zoom keeps the left edge accessible and allows horizontal panning to the right edge', async ({
    page
}, info) => {
    const doc = await PDFDocument.create(),
        p = doc.addPage([500, 1000]);
    p.drawText('Left edge', { x: 8, y: 900, size: 18 });
    p.drawText('Right', { x: 450, y: 900, size: 18 });
    const file = info.outputPath('wide-zoom.pdf');
    await fs.writeFile(file, await doc.save());
    await loadFixture(page, file);
    for (let i = 0; i < 10; i++) await page.click('#zoomInBtn');
    await page.locator('.pdf-viewer').scrollIntoViewIfNeeded();
    const viewer = page.locator('.pdf-viewer');
    const r = await viewer.boundingBox(),
        c = await page.locator('.pdf-page').boundingBox();
    expect(c.x).toBeGreaterThanOrEqual(r.x);
    await page.mouse.move(
        r.x + r.width / 2,
        Math.min(r.y + 150, page.viewportSize().height - 60)
    );
    await page.mouse.wheel(2500, 0);
    await expect
        .poll(() => viewer.evaluate((el) => el.scrollLeft))
        .toBeGreaterThan(300);
    await expect
        .poll(() =>
            page
                .locator('.pdf-page')
                .evaluate(
                    (el) =>
                        el.getBoundingClientRect().right -
                        el.closest('.pdf-viewer').getBoundingClientRect().right
                )
        )
        .toBeLessThan(30);
});
