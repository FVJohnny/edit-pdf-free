// ============================================
// Image toolbar — floating toolbar for image actions
// ============================================
import { createFloatingToolbar } from './utils/floating-toolbar.js';
import { coverOriginalImage } from './utils/canvas.js';
import { recordAction } from './history.js';

const imageToolbar = document.getElementById('imageToolbar');
const imgDeleteBtn = document.getElementById('imgDelete');
const imgDownloadBtn = document.getElementById('imgDownload');

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

    recordAction({
        undo() { img.deleted = false; img.element.style.display = ''; },
        redo() { img.deleted = true; img.element.style.display = 'none'; },
    });
});

imgDownloadBtn.addEventListener('click', () => {
    const img = toolbar.getActiveItem();
    if (!img) return;

    // For imported images use their original data URL; for extracted images use the canvas capture
    const dataURL = img.importedImageDataURL || img.imageDataURL;
    if (!dataURL) return;

    const a = document.createElement('a');
    a.href = dataURL;
    a.download = 'image.' + (dataURL.startsWith('data:image/png') ? 'png' : 'jpg');
    a.click();
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
