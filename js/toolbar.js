// ============================================
// Format toolbar
// ============================================
const formatToolbar = document.getElementById('formatToolbar');
const fmtBold = document.getElementById('fmtBold');
const fmtItalic = document.getElementById('fmtItalic');
const fmtSizeDown = document.getElementById('fmtSizeDown');
const fmtSizeUp = document.getElementById('fmtSizeUp');
const fmtSizeLabel = document.getElementById('fmtSizeLabel');
const fmtColor = document.getElementById('fmtColor');

let activeTextItem = null;

export function getActiveTextItem() {
    return activeTextItem;
}

export function repositionToolbar(textItem) {
    const rect = textItem.element.getBoundingClientRect();
    const tbRect = formatToolbar.getBoundingClientRect();

    let left = rect.left + rect.width / 2 - tbRect.width / 2;
    let top = rect.top - tbRect.height - 8;

    if (left < 8) left = 8;
    if (left + tbRect.width > window.innerWidth - 8) left = window.innerWidth - tbRect.width - 8;
    if (top < 8) top = rect.bottom + 8;

    formatToolbar.style.left = left + 'px';
    formatToolbar.style.top = top + 'px';
}

export function showFormatToolbar(textItem) {
    activeTextItem = textItem;

    // Make visible off-screen first to measure, then position
    formatToolbar.style.left = '-9999px';
    formatToolbar.style.top = '-9999px';
    formatToolbar.style.display = 'flex';

    repositionToolbar(textItem);
    updateToolbarState(textItem);
}

export function hideFormatToolbar() {
    formatToolbar.style.display = 'none';
    activeTextItem = null;
}

function updateToolbarState(textItem) {
    const currentWeight = textItem.fontWeightOverride ?? textItem.fontWeight;
    const currentStyle = textItem.fontStyleOverride ?? textItem.fontStyle;
    const currentSize = textItem.fontSizeOverride ?? Math.round(parseFloat(textItem.element.style.fontSize));
    const tc = textItem.textColorOverride ?? textItem.textColor;

    fmtBold.classList.toggle('active', currentWeight === '700');
    fmtItalic.classList.toggle('active', currentStyle === 'italic');
    fmtSizeLabel.textContent = currentSize;

    // Convert rgb 0-1 to hex
    const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
    fmtColor.value = `#${toHex(tc.r)}${toHex(tc.g)}${toHex(tc.b)}`;
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

// Reposition toolbar on scroll so it follows the text
window.addEventListener('scroll', () => {
    if (activeTextItem) repositionToolbar(activeTextItem);
}, true);

// Prevent toolbar clicks from blurring the editable text
formatToolbar.addEventListener('mousedown', (e) => {
    e.preventDefault();
});

// Hide toolbar when clicking outside of it and outside editable text
document.addEventListener('mousedown', (e) => {
    if (!activeTextItem) return;
    if (formatToolbar.contains(e.target)) return;
    if (e.target.classList && e.target.classList.contains('editable-text')) return;
    hideFormatToolbar();
});

fmtBold.addEventListener('click', () => {
    if (!activeTextItem) return;
    const current = activeTextItem.fontWeightOverride ?? activeTextItem.fontWeight;
    activeTextItem.fontWeightOverride = current === '700' ? '400' : '700';
    applyFormat(activeTextItem);
});

fmtItalic.addEventListener('click', () => {
    if (!activeTextItem) return;
    const current = activeTextItem.fontStyleOverride ?? activeTextItem.fontStyle;
    activeTextItem.fontStyleOverride = current === 'italic' ? 'normal' : 'italic';
    applyFormat(activeTextItem);
});

fmtSizeDown.addEventListener('click', () => {
    if (!activeTextItem) return;
    const current = activeTextItem.fontSizeOverride ?? Math.round(parseFloat(activeTextItem.element.style.fontSize));
    activeTextItem.fontSizeOverride = Math.max(6, current - 1);
    applyFormat(activeTextItem);
});

fmtSizeUp.addEventListener('click', () => {
    if (!activeTextItem) return;
    const current = activeTextItem.fontSizeOverride ?? Math.round(parseFloat(activeTextItem.element.style.fontSize));
    activeTextItem.fontSizeOverride = current + 1;
    applyFormat(activeTextItem);
});

// Track the text item when color picker opens, since the native color dialog
// causes blur which clears activeTextItem before the color input event fires
let colorPickerTextItem = null;

fmtColor.addEventListener('click', () => {
    colorPickerTextItem = activeTextItem;
});

fmtColor.addEventListener('input', () => {
    const textItem = activeTextItem || colorPickerTextItem;
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
