/**
 * PDF Saver — modifies the original PDF with user edits and downloads the result.
 *
 * Coordinate conversion: all item positions are stored in canvas pixels (see types.js).
 * To convert back to PDF coordinates for saving:
 *   pdfX = canvasX / scale
 *   pdfY = pageHeight - canvasY / scale  (PDF Y is bottom-up, canvas Y is top-down)
 *
 * Text saving strategy:
 *   1. Cover the original text position with a background-colored rectangle
 *   2. If the text hasn't changed style, try to redraw using the original PDF font
 *      (via CMap glyph encoding) — this preserves font fidelity
 *   3. If that fails (or style was changed), fall back to a standard PDF font
 *      (Helvetica, Times, Courier family)
 */
import { showToast, showPrompt } from './ui.js';
import {
    PDF_COVER_BOTTOM_EXTEND, PDF_COVER_HEIGHT_SCALE,
    PDF_COVER_X_OFFSET, PDF_COVER_WIDTH_PADDING, ZLIB_HEADER,
    FONT_BASELINE_RATIO,
} from './utils/constants.js';
import { layoutWidth, layoutHeight } from './utils/canvas.js';
import { buildShapePath } from './draw.js';

// ============================================
// Save modified PDF
// ============================================
export async function savePDF(pdfBytes, textItems, imageItems, pageOrder, drawnStrokes, originalFileName) {
    try {
        if (typeof PDFLib === 'undefined') {
            alert('PDF library is still loading. Please wait a moment and try again.');
            return;
        }
        const modifiedPdfBytes = await buildPdfBytes(pdfBytes, textItems, imageItems, pageOrder, drawnStrokes);
        await downloadPdf(modifiedPdfBytes, originalFileName);
    } catch (error) {
        console.error('Error saving PDF:', error);
        // Surface the actual reason — "please try again" hides bugs users
        // could otherwise report precisely.
        showToast('Error saving PDF: ' + (error?.message || error));
    }
}

/**
 * Build the modified PDF and return its bytes without downloading.
 * Also used by the toolbar size indicator to show the exact output size.
 *
 * The output document is assembled from scratch by copying pages in on-screen
 * order — pageOrder is one entry per viewer page container:
 *   { kind: 'original', sourcePageIndex }        — page of the loaded PDF
 *   { kind: 'blank',    entry: {pdfWidth, pdfHeight} }
 *   { kind: 'merged',   entry: {sourceId, sourceBytes, sourcePageIndex} }
 * This is what makes page reordering and deletion work: whatever the DOM says,
 * the saved document matches, and item page indices are DOM indices.
 */
export async function buildPdfBytes(pdfBytes, textItems, imageItems, pageOrder, drawnStrokes) {
    // ignoreEncryption: permission-restricted PDFs (owner password only) parse
    // fine; fully encrypted ones will fail later with the generic save error.
    const srcDoc = await PDFLib.PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const doc = await PDFLib.PDFDocument.create();
    if (typeof fontkit !== 'undefined') doc.registerFontkit(fontkit);

    const order = pageOrder || [];

    // Copy needed original pages in one call (shares copied resources)
    const originalIdxs = order.filter(p => p.kind === 'original').map(p => p.sourcePageIndex);
    const copiedOriginals = await doc.copyPages(srcDoc, originalIdxs);

    // Copy merged pages per source document, one call each
    const mergedBySource = new Map();
    for (const p of order) {
        if (p.kind !== 'merged') continue;
        if (!mergedBySource.has(p.entry.sourceId)) mergedBySource.set(p.entry.sourceId, []);
        mergedBySource.get(p.entry.sourceId).push(p);
    }
    const copiedMerged = new Map(); // entry → copied page
    for (const [, group] of mergedBySource) {
        const mergedSrc = await PDFLib.PDFDocument.load(group[0].entry.sourceBytes, { ignoreEncryption: true });
        const copied = await doc.copyPages(mergedSrc, group.map(p => p.entry.sourcePageIndex));
        group.forEach((p, i) => copiedMerged.set(p, copied[i]));
    }

    // Assemble in on-screen order
    let originalCursor = 0;
    for (const p of order) {
        if (p.kind === 'original') {
            doc.addPage(copiedOriginals[originalCursor++]);
        } else if (p.kind === 'blank') {
            doc.addPage([p.entry.pdfWidth, p.entry.pdfHeight]);
        } else if (p.kind === 'merged') {
            doc.addPage(copiedMerged.get(p));
        }
    }

    // Items use finalPageIndex / originPageIndex (0-based DOM container indices,
    // set by the caller — they match the page order assembled above).
    const pages = doc.getPages();

    const fonts = await embedStandardFonts(doc);
    const fontInfoCache = {};

    await processModifiedText(doc, pages, textItems, fonts, fontInfoCache);
    await processImportedImages(doc, pages, imageItems);
    processMovedImages(doc, pages, imageItems);
    processDrawnStrokes(doc, pages, drawnStrokes || []);

    return doc.save();
}

