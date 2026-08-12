// ============================================
// Canvas utilities — cover original positions, capture regions
// ============================================
import { rgbToCss } from './color.js';
import { TEXT_COVER_TOP_OFFSET, TEXT_COVER_HEIGHT_SCALE, COVER_PADDING } from './constants.js';

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

/**
 * Cover an image's original position on the canvas with its background color.
 * Called when dragging, resizing, or deleting an image so the original
 * rendered pixels are hidden beneath a solid rectangle.
 *
 * @param {Object} imageItem - an image item with cssLeft/Top/Width/Height, bgColor, canvas
 */
export function coverOriginalImage(imageItem) {
    if (imageItem.originalCovered) return;
    // Cover always happens on the page the item came from, even after the
    // item has been dragged to another page.
    const canvas = imageItem.originCanvas || imageItem.canvas;
    const ctx = canvas.getContext('2d');
    const ratio = backingRatio(canvas);
    ctx.save();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = rgbToCss(imageItem.bgColor);
    // Add 2px padding on each side to cover any sub-pixel edge artifacts
    const pad = 2;
    ctx.fillRect(
        imageItem.cssLeft - pad,
        imageItem.cssTop - pad,
        imageItem.cssWidth + pad * 2,
        imageItem.cssHeight + pad * 2
    );
    ctx.restore();
    imageItem.originalCovered = true;
}

/**
 * Cover a text item's original position on the canvas with its background color.
 * The cover rect extends slightly above and below the text baseline to ensure
 * full coverage of rendered glyphs (ascenders, descenders).
 *
 * @param {Object} textItem - a text item with cssLeft/Top, bgColor, canvas, renderedFontSize
 * @param {number} spanWidth - the rendered width of the text span in pixels
 */
export function coverOriginalText(textItem, spanWidth) {
    if (textItem.originalCovered) return;
    // Cover always happens on the page the item came from, even after the
    // item has been dragged to another page.
    const canvas = textItem.originCanvas || textItem.canvas;
    const ctx = canvas.getContext('2d');
    const ratio = backingRatio(canvas);
    const fontSize = textItem.renderedFontSize;
    ctx.save();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = rgbToCss(textItem.bgColor);

    // For multi-line merged items, cover the full merged height.
    // mergedHeight already spans top-of-first-line to bottom-of-last-line,
    // so only add the small top offset to account for ascenders.
    const coverHeight = textItem.mergedHeight
        ? textItem.mergedHeight + fontSize * TEXT_COVER_TOP_OFFSET
        : fontSize * TEXT_COVER_HEIGHT_SCALE;

    ctx.fillRect(
        textItem.cssLeft,
        textItem.cssTop - fontSize * TEXT_COVER_TOP_OFFSET,
        spanWidth + COVER_PADDING,
        coverHeight
    );
    ctx.restore();
    // Remembered so covers can be replayed after a zoom re-render
    textItem.lastCoverWidth = spanWidth;
    textItem.originalCovered = true;
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
