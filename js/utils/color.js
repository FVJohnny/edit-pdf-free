// ============================================
// Color utilities
// ============================================

export function rgbToHex(r, g, b) {
    const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToRgb(hex) {
    return {
        r: parseInt(hex.slice(1, 3), 16) / 255,
        g: parseInt(hex.slice(3, 5), 16) / 255,
        b: parseInt(hex.slice(5, 7), 16) / 255
    };
}

export function rgbToCss(color) {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Sample the most common background color from a horizontal strip of pixels.
 * Skips dark pixels (brightness < 80) to avoid sampling text.
 */
export function sampleBgColor(canvas, x, y, width) {
    const ctx = canvas.getContext('2d');
    let bgColor = { r: 1, g: 1, b: 1 };

    const stripY = Math.round(y);
    const stripX = Math.max(0, Math.round(x));
    const stripW = Math.min(Math.round(width), canvas.width - stripX);
    if (stripW <= 0 || stripY < 0 || stripY >= canvas.height) return bgColor;

    const stripData = ctx.getImageData(stripX, stripY, stripW, 1).data;
    const colorCounts = {};
    for (let i = 0; i < stripData.length; i += 4) {
        const r = stripData[i], g = stripData[i + 1], b = stripData[i + 2];
        const brightness = r * 0.299 + g * 0.587 + b * 0.114;
        if (brightness < 80) continue;
        const qr = Math.round(r / 4) * 4;
        const qg = Math.round(g / 4) * 4;
        const qb = Math.round(b / 4) * 4;
        const key = `${qr},${qg},${qb}`;
        if (!colorCounts[key]) colorCounts[key] = { count: 0, r, g, b };
        colorCounts[key].count++;
    }
    let bestCount = 0;
    for (const c of Object.values(colorCounts)) {
        if (c.count > bestCount) {
            bestCount = c.count;
            bgColor = { r: c.r / 255, g: c.g / 255, b: c.b / 255 };
        }
    }
    return bgColor;
}

/**
 * Sample the most common background color near an image.
 * Unlike sampleBgColor, does NOT skip dark pixels.
 */
export function sampleImageBgColor(canvas, x, y, width) {
    const ctx = canvas.getContext('2d');
    let bgColor = { r: 1, g: 1, b: 1 };

    const stripY = Math.max(0, Math.round(y) - 2);
    const stripX = Math.max(0, Math.round(x));
    const stripW = Math.min(Math.round(width), canvas.width - stripX);
    if (stripW <= 0 || stripY < 0 || stripY >= canvas.height) return bgColor;

    const stripData = ctx.getImageData(stripX, stripY, stripW, 1).data;
    const colorCounts = {};
    for (let i = 0; i < stripData.length; i += 4) {
        const r = stripData[i], g = stripData[i + 1], b = stripData[i + 2];
        const qr = Math.round(r / 4) * 4;
        const qg = Math.round(g / 4) * 4;
        const qb = Math.round(b / 4) * 4;
        const key = `${qr},${qg},${qb}`;
        if (!colorCounts[key]) colorCounts[key] = { count: 0, r, g, b };
        colorCounts[key].count++;
    }
    let bestCount = 0;
    for (const c of Object.values(colorCounts)) {
        if (c.count > bestCount) {
            bestCount = c.count;
            bgColor = { r: c.r / 255, g: c.g / 255, b: c.b / 255 };
        }
    }
    return bgColor;
}

/**
 * Sample text color by finding the most common non-bright pixel in a strip.
 */
export function sampleTextColor(canvas, tx, originalWidth, fontSize, str) {
    let textColor = { r: 0, g: 0, b: 0 };
    if (str.trim().length === 0) return textColor;

    const ctx = canvas.getContext('2d');
    const textStripY = Math.round(tx[5] - fontSize * 0.5);
    const textStripX = Math.max(0, Math.round(tx[4]));
    const textStripW = Math.min(Math.round(originalWidth), canvas.width - textStripX);
    if (textStripW <= 0 || textStripY < 0 || textStripY >= canvas.height) return textColor;

    const textStripData = ctx.getImageData(textStripX, textStripY, textStripW, 1).data;
    const darkColorCounts = {};
    for (let i = 0; i < textStripData.length; i += 4) {
        const r = textStripData[i], g = textStripData[i + 1], b = textStripData[i + 2];
        const brightness = r * 0.299 + g * 0.587 + b * 0.114;
        const saturation = Math.max(r, g, b) - Math.min(r, g, b);
        if (brightness >= 200 && saturation < 50) continue;
        const qr = Math.round(r / 8) * 8;
        const qg = Math.round(g / 8) * 8;
        const qb = Math.round(b / 8) * 8;
        const key = `${qr},${qg},${qb}`;
        if (!darkColorCounts[key]) darkColorCounts[key] = { count: 0, r, g, b };
        darkColorCounts[key].count++;
    }
    let bestDarkCount = 0;
    for (const c of Object.values(darkColorCounts)) {
        if (c.count > bestDarkCount) {
            bestDarkCount = c.count;
            textColor = { r: c.r / 255, g: c.g / 255, b: c.b / 255 };
        }
    }
    return textColor;
}
