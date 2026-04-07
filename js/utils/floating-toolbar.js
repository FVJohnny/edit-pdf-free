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
 * @returns {{ show, hide, reposition, getActiveItem }}
 */
export function createFloatingToolbar(toolbarEl, { shouldIgnoreTarget }) {
    let activeItem = null;

    function reposition(item) {
        const rect = item.element.getBoundingClientRect();
        const tbRect = toolbarEl.getBoundingClientRect();

        // Center horizontally above the item, clamped to viewport edges
        let left = rect.left + rect.width / 2 - tbRect.width / 2;
        let top = rect.top - tbRect.height - TOOLBAR_MARGIN;

        if (left < TOOLBAR_MARGIN) left = TOOLBAR_MARGIN;
        if (left + tbRect.width > window.innerWidth - TOOLBAR_MARGIN) {
            left = window.innerWidth - tbRect.width - TOOLBAR_MARGIN;
        }
        // If no room above, flip below the item
        if (top < TOOLBAR_MARGIN) top = rect.bottom + TOOLBAR_MARGIN;

        toolbarEl.style.left = left + 'px';
        toolbarEl.style.top = top + 'px';
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
        toolbarEl.style.display = 'none';
        activeItem = null;
    }

    function getActiveItem() {
        return activeItem;
    }

    // Keep toolbar above item while scrolling
    window.addEventListener('scroll', () => {
        if (activeItem) reposition(activeItem);
    }, true);

    // Prevent toolbar clicks from stealing focus/blur from editable elements
    toolbarEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
    });

    // Dismiss when clicking outside both the toolbar and the active item
    document.addEventListener('mousedown', (e) => {
        if (!activeItem) return;
        if (toolbarEl.contains(e.target)) return;
        if (shouldIgnoreTarget && shouldIgnoreTarget(e.target)) return;
        hide();
    });

    return { show, hide, reposition, getActiveItem };
}
