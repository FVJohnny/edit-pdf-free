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
} from './utils/constants.js';

// ============================================
// Save modified PDF
// ============================================
export async function savePDF(pdfBytes, textItems, imageItems, extraPages, drawnStrokes, originalFileName) {
    try {
        if (typeof PDFLib === 'undefined') {
            alert('PDF library is still loading. Please wait a moment and try again.');
            return;
        }
        const modifiedPdfBytes = await buildPdfBytes(pdfBytes, textItems, imageItems, extraPages, drawnStrokes);
        await downloadPdf(modifiedPdfBytes, originalFileName);
    } catch (error) {
        console.error('Error saving PDF:', error);
        showToast('Error saving PDF. Please try again.');
    }
}

/**
 * Build the modified PDF and return its bytes without downloading.
 * Also used by the toolbar size indicator to show the exact output size.
 *
 * extraPages: ordered [{ kind: 'blank'|'merged', domIndex, entry }] where domIndex
 * is the page's position among the viewer's page containers (0-based).
 */
export async function buildPdfBytes(pdfBytes, textItems, imageItems, extraPages, drawnStrokes) {
    const doc = await PDFLib.PDFDocument.load(pdfBytes);
    if (typeof fontkit !== 'undefined') doc.registerFontkit(fontkit);

    // Insert added pages (blank or merged) at their on-screen positions.
    // Original pages are already in the doc in order; inserting extras at their
    // final index in ascending order keeps every page at its viewer position.
    const sourceCache = {};
    const extras = (extraPages || []).slice().sort((a, b) => a.domIndex - b.domIndex);
    for (const extra of extras) {
        const idx = Math.min(extra.domIndex, doc.getPageCount());
        if (extra.kind === 'blank') {
            doc.insertPage(idx, [extra.entry.pdfWidth, extra.entry.pdfHeight]);
        } else if (extra.kind === 'merged') {
            const { sourceId, sourceBytes, sourcePageIndex } = extra.entry;
            let cached = sourceCache[sourceId];
            if (!cached) {
                cached = await PDFLib.PDFDocument.load(sourceBytes);
                sourceCache[sourceId] = cached;
            }
            const [copied] = await doc.copyPages(cached, [sourcePageIndex]);
            doc.insertPage(idx, copied);
        }
    }

    // Items use finalPageIndex / originPageIndex (0-based, set by the caller from
    // the DOM container order, which matches the page order built above).
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
    const family = item.fontFamily || '';

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
            item.fontSizeOverride || item.textColorOverride;
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
            const originPage = (item.originPageIndex != null && pages[item.originPageIndex]) || page;
            // Item coordinates are anchored to the origin page's coordinate
            // system. When the target page height differs, shift Y so the
            // css-pixel position maps correctly onto the target page.
            const pageHeightDiff = page.getHeight() - originPage.getHeight();
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
            const newX = pdfX + dragOffsetX;
            const newY = pdfY + dragOffsetY;

            const fallbackFont = getFallbackFont(item, fonts);
            const bgColor = item.bgColor || { r: 1, g: 1, b: 1 };

            // Cover original text position(s) with background-colored rectangle(s).
            // Merged items have subItems — cover each sub-item's original position.
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

            if (item.deleted) continue;

            const textColor = item.textColorOverride || item.textColor || { r: 0, g: 0, b: 0 };
            const hasStyleOverride = item.fontWeightOverride || item.fontStyleOverride;

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
                    const linePdfX = lineSub.transform[4] + dragOffsetX;
                    const linePdfY = subLine.baselineY + dragOffsetY;
                    const lineFontSize = item.fontSizeOverride
                        ? item.fontSizeOverride / item.scale
                        : Math.sqrt(lineSub.transform[0] ** 2 + lineSub.transform[1] ** 2);

                    if (!hasStyleOverride) {
                        const fontInfo = await getFontInfo(doc, page, lineSub.fontName, fontInfoCache);
                        if (fontInfo && tryDrawWithOriginalFont(doc, page, fontInfo, lineText, lineFontSize, linePdfX, linePdfY, textColor)) {
                            continue;
                        }
                    }

                    page.drawText(lineText, {
                        x: linePdfX, y: linePdfY,
                        size: lineFontSize,
                        font: fallbackFont,
                        color: PDFLib.rgb(textColor.r, textColor.g, textColor.b),
                    });
                }
                continue;
            }

            // Single-line item
            const cleanText = item.currentText.replace(/[\r\n]/g, ' ');

            // Try original font first (only if no style overrides)
            if (!hasStyleOverride) {
                const fontInfo = await getFontInfo(doc, page, item.fontName, fontInfoCache);
                if (fontInfo && tryDrawWithOriginalFont(doc, page, fontInfo, cleanText, fontSize, newX, newY, textColor)) {
                    continue;
                }
            }

            page.drawText(cleanText, {
                x: newX, y: newY,
                size: fontSize,
                font: fallbackFont,
                color: PDFLib.rgb(textColor.r, textColor.g, textColor.b),
            });
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
    for (const img of imported) {
        const pageIdx = img.finalPageIndex;
        const page = pageIdx != null && pageIdx >= 0 ? pages[pageIdx] : null;
        if (!page) continue;
        const pageHeight = page.getHeight();

        const embeddedImage = img.importedImageType === 'image/png'
            ? await doc.embedPng(img.importedImageBytes)
            : await doc.embedJpg(img.importedImageBytes);

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
        const originPage = (img.originPageIndex != null && pages[img.originPageIndex]) || page;

        const bgColor = img.bgColor || { r: 1, g: 1, b: 1 };
        const originPageHeight = originPage.getHeight();
        const pageHeight = page.getHeight();

        // Convert original position from canvas pixels to PDF coordinates
        const pdfX = img.cssLeft / img.scale;
        const pdfY = originPageHeight - (img.cssTop + img.cssHeight) / img.scale;
        const pdfWidth = img.cssWidth / img.scale;
        const pdfHeight = img.cssHeight / img.scale;

        // Cover original position (with small padding to catch sub-pixel edges)
        const pad = 2 / img.scale;
        originPage.drawRectangle({
            x: pdfX - pad, y: pdfY - pad,
            width: pdfWidth + pad * 2, height: pdfHeight + pad * 2,
            color: PDFLib.rgb(bgColor.r, bgColor.g, bgColor.b),
        });

        if (img.deleted) continue;

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

        // canvas pixels per PDF point — same factor used elsewhere.
        const scale = canvas.width / pageWidth;

        // Build the SVG path in canvas-pixel coords (top-down). pdf-lib's
        // drawSvgPath flips Y for us, so we anchor at (0, pageHeight) and
        // pass scale=1/scale to convert canvas pixels → PDF points.
        const d = buildSavePathFromPoints(stroke.points);
        const { r, g, b } = hexToRgb(stroke.color);
        page.drawSvgPath(d, {
            x: 0,
            y: pageHeight,
            scale: 1 / scale,
            borderColor: PDFLib.rgb(r, g, b),
            borderWidth: stroke.size,
            borderOpacity: stroke.opacity ?? 1,
            borderLineCap: PDFLib.LineCapStyle?.Round,
        });
    }
}

function buildSavePathFromPoints(points) {
    if (points.length === 1) {
        const p = points[0];
        return `M ${p.x} ${p.y} L ${p.x + 0.01} ${p.y + 0.01}`;
    }
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        d += ` Q ${a.x} ${a.y} ${(a.x + b.x) / 2} ${(a.y + b.y) / 2}`;
    }
    const last = points[points.length - 1];
    d += ` L ${last.x} ${last.y}`;
    return d;
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
async function getFontInfo(doc, page, pdjsFontName, cache) {
    if (cache[pdjsFontName] !== undefined) return cache[pdjsFontName];

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
        cache[pdjsFontName] = result;
        return result;
    } catch (_) {
        cache[pdjsFontName] = null;
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
async function downloadPdf(pdfBytes, originalFileName) {
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
