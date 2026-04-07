import { showToast, showPrompt } from './ui.js';

// ============================================
// Save modified PDF
// ============================================
export async function savePDF(pdfBytes, textItems, imageItems, originalFileName) {
    try {
        if (typeof PDFLib === 'undefined') {
            alert('PDF library is still loading. Please wait a moment and try again.');
            return;
        }

        const pdfLibDoc = await PDFLib.PDFDocument.load(pdfBytes);
        if (typeof fontkit !== 'undefined') pdfLibDoc.registerFontkit(fontkit);
        const pages = pdfLibDoc.getPages();

        const fonts = await embedStandardFonts(pdfLibDoc);
        const fontInfoCache = {};

        await processModifiedText(pdfLibDoc, pages, textItems, fonts, fontInfoCache);
        await processImportedImages(pdfLibDoc, pages, imageItems);
        processMovedImages(pdfLibDoc, pages, imageItems);

        const modifiedPdfBytes = await pdfLibDoc.save();
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
        helvetica: await doc.embedFont(S.Helvetica),
        helveticaBold: await doc.embedFont(S.HelveticaBold),
        helveticaOblique: await doc.embedFont(S.HelveticaOblique),
        helveticaBoldOblique: await doc.embedFont(S.HelveticaBoldOblique),
        timesRoman: await doc.embedFont(S.TimesRoman),
        timesRomanBold: await doc.embedFont(S.TimesRomanBold),
        timesRomanItalic: await doc.embedFont(S.TimesRomanItalic),
        timesRomanBoldItalic: await doc.embedFont(S.TimesRomanBoldItalic),
        courier: await doc.embedFont(S.Courier),
        courierBold: await doc.embedFont(S.CourierBold),
        courierOblique: await doc.embedFont(S.CourierOblique),
        courierBoldOblique: await doc.embedFont(S.CourierBoldOblique),
    };
}

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
async function processModifiedText(pdfLibDoc, pages, textItems, fonts, fontInfoCache) {
    const pageTexts = {};
    for (const item of textItems) {
        const isMoved = item.moveOffsetX !== 0 || item.moveOffsetY !== 0;
        const hasOverrides = item.fontWeightOverride || item.fontStyleOverride ||
                             item.fontSizeOverride || item.textColorOverride;
        if (item.deleted || item.currentText !== item.originalText || isMoved || hasOverrides) {
            if (!pageTexts[item.pageNum]) pageTexts[item.pageNum] = [];
            pageTexts[item.pageNum].push(item);
        }
    }

    for (const [pageNum, items] of Object.entries(pageTexts)) {
        const page = pages[parseInt(pageNum) - 1];

        for (const item of items) {
            const origX = item.transform[4];
            const origY = item.transform[5];
            const origFontSize = Math.sqrt(item.transform[0] ** 2 + item.transform[1] ** 2);
            const fontSize = item.fontSizeOverride ? item.fontSizeOverride / item.scale : origFontSize;
            const moveX = (item.moveOffsetX || 0) / item.scale;
            const moveY = -(item.moveOffsetY || 0) / item.scale;
            const newX = origX + moveX;
            const newY = origY + moveY;

            const cleanText = item.currentText.replace(/[\r\n]/g, ' ');
            const fallbackFont = getFallbackFont(item, fonts);
            const newTextWidth = fallbackFont.widthOfTextAtSize(cleanText, fontSize);
            const coverWidth = Math.max(item.width, newTextWidth) + 6;
            const bg = item.bgColor || { r: 1, g: 1, b: 1 };

            // Cover original position
            page.drawRectangle({
                x: origX - 2,
                y: origY - (origFontSize * 0.3),
                width: coverWidth,
                height: origFontSize * 1.4,
                color: PDFLib.rgb(bg.r, bg.g, bg.b),
            });

            if (item.deleted) continue;

            // Try to use original font via CMap encoding
            const hasStyleOverride = item.fontWeightOverride || item.fontStyleOverride;
            const fontInfo = hasStyleOverride ? null : await getFontInfo(pdfLibDoc, page, item.fontName, fontInfoCache);
            const tc = item.textColorOverride || item.textColor || { r: 0, g: 0, b: 0 };

            if (fontInfo && tryDrawWithOriginalFont(pdfLibDoc, page, fontInfo, cleanText, fontSize, newX, newY, tc)) {
                continue;
            }

            // Fallback: draw with standard font
            page.drawText(cleanText, {
                x: newX, y: newY,
                size: fontSize,
                font: fallbackFont,
                color: PDFLib.rgb(tc.r, tc.g, tc.b),
            });
        }
    }
}

