// ============================================
// Canvas utilities — cover original positions, capture regions
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
    document.dispatchEvent(new CustomEvent('text-background-change'));
}

/** Request a clean PDF rendering without the original text glyphs. */
export function coverOriginalText(textItem, spanWidth) {
    if (textItem.originalCovered) return;
    textItem.originalCovered = true;
    textItem.lastCoverWidth = spanWidth;
    // Request a real rendering with those original glyphs removed. Painting a
    // flat rectangle here would destroy gradients, borders and images.
    document.dispatchEvent(new Event('text-background-change'));
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