// ============================================
// Embed standard fonts
// ============================================
async function embedStandardFonts(doc) {
    const S = PDFLib.StandardFonts;
    return {
        helvetica:            await doc.embedFont(S.Helvetica),
        helveticaBold:        await doc.embedFont(S.HelveticaBold),
        helveticaOblique:     await doc.embedFont(S.HelveticaOblique),
        helveticaBoldOblique: await doc.embedFont(S.HelveticaBoldOblique),
        timesRoman:           await doc.embedFont(S.TimesRoman),
        timesRomanBold:       await doc.embedFont(S.TimesRomanBold),
        timesRomanItalic:     await doc.embedFont(S.TimesRomanItalic),
        timesRomanBoldItalic: await doc.embedFont(S.TimesRomanBoldItalic),
        courier:              await doc.embedFont(S.Courier),
        courierBold:          await doc.embedFont(S.CourierBold),
        courierOblique:       await doc.embedFont(S.CourierOblique),
        courierBoldOblique:   await doc.embedFont(S.CourierBoldOblique),
    };
}

/** Pick the correct standard font variant based on family + weight/style overrides. */
function getFallbackFont(item, fonts) {
    const isBold = (item.fontWeightOverride ?? item.fontWeight) === '700';
    const isItalic = (item.fontStyleOverride ?? item.fontStyle) === 'italic';
    const family = item.fontFamilyOverride || item.fontFamily || '';

    if (family.includes('Times')) {
        if (isBold && isItalic) return fonts.timesRomanBoldItalic;
        if (isBold) return fonts.timesRomanBold;
        if (isItalic) return fonts.timesRomanItalic;
        return fonts.timesRoman;
    }
    if (family.includes('Courier')) {
        if (isBold && isItalic) return fonts.courierBoldOblique;
        if (isBold) return fonts.courierBold;
        if (isItalic) return fonts.courierOblique;
        return fonts.courier;
    }
    if (isBold && isItalic) return fonts.helveticaBoldOblique;
    if (isBold) return fonts.helveticaBold;
    if (isItalic) return fonts.helveticaOblique;
    return fonts.helvetica;
}

