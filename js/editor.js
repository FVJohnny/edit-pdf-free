import { showFormatToolbar, hideFormatToolbar } from './toolbar.js';
import { recordAction } from './history.js';
import { coverOriginalText } from './utils/canvas.js';

// ============================================
// Make text editable inline
// ============================================
export function makeEditable(textItem) {
    const el = textItem.element;
    if (el.isContentEditable) return;

    // Close any other editor still open (normally blur handles this; this is
    // a safety net e.g. when focus was lost without a blur event)
    document.querySelectorAll('.editable-text[contenteditable]').forEach(other => {
        if (other !== el && other.isContentEditable) other.blur();
    });

    el.style.minWidth = textItem.originalWidth + 'px';
    // Render \n as line breaks while editing (and after, for multi-line text)
    el.style.whiteSpace = 'pre-wrap';
    // plaintext-only makes Enter insert plain \n and strips pasted formatting;
    // fall back to true where unsupported
    el.contentEditable = 'plaintext-only';
    if (!el.isContentEditable) el.contentEditable = 'true';
    el.classList.add('editing');
    el.focus();

    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    showFormatToolbar(textItem);

    const textBefore = textItem.currentText;

    /** Read the edited text preserving line breaks (innerText keeps <br>/<div> breaks). */
    const readText = () => el.innerText.replace(/\r/g, '').replace(/\n+$/, '');

    let finished = false;
    const finishEditing = (event) => {
        if (finished) return; // runs via Enter/Escape, blur AND outside-pointer — only once
        finished = true;
        el.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('pointerdown', onOutsidePointer, true);
        el.contentEditable = 'false';
        el.classList.remove('editing');
        const textAfter = readText();
        // Normalize the DOM content back to plain text with \n
        el.textContent = textAfter;
        textItem.currentText = textAfter;
        const isMoved = textItem.moveOffsetX !== 0 || textItem.moveOffsetY !== 0;
        const hasOverrides = textItem.fontWeightOverride || textItem.fontStyleOverride ||
                             textItem.fontSizeOverride || textItem.textColorOverride ||
                             textItem.fontFamilyOverride || textItem.alignOverride;
        if (textItem.currentText !== textItem.originalText || isMoved || hasOverrides) {
            coverOriginalText(textItem, textItem.originalWidth);
            el.classList.add('modified');
            el.style.minWidth = textItem.originalWidth + 'px';
        } else {
            el.classList.remove('modified');
            el.style.minWidth = '';
        }
        // When focus moved INTO the toolbar (e.g. opening the font select),
        // the user is formatting, not leaving — keep the toolbar open.
        const toolbarEl = document.getElementById('formatToolbar');
        const focusMovedIntoToolbar = event?.relatedTarget && toolbarEl.contains(event.relatedTarget);
        if (!focusMovedIntoToolbar) hideFormatToolbar();

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

    // Enter confirms; Shift+Enter (or Cmd/Ctrl+Enter) inserts a line break.
    const onKeyDown = (e) => {
        if (e.key === 'Enter') {
            if (e.shiftKey || e.metaKey || e.ctrlKey) {
                // plaintext-only inserts \n natively; otherwise insert a <br>
                if (el.contentEditable !== 'plaintext-only') {
                    e.preventDefault();
                    document.execCommand('insertLineBreak');
                }
                return;
            }
            e.preventDefault();
            finishEditing();
            el.blur();
        } else if (e.key === 'Escape') {
            el.textContent = textItem.currentText;
            finishEditing();
            el.blur();
        }
    };

    // Drag handlers on shapes/images preventDefault their pointerdown, which
    // stops the browser from moving focus — so blur alone can't be trusted to
    // commit the edit. A capture-phase outside-pointer listener covers it.
    const onOutsidePointer = (e) => {
        if (el.contains(e.target)) return;
        const toolbarEl = document.getElementById('formatToolbar');
        if (toolbarEl.contains(e.target)) return;
        finishEditing(e);
        el.blur();
    };

    el.addEventListener('blur', finishEditing, { once: true });
    el.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onOutsidePointer, true);
}