function tryDrawWithOriginalFont(pdfLibDoc, page, fontInfo, text, fontSize, x, y, tc) {
    const hexChars = [];
    for (const ch of text) {
        const glyph = fontInfo.unicodeToGlyph[ch.codePointAt(0)];
        if (!glyph) return false;
        hexChars.push(glyph);
    }
    if (hexChars.length === 0) return false;

    const hexString = hexChars.join('');
    const content = `q\nBT\n${tc.r} ${tc.g} ${tc.b} rg\n/${fontInfo.pdfFontName} ${fontSize} Tf\n${x} ${y} Td\n<${hexString}> Tj\nET\nQ\n`;
    addContentStream(pdfLibDoc, page, content);
    return true;
}

// ============================================
// Process imported images
// ============================================
async function processImportedImages(pdfLibDoc, pages, imageItems) {
    const imported = imageItems.filter(img => img.type === 'imported-image' && !img.deleted);
    for (const img of imported) {
        const page = pages[img.pageNum - 1];
        const pageHeight = page.getHeight();

        const embeddedImage = img.importedImageType === 'image/png'
            ? await pdfLibDoc.embedPng(img.importedImageBytes)
            : await pdfLibDoc.embedJpg(img.importedImageBytes);

        const finalLeft = img.cssLeft + img.moveOffsetX;
        const finalTop = img.cssTop + img.moveOffsetY;
        const finalW = img.resizedWidth || img.cssWidth;
        const finalH = img.resizedHeight || img.cssHeight;

        page.drawImage(embeddedImage, {
            x: finalLeft / img.scale,
            y: pageHeight - (finalTop + finalH) / img.scale,
            width: finalW / img.scale,
            height: finalH / img.scale,
        });
    }
}

// ============================================
// Process moved/resized/deleted existing images
// ============================================
function processMovedImages(pdfLibDoc, pages, imageItems) {
    const moved = imageItems.filter(img =>
        img.type !== 'imported-image' &&
        (img.deleted || img.moveOffsetX !== 0 || img.moveOffsetY !== 0 || img.resizedWidth || img.resizedHeight)
    );

    const byPage = {};
    for (const img of moved) {
        if (!byPage[img.pageNum]) byPage[img.pageNum] = [];
        byPage[img.pageNum].push(img);
    }

    for (const [pageNum, items] of Object.entries(byPage)) {
        const page = pages[parseInt(pageNum) - 1];

        for (const img of items) {
            const bg = img.bgColor || { r: 1, g: 1, b: 1 };
            const pageHeight = page.getHeight();
            const origX = img.cssLeft / img.scale;
            const origY = pageHeight - (img.cssTop + img.cssHeight) / img.scale;
            const pdfW = img.cssWidth / img.scale;
            const pdfH = img.cssHeight / img.scale;

            // Cover original position
            page.drawRectangle({
                x: origX, y: origY, width: pdfW, height: pdfH,
                color: PDFLib.rgb(bg.r, bg.g, bg.b),
            });

            if (img.deleted) continue;

            // Redraw at new position
            const newPdfW = img.resizedWidth ? img.resizedWidth / img.scale : pdfW;
            const newPdfH = img.resizedHeight ? img.resizedHeight / img.scale : pdfH;
            const newX = origX + img.moveOffsetX / img.scale;
            const newY = origY - img.moveOffsetY / img.scale;

            const imgRefName = findImageXObjectName(page, pdfLibDoc, img.imageSeqIndex);
            if (imgRefName) {
                addContentStream(pdfLibDoc, page,
                    `q\n${newPdfW} 0 0 ${newPdfH} ${newX} ${newY} cm\n/${imgRefName} Do\nQ\n`);
            }
        }
    }
}

// ============================================
// PDF utilities
// ============================================
function addContentStream(pdfLibDoc, page, content) {
    const bytes = new TextEncoder().encode(content);
    const stream = pdfLibDoc.context.stream(bytes);
    const ref = pdfLibDoc.context.register(stream);
    page.node.addContentStream(ref);
}