// ============================================
// Process modified text items
// ============================================
async function processModifiedText(doc, pages, textItems, fonts, fontInfoCache) {
    // Group modified items by final page index (in the saved doc, 0-based).
    const byPage = {};
    for (const item of textItems) {
        const isModified = item.deleted ||
            item.currentText !== item.originalText ||
            item.moveOffsetX !== 0 || item.moveOffsetY !== 0 ||
            item.fontWeightOverride || item.fontStyleOverride ||
            item.fontSizeOverride || item.textColorOverride ||
            item.fontFamilyOverride || item.alignOverride ||
            item.textOpacityOverride != null;
        if (!isModified) continue;
        const pageIdx = item.finalPageIndex;
        if (pageIdx == null || pageIdx < 0) continue;
        if (!byPage[pageIdx]) byPage[pageIdx] = [];
        byPage[pageIdx].push(item);
    }

    for (const [pageIdx, items] of Object.entries(byPage)) {
        const page = pages[parseInt(pageIdx)];
        if (!page) continue;

        for (const item of items) {
            // The page the text originally lived on (covers go there); for
            // cross-page moves the redraw happens on `page` (the target).
            // A deleted origin page (originPage null) means: no covers needed,
            // and the original font resources are gone → fallback font.
            const originPage = item.originPageIndex != null && item.originPageIndex >= 0
                ? pages[item.originPageIndex] || null
                : null;
            // Item coordinates are anchored to the origin page's coordinate
            // system. When the target page height differs, shift Y so the
            // css-pixel position maps correctly onto the target page.
            const originHeightPts = originPage
                ? originPage.getHeight()
                : (item.originCanvas ? layoutHeight(item.originCanvas) / item.scale : page.getHeight());
            const pageHeightDiff = page.getHeight() - originHeightPts;
            // Original position and size in PDF coordinates
            const pdfX = item.transform[4];
            const pdfY = item.transform[5];
            const pdfFontSize = Math.sqrt(item.transform[0] ** 2 + item.transform[1] ** 2);

            // Apply font size override (stored in canvas pixels, convert to PDF points)
            const fontSize = item.fontSizeOverride
                ? item.fontSizeOverride / item.scale
                : pdfFontSize;

            // Convert drag offset from screen pixels to PDF points
            // Note: Y is negated because PDF Y goes up, screen Y goes down
            const dragOffsetX = (item.moveOffsetX || 0) / item.scale;
            const dragOffsetY = -(item.moveOffsetY || 0) / item.scale + pageHeightDiff;
            // On screen the span TOP stays fixed when the font size changes, so
            // the visual baseline moves down as text grows — mirror that here.
            const baselineShift = (fontSize - pdfFontSize) * FONT_BASELINE_RATIO;
            const newX = pdfX + dragOffsetX;
            const newY = pdfY + dragOffsetY - baselineShift;

            const fallbackFont = getFallbackFont(item, fonts);
            const bgColor = item.bgColor || { r: 1, g: 1, b: 1 };

            // Cover original text position(s) with background-colored rectangle(s).
            // Merged items have subItems — cover each sub-item's original position.
            if (originPage) {
                const itemsToCover = item.subItems || [item];
                for (const sub of itemsToCover) {
                    const subPdfX = sub.transform[4];
                    const subPdfY = sub.transform[5];
                    const subFontSize = Math.sqrt(sub.transform[0] ** 2 + sub.transform[1] ** 2);
                    const subWidth = sub.width + PDF_COVER_WIDTH_PADDING;
                    const subBg = sub.bgColor || bgColor;
                    originPage.drawRectangle({
                        x: subPdfX - PDF_COVER_X_OFFSET,
                        y: subPdfY - (subFontSize * PDF_COVER_BOTTOM_EXTEND),
                        width: subWidth,
                        height: subFontSize * PDF_COVER_HEIGHT_SCALE,
                        color: PDFLib.rgb(subBg.r, subBg.g, subBg.b),
                    });
                }
            }

            if (item.deleted) continue;

            const textColor = item.textColorOverride || item.textColor || { r: 0, g: 0, b: 0 };
            const textOpacity = item.textOpacityOverride ?? 1;
            // Family/alignment changes also force the fallback font: the original
            // font can't be re-measured (alignment) or swapped (family).
            // Opacity does too — the original-font path writes a raw content
            // stream with no ExtGState, so it can't render transparency.
            const hasStyleOverride = item.fontWeightOverride || item.fontStyleOverride ||
                item.fontFamilyOverride || item.alignOverride || textOpacity < 1;

            // Original-font info is parsed from the ORIGIN page's resources;
            // when drawing on a different page the font ref must be registered
            // in the target page's resources under a usable name.
            const getDrawableFontInfo = async (fontName) => {
                if (!originPage) return null; // origin page deleted → fallback font
                const fontInfo = await getFontInfo(doc, originPage, item.originPageIndex ?? '', fontName, fontInfoCache);
                if (!fontInfo || page === originPage) return fontInfo;
                const drawName = ensureFontOnPage(doc, originPage, page, fontInfo.pdfFontName);
                return drawName ? { ...fontInfo, pdfFontName: drawName } : null;
            };

            // For merged multi-line items, draw each line at its original Y position.
            // Group sub-items by baseline Y to identify distinct lines.
            if (item.subItems && item.currentText.includes('\n')) {
                const lines = item.currentText.split('\n');

                // Group sub-items into lines by baseline Y proximity
                const subLines = [];
                for (const sub of item.subItems) {
                    const subY = sub.transform[5];
                    const existing = subLines.find(g =>
                        Math.abs(g.baselineY - subY) < 2
                    );
                    if (existing) {
                        existing.subs.push(sub);
                    } else {
                        subLines.push({ baselineY: subY, subs: [sub] });
                    }
                }
                // Sort by Y descending (PDF Y goes up, so first line has highest Y)
                subLines.sort((a, b) => b.baselineY - a.baselineY);

                for (let li = 0; li < lines.length; li++) {
                    const lineText = lines[li].replace(/[\r]/g, '');
                    if (!lineText) continue;

                    // Use the corresponding sub-line's position, or fall back to first
                    const subLine = subLines[li] || subLines[subLines.length - 1];
                    const lineSub = subLine.subs[0];
                    const origLineFontSize = Math.sqrt(lineSub.transform[0] ** 2 + lineSub.transform[1] ** 2);
                    const lineFontSize = item.fontSizeOverride
                        ? item.fontSizeOverride / item.scale
                        : origLineFontSize;
                    const linePdfX = lineSub.transform[4] + dragOffsetX;
                    // Same top-anchored baseline correction as single items
                    const linePdfY = subLine.baselineY + dragOffsetY
                        - (lineFontSize - origLineFontSize) * FONT_BASELINE_RATIO;

                    if (!hasStyleOverride) {
                        const fontInfo = await getDrawableFontInfo(lineSub.fontName);
                        if (fontInfo && tryDrawWithOriginalFont(doc, page, fontInfo, lineText, lineFontSize, linePdfX, linePdfY, textColor)) {
                            continue;
                        }
                    }

                    page.drawText(lineText, {
                        x: linePdfX, y: linePdfY,
                        size: lineFontSize,
                        font: fallbackFont,
                        color: PDFLib.rgb(textColor.r, textColor.g, textColor.b),
                        opacity: textOpacity,
                    });
                }
                continue;
            }

            // Single item — may contain user-inserted line breaks (Shift+Enter).
            // The on-screen span uses line-height:1, so each line advances by
            // exactly one font size.
            const lines = item.currentText.replace(/\r/g, '').split('\n');

            // Center/right alignment: offset each line within the block width
            // (the widest of the original text box and the new lines).
            const align = item.alignOverride || 'left';
            let lineWidths = null;
            let blockWidth = 0;
            if (align !== 'left') {
                lineWidths = lines.map(l => l ? fallbackFont.widthOfTextAtSize(l, fontSize) : 0);
                blockWidth = Math.max(item.width || 0, ...lineWidths);
            }

            for (let li = 0; li < lines.length; li++) {
                const lineText = lines[li];
                if (!lineText) continue;
                const lineY = newY - li * fontSize;
                let lineX = newX;
                if (align === 'center') lineX = newX + (blockWidth - lineWidths[li]) / 2;
                else if (align === 'right') lineX = newX + (blockWidth - lineWidths[li]);

                // Try original font first (only if no style overrides)
                if (!hasStyleOverride) {
                    const fontInfo = await getDrawableFontInfo(item.fontName);
                    if (fontInfo && tryDrawWithOriginalFont(doc, page, fontInfo, lineText, fontSize, lineX, lineY, textColor)) {
                        continue;
                    }
                }

                page.drawText(lineText, {
                    x: lineX, y: lineY,
                    size: fontSize,
                    font: fallbackFont,
                    color: PDFLib.rgb(textColor.r, textColor.g, textColor.b),
                    opacity: textOpacity,
                });
            }
        }
    }
}

