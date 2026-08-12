// ============================================
// Text format toolbar
// ============================================
import { createFloatingToolbar } from './utils/floating-toolbar.js';
import { rgbToHex, hexToRgb, rgbToCss } from './utils/color.js';
import { coverOriginalText } from './utils/canvas.js';
import { MIN_FONT_SIZE } from './utils/constants.js';
import { recordAction } from './history.js';

const formatToolbar = document.getElementById('formatToolbar');
const fmtFont = document.getElementById('fmtFont');
const fmtBold = document.getElementById('fmtBold');
const fmtItalic = document.getElementById('fmtItalic');
const fmtAlignLeft = document.getElementById('fmtAlignLeft');
const fmtAlignCenter = document.getElementById('fmtAlignCenter');
const fmtAlignRight = document.getElementById('fmtAlignRight');

/** CSS stacks for the three embeddable standard font families. */
const FAMILY_CSS = {
    Helvetica: 'Helvetica, Arial, sans-serif',
    Times: "'Times New Roman', Times, serif",
    Courier: "'Courier New', Courier, monospace",
};
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
    fmtFont.value = textItem.fontFamilyOverride || '';
    const align = textItem.alignOverride || 'left';
    fmtAlignLeft.classList.toggle('active', align === 'left');
    fmtAlignCenter.classList.toggle('active', align === 'center');
    fmtAlignRight.classList.toggle('active', align === 'right');
}

function applyFormat(textItem) {
    const el = textItem.element;
    el.style.fontWeight = currentWeight(textItem);
    el.style.fontStyle = currentStyle(textItem);
    el.style.fontSize = currentSize(textItem) + 'px';

    if (textItem.textColorOverride) {
        el.style.setProperty('--text-color', rgbToCss(textItem.textColorOverride));
    }

    if (textItem.fontFamilyOverride) {
        el.style.fontFamily = FAMILY_CSS[textItem.fontFamilyOverride] || textItem.fontFamilyOverride;
    } else {
        el.style.fontFamily = textItem.fontFamily;
    }

    // Alignment needs a box wider than the text — min-width covers it
    el.style.textAlign = textItem.alignOverride || '';

    // Cover original canvas text so it doesn't show through the styled overlay
    coverOriginalText(textItem, textItem.originalWidth);

    el.classList.add('modified');
    updateToolbarState(textItem);
}

// ============================================
// Button handlers
// ============================================
/** Record a format property change with undo/redo support. */
function applyWithUndo(item, prop, newValue) {
    const oldValue = item[prop];
    item[prop] = newValue;
    applyFormat(item);
    recordAction({
        undo() { item[prop] = oldValue; applyFormat(item); },
        redo() { item[prop] = newValue; applyFormat(item); },
    });
}

fmtBold.addEventListener('click', () => {
    const item = toolbar.getActiveItem();
    if (!item) return;
    applyWithUndo(item, 'fontWeightOverride', currentWeight(item) === '700' ? '400' : '700');
});

fmtItalic.addEventListener('click', () => {
    const item = toolbar.getActiveItem();
    if (!item) return;
    applyWithUndo(item, 'fontStyleOverride', currentStyle(item) === 'italic' ? 'normal' : 'italic');
});

fmtSizeDown.addEventListener('click', () => {
    const item = toolbar.getActiveItem();
    if (!item) return;
    applyWithUndo(item, 'fontSizeOverride', Math.max(MIN_FONT_SIZE, currentSize(item) - 1));
});

fmtSizeUp.addEventListener('click', () => {
    const item = toolbar.getActiveItem();
    if (!item) return;
    applyWithUndo(item, 'fontSizeOverride', currentSize(item) + 1);
});

fmtFont.addEventListener('change', () => {
    const item = toolbar.getActiveItem();
    if (!item) return;
    applyWithUndo(item, 'fontFamilyOverride', fmtFont.value || undefined);
});
// The native select steals focus — keep the toolbar's active item alive
fmtFont.addEventListener('pointerdown', (e) => e.stopPropagation());

for (const [btn, align] of [[fmtAlignLeft, 'left'], [fmtAlignCenter, 'center'], [fmtAlignRight, 'right']]) {
    btn.addEventListener('click', () => {
        const item = toolbar.getActiveItem();
        if (!item) return;
        applyWithUndo(item, 'alignOverride', align === 'left' ? undefined : align);
    });
}

fmtDelete.addEventListener('click', () => {
    const item = toolbar.getActiveItem();
    if (!item) return;
    // Remember state so undo restores exactly what was there before
    const wasModified = item.element.classList.contains('modified');
    const wasMoved = item.element.classList.contains('moved');
    coverOriginalText(item, item.originalWidth);
    item.deleted = true;
    item.element.classList.add('deleted');
    item.element.classList.remove('editing', 'modified', 'moved');
    item.element.contentEditable = false;
    item.element.style.display = 'none';
    toolbar.hide();

    recordAction({
        undo() {
            item.deleted = false;
            item.element.classList.remove('deleted');
            // The canvas original was covered on delete, so an unmodified item
            // still needs its overlay text visible — keep 'modified' in that case.
            item.element.classList.toggle('modified', wasModified || item.originalCovered);
            item.element.classList.toggle('moved', wasMoved);
            item.element.style.display = '';
        },
        redo() {
            item.deleted = true;
            item.element.classList.add('deleted');
            item.element.classList.remove('modified', 'moved');
            item.element.style.display = 'none';
        },
    });
});

// Track text item and original color when color picker opens — the native
// color dialog causes a blur event which clears activeItem before input fires.
let colorPickerTextItem = null;
let colorBeforePicker = null;

fmtColor.addEventListener('click', () => {
    colorPickerTextItem = toolbar.getActiveItem();
    if (colorPickerTextItem) {
        colorBeforePicker = colorPickerTextItem.textColorOverride ?? colorPickerTextItem.textColor;
    }
});

// Apply color live as the user drags in the picker (no undo recording)
fmtColor.addEventListener('input', () => {
    const textItem = toolbar.getActiveItem() || colorPickerTextItem;
    if (!textItem) return;
    textItem.textColorOverride = hexToRgb(fmtColor.value);
    applyFormat(textItem);
    showFormatToolbar(textItem);
});

// Record a single undo action when the picker closes
fmtColor.addEventListener('change', () => {
    const textItem = toolbar.getActiveItem() || colorPickerTextItem;
    if (textItem && colorBeforePicker) {
        const oldColor = colorBeforePicker;
        const newColor = hexToRgb(fmtColor.value);
        recordAction({
            undo() { textItem.textColorOverride = oldColor; applyFormat(textItem); },
            redo() { textItem.textColorOverride = newColor; applyFormat(textItem); },
        });
    }
    colorPickerTextItem = null;
    colorBeforePicker = null;
});
