// ============================================
// Image toolbar — floating toolbar for image actions
// ============================================
import { createFloatingToolbar } from './utils/floating-toolbar.js';
import { coverOriginalImage } from './utils/canvas.js';

const imageToolbar = document.getElementById('imageToolbar');
const imgDeleteBtn = document.getElementById('imgDelete');

const toolbar = createFloatingToolbar(imageToolbar, {
    shouldIgnoreTarget: (target) =>
        target.classList?.contains('draggable-image') ||
        target.classList?.contains('img-resize-handle')
});

imgDeleteBtn.addEventListener('click', () => {
    const img = toolbar.getActiveItem();
    if (!img) return;

    coverOriginalImage(img);
    img.deleted = true;
    img.element.style.display = 'none';
    toolbar.hide();
});

export function showImageToolbar(imageItemData) {
    document.querySelectorAll('.draggable-image.selected').forEach(el => el.classList.remove('selected'));
    imageItemData.element.classList.add('selected');
    toolbar.show(imageItemData);
}

export function hideImageToolbar() {
    const item = toolbar.getActiveItem();
    if (item) item.element.classList.remove('selected');
    toolbar.hide();
}

export function repositionImageToolbar(imageItemData) {
    toolbar.reposition(imageItemData);
}

// Re-export for renderer.js drag/resize handlers
export { coverOriginalImage };