/**
 * Try to draw text using the original PDF font by encoding characters as hex glyph IDs.
 * Returns true if successful, false if any character can't be mapped.
 *
 * The PDF content stream format is:
 *   q BT                    — save state, begin text
 *   r g b rg                — set fill color
 *   /FontName size Tf       — set font
 *   x y Td                  — move to position
 *   <hex> Tj                — draw text using hex-encoded glyph IDs
 *   ET Q                    — end text, restore state
 */
function tryDrawWithOriginalFont(doc, page, fontInfo, text, fontSize, x, y, color) {
    const hexChars = [];
    for (const ch of text) {
        const glyphHex = fontInfo.unicodeToGlyph[ch.codePointAt(0)];
        if (!glyphHex) return false;
        hexChars.push(glyphHex);
    }
    if (hexChars.length === 0) return false;

    const hexString = hexChars.join('');
    const content = `q\nBT\n${color.r} ${color.g} ${color.b} rg\n` +
        `/${fontInfo.pdfFontName} ${fontSize} Tf\n` +
        `${x} ${y} Td\n<${hexString}> Tj\nET\nQ\n`;
    addContentStream(doc, page, content);
    return true;
}

// ============================================
// Process imported images
// ============================================
async function processImportedImages(doc, pages, imageItems) {
    const imported = imageItems.filter(img => img.type === 'imported-image' && !img.deleted);
    // The same image imported several times embeds once and is drawn many times
    const embedCache = new Map();
    for (const img of imported) {
        const pageIdx = img.finalPageIndex;
        const page = pageIdx != null && pageIdx >= 0 ? pages[pageIdx] : null;
        if (!page) continue;
        const pageHeight = page.getHeight();

        const cacheKey = await imageBytesKey(img.importedImageBytes);
        let embeddedImage = embedCache.get(cacheKey);
        if (!embeddedImage) {
            embeddedImage = img.importedImageType === 'image/png'
                ? await doc.embedPng(img.importedImageBytes)
                : await doc.embedJpg(img.importedImageBytes);
            embedCache.set(cacheKey, embeddedImage);
        }

        // Final position = original placement + any drag offset
        const finalCssLeft = img.cssLeft + img.moveOffsetX;
        const finalCssTop = img.cssTop + img.moveOffsetY;
        const finalWidth = img.resizedWidth || img.cssWidth;
        const finalHeight = img.resizedHeight || img.cssHeight;

        page.drawImage(embeddedImage, {
            x: finalCssLeft / img.scale,
            y: pageHeight - (finalCssTop + finalHeight) / img.scale,
            width: finalWidth / img.scale,
            height: finalHeight / img.scale,
        });
    }
}

