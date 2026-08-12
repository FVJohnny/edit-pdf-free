/**
 * Shared type definitions for the PDF editor.
 * These are JSDoc-only — no runtime code. Import types with:
 *   @typedef {import('./types.js').TextItem} TextItem
 *
 * COORDINATE SYSTEMS
 * ==================
 * This editor works with three coordinate systems:
 *
 * 1. PDF coordinates (used by pdf-lib for saving)
 *    - Origin: bottom-left of page
 *    - Units: PDF points (1/72 inch)
 *    - Y increases upward
 *    - Stored in: item.transform[4] (x), item.transform[5] (y)
 *
 * 2. Canvas/CSS coordinates (used for on-screen rendering)
 *    - Origin: top-left of the page canvas
 *    - Units: CSS pixels (scaled from PDF coords by viewport.scale)
 *    - Y increases downward
 *    - Stored in: item.cssLeft, item.cssTop
 *    - Converting: cssX = pdfX * scale, cssY = (pageHeight - pdfY) * scale
 *
 * 3. Screen/viewport coordinates (mouse events)
 *    - Origin: top-left of browser viewport
 *    - Units: CSS pixels
 *    - Used in: e.clientX, e.clientY, getBoundingClientRect()
 *    - item.moveOffsetX/Y are accumulated deltas in screen pixels
 *
 * The `scale` factor (viewport.scale = canvasWidth / pdfPageWidth) converts
 * between PDF and canvas coordinates. It's stored on each item so saver.js
 * can convert back: pdfX = cssX / scale.
 */

/**
 * Normalized RGB color (each channel 0.0–1.0).
 * Used throughout for bgColor, textColor, and overrides.
 * Convert to CSS with rgbToCss(), to 0-255 with Math.round(c * 255).
 *
 * @typedef {Object} RGBColor
 * @property {number} r - Red channel (0.0–1.0)
 * @property {number} g - Green channel (0.0–1.0)
 * @property {number} b - Blue channel (0.0–1.0)
 */

/**
 * A text item extracted from the PDF, tracked through editing to saving.
 *
 * @typedef {Object} TextItem
 * @property {HTMLSpanElement} element - The DOM span element for this text
 * @property {number} pageNum - 1-based page number
 * @property {string} originalText - Text content as extracted from the PDF
 * @property {string} currentText - Current text (updated after editing)
 * @property {number} index - Index within the page's text items
 * @property {number[]} transform - PDF transform matrix [a, b, c, d, tx, ty]
 *   where [4]=x position, [5]=y position in PDF coordinates
 * @property {number} width - Original text width in PDF points
 * @property {number} height - Original text height in PDF points
 * @property {string} fontName - PDF.js internal font name (e.g. "g_d0_f1")
 * @property {string} fontFamily - Detected CSS font family
 * @property {string} fontWeight - Detected weight ('400', '700', etc.)
 * @property {string} fontStyle - Detected style ('normal' or 'italic')
 * @property {number} scale - viewport.scale: multiplier from PDF to canvas coords
 * @property {number} originalWidth - Text width in canvas pixels (width * scale)
 * @property {RGBColor} bgColor - Sampled background color behind this text
 * @property {RGBColor} textColor - Sampled text color
 * @property {number} moveOffsetX - Accumulated drag offset in screen pixels
 * @property {number} moveOffsetY - Accumulated drag offset in screen pixels
 * @property {boolean} originalCovered - Whether the original position has been covered on canvas
 * @property {number} cssLeft - Left position in canvas pixels
 * @property {number} cssTop - Top position in canvas pixels
 * @property {HTMLCanvasElement} canvas - Canvas of the page the item is currently on (changes on cross-page drag)
 * @property {HTMLCanvasElement} originCanvas - Canvas of the page the item came from (covers are drawn here)
 * @property {number} renderedFontSize - Font size in canvas pixels
 *
 * Optional properties (set by user interactions):
 * @property {string} [fontWeightOverride] - User-changed font weight
 * @property {string} [fontStyleOverride] - User-changed font style
 * @property {number} [fontSizeOverride] - User-changed font size in canvas pixels
 * @property {RGBColor} [textColorOverride] - User-changed text color
 * @property {boolean} [deleted] - Whether the user deleted this text
 */

/**
 * An image item extracted from the PDF or imported by the user.
 *
 * @typedef {Object} ImageItem
 * @property {HTMLDivElement} element - The DOM overlay element
 * @property {number} pageNum - 1-based page number
 * @property {'image'|'imported-image'} type - Source: PDF-extracted or user-imported
 * @property {number} scale - viewport.scale for coordinate conversion
 * @property {number} cssLeft - Left position in canvas pixels
 * @property {number} cssTop - Top position in canvas pixels
 * @property {number} cssWidth - Width in canvas pixels
 * @property {number} cssHeight - Height in canvas pixels
 * @property {RGBColor} bgColor - Background color behind this image
 * @property {number} moveOffsetX - Accumulated drag offset in screen pixels
 * @property {number} moveOffsetY - Accumulated drag offset in screen pixels
 * @property {boolean} originalCovered - Whether the original position has been covered
 * @property {HTMLCanvasElement} canvas - Canvas of the page the item is currently on (changes on cross-page drag)
 * @property {HTMLCanvasElement} originCanvas - Canvas of the page the item came from (covers are drawn here)
 *
 * PDF-extracted images only:
 * @property {string} [imageName] - PDF.js XObject name
 * @property {number} [imageSeqIndex] - Sequential index among images on the page
 *
 * Imported images only:
 * @property {Uint8Array} [importedImageBytes] - Raw file bytes for PDF embedding
 * @property {string} [importedImageType] - MIME type ('image/png' or 'image/jpeg')
 * @property {string} [importedImageDataURL] - Data URL for display
 *
 * Set by resize interactions:
 * @property {number} [resizedWidth] - New width after resize (canvas pixels)
 * @property {number} [resizedHeight] - New height after resize (canvas pixels)
 *
 * @property {boolean} [deleted] - Whether the user deleted this image
 */

export {};
