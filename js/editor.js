import { showFormatToolbar, hideFormatToolbar } from './toolbar.js';
import { recordAction } from './history.js';

// ============================================
// Make text editable inline
// ============================================
export function makeEditable(textItem) {
    if (textItem.element.contentEditable === 'true') return;

    document.querySelectorAll('.text-item').forEach(el => {
        el.contentEditable = false;
        el.classList.remove('editing');
    });

    textItem.element.style.minWidth = textItem.originalWidth + 'px';
    textItem.element.contentEditable = true;
    textItem.element.classList.add('editing');
    textItem.element.focus();

    const range = document.createRange();
    range.selectNodeContents(textItem.element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    showFormatToolbar(textItem);

    const textBefore = textItem.currentText;

    const finishEditing = () => {
        textItem.element.contentEditable = false;
        textItem.element.classList.remove('editing');
        const textAfter = textItem.element.textContent;
        textItem.currentText = textAfter;
        const isMoved = textItem.moveOffsetX !== 0 || textItem.moveOffsetY !== 0;
        const hasOverrides = textItem.fontWeightOverride || textItem.fontStyleOverride ||
                             textItem.fontSizeOverride || textItem.textColorOverride;
        if (textItem.currentText !== textItem.originalText || isMoved || hasOverrides) {
            textItem.element.classList.add('modified');
            textItem.element.style.minWidth = textItem.originalWidth + 'px';
        } else {
            textItem.element.classList.remove('modified');
            textItem.element.style.minWidth = '';
        }
        hideFormatToolbar();

        // Record undo action if text actually changed
        if (textAfter !== textBefore) {
            recordAction({
                undo() {
                    textItem.currentText = textBefore;
                    textItem.element.textContent = textBefore;
                },
                redo() {
                    textItem.currentText = textAfter;
                    textItem.element.textContent = textAfter;
                },
            });
        }
    };

    textItem.element.addEventListener('blur', finishEditing, { once: true });

    textItem.element.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            textItem.element.blur();
        }
        if (e.key === 'Escape') {
            textItem.element.textContent = textItem.currentText;
            textItem.element.blur();
        }
    }, { once: true });
}