/** Content hash for dedupe of identical imported images. */
async function imageBytesKey(bytes) {
    // crypto.subtle only exists in secure contexts (HTTPS/localhost) — over
    // plain HTTP (e.g. testing via LAN IP) fall back to a simple FNV-1a hash;
    // dedupe quality barely matters, but saving must never fail.
    if (crypto.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    }
    let h1 = 0x811c9dc5, h2 = 0xcbf29ce4;
    for (let i = 0; i < bytes.length; i++) {
        h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ bytes[i], 0x01000197) >>> 0;
    }
    return bytes.length + '-' + h1.toString(16) + h2.toString(16);
}

// ============================================
// Process moved/resized/deleted existing images
// ============================================
function processMovedImages(doc, pages, imageItems) {
    const modified = imageItems.filter(img =>
        img.type !== 'imported-image' &&
        (img.deleted || img.moveOffsetX !== 0 || img.moveOffsetY !== 0 || img.resizedWidth || img.resizedHeight)
    );

    for (const img of modified) {
        const pageIdx = img.finalPageIndex;
        const page = pageIdx != null && pageIdx >= 0 ? pages[pageIdx] : null;
        if (!page) continue;
        // Existing images always originate on an original PDF page; covers and
        // the XObject lookup use that page, the redraw goes on the target page.
        // If the origin page was deleted, there is nothing to cover — and the
        // image's data went with it, so a moved image can't be redrawn.
        const originPage = img.originPageIndex != null && img.originPageIndex >= 0
            ? pages[img.originPageIndex] || null
            : null;

        const bgColor = img.bgColor || { r: 1, g: 1, b: 1 };
        const pageHeight = page.getHeight();
        const pdfWidth = img.cssWidth / img.scale;
        const pdfHeight = img.cssHeight / img.scale;

        if (originPage) {
            // Convert original position from canvas pixels to PDF coordinates
            const pdfX = img.cssLeft / img.scale;
            const pdfY = originPage.getHeight() - (img.cssTop + img.cssHeight) / img.scale;

            // Cover original position (with small padding to catch sub-pixel edges)
            const pad = 2 / img.scale;
            originPage.drawRectangle({
                x: pdfX - pad, y: pdfY - pad,
                width: pdfWidth + pad * 2, height: pdfHeight + pad * 2,
                color: PDFLib.rgb(bgColor.r, bgColor.g, bgColor.b),
            });
        }

        if (img.deleted || !originPage) continue;

        // Redraw at new position/size using a PDF content stream.
        // We compute the final position from the current CSS state (original + all offsets)
        // rather than incrementally, to avoid compounding Y-flip errors with resize.
        const newPdfWidth = img.resizedWidth ? img.resizedWidth / img.scale : pdfWidth;
        const newPdfHeight = img.resizedHeight ? img.resizedHeight / img.scale : pdfHeight;

        // Final CSS position = original + accumulated move offset (includes resize shifts)
        const finalCssLeft = img.cssLeft + img.moveOffsetX;
        const finalCssTop = img.cssTop + img.moveOffsetY;

        // Convert to PDF coordinates (Y flipped, using the NEW height, on the target page)
        const newX = finalCssLeft / img.scale;
        const newY = pageHeight - (finalCssTop + (img.resizedHeight || img.cssHeight)) / img.scale;

        const xObject = findImageXObject(originPage, doc, img.imageSeqIndex);
        if (xObject) {
            // The XObject lives in the origin page's resources; when drawing on
            // a different page, register it there under a fresh name first.
            const drawName = page === originPage
                ? xObject.name
                : addImageXObjectToPage(doc, page, xObject.ref);
            if (drawName) {
                addContentStream(doc, page,
                    `q\n${newPdfWidth} 0 0 ${newPdfHeight} ${newX} ${newY} cm\n/${drawName} Do\nQ\n`);
            }
        }
    }
}

