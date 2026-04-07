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
export async function savePDF(pdfBytes, textItems, imageItems, originalFileName) {
    try {
        if (typeof PDFLib === 'undefined') {
            alert('PDF library is still loading. Please wait a moment and try again.');
            return;
        }

        const doc = await PDFLib.PDFDocument.load(pdfBytes);
        if (typeof fontkit !== 'undefined') doc.registerFontkit(fontkit);
        const pages = doc.getPages();

        const fonts = await embedStandardFonts(doc);
        const fontInfoCache = {};

        await processModifiedText(doc, pages, textItems, fonts, fontInfoCache);
        await processImportedImages(doc, pages, imageItems);
        processMovedImages(doc, pages, imageItems);

        const modifiedPdfBytes = await doc.save();
        await downloadPdf(modifiedPdfBytes, originalFileName);
    } catch (error) {
        console.error('Error saving PDF:', error);
        showToast('Error saving PDF. Please try again.');
    }
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
    // Group modified items by page
    const byPage = {};
    for (const item of textItems) {
        const isModified = item.deleted ||
            item.currentText !== item.originalText ||
            item.moveOffsetX !== 0 || item.moveOffsetY !== 0 ||
            item.fontWeightOverride || item.fontStyleOverride ||
            item.fontSizeOverride || item.textColorOverride;
        if (!isModified) continue;
        if (!byPage[item.pageNum]) byPage[item.pageNum] = [];
        byPage[item.pageNum].push(item);
    }

    for (const [pageNum, items] of Object.entries(byPage)) {
        const page = pages[parseInt(pageNum) - 1];

        for (const item of items) {
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
            const dragOffsetY = -(item.moveOffsetY || 0) / item.scale;
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
                page.drawRectangle({
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
        const page = pages[img.pageNum - 1];
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

    const byPage = {};
    for (const img of modified) {
        if (!byPage[img.pageNum]) byPage[img.pageNum] = [];
        byPage[img.pageNum].push(img);
    }

    for (const [pageNum, items] of Object.entries(byPage)) {
        const page = pages[parseInt(pageNum) - 1];

        for (const img of items) {
            const bgColor = img.bgColor || { r: 1, g: 1, b: 1 };
            const pageHeight = page.getHeight();

            // Convert original position from canvas pixels to PDF coordinates
            const pdfX = img.cssLeft / img.scale;
            const pdfY = pageHeight - (img.cssTop + img.cssHeight) / img.scale;
            const pdfWidth = img.cssWidth / img.scale;
            const pdfHeight = img.cssHeight / img.scale;

            // Cover original position (with small padding to catch sub-pixel edges)
            const pad = 2 / img.scale;
            page.drawRectangle({
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

            // Convert to PDF coordinates (Y flipped, using the NEW height)
            const newX = finalCssLeft / img.scale;
            const newY = pageHeight - (finalCssTop + (img.resizedHeight || img.cssHeight)) / img.scale;

            const xObjectName = findImageXObjectName(page, doc, img.imageSeqIndex);
            if (xObjectName) {
                addContentStream(doc, page,
                    `q\n${newPdfWidth} 0 0 ${newPdfHeight} ${newX} ${newY} cm\n/${xObjectName} Do\nQ\n`);
            }
        }
    }
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
 * Find the PDF XObject name for an image by its sequential index on the page.
 * The sequential index matches the order images appear in the PDF operator list
 * (the same order PDF.js processes them during rendering).
 */
function findImageXObjectName(page, doc, seqIndex) {
    try {
        const resources = page.node.Resources();
        if (!resources) return null;
        const xObjectRef = resources.get(PDFLib.PDFName.of('XObject'));
        if (!xObjectRef) return null;
        const xObjectDict = xObjectRef instanceof PDFLib.PDFDict
            ? xObjectRef : doc.context.lookup(xObjectRef);
        if (!xObjectDict) return null;

        const imageNames = [];
        for (const [name, ref] of xObjectDict.entries()) {
            const nameStr = name.decodeText ? name.decodeText() : name.toString().replace('/', '');
            const obj = doc.context.lookup(ref);
            if (!obj) continue;
            const subtype = obj.dict
                ? obj.dict.get(PDFLib.PDFName.of('Subtype'))
                : obj.get?.(PDFLib.PDFName.of('Subtype'));
            if (subtype?.toString() === '/Image') {
                imageNames.push(nameStr);
            }
        }
        return imageNames[seqIndex] || null;
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
