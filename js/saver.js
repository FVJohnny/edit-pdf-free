import { showToast, showPrompt } from './ui.js';

// ============================================
// Decompress zlib data using browser DecompressionStream
// ============================================
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
// Find XObject image name by sequential index
// ============================================
function findImageXObjectName(page, pdfLibDoc, seqIndex) {
    try {
        const resources = page.node.Resources();
        if (!resources) return null;
        const xObjRef = resources.get(PDFLib.PDFName.of('XObject'));
        if (!xObjRef) return null;
        const xObjDict = xObjRef instanceof PDFLib.PDFDict
            ? xObjRef : pdfLibDoc.context.lookup(xObjRef);
        if (!xObjDict) return null;

        // Collect image XObject names in dict order (filtering out forms/other)
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
// Save modified PDF
// ============================================
export async function savePDF(pdfBytes, textItems, imageItems, originalFileName) {
    try {
        if (typeof PDFLib === 'undefined') {
            alert('PDF library is still loading. Please wait a moment and try again.');
            return;
        }

        const pdfLibDoc = await PDFLib.PDFDocument.load(pdfBytes);
        if (typeof fontkit !== 'undefined') {
            pdfLibDoc.registerFontkit(fontkit);
        }
        const pages = pdfLibDoc.getPages();

        const pageTexts = {};
        textItems.forEach(item => {
            if (!pageTexts[item.pageNum]) {
                pageTexts[item.pageNum] = [];
            }
            const isMoved = item.moveOffsetX !== 0 || item.moveOffsetY !== 0;
            const hasOverrides = item.fontWeightOverride || item.fontStyleOverride ||
                                 item.fontSizeOverride || item.textColorOverride;
            if (item.deleted || item.currentText !== item.originalText || isMoved || hasOverrides) {
                pageTexts[item.pageNum].push(item);
            }
        });

        // Parse ToUnicode CMap and get font resource info
        const fontInfoCache = {};

        async function getFontInfo(pageObj, pdjsFontName) {
            if (fontInfoCache[pdjsFontName] !== undefined) return fontInfoCache[pdjsFontName];

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

                let cmapBytes;
                if (toUnicodeStream.decodeContents) {
                    cmapBytes = toUnicodeStream.decodeContents();
                } else if (toUnicodeStream.getUnencodedContents) {
                    cmapBytes = toUnicodeStream.getUnencodedContents();
                } else if (toUnicodeStream.getContents) {
                    cmapBytes = toUnicodeStream.getContents();
                } else {
                    cmapBytes = toUnicodeStream.contents;
                }

                if (!cmapBytes) throw new Error('empty CMap');

                if (cmapBytes[0] === 0x78) {
                    cmapBytes = await decompressZlib(cmapBytes);
                }

                const cmapText = new TextDecoder('latin1').decode(cmapBytes);

                const unicodeToGlyph = {};
                let match;

                const bfcharRegex = /beginbfchar\s*([\s\S]*?)endbfchar/g;
                while ((match = bfcharRegex.exec(cmapText)) !== null) {
                    const lineRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
                    let lineMatch;
                    while ((lineMatch = lineRegex.exec(match[1])) !== null) {
                        const glyphCode = lineMatch[1].toUpperCase();
                        const unicodeVal = parseInt(lineMatch[2], 16);
                        unicodeToGlyph[unicodeVal] = glyphCode;
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

                const result = { pdfFontName, unicodeToGlyph };
                fontInfoCache[pdjsFontName] = result;
                return result;
            } catch (e) {
                fontInfoCache[pdjsFontName] = null;
                return null;
            }
        }

        // Fallback standard fonts
        const fonts = {
            helvetica: await pdfLibDoc.embedFont(PDFLib.StandardFonts.Helvetica),
            helveticaBold: await pdfLibDoc.embedFont(PDFLib.StandardFonts.HelveticaBold),
            helveticaOblique: await pdfLibDoc.embedFont(PDFLib.StandardFonts.HelveticaOblique),
            helveticaBoldOblique: await pdfLibDoc.embedFont(PDFLib.StandardFonts.HelveticaBoldOblique),
            timesRoman: await pdfLibDoc.embedFont(PDFLib.StandardFonts.TimesRoman),
            timesRomanBold: await pdfLibDoc.embedFont(PDFLib.StandardFonts.TimesRomanBold),
            timesRomanItalic: await pdfLibDoc.embedFont(PDFLib.StandardFonts.TimesRomanItalic),
            timesRomanBoldItalic: await pdfLibDoc.embedFont(PDFLib.StandardFonts.TimesRomanBoldItalic),
            courier: await pdfLibDoc.embedFont(PDFLib.StandardFonts.Courier),
            courierBold: await pdfLibDoc.embedFont(PDFLib.StandardFonts.CourierBold),
            courierOblique: await pdfLibDoc.embedFont(PDFLib.StandardFonts.CourierOblique),
            courierBoldOblique: await pdfLibDoc.embedFont(PDFLib.StandardFonts.CourierBoldOblique),
        };

        function getFallbackFont(item) {
            const isBold = (item.fontWeightOverride ?? item.fontWeight) === '700';
            const isItalic = (item.fontStyleOverride ?? item.fontStyle) === 'italic';

            if (item.fontFamily && item.fontFamily.includes('Times')) {
                if (isBold && isItalic) return fonts.timesRomanBoldItalic;
                if (isBold) return fonts.timesRomanBold;
                if (isItalic) return fonts.timesRomanItalic;
                return fonts.timesRoman;
            } else if (item.fontFamily && item.fontFamily.includes('Courier')) {
                if (isBold && isItalic) return fonts.courierBoldOblique;
                if (isBold) return fonts.courierBold;
                if (isItalic) return fonts.courierOblique;
                return fonts.courier;
            } else {
                if (isBold && isItalic) return fonts.helveticaBoldOblique;
                if (isBold) return fonts.helveticaBold;
                if (isItalic) return fonts.helveticaOblique;
                return fonts.helvetica;
            }
        }

        for (const [pageNum, items] of Object.entries(pageTexts)) {
            const page = pages[parseInt(pageNum) - 1];

            for (const item of items) {
                const origX = item.transform[4];
                const origY = item.transform[5];
                const origFontSize = Math.sqrt(item.transform[0] * item.transform[0] + item.transform[1] * item.transform[1]);

                const fontSize = item.fontSizeOverride
                    ? item.fontSizeOverride / item.scale
                    : origFontSize;

                const moveX = (item.moveOffsetX || 0) / item.scale;
                const moveY = -(item.moveOffsetY || 0) / item.scale;

                const newX = origX + moveX;
                const newY = origY + moveY;

                const cleanCurrentText = item.currentText.replace(/[\r\n]/g, ' ');

                const fallbackFont = getFallbackFont(item);
                const originalPdfWidth = item.width;
                const newTextWidth = fallbackFont.widthOfTextAtSize(cleanCurrentText, fontSize);
                const coverWidth = Math.max(originalPdfWidth, newTextWidth) + 6;

                const bg = item.bgColor || { r: 1, g: 1, b: 1 };
                page.drawRectangle({
                    x: origX - 2,
                    y: origY - (origFontSize * 0.3),
                    width: coverWidth,
                    height: origFontSize * 1.4,
                    color: PDFLib.rgb(bg.r, bg.g, bg.b),
                });

                // Deleted items only need the cover rect, no new text
                if (item.deleted) continue;

                const hasStyleOverride = item.fontWeightOverride || item.fontStyleOverride;
                const fontInfo = hasStyleOverride ? null : await getFontInfo(page, item.fontName);
                let usedOriginalFont = false;

                if (fontInfo) {
                    const hexChars = [];
                    let allMapped = true;
                    for (const ch of cleanCurrentText) {
                        const code = ch.codePointAt(0);
                        const glyph = fontInfo.unicodeToGlyph[code];
                        if (glyph) {
                            hexChars.push(glyph);
                        } else {
                            allMapped = false;
                            break;
                        }
                    }

                    if (allMapped && hexChars.length > 0) {
                        const hexString = hexChars.join('');
                        const tc = item.textColorOverride || item.textColor || { r: 0, g: 0, b: 0 };
                        const streamContent =
                            `q\nBT\n${tc.r} ${tc.g} ${tc.b} rg\n/${fontInfo.pdfFontName} ${fontSize} Tf\n${newX} ${newY} Td\n<${hexString}> Tj\nET\nQ\n`;

                        const encoder = new TextEncoder();
                        const streamBytes = encoder.encode(streamContent);
                        const stream = pdfLibDoc.context.stream(streamBytes);
                        const streamRef = pdfLibDoc.context.register(stream);
                        page.node.addContentStream(streamRef);

                        usedOriginalFont = true;
                    }
                }

                if (!usedOriginalFont) {
                    const tc = item.textColorOverride || item.textColor || { r: 0, g: 0, b: 0 };
                    page.drawText(cleanCurrentText, {
                        x: newX,
                        y: newY,
                        size: fontSize,
                        font: fallbackFont,
                        color: PDFLib.rgb(tc.r, tc.g, tc.b),
                    });
                }
            }
        }

        // Handle imported images
        const importedImages = imageItems.filter(img => img.type === 'imported-image' && !img.deleted);
        for (const img of importedImages) {
            const page = pages[img.pageNum - 1];
            const pageHeight = page.getHeight();

            // Embed the image
            let embeddedImage;
            if (img.importedImageType === 'image/png') {
                embeddedImage = await pdfLibDoc.embedPng(img.importedImageBytes);
            } else {
                embeddedImage = await pdfLibDoc.embedJpg(img.importedImageBytes);
            }

            // Calculate final position (original + any drag offset)
            const finalCssLeft = img.cssLeft + img.moveOffsetX;
            const finalCssTop = img.cssTop + img.moveOffsetY;
            const finalW = img.resizedWidth || img.cssWidth;
            const finalH = img.resizedHeight || img.cssHeight;

            const pdfX = finalCssLeft / img.scale;
            const pdfY = pageHeight - (finalCssTop + finalH) / img.scale;
            const pdfW = finalW / img.scale;
            const pdfH = finalH / img.scale;

            page.drawImage(embeddedImage, {
                x: pdfX,
                y: pdfY,
                width: pdfW,
                height: pdfH,
            });
        }

        // Handle moved/resized/deleted images
        const movedImages = imageItems.filter(img =>
            img.type !== 'imported-image' &&
            (img.deleted || img.moveOffsetX !== 0 || img.moveOffsetY !== 0 || img.resizedWidth || img.resizedHeight)
        );
        const imagesByPage = {};
        movedImages.forEach(img => {
            if (!imagesByPage[img.pageNum]) imagesByPage[img.pageNum] = [];
            imagesByPage[img.pageNum].push(img);
        });

        for (const [pageNum, items] of Object.entries(imagesByPage)) {
            const page = pages[parseInt(pageNum) - 1];

            for (const img of items) {
                // Cover original position with background color rectangle
                const bg = img.bgColor || { r: 1, g: 1, b: 1 };
                const pageHeight = page.getHeight();

                // Convert CSS coordinates to PDF coordinates
                const origX = img.cssLeft / img.scale;
                const origY = pageHeight - (img.cssTop + img.cssHeight) / img.scale;
                const pdfW = img.cssWidth / img.scale;
                const pdfH = img.cssHeight / img.scale;

                page.drawRectangle({
                    x: origX,
                    y: origY,
                    width: pdfW,
                    height: pdfH,
                    color: PDFLib.rgb(bg.r, bg.g, bg.b),
                });

                // Redraw at new position (skip if deleted)
                if (!img.deleted) {
                    const moveX = img.moveOffsetX / img.scale;
                    const moveY = -img.moveOffsetY / img.scale;

                    const newPdfW = img.resizedWidth ? img.resizedWidth / img.scale : pdfW;
                    const newPdfH = img.resizedHeight ? img.resizedHeight / img.scale : pdfH;

                    const newX = origX + moveX;
                    const newY = origY + moveY;

                    const imgRefName = findImageXObjectName(page, pdfLibDoc, img.imageSeqIndex);

                    if (imgRefName) {
                        const streamContent =
                            `q\n${newPdfW} 0 0 ${newPdfH} ${newX} ${newY} cm\n/${imgRefName} Do\nQ\n`;
                        const encoder = new TextEncoder();
                        const streamBytes = encoder.encode(streamContent);
                        const stream = pdfLibDoc.context.stream(streamBytes);
                        const streamRef = pdfLibDoc.context.register(stream);
                        page.node.addContentStream(streamRef);
                    }
                }
            }
        }

        const modifiedPdfBytes = await pdfLibDoc.save();

        const defaultFilename = originalFileName || 'edited-document';
        const fileName = await showPrompt('Save as', 'Enter filename (without .pdf extension)', defaultFilename);

        if (fileName === null) return;

        const finalFilename = (fileName.trim() || defaultFilename) + '.pdf';

        const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = finalFilename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);

        showToast('Saved as ' + finalFilename);
    } catch (error) {
        console.error('Error saving PDF:', error);
        showToast('Error saving PDF. Please try again.');
    }
}