// ============================================
// Process drawn strokes (free-hand drawing)
// ============================================

/**
 * Convert each stroke's canvas-pixel points to PDF points and draw a vector
 * SVG path on the right page. PDF Y is bottom-up while canvas Y is top-down,
 * so we flip Y when constructing the path data.
 */
function processDrawnStrokes(doc, pages, strokes) {
    for (const stroke of strokes) {
        if (!stroke.points || stroke.points.length === 0) continue;

        const pageIdx = stroke.finalPageIndex;
        const page = pageIdx != null && pageIdx >= 0 ? pages[pageIdx] : null;
        if (!page) continue;

        const pageWidth = page.getWidth();
        const pageHeight = page.getHeight();
        const canvas = stroke.canvas;
        if (!canvas) continue;

        // layout pixels per PDF point — same factor used elsewhere.
        const scale = layoutWidth(canvas) / pageWidth;

        // Build the SVG path in layout-pixel coords (top-down). pdf-lib's
        // drawSvgPath flips Y for us, so we anchor at (0, pageHeight) and
        // pass scale=1/scale to convert layout pixels → PDF points.
        // buildShapePath is the same builder the screen uses (pen/rect/arrow).
        const d = buildShapePath(stroke.shape || 'pen', stroke.points, stroke.size);
        // One stroke with an unparseable color (e.g. stale state from an old
        // session) must not abort the whole save — fall back to black.
        const sane = (c) => c && Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b)
            ? c : { r: 0, g: 0, b: 0 };
        const { r, g, b } = sane(hexToRgb(stroke.color || '#000000'));
        const fill = stroke.fillColor ? sane(hexToRgb(stroke.fillColor)) : null;
        page.drawSvgPath(d, {
            x: 0,
            y: pageHeight,
            scale: 1 / scale,
            borderColor: PDFLib.rgb(r, g, b),
            borderWidth: stroke.size,
            borderOpacity: stroke.opacity ?? 1,
            borderLineCap: PDFLib.LineCapStyle?.Round,
            // Fill opacity composes with the whole-stroke opacity, matching
            // the on-screen SVG (opacity attr × fill-opacity attr).
            ...(fill ? {
                color: PDFLib.rgb(fill.r, fill.g, fill.b),
                opacity: (stroke.fillOpacity ?? 1) * (stroke.opacity ?? 1),
            } : {}),
        });
    }
}

function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const num = parseInt(clean.length === 3
        ? clean.split('').map(c => c + c).join('')
        : clean, 16);
    return {
        r: ((num >> 16) & 0xff) / 255,
        g: ((num >> 8) & 0xff) / 255,
        b: (num & 0xff) / 255,
    };
}

// ============================================
// PDF low-level utilities
// ============================================

/** Append a raw content stream to a page (for drawing with original fonts or images). */
function addContentStream(doc, page, content) {
    const bytes = new TextEncoder().encode(content);
    const stream = doc.context.stream(bytes);
    const ref = doc.context.register(stream);
    page.node.addContentStream(ref);
}

/**
 * Find the PDF XObject (name + ref) for an image by its sequential index on the page.
 * The sequential index matches the order images appear in the PDF operator list
 * (the same order PDF.js processes them during rendering).
 */
function findImageXObject(page, doc, seqIndex) {
    try {
        const resources = page.node.Resources();
        if (!resources) return null;
        const xObjectRef = resources.get(PDFLib.PDFName.of('XObject'));
        if (!xObjectRef) return null;
        const xObjectDict = xObjectRef instanceof PDFLib.PDFDict
            ? xObjectRef : doc.context.lookup(xObjectRef);
        if (!xObjectDict) return null;

        const images = [];
        for (const [name, ref] of xObjectDict.entries()) {
            const nameStr = name.decodeText ? name.decodeText() : name.toString().replace('/', '');
            const obj = doc.context.lookup(ref);
            if (!obj) continue;
            const subtype = obj.dict
                ? obj.dict.get(PDFLib.PDFName.of('Subtype'))
                : obj.get?.(PDFLib.PDFName.of('Subtype'));
            if (subtype?.toString() === '/Image') {
                images.push({ name: nameStr, ref });
            }
        }
        return images[seqIndex] || null;
    } catch (_) {
        return null;
    }
}

