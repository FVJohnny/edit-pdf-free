// ============================================
// Shared constants
// ============================================

/** Minimum mouse movement (px) before a click becomes a drag */
export const DRAG_THRESHOLD = 3;

/** Minimum dimension (px) an image can be resized to */
export const MIN_RESIZE_PX = 20;

/** Maximum imported image size as fraction of page dimension */
export const MAX_IMPORT_SCALE = 0.5;

/** Padding (px) added to cover rectangles beyond the text width */
export const COVER_PADDING = 8;

/** Viewport edge margin (px) for toolbar positioning */
export const TOOLBAR_MARGIN = 8;

/**
 * Text cover rectangle geometry, relative to font size.
 * When covering original text on the canvas, we draw a rect from
 * (cssTop - fontSize * TOP_OFFSET) with height (fontSize * HEIGHT_SCALE).
 */
export const TEXT_COVER_TOP_OFFSET = 0.4;
export const TEXT_COVER_HEIGHT_SCALE = 1.5;

/**
 * PDF save cover rectangle geometry, relative to original font size.
 * The cover rect in PDF coordinates extends from
 * (origY - fontSize * BOTTOM_EXTEND) with height (fontSize * HEIGHT_SCALE).
 */
export const PDF_COVER_BOTTOM_EXTEND = 0.3;
export const PDF_COVER_HEIGHT_SCALE = 1.4;
export const PDF_COVER_X_OFFSET = 2;
export const PDF_COVER_WIDTH_PADDING = 6;

/** Minimum font size (pt) allowed in the format toolbar */
export const MIN_FONT_SIZE = 6;

/**
 * Approximate baseline position within a CSS line box at line-height: 1,
 * as a fraction of font-size from the top. Most Latin fonts (Helvetica,
 * Arial, Times, Calibri) put the baseline at ~0.78 em. Used to align the
 * editable text overlay's rendered baseline with the original PDF baseline.
 */
export const FONT_BASELINE_RATIO = 0.78;

/**
 * Color quantization bucket size.
 * Background sampling uses 4 (coarser grouping for large bg areas).
 * Text sampling uses 8 (finer grouping to distinguish colored text).
 */
export const BG_COLOR_BUCKET = 4;
export const TEXT_COLOR_BUCKET = 8;

/** ITU-R BT.601 luminance weights for perceived brightness */
export const LUMINANCE_R = 0.299;
export const LUMINANCE_G = 0.587;
export const LUMINANCE_B = 0.114;

/** Minimum brightness (0-255) to count as "background" when sampling */
export const BG_BRIGHTNESS_THRESHOLD = 80;

/**
 * Text color sampling: skip pixels that are bright AND unsaturated.
 * These are likely background, not text.
 */
export const TEXT_BRIGHTNESS_THRESHOLD = 200;
export const TEXT_SATURATION_THRESHOLD = 50;

/** Minimum image dimension (px) to consider it a real image vs artifact */
export const MIN_IMAGE_SIZE = 10;

/** Pixels above an image to sample for background color */
export const IMAGE_BG_SAMPLE_OFFSET = 2;

/** zlib compression magic byte (first byte of deflate stream) */
export const ZLIB_HEADER = 0x78;
