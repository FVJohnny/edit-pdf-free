// ============================================
// Text format toolbar
// ============================================
import { createFloatingToolbar } from './utils/floating-toolbar.js';
import { rgbToHex, hexToRgb, rgbToCss } from './utils/color.js';
import { coverOriginalText } from './utils/canvas.js';
import { MIN_FONT_SIZE } from './utils/constants.js';

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
        target.classList?.contains('editable-text')
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

function currentWeight(item) { return item.fontWeightOverride ?? item.fontWeight; }
function currentStyle(item) { return item.fontStyleOverride ?? item.fontStyle; }
function currentSize(item) { return item.fontSizeOverride ?? Math.round(parseFloat(item.element.style.fontSize)); }
function currentColor(item) { return item.textColorOverride ?? item.textColor; }

function updateToolbarState(textItem) {
    fmtBold.classList.toggle('active', currentWeight(textItem) === '700');
    fmtItalic.classList.toggle('active', currentStyle(textItem) === 'italic');
    fmtSizeLabel.textContent = currentSize(textItem);
    const color = currentColor(textItem);
    fmtColor.value = rgbToHex(color.r, color.g, color.b);
}

function applyFormat(textItem) {
    const el = textItem.element;
    el.style.fontWeight = currentWeight(textItem);
    el.style.fontStyle = currentStyle(textItem);
    el.style.fontSize = currentSize(textItem) + 'px';

    if (textItem.textColorOverride) {
        el.style.setProperty('--text-color', rgbToCss(textItem.textColorOverride));
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
    item.fontWeightOverride = currentWeight(item) === '700' ? '400' : '700';
    applyFormat(item);
});

fmtItalic.addEventListener('click', () => {
    const item = toolbar.getActiveItem();
    if (!item) return;
    item.fontStyleOverride = currentStyle(item) === 'italic' ? 'normal' : 'italic';
    applyFormat(item);
});

fmtSizeDown.addEventListener('click', () => {
    const item = toolbar.getActiveItem();
    if (!item) return;
    item.fontSizeOverride = Math.max(MIN_FONT_SIZE, currentSize(item) - 1);
    applyFormat(item);
});

fmtSizeUp.addEventListener('click', () => {
    const item = toolbar.getActiveItem();
    if (!item) return;
    item.fontSizeOverride = currentSize(item) + 1;
    applyFormat(item);
});

fmtDelete.addEventListener('click', () => {
    const item = toolbar.getActiveItem();
    if (!item) return;
    coverOriginalText(item, item.originalWidth);
    item.deleted = true;
    item.element.classList.add('deleted');
    item.element.classList.remove('editing', 'modified', 'moved');
    item.element.contentEditable = false;
    item.element.style.display = 'none';
    toolbar.hide();
});

// Track text item when color picker opens — the native color dialog causes
// a blur event which clears activeItem before the 'input' event fires.
let colorPickerTextItem = null;

fmtColor.addEventListener('click', () => {
    colorPickerTextItem = toolbar.getActiveItem();
});

fmtColor.addEventListener('input', () => {
    const textItem = toolbar.getActiveItem() || colorPickerTextItem;
    if (!textItem) return;
    textItem.textColorOverride = hexToRgb(fmtColor.value);
    applyFormat(textItem);
    showFormatToolbar(textItem);
});

fmtColor.addEventListener('change', () => {
    colorPickerTextItem = null;
});