/**
 * Register an existing image XObject ref in another page's resources under a
 * fresh unique name so a content stream on that page can draw it.
 * Returns the name (without leading slash), or null on failure.
 */
function addImageXObjectToPage(doc, page, ref) {
    try {
        const { PDFName, PDFDict } = PDFLib;
        let resources = page.node.get(PDFName.of('Resources'));
        resources = resources instanceof PDFDict ? resources : (resources ? doc.context.lookup(resources) : null);
        if (!resources) {
            resources = doc.context.obj({});
            page.node.set(PDFName.of('Resources'), resources);
        }
        let xObjects = resources.get(PDFName.of('XObject'));
        xObjects = xObjects instanceof PDFDict ? xObjects : (xObjects ? doc.context.lookup(xObjects) : null);
        if (!xObjects) {
            xObjects = doc.context.obj({});
            resources.set(PDFName.of('XObject'), xObjects);
        }
        let n = 1, name;
        do { name = `EPFX${n++}`; } while (xObjects.has(PDFName.of(name)));
        xObjects.set(PDFName.of(name), ref);
        return name;
    } catch (_) {
        return null;
    }
}

// ============================================
// CMap font info — parse ToUnicode CMap for original font rendering
// ============================================

/**
 * Extract font info needed to re-draw text in its original PDF font.
 * Returns { pdfFontName, unicodeToGlyph } or null if the font can't be resolved.
 *
 * PDF.js uses internal names like "g_d0_f1" where the trailing number maps to
 * the font's position in the page's Font resource dictionary. We parse that index,
 * then read the font's ToUnicode CMap to build a unicode→glyph hex mapping.
 */
async function getFontInfo(doc, page, pageKey, pdjsFontName, cache) {
    // PDF.js's "f<N>" index is relative to each page's Font dictionary, so the
    // cache must be scoped per page.
    const cacheKey = `${pageKey}:${pdjsFontName}`;
    if (cache[cacheKey] !== undefined) return cache[cacheKey];

    try {
        const resources = page.node.Resources();
        if (!resources) throw new Error('no resources');
        const fontDictRef = resources.get(PDFLib.PDFName.of('Font'));
        if (!fontDictRef) throw new Error('no font dict');
        const fontDict = fontDictRef instanceof PDFLib.PDFDict
            ? fontDictRef : doc.context.lookup(fontDictRef);
        if (!fontDict) throw new Error('cannot resolve font dict');

        // Get ordered list of font names from the dictionary
        const fontNames = fontDict.entries().map(([key]) =>
            key.decodeText ? key.decodeText() : key.toString().replace('/', '')
        );

        // PDF.js names fonts like "g_d0_f1" — extract the 1-based index
        const indexMatch = pdjsFontName.match(/f(\d+)$/);
        if (!indexMatch) throw new Error('cannot parse font index');
        const fontIndex = parseInt(indexMatch[1]) - 1;
        if (fontIndex >= fontNames.length) throw new Error('font index out of range');

        const pdfFontName = fontNames[fontIndex];
        const fontRef = fontDict.get(PDFLib.PDFName.of(pdfFontName));
        const fontObj = fontRef instanceof PDFLib.PDFDict
            ? fontRef : doc.context.lookup(fontRef);
        if (!fontObj) throw new Error('cannot resolve font');

        // Get the ToUnicode CMap (maps glyph codes ↔ Unicode code points)
        const toUnicodeRef = fontObj.get(PDFLib.PDFName.of('ToUnicode'));
        if (!toUnicodeRef) throw new Error('no ToUnicode CMap');
        const toUnicodeStream = doc.context.lookup(toUnicodeRef) || toUnicodeRef;
        if (!toUnicodeStream) throw new Error('cannot resolve ToUnicode');

        let cmapBytes = toUnicodeStream.decodeContents?.() ||
                        toUnicodeStream.getUnencodedContents?.() ||
                        toUnicodeStream.getContents?.() ||
                        toUnicodeStream.contents;
        if (!cmapBytes) throw new Error('empty CMap');

        // Decompress if zlib-compressed (first byte 0x78 is the deflate header)
        if (cmapBytes[0] === ZLIB_HEADER) {
            cmapBytes = await decompressZlib(cmapBytes);
        }

        const unicodeToGlyph = parseCMap(new TextDecoder('latin1').decode(cmapBytes));
        const result = { pdfFontName, unicodeToGlyph };
        cache[cacheKey] = result;
        return result;
    } catch (_) {
        cache[cacheKey] = null;
        return null;
    }
}