function findImageXObjectName(page, pdfLibDoc, seqIndex) {
    try {
        const resources = page.node.Resources();
        if (!resources) return null;
        const xObjRef = resources.get(PDFLib.PDFName.of('XObject'));
        if (!xObjRef) return null;
        const xObjDict = xObjRef instanceof PDFLib.PDFDict
            ? xObjRef : pdfLibDoc.context.lookup(xObjRef);
        if (!xObjDict) return null;

        const imageNames = [];
        for (const [name, ref] of xObjDict.entries()) {
            const nameStr = name.decodeText ? name.decodeText() : name.toString().replace('/', '');
            const obj = pdfLibDoc.context.lookup(ref);
            if (obj) {
                const subtypeRef = obj.dict
                    ? obj.dict.get(PDFLib.PDFName.of('Subtype'))
                    : (obj.get ? obj.get(PDFLib.PDFName.of('Subtype')) : null);
                if (subtypeRef && subtypeRef.toString() === '/Image') {
                    imageNames.push(nameStr);
                }
            }
        }
        return imageNames[seqIndex] || null;
    } catch (e) {
        return null;
    }
}

// ============================================
// CMap font info parsing
// ============================================
async function getFontInfo(pdfLibDoc, pageObj, pdjsFontName, cache) {
    if (cache[pdjsFontName] !== undefined) return cache[pdjsFontName];

    try {
        const resources = pageObj.node.Resources();
        if (!resources) throw new Error('no resources');
        const fontDictObj = resources.get(PDFLib.PDFName.of('Font'));
        if (!fontDictObj) throw new Error('no font dict');
        const fontDict = fontDictObj instanceof PDFLib.PDFDict
            ? fontDictObj : pdfLibDoc.context.lookup(fontDictObj);
        if (!fontDict) throw new Error('cannot resolve font dict');

        const fontNames = [];
        fontDict.entries().forEach(([key]) => {
            fontNames.push(key.decodeText ? key.decodeText() : key.toString().replace('/', ''));
        });

        const indexMatch = pdjsFontName.match(/f(\d+)$/);
        if (!indexMatch) throw new Error('cannot parse font index');
        const fontIndex = parseInt(indexMatch[1]) - 1;
        if (fontIndex >= fontNames.length) throw new Error('font index out of range');

        const pdfFontName = fontNames[fontIndex];
        const fontRef = fontDict.get(PDFLib.PDFName.of(pdfFontName));
        const fontObj = fontRef instanceof PDFLib.PDFDict
            ? fontRef : pdfLibDoc.context.lookup(fontRef);
        if (!fontObj) throw new Error('cannot resolve font');

        const toUnicodeRef = fontObj.get(PDFLib.PDFName.of('ToUnicode'));
        if (!toUnicodeRef) throw new Error('no ToUnicode CMap');

        const toUnicodeStream = pdfLibDoc.context.lookup(toUnicodeRef) || toUnicodeRef;
        if (!toUnicodeStream) throw new Error('cannot resolve ToUnicode');

        let cmapBytes = toUnicodeStream.decodeContents?.() ||
                        toUnicodeStream.getUnencodedContents?.() ||
                        toUnicodeStream.getContents?.() ||
                        toUnicodeStream.contents;
        if (!cmapBytes) throw new Error('empty CMap');

        if (cmapBytes[0] === 0x78) {
            cmapBytes = await decompressZlib(cmapBytes);
        }

        const unicodeToGlyph = parseCMap(new TextDecoder('latin1').decode(cmapBytes));
        const result = { pdfFontName, unicodeToGlyph };
        cache[pdjsFontName] = result;
        return result;
    } catch (e) {
        cache[pdjsFontName] = null;
        return null;
    }
}

function parseCMap(cmapText) {
    const unicodeToGlyph = {};

    const bfcharRegex = /beginbfchar\s*([\s\S]*?)endbfchar/g;
    let match;
    while ((match = bfcharRegex.exec(cmapText)) !== null) {
        const lineRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
        let lineMatch;
        while ((lineMatch = lineRegex.exec(match[1])) !== null) {
            unicodeToGlyph[parseInt(lineMatch[2], 16)] = lineMatch[1].toUpperCase();
        }
    }

    const bfrangeRegex = /beginbfrange\s*([\s\S]*?)endbfrange/g;
    while ((match = bfrangeRegex.exec(cmapText)) !== null) {
        const lineRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
        let lineMatch;
        while ((lineMatch = lineRegex.exec(match[1])) !== null) {
            const startGlyph = parseInt(lineMatch[1], 16);
            const endGlyph = parseInt(lineMatch[2], 16);
            const startUnicode = parseInt(lineMatch[3], 16);
            const codeLen = lineMatch[1].length;
            for (let g = startGlyph; g <= endGlyph; g++) {
                unicodeToGlyph[startUnicode + (g - startGlyph)] =
                    g.toString(16).padStart(codeLen, '0').toUpperCase();
            }
        }
    }

    return unicodeToGlyph;
}

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
    const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
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
