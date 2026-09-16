import { test, expect } from '@playwright/test';
import {
    startBlank,
    canvasPoint,
    saveAndReload,
    IMAGE_PNG
} from './helpers.js';

test('mobile browser: tap to add/edit text, change font and save/reopen @touch', async ({
    page
}) => {
    await startBlank(page);
    await page.locator('#addTextBtn').tap();
    const point = await canvasPoint(page, 0.25, 0.25);
    await page.touchscreen.tap(point.x, point.y);
    await page.keyboard.type('Mobile edit');
    await page.keyboard.press('Enter');
    const text = page
        .locator('.editable-text')
        .filter({ hasText: 'Mobile edit' });
    await text.tap();
    await text.tap();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Mobile saved');
    await page.locator('#fmtBold').tap();
    await expect(page.locator('#fmtBold')).toHaveClass(/active/);
    await page.selectOption('#fmtFont', 'Courier');
    await page.keyboard.press('Enter');
    await saveAndReload(page);
    const saved = page
        .locator('.editable-text')
        .filter({ hasText: 'Mobile saved' });
    await expect(saved).toHaveCount(1);
    expect(await saved.evaluate((el) => el.style.fontFamily)).toContain(
        'Courier'
    );
    expect(await saved.evaluate((el) => el.style.fontWeight)).toBe('700');
    await page.locator('#zoomInBtn').tap();
    await expect(page.locator('#zoomLabel')).toHaveText('110%');
    await expect(page.locator('.pdf-detail').first()).toBeAttached();
});
test('mobile browser: image selection, deletion and undo use touch targets @touch', async ({
    page
}) => {
    await startBlank(page);
    await page.setInputFiles('#imageInput', IMAGE_PNG);
    const image = page.locator('.draggable-image');
    await expect(image).toBeVisible();
    await image.tap();
    await expect(page.locator('#imageToolbar')).toBeVisible();
    const handle = await page.locator('.img-resize-se').boundingBox();
    expect(handle.width).toBeGreaterThanOrEqual(20);
    await page.locator('#imgDelete').tap();
    await expect(image).toBeHidden();
    await page.locator('#undoBtn').tap();
    await expect(image).toBeVisible();
    await saveAndReload(page);
    await expect(page.locator('.draggable-image')).toHaveCount(1);
});