/**
 * Register a font from the origin page's resources in another page's
 * resources under a fresh unique name so content on that page can use it.
 * Returns the name (without leading slash), or null on failure.
 */
function ensureFontOnPage(doc, originPage, targetPage, pdfFontName) {
    try {
        const { PDFName, PDFDict } = PDFLib;
        const originRes = originPage.node.Resources();
        if (!originRes) return null;
        let originFonts = originRes.get(PDFName.of('Font'));
        originFonts = originFonts instanceof PDFDict ? originFonts : doc.context.lookup(originFonts);
        if (!originFonts) return null;
        const fontRef = originFonts.get(PDFName.of(pdfFontName));
        if (!fontRef) return null;

        let resources = targetPage.node.get(PDFName.of('Resources'));
        resources = resources instanceof PDFDict ? resources : (resources ? doc.context.lookup(resources) : null);
        if (!resources) {
            resources = doc.context.obj({});
            targetPage.node.set(PDFName.of('Resources'), resources);
        }
        let fonts = resources.get(PDFName.of('Font'));
        fonts = fonts instanceof PDFDict ? fonts : (fonts ? doc.context.lookup(fonts) : null);
        if (!fonts) {
            fonts = doc.context.obj({});
            resources.set(PDFName.of('Font'), fonts);
        }
        // Reuse if this exact ref is already registered on the target page
        for (const [name, ref] of fonts.entries()) {
            if (ref === fontRef) return name.toString().slice(1);
        }
        let n = 1, name;
        do { name = `EPFF${n++}`; } while (fonts.has(PDFName.of(name)));
        fonts.set(PDFName.of(name), fontRef);
        return name;
    } catch (_) {
        return null;
    }
}

/**
 * Parse an Adobe CMap to build a unicode→glyph hex mapping.
 * CMaps contain two types of entries:
 *   - beginbfchar/endbfchar: individual <glyphHex> <unicodeHex> pairs
 *   - beginbfrange/endbfrange: <startGlyph> <endGlyph> <startUnicode> ranges
 */
function parseCMap(cmapText) {
    const unicodeToGlyph = {};

    // Parse individual char mappings: <glyphHex> <unicodeHex>
    const charBlockRegex = /beginbfchar\s*([\s\S]*?)endbfchar/g;
    let blockMatch;
    while ((blockMatch = charBlockRegex.exec(cmapText)) !== null) {
        const pairRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
        let pairMatch;
        while ((pairMatch = pairRegex.exec(blockMatch[1])) !== null) {
            const glyphHex = pairMatch[1].toUpperCase();
            const unicodeCodePoint = parseInt(pairMatch[2], 16);
            unicodeToGlyph[unicodeCodePoint] = glyphHex;
        }
    }

    // Parse range mappings: <startGlyph> <endGlyph> <startUnicode>
    const rangeBlockRegex = /beginbfrange\s*([\s\S]*?)endbfrange/g;
    while ((blockMatch = rangeBlockRegex.exec(cmapText)) !== null) {
        const rangeRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
        let rangeMatch;
        while ((rangeMatch = rangeRegex.exec(blockMatch[1])) !== null) {
            const startGlyph = parseInt(rangeMatch[1], 16);
            const endGlyph = parseInt(rangeMatch[2], 16);
            const startUnicode = parseInt(rangeMatch[3], 16);
            const hexDigits = rangeMatch[1].length;
            for (let glyph = startGlyph; glyph <= endGlyph; glyph++) {
                const unicodeCodePoint = startUnicode + (glyph - startGlyph);
                unicodeToGlyph[unicodeCodePoint] = glyph.toString(16).padStart(hexDigits, '0').toUpperCase();
            }
        }
    }

    return unicodeToGlyph;
}

/** Decompress zlib/deflate data using the browser's DecompressionStream API. */
async function decompressZlib(compressedBytes) {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    writer.write(compressedBytes);
    writer.close();
    const reader = ds.readable.getReader();
    const chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    const totalLen = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

// ============================================
// Download
// ============================================
export async function downloadPdf(pdfBytes, originalFileName) {
    const defaultFilename = originalFileName || 'edited-document';
    const fileName = await showPrompt('Save as', 'Enter filename (without .pdf extension)', defaultFilename);
    if (fileName === null) return;

    const finalFilename = (fileName.trim() || defaultFilename) + '.pdf';
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = finalFilename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    showToast('Saved as ' + finalFilename);
}
