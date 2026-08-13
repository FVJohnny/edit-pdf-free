// ============================================
// Image toolbar — floating toolbar for image actions
// ============================================
import { createFloatingToolbar } from './utils/floating-toolbar.js';
import { coverOriginalImage } from './utils/canvas.js';
import { recordAction } from './history.js';
import { clearStrokeSelection } from './draw.js';

import { showToast } from './ui.js';

const imageToolbar = document.getElementById('imageToolbar');
const imgDeleteBtn = document.getElementById('imgDelete');
const imgDownloadBtn = document.getElementById('imgDownload');
const imgRotateBtn = document.getElementById('imgRotate');

const toolbar = createFloatingToolbar(imageToolbar, {
    shouldIgnoreTarget: (target) =>
        target.classList?.contains('draggable-image') ||
        target.classList?.contains('img-resize-handle'),
    // Runs on self-dismissal too — without it, tapping empty space hid the
    // toolbar but left the image outlined "selected" forever.
    onHide: (item) => item.element.classList.remove('selected'),
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

imgRotateBtn.addEventListener('click', async () => {
    const img = toolbar.getActiveItem();
    if (!img) return;
    if (img.type !== 'imported-image') {
        showToast('Only imported images can be rotated (for now)');
        return;
    }
    await rotateImportedImage(img);
    toolbar.reposition(img);
});

/**
 * Rotate an imported image 90° clockwise by re-encoding its pixels — the item
 * stays a perfectly normal imported image (save/minimap/resize all just work).
 */
async function rotateImportedImage(item) {
    const prev = {
        bytes: item.importedImageBytes,
        type: item.importedImageType,
        dataURL: item.importedImageDataURL,
        w: item.element.style.width,
        h: item.element.style.height,
        resizedWidth: item.resizedWidth,
        resizedHeight: item.resizedHeight,
    };

    const image = await new Promise((resolve) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.src = item.importedImageDataURL;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalHeight;
    canvas.height = image.naturalWidth;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(image, 0, 0);
    const isPng = item.importedImageType === 'image/png';
    const dataURL = isPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92);

    const binary = atob(dataURL.slice(dataURL.indexOf(',') + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const apply = (data, w, h, rw, rh) => {
        item.importedImageBytes = data.bytes;
        item.importedImageDataURL = data.dataURL;
        item.element.style.backgroundImage = `url(${data.dataURL})`;
        item.element.style.width = w;
        item.element.style.height = h;
        item.resizedWidth = rw;
        item.resizedHeight = rh;
    };

    // Swap displayed dimensions (rotating 90° swaps width/height)
    const next = {
        bytes, dataURL,
        w: prev.h, h: prev.w,
        resizedWidth: parseFloat(prev.h) || item.cssHeight,
        resizedHeight: parseFloat(prev.w) || item.cssWidth,
    };
    apply(next, next.w, next.h, next.resizedWidth, next.resizedHeight);

    recordAction({
        undo() { apply(prev, prev.w, prev.h, prev.resizedWidth, prev.resizedHeight); },
        redo() { apply(next, next.w, next.h, next.resizedWidth, next.resizedHeight); },
    });
}

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
    // Selections are exclusive: picking an image drops any selected stroke
    // (their handlers stopPropagation, so global dismissers never see this).
    clearStrokeSelection();
    document.querySelectorAll('.draggable-image.selected').forEach(el => el.classList.remove('selected'));
    imageItemData.element.classList.add('selected');
    toolbar.show(imageItemData);
}

export function hideImageToolbar() {
    toolbar.hide(); // onHide clears the selection outline
}

export function repositionImageToolbar(imageItemData) {
    toolbar.reposition(imageItemData);
}

// Re-export for renderer.js drag/resize handlers
export { coverOriginalImage };
