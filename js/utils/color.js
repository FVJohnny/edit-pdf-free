// ============================================
// Color utilities
// ============================================
import {
    BG_COLOR_BUCKET, TEXT_COLOR_BUCKET,
    LUMINANCE_R, LUMINANCE_G, LUMINANCE_B,
    BG_BRIGHTNESS_THRESHOLD, TEXT_BRIGHTNESS_THRESHOLD, TEXT_SATURATION_THRESHOLD,
    IMAGE_BG_SAMPLE_OFFSET,
} from './constants.js';

/** Convert normalized RGB (0–1) to hex string "#rrggbb" */
export function rgbToHex(r, g, b) {
    const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Convert hex string "#rrggbb" to normalized RGB (0–1) */
export function hexToRgb(hex) {
    return {
        r: parseInt(hex.slice(1, 3), 16) / 255,
        g: parseInt(hex.slice(3, 5), 16) / 255,
        b: parseInt(hex.slice(5, 7), 16) / 255
    };
}

/** Convert normalized RGB (0–1) to CSS "rgb(r, g, b)" string */
export function rgbToCss(color) {
    return `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
}

/** Combine "#rrggbb" + alpha (0–1) into "#rrggbbaa". */
export function combineHexAlpha(hex, alpha) {
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
    return hex + a;
}

/**
 * Find the most common color in a horizontal pixel strip.
 * Used internally by sampleBgColor and sampleImageBgColor.
 *
 * @param {Uint8ClampedArray} pixelData - raw RGBA pixel data from getImageData
 * @param {number} bucketSize - color quantization granularity (smaller = more precise)
 * @param {function|null} shouldSkip - optional filter: return true to skip a pixel (r, g, b)
 * @returns {{r: number, g: number, b: number}} most common color (0–1 normalized)
 */
function findDominantColor(pixelData, bucketSize, shouldSkip, fallback) {
    const counts = {};
    for (let i = 0; i < pixelData.length; i += 4) {
        const r = pixelData[i], g = pixelData[i + 1], b = pixelData[i + 2];
        if (shouldSkip && shouldSkip(r, g, b)) continue;
        // Quantize to buckets so nearby colors are grouped
        const qr = Math.round(r / bucketSize) * bucketSize;
        const qg = Math.round(g / bucketSize) * bucketSize;
        const qb = Math.round(b / bucketSize) * bucketSize;
        const key = `${qr},${qg},${qb}`;
        if (!counts[key]) counts[key] = { count: 0, r, g, b };
        counts[key].count++;
    }
    let best = fallback;
    let bestCount = 0;
    for (const c of Object.values(counts)) {
        if (c.count > bestCount) {
            bestCount = c.count;
            best = { r: c.r / 255, g: c.g / 255, b: c.b / 255 };
        }
    }
    return best;
}

/** Read a 1px-tall horizontal strip of pixel data from the canvas. Returns null if out of bounds. */
function readStrip(canvas, x, y, width) {
    const stripX = Math.max(0, Math.round(x));
    const stripY = Math.round(y);
    const stripW = Math.min(Math.round(width), canvas.width - stripX);
    if (stripW <= 0 || stripY < 0 || stripY >= canvas.height) return null;
    return canvas.getContext('2d').getImageData(stripX, stripY, stripW, 1).data;
}

/**
 * Sample the background color behind a text item.
 * Reads a 1px strip at the text's baseline (y position) and finds the most common
 * bright color, skipping dark pixels which are likely rendered text glyphs.
 *
 * @param {HTMLCanvasElement} canvas - the page canvas
 * @param {number} x - left edge in canvas pixels
 * @param {number} y - baseline y in canvas pixels (from transform matrix)
 * @param {number} width - text width in canvas pixels
 * @returns {RGBColor} background color (normalized 0–1), defaults to white
 */
export function sampleBgColor(canvas, x, y, width) {
    const WHITE = { r: 1, g: 1, b: 1 };
    const pixels = readStrip(canvas, x, y, width);
    if (!pixels) return WHITE;
    return findDominantColor(pixels, BG_COLOR_BUCKET, (r, g, b) => {
        // Skip dark pixels — they're likely text, not background
        const brightness = r * LUMINANCE_R + g * LUMINANCE_G + b * LUMINANCE_B;
        return brightness < BG_BRIGHTNESS_THRESHOLD;
    }, WHITE);
}

/**
 * Sample the background color near an image.
 * Reads a 1px strip just above the image. Unlike sampleBgColor, does NOT skip
 * dark pixels since images can have dark backgrounds.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} x - left edge in canvas pixels
 * @param {number} y - top edge of image in canvas pixels
 * @param {number} width - image width in canvas pixels
 * @returns {RGBColor} background color (normalized 0–1), defaults to white
 */
export function sampleImageBgColor(canvas, x, y, width) {
    const WHITE = { r: 1, g: 1, b: 1 };
    const pixels = readStrip(canvas, x, Math.max(0, y) - IMAGE_BG_SAMPLE_OFFSET, width);
    if (!pixels) return WHITE;
    return findDominantColor(pixels, BG_COLOR_BUCKET, null, WHITE);
}

/**
 * Sample the text color by finding the most common non-background pixel.
 * Reads a strip through the vertical center of the text and ignores pixels
 * that are bright and unsaturated (likely background).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} transformedCoords - viewport-transformed coords [a,b,c,d, x, y]
 * @param {number} width - text width in canvas pixels
 * @param {number} fontSize - rendered font size in canvas pixels
 * @param {string} str - the text string (skipped if whitespace-only)
 * @returns {RGBColor} text color (normalized 0–1), defaults to black
 */
export function sampleTextColor(canvas, transformedCoords, width, fontSize, str) {
    const BLACK = { r: 0, g: 0, b: 0 };
    if (str.trim().length === 0) return BLACK;
    // Sample at vertical center of text (baseline minus half font size)
    const stripY = transformedCoords[5] - fontSize * 0.5;
    const pixels = readStrip(canvas, transformedCoords[4], stripY, width);
    if (!pixels) return BLACK;
    return findDominantColor(pixels, TEXT_COLOR_BUCKET, (r, g, b) => {
        // Skip bright, unsaturated pixels — they're background, not text
        const brightness = r * LUMINANCE_R + g * LUMINANCE_G + b * LUMINANCE_B;
        const saturation = Math.max(r, g, b) - Math.min(r, g, b);
        return brightness >= TEXT_BRIGHTNESS_THRESHOLD && saturation < TEXT_SATURATION_THRESHOLD;
    }, BLACK);
}
