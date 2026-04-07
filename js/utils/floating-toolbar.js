// ============================================
// Floating toolbar — shared positioning, show/hide, dismiss logic
// ============================================

export function createFloatingToolbar(toolbarEl, { shouldIgnoreTarget }) {
    let activeItem = null;

    function reposition(item) {
        const rect = item.element.getBoundingClientRect();
        const tbRect = toolbarEl.getBoundingClientRect();

        let left = rect.left + rect.width / 2 - tbRect.width / 2;
        let top = rect.top - tbRect.height - 8;

        if (left < 8) left = 8;
        if (left + tbRect.width > window.innerWidth - 8) left = window.innerWidth - tbRect.width - 8;
        if (top < 8) top = rect.bottom + 8;

        toolbarEl.style.left = left + 'px';
        toolbarEl.style.top = top + 'px';
    }

    function show(item) {
        activeItem = item;
        // Render off-screen first to measure
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

    // Reposition on scroll
    window.addEventListener('scroll', () => {
        if (activeItem) reposition(activeItem);
    }, true);

    // Prevent toolbar clicks from blurring active elements
    toolbarEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
    });

    // Click outside to dismiss
    document.addEventListener('mousedown', (e) => {
        if (!activeItem) return;
        if (toolbarEl.contains(e.target)) return;
        if (shouldIgnoreTarget && shouldIgnoreTarget(e.target)) return;
        hide();
    });

    return { show, hide, reposition, getActiveItem };
}
