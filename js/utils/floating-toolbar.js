// ============================================
// Floating toolbar — shared positioning, show/hide, dismiss logic
// ============================================
import { TOOLBAR_MARGIN } from './constants.js';

/**
 * Create a floating toolbar controller.
 * Handles positioning (centered above the active item's element),
 * scroll tracking, click-outside dismissal, and preventing blur.
 *
 * @param {HTMLElement} toolbarEl - the toolbar DOM element
 * @param {Object} options
 * @param {function} options.shouldIgnoreTarget - return true for targets that
 *   should NOT dismiss the toolbar when clicked (e.g. the items themselves)
 * @param {function} [options.onHide] - called with the item whenever the
 *   toolbar hides, INCLUDING self-dismissal on outside clicks — put any
 *   per-item cleanup (selection outlines, handles) here, not in a wrapper.
 * @returns {{ show, hide, reposition, getActiveItem }}
 */
export function createFloatingToolbar(toolbarEl, { shouldIgnoreTarget, onHide }) {
    let activeItem = null;

    function reposition(item) {
        const rect = item.element.getBoundingClientRect();
        const tbRect = toolbarEl.getBoundingClientRect();

        // Visible band in client coordinates. On mobile, the on-screen
        // keyboard shrinks/pans the visual viewport without moving the layout
        // viewport that position:fixed anchors to — clamping against
        // window.innerWidth/Height alone can leave the toolbar off-screen.
        const vv = window.visualViewport;
        const bandLeft = (vv?.offsetLeft ?? 0) + TOOLBAR_MARGIN;
        const bandTop = (vv?.offsetTop ?? 0) + TOOLBAR_MARGIN;
        const bandRight = (vv?.offsetLeft ?? 0) + (vv?.width ?? window.innerWidth) - TOOLBAR_MARGIN;
        const bandBottom = (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight) - TOOLBAR_MARGIN;

        // Center horizontally above the item, clamped to the visible band
        let left = rect.left + rect.width / 2 - tbRect.width / 2;
        let top = rect.top - tbRect.height - TOOLBAR_MARGIN;

        if (left + tbRect.width > bandRight) left = bandRight - tbRect.width;
        if (left < bandLeft) left = bandLeft;
        // If no room above, flip below the item
        if (top < bandTop) top = rect.bottom + TOOLBAR_MARGIN;
        // Never leave the visible band (keyboard may cover the lower half)
        if (top + tbRect.height > bandBottom) top = bandBottom - tbRect.height;
        if (top < bandTop) top = bandTop;

        toolbarEl.style.left = left + 'px';
        toolbarEl.style.top = top + 'px';

        // Mobile browsers disagree on what position:fixed anchors to while
        // the keyboard pans the visual viewport, so a computed `top` can land
        // somewhere else entirely. Measure where the toolbar actually ended
        // up (same client-coordinate space as `rect` above) and compensate.
        const landed = toolbarEl.getBoundingClientRect();
        const dx = landed.left - left;
        const dy = landed.top - top;
        if (dx || dy) {
            toolbarEl.style.left = (left - dx) + 'px';
            toolbarEl.style.top = (top - dy) + 'px';
        }
    }

    function show(item) {
        activeItem = item;
        // Render off-screen first so the browser can measure its dimensions
        toolbarEl.style.left = '-9999px';
        toolbarEl.style.top = '-9999px';
        toolbarEl.style.display = 'flex';
        reposition(item);
    }

    function hide() {
        const item = activeItem;
        toolbarEl.style.display = 'none';
        activeItem = null;
        if (item) onHide?.(item);
    }

    function getActiveItem() {
        return activeItem;
    }

    // Keep toolbar above item while scrolling
    window.addEventListener('scroll', () => {
        if (activeItem) reposition(activeItem);
    }, true);

    // Mobile keyboards pan/resize the visual viewport without firing window
    // scroll — track it so the toolbar stays glued to its item.
    window.visualViewport?.addEventListener('resize', () => {
        if (activeItem) reposition(activeItem);
    });
    window.visualViewport?.addEventListener('scroll', () => {
        if (activeItem) reposition(activeItem);
    });

    // Prevent toolbar clicks from stealing focus/blur from editable elements.
    // Form controls are exempt: they need native focus to work — on iOS,
    // preventing pointerdown stops color/select inputs from ever opening.
    toolbarEl.addEventListener('pointerdown', (e) => {
        if (e.target.closest('input, select, textarea, label')) return;
        e.preventDefault();
    });

    // Dismiss when clicking outside both the toolbar and the active item
    document.addEventListener('pointerdown', (e) => {
        if (!activeItem) return;
        if (toolbarEl.contains(e.target)) return;
        if (shouldIgnoreTarget && shouldIgnoreTarget(e.target)) return;
        hide();
    });

    return { show, hide, reposition, getActiveItem };
}
