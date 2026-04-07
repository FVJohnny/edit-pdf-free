// ============================================
// Image toolbar — floating toolbar for image actions
// ============================================
import { createFloatingToolbar } from './utils/floating-toolbar.js';

const imageToolbar = document.getElementById('imageToolbar');
const imgDeleteBtn = document.getElementById('imgDelete');

const toolbar = createFloatingToolbar(imageToolbar, {
    shouldIgnoreTarget: (target) =>
        (target.classList && target.classList.contains('draggable-image')) ||
        (target.classList && target.classList.contains('img-resize-handle'))
});

// Delete image
imgDeleteBtn.addEventListener('click', () => {
    const img = toolbar.getActiveItem();
    if (!img) return;

    // Cover original position on canvas
    if (!img.originalCovered && img.canvas) {
        coverOriginal(img);
    }

    img.deleted = true;
    img.element.style.display = 'none';
    toolbar.hide();
});

function coverOriginal(imageItemData) {
    if (imageItemData.originalCovered) return;
    const ctx = imageItemData.canvas.getContext('2d');
    const bg = imageItemData.bgColor;
    const r = Math.round(bg.r * 255);
    const g = Math.round(bg.g * 255);
    const b = Math.round(bg.b * 255);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(
        imageItemData.cssLeft,
        imageItemData.cssTop,
        imageItemData.cssWidth,
        imageItemData.cssHeight
    );
    imageItemData.originalCovered = true;
}

export function showImageToolbar(imageItemData) {
    // Deselect any previously selected image
    document.querySelectorAll('.draggable-image.selected').forEach(e => e.classList.remove('selected'));
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

export { coverOriginal as coverOriginalImage };
