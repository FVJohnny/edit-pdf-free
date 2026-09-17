// ============================================
// Canvas utilities — transfer original content into editable overlays
// ============================================

/**
 * Layout units vs backing resolution:
 * All item coordinates (cssLeft/Top, style.left, stroke points…) are in LAYOUT
 * pixels — the canvas's CSS size. The canvas backing store (canvas.width) can
 * be re-rendered at a higher resolution for sharp zoom, so code that touches
 * canvas pixels must convert through backingRatio().
 */
export function layoutWidth(canvas) {
    return parseFloat(canvas.style.width) || canvas.width;
}

export function layoutHeight(canvas) {
    return parseFloat(canvas.style.height) || canvas.height;
}

export function backingRatio(canvas) {
    return canvas.width / layoutWidth(canvas);
}

/** Request a clean PDF rendering without the original image occurrence. */
export function coverOriginalImage(imageItem) {
    if (imageItem.originalCovered) return;
    imageItem.originalCovered = true;
    imageItem.element.classList.add('original-removed');
    if (imageItem.type === 'image') imageItem.element.classList.add('background-pending');
    requestBackground();
}

/** Request a clean PDF rendering without the original text glyphs. */
export function coverOriginalText(textItem, spanWidth) {
    if (textItem.originalCovered) return;
    textItem.originalCovered = true;
    textItem.lastCoverWidth = spanWidth;
    textItem.element.classList.add('original-removed', 'background-pending');
    // Request a real rendering with those original glyphs removed. Painting a
    // flat rectangle here would destroy gradients, borders and images.
    requestBackground();
}

function requestBackground() {
    document.dispatchEvent(new CustomEvent('text-background-change', { detail: { immediate: true } }));
}

/** Start on pointer-down, before the drag threshold, to hide the cold-start delay. */
export function prepareTextDrag(item, width) {
    if (!item.originalText) return;
    item.previewLifted = true;
    if (item.nativePreview && item.originalCovered) {
        if (item.element.hasAttribute('data-native-preview')) {
            item.element.classList.add('background-pending');
            item.element.removeAttribute('data-native-preview');
        }
        // Also invalidate a confirmation preview that has not painted yet.
        // It must not bake the text back into the page during this new drag.
        requestBackground();
    }
    coverOriginalText(item, width);
}

/**
 * Capture a rectangular region of a canvas as a data URL (for image overlays).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} x - left position in canvas pixels
 * @param {number} y - top position in canvas pixels
 * @param {number} w - width in canvas pixels
 * @param {number} h - height in canvas pixels
 * @returns {string} data URL, or empty string if the region is out of bounds
 */
export function captureCanvasRegion(canvas, x, y, w, h) {
    const ratio = backingRatio(canvas);
    const sx = Math.max(0, Math.round(x * ratio));
    const sy = Math.max(0, Math.round(y * ratio));
    const sw = Math.min(Math.round(w * ratio), canvas.width - sx);
    const sh = Math.min(Math.round(h * ratio), canvas.height - sy);
    if (sw <= 0 || sh <= 0) return '';

    const temp = document.createElement('canvas');
    temp.width = sw;
    temp.height = sh;
    temp.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return temp.toDataURL();
}
