// ============================================
// Text format toolbar
// ============================================
import { createFloatingToolbar } from './utils/floating-toolbar.js';
import { rgbToHex, hexToRgb, combineHexAlpha } from './utils/color.js';
import { openColorPopover } from './utils/color-popover.js';
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
function currentOpacity(item) { return item.textOpacityOverride ?? 1; }

function updateToolbarState(textItem) {
    fmtBold.classList.toggle('active', currentWeight(textItem) === '700');
    fmtItalic.classList.toggle('active', currentStyle(textItem) === 'italic');
    fmtSizeLabel.textContent = currentSize(textItem);
    const color = currentColor(textItem);
    fmtColor.style.setProperty('--swatch-color',
        combineHexAlpha(rgbToHex(color.r, color.g, color.b), currentOpacity(textItem)));
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

    {
        // Always rewrite the var: undoing back to "no override" must restore
        // the item's base color, not leave the previous rgba behind.
        const c = currentColor(textItem);
        const a = currentOpacity(textItem);
        el.style.setProperty('--text-color',
            `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${a})`);
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
// Text color & opacity: custom popover, live preview, one undo entry on close
fmtColor.addEventListener('click', () => {
    const textItem = toolbar.getActiveItem();
    if (!textItem) return;
    const before = { color: textItem.textColorOverride, opacity: textItem.textOpacityOverride };
    const cur = currentColor(textItem);
    openColorPopover({
        anchor: fmtColor,
        color: rgbToHex(cur.r, cur.g, cur.b),
        alpha: currentOpacity(textItem),
        onChange(hex, a) {
            textItem.textColorOverride = hexToRgb(hex);
            // Only store an override when it actually deviates — full opacity
            // must not force the fallback-font path on save.
            textItem.textOpacityOverride = a < 1 ? Math.max(0.05, a) : undefined;
            applyFormat(textItem);
        },
        onCommit() {
            if (before.color === textItem.textColorOverride &&
                before.opacity === textItem.textOpacityOverride) return;
            const after = { color: textItem.textColorOverride, opacity: textItem.textOpacityOverride };
            recordAction({
                undo() {
                    textItem.textColorOverride = before.color;
                    textItem.textOpacityOverride = before.opacity;
                    applyFormat(textItem);
                },
                redo() {
                    textItem.textColorOverride = after.color;
                    textItem.textOpacityOverride = after.opacity;
                    applyFormat(textItem);
                },
            });
        },
    });
});
