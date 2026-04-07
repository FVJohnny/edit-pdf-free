// ============================================
// Text format toolbar
// ============================================
import { createFloatingToolbar } from './utils/floating-toolbar.js';
import { rgbToHex } from './utils/color.js';

const formatToolbar = document.getElementById('formatToolbar');
const fmtBold = document.getElementById('fmtBold');
const fmtItalic = document.getElementById('fmtItalic');
const fmtSizeDown = document.getElementById('fmtSizeDown');
const fmtSizeUp = document.getElementById('fmtSizeUp');
const fmtSizeLabel = document.getElementById('fmtSizeLabel');
const fmtColor = document.getElementById('fmtColor');
const fmtDelete = document.getElementById('fmtDelete');

const toolbar = createFloatingToolbar(formatToolbar, {
    shouldIgnoreTarget: (target) =>
        target.classList && target.classList.contains('editable-text')
});

export function getActiveTextItem() {
    return toolbar.getActiveItem();
}

export function repositionToolbar(textItem) {
    toolbar.reposition(textItem);
}

export function showFormatToolbar(textItem) {
    toolbar.show(textItem);
    updateToolbarState(textItem);
}

export function hideFormatToolbar() {
    toolbar.hide();
}

function updateToolbarState(textItem) {
    const currentWeight = textItem.fontWeightOverride ?? textItem.fontWeight;
    const currentStyle = textItem.fontStyleOverride ?? textItem.fontStyle;
    const currentSize = textItem.fontSizeOverride ?? Math.round(parseFloat(textItem.element.style.fontSize));
    const tc = textItem.textColorOverride ?? textItem.textColor;

    fmtBold.classList.toggle('active', currentWeight === '700');
    fmtItalic.classList.toggle('active', currentStyle === 'italic');
    fmtSizeLabel.textContent = currentSize;
    fmtColor.value = rgbToHex(tc.r, tc.g, tc.b);
}

function applyFormat(textItem) {
    const el = textItem.element;
    const weight = textItem.fontWeightOverride ?? textItem.fontWeight;
    const style = textItem.fontStyleOverride ?? textItem.fontStyle;
    const size = textItem.fontSizeOverride ?? Math.round(parseFloat(el.style.fontSize));

    el.style.fontWeight = weight;
    el.style.fontStyle = style;
    el.style.fontSize = size + 'px';

    if (textItem.textColorOverride) {
        const tc = textItem.textColorOverride;
        const r = Math.round(tc.r * 255), g = Math.round(tc.g * 255), b = Math.round(tc.b * 255);
        el.style.setProperty('--text-color', `rgb(${r}, ${g}, ${b})`);
    }

    el.classList.add('modified');
    updateToolbarState(textItem);
}

// ============================================
// Button handlers
// ============================================
fmtBold.addEventListener('click', () => {
    const item = toolbar.getActiveItem();
    if (!item) return;
    const current = item.fontWeightOverride ?? item.fontWeight;
    item.fontWeightOverride = current === '700' ? '400' : '700';
    applyFormat(item);
});

fmtItalic.addEventListener('click', () => {
    const item = toolbar.getActiveItem();
    if (!item) return;
    const current = item.fontStyleOverride ?? item.fontStyle;
    item.fontStyleOverride = current === 'italic' ? 'normal' : 'italic';
    applyFormat(item);
});

fmtSizeDown.addEventListener('click', () => {
    const item = toolbar.getActiveItem();
    if (!item) return;
    const current = item.fontSizeOverride ?? Math.round(parseFloat(item.element.style.fontSize));
    item.fontSizeOverride = Math.max(6, current - 1);
    applyFormat(item);
});

fmtSizeUp.addEventListener('click', () => {
    const item = toolbar.getActiveItem();
    if (!item) return;
    const current = item.fontSizeOverride ?? Math.round(parseFloat(item.element.style.fontSize));
    item.fontSizeOverride = current + 1;
    applyFormat(item);
});

fmtDelete.addEventListener('click', () => {
    const item = toolbar.getActiveItem();
    if (!item) return;
    if (!item.originalCovered && item.canvas) {
        const ctx = item.canvas.getContext('2d');
        const bgR = Math.round(item.bgColor.r * 255);
        const bgG = Math.round(item.bgColor.g * 255);
        const bgB = Math.round(item.bgColor.b * 255);
        ctx.fillStyle = `rgb(${bgR}, ${bgG}, ${bgB})`;
        const fs = item.renderedFontSize;
        ctx.fillRect(item.cssLeft, item.cssTop - fs * 0.4, item.originalWidth + 8, fs * 1.5);
        item.originalCovered = true;
    }
    item.deleted = true;
    item.element.classList.add('deleted');
    item.element.classList.remove('editing', 'modified', 'moved');
    item.element.contentEditable = false;
    item.element.style.display = 'none';
    toolbar.hide();
});

// Track text item when color picker opens (native dialog causes blur)
let colorPickerTextItem = null;

fmtColor.addEventListener('click', () => {
    colorPickerTextItem = toolbar.getActiveItem();
});

fmtColor.addEventListener('input', () => {
    const textItem = toolbar.getActiveItem() || colorPickerTextItem;
    if (!textItem) return;
    const hex = fmtColor.value;
    textItem.textColorOverride = {
        r: parseInt(hex.slice(1, 3), 16) / 255,
        g: parseInt(hex.slice(3, 5), 16) / 255,
        b: parseInt(hex.slice(5, 7), 16) / 255
    };
    applyFormat(textItem);
    showFormatToolbar(textItem);
});

fmtColor.addEventListener('change', () => {
    colorPickerTextItem = null;
});
