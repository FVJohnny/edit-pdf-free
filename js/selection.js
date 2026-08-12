/**
 * Multi-selection — Shift+click adds text items and images to a selection.
 * Dragging any selected item moves the whole group (within each item's page);
 * Delete removes them all in one undoable action.
 */

const selected = new Set();

export function toggleMultiSelect(item) {
    if (selected.has(item)) {
        selected.delete(item);
        item.element.classList.remove('multi-selected');
    } else {
        selected.add(item);
        item.element.classList.add('multi-selected');
    }
}

export function clearMultiSelection() {
    for (const item of selected) item.element.classList.remove('multi-selected');
    selected.clear();
}

export function isMultiSelected(item) {
    return selected.has(item);
}

export function getMultiSelection() {
    return [...selected];
}

export function multiSelectionSize() {
    return selected.size;
}

// Clicking anywhere that isn't a selected item (or a floating toolbar)
// clears the selection — same mental model as file managers.
document.addEventListener('pointerdown', (e) => {
    if (selected.size === 0 || e.shiftKey) return;
    if (e.target.closest?.('.image-toolbar, .format-toolbar, .search-bar, .draw-palette')) return;
    const el = e.target.closest?.('.editable-text, .draggable-image');
    if (el && [...selected].some(item => item.element === el)) return;
    clearMultiSelection();
});
