/**
 * PDF Renderer — renders PDF pages to canvas and creates interactive overlays.
 *
 * Creates two layers per page:
 *   1. A <canvas> with the rendered PDF page pixels
 *   2. A "text layer" div containing absolutely-positioned elements:
 *      - <span> elements for each text item (invisible until hovered/edited)
 *      - <div> elements for each detected image (draggable overlays)
 *
 * Coordinates: all cssLeft/cssTop/cssWidth/cssHeight values are in canvas pixels
 * (PDF points * viewport.scale). See js/types.js for coordinate system docs.
 */
import {registerPage, resetPageRendering, rerenderVisiblePages} from './viewport-renderer.js';
export {setPagePreviewDocument} from './viewport-renderer.js';
import { showFormatToolbar, repositionToolbar } from './toolbar.js';
import { showImageToolbar, repositionImageToolbar, coverOriginalImage } from './image-toolbar.js';
import { makeEditable } from './editor.js';
import { sampleBgColor, sampleTextColor, sampleImageBgColor, rgbToCss } from './utils/color.js';
import { coverOriginalText, captureCanvasRegion, layoutWidth, layoutHeight } from './utils/canvas.js';
import { DRAG_THRESHOLD, MIN_RESIZE_PX, MIN_IMAGE_SIZE, FONT_BASELINE_RATIO } from './utils/constants.js';
import { recordAction } from './history.js';
import { toggleMultiSelect, isMultiSelected, getMultiSelection, multiSelectionSize } from './selection.js';

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * How to re-render each page container's canvas backing (for sharp zoom):
 * container → { kind: 'pdf'|'merged', doc, pageNum } or { kind: 'blank' }.
 */


/** Set a canvas's layout size (CSS px) and backing resolution in one go. */
function sizeCanvas(canvas, layoutW, layoutH, resolution = 1) {
    canvas.width = Math.round(layoutW * resolution);
    canvas.height = Math.round(layoutH * resolution);
    canvas.style.width = layoutW + 'px';
    canvas.style.height = layoutH + 'px';
}

// ============================================
// Render PDF pages
// ============================================
export async function renderPDF(pdfDoc, pdfViewer, textItems, imageItems) {
    await resetPageRendering();
    pdfViewer.innerHTML = '';
    textItems.length = 0;
    imageItems.length = 0;

    // Available content width = viewer clientWidth minus its horizontal padding,
    // and minus a small allowance for the page border (1px each side) so pages don't overflow.
    const viewerStyle = getComputedStyle(pdfViewer);
    const horizontalPadding = parseFloat(viewerStyle.paddingLeft) + parseFloat(viewerStyle.paddingRight);
    const availableWidth = pdfViewer.clientWidth - horizontalPadding - 2;

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        // Scale the page to fill the available width inside the viewer
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = availableWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.getContext('2d', { willReadFrequently: true });
        sizeCanvas(canvas, viewport.width, viewport.height, Math.min(1, Math.sqrt(16e6 / (pdfDoc.numPages * viewport.width * viewport.height)), 4096 / viewport.height));
        canvas.className = 'pdf-page';

        await page.render({ canvasContext: canvas.getContext('2d'), viewport: page.getViewport({scale: scale * canvas.width / viewport.width}) }).promise;

        const textContent = await page.getTextContent();
        const sourceEncodings = await readSourceEncodings(page);

        // Page container holds the canvas and the overlay text layer
        const pageContainer = document.createElement('div');
        pageContainer.style.position = 'relative';
        pageContainer.style.marginBottom = '20px';
        pageContainer.dataset.viewportTransform = JSON.stringify(viewport.transform);
        pageContainer.dataset.pdfWidth = String(unscaledViewport.width);
        pageContainer.dataset.pdfHeight = String(unscaledViewport.height);
        // 0-based index into the ORIGINAL document — survives page reordering
        pageContainer.dataset.originalPageIndex = String(pageNum - 1);
        pageContainer.appendChild(canvas);
        registerPage(pageContainer, { kind: 'pdf', doc: pdfDoc, pageNum });

        const textLayerDiv = createTextLayerDiv(viewport);

        const pageTextItems = [];
        textContent.items.forEach((item, index) => {
            pageTextItems.push(createTextItem(item, index, pageNum, viewport, canvas, textContent, page, sourceEncodings));
        });

        const mergedItems = mergeAdjacentTextItems(pageTextItems);
        for (const textItem of mergedItems) {
            textItems.push(textItem);
            setupTextDrag(textItem.element, textItem, canvas);
            textLayerDiv.appendChild(textItem.element);
        }

        await extractImages(page, viewport, canvas, textLayerDiv, imageItems, pageNum);

        pageContainer.appendChild(textLayerDiv);
        pdfViewer.appendChild(pageContainer);
    }
}

/**
 * Render a single page from a PDF.js document into a new page container,
 * matching the same width-fit logic used for original pages.
 * Returns the container (caller appends it to the viewer).
 */
export async function renderMergedPage(pdfJsDoc, pageNum, availableWidth) {
    const page = await pdfJsDoc.getPage(pageNum);
    const unscaledViewport = page.getViewport({ scale: 1 });
    const scale = availableWidth / unscaledViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    sizeCanvas(canvas, viewport.width, viewport.height, Math.min(1, Math.sqrt(2e6 / (viewport.width * viewport.height)), 4096 / viewport.height));
    canvas.className = 'pdf-page';
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: page.getViewport({scale: scale * canvas.width / viewport.width}) }).promise;

    const container = document.createElement('div');
    container.style.position = 'relative';
    container.style.marginBottom = '20px';
    container.dataset.mergedPage = 'true';
    container.dataset.viewportTransform=JSON.stringify(viewport.transform);
    container.dataset.pdfWidth = String(unscaledViewport.width);
    container.dataset.pdfHeight = String(unscaledViewport.height);
    container.appendChild(canvas);
    registerPage(container, { kind: 'merged', doc: pdfJsDoc, pageNum });

    const textLayer = document.createElement('div');
    textLayer.className = 'custom-text-layer';
    textLayer.style.position = 'absolute';
    textLayer.style.left = '0';
    textLayer.style.top = '0';
    textLayer.style.width = viewport.width + 'px';
    textLayer.style.height = viewport.height + 'px';
    textLayer.style.pointerEvents = 'none';
    container.appendChild(textLayer);

    return container;
}

/**
 * Create a blank page DOM container (white canvas) sized to match an existing page.
 * Used for blank pages added before/after the original PDF pages.
 * Also creates an empty text layer so add-text and import-image can target it.
 */
export function createBlankPageContainer(width, height) {
    const container = document.createElement('div');
    container.style.position = 'relative';
    container.style.marginBottom = '20px';
    container.dataset.blankPage = 'true';

    const canvas = document.createElement('canvas');
    sizeCanvas(canvas, width, height, Math.min(1,Math.sqrt(2e6/(width*height)),4096/height));
    canvas.className = 'pdf-page';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    container.appendChild(canvas);
    registerPage(container, { kind: 'blank' });

    const textLayer = document.createElement('div');
    textLayer.className = 'custom-text-layer';
    textLayer.style.position = 'absolute';
    textLayer.style.left = '0';
    textLayer.style.top = '0';
    textLayer.style.width = width + 'px';
    textLayer.style.height = height + 'px';
    textLayer.style.pointerEvents = 'none';
    container.appendChild(textLayer);

    return container;
}

// ============================================
// Zoom re-render — sharp pages at any zoom level
// ============================================

/** Retained public name; high-resolution work now covers visible regions only. */
export const rerenderAllPages = rerenderVisiblePages;

function createTextLayerDiv(viewport) {
    const div = document.createElement('div');
    div.className = 'custom-text-layer';
    div.style.position = 'absolute';
    div.style.left = '0';
    div.style.top = '0';
    div.style.width = viewport.width + 'px';
    div.style.height = viewport.height + 'px';
    div.style.pointerEvents = 'none';
    return div;
}

/**
 * Create a text item data object and its DOM span from a PDF text content item.
 * @returns {TextItem} see js/types.js
 */
async function readSourceEncodings(page) {
    const ops = await page.getOperatorList();
    const maps = {}, stack = [];
    let font;
    const O = pdfjsLib.OPS;
    for (let i=0; i<ops.fnArray.length; i++) {
        const op=ops.fnArray[i], args=ops.argsArray[i];
        if (op===O.save) stack.push(font);
        else if(op===O.restore) font=stack.pop();
        else if(op===O.setFont) font=args[0];
        else if((op===O.showText || op===O.showSpacedText || op===O.nextLineShowText || op===O.nextLineSetSpacingShowText) && font) {
            const glyphs=args.find(a=>Array.isArray(a)) || [];
            const map=maps[font] ||= {};
            for(const glyph of glyphs) {
                if(typeof glyph !== 'object' || !glyph?.unicode || !Number.isInteger(glyph.originalCharCode)) continue;
                map[glyph.unicode]=glyph.originalCharCode;
            }
        }
    }
    return maps;
}

function createTextItem(item, index, pageNum, viewport, canvas, textContent, page, sourceEncodings) {
    // Transform the item's PDF coordinates into canvas pixel coordinates
    const coords = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const canvasX = coords[4];
    const canvasY = coords[5];

    // Font size: extract from the transform matrix (magnitude of the [a, b] vector)
    const pdfFontSize = Math.sqrt(item.transform[0] ** 2 + item.transform[1] ** 2);
    const renderedFontSize = pdfFontSize * viewport.scale;
    const renderedWidth = item.width * viewport.scale;

    const { fontFamily, fontWeight, fontStyle, sourceFontName, loadedFontName, nativePreview } = detectFont(item, textContent, page);
    const bgColor = sampleBgColor(canvas, canvasX, canvasY, renderedWidth);
    const textColor = sampleTextColor(canvas, coords, renderedWidth, renderedFontSize, item.str);

    // Align the rendered baseline with the PDF baseline. CSS positions the
    // top of the line box, but the glyph baseline sits ~0.78 em below the top.
    const cssTop = canvasY - renderedFontSize * FONT_BASELINE_RATIO;

    const span = document.createElement('span');
    span.textContent = item.str;
    span.className = 'editable-text';
    span.style.position = 'absolute';
    span.style.left = canvasX + 'px';
    span.style.top = cssTop + 'px';
    span.style.fontSize = renderedFontSize + 'px';
    span.style.lineHeight = '1';
    span.style.fontFamily = loadedFontName ? `'${loadedFontName}', ${fontFamily}` : fontFamily;
    span.style.fontWeight = fontWeight;
    if (fontStyle === 'italic') span.style.fontStyle = 'italic';
    span.style.transformOrigin = `0 ${renderedFontSize * FONT_BASELINE_RATIO}px`;
    span.style.transform = `matrix(${coords[0]/renderedFontSize},${coords[1]/renderedFontSize},${-coords[2]/renderedFontSize},${-coords[3]/renderedFontSize},0,0)`;
    span.style.fontSynthesis = 'none';
    span.style.pointerEvents = 'auto';
    // Tight letter-spacing and subpixel rendering to match PDF appearance
    span.style.letterSpacing = '0';
    span.style.textRendering = 'geometricPrecision';
    span.style.webkitFontSmoothing = 'antialiased';
    span.style.mozOsxFontSmoothing = 'grayscale';
    span.style.setProperty('--bg-color', rgbToCss(bgColor));
    span.style.setProperty('--text-color', rgbToCss(textColor));

    return {
        element: span,
        pageNum,
        originalText: item.str,
        currentText: item.str,
        index,
        transform: item.transform,
        viewportTransform: [...viewport.transform],
        width: item.width,
        height: item.height,
        fontName: item.fontName,
        sourceGlyphs: sourceEncodings[item.fontName],
        fontFamily, fontWeight, fontStyle, sourceFontName, loadedFontName, nativePreview,
        scale: viewport.scale,
        originalWidth: renderedWidth,
        bgColor, textColor,
        moveOffsetX: 0,
        moveOffsetY: 0,
        originalCovered: false,
        cssLeft: canvasX,
        cssTop,
        canvas,
        originCanvas: canvas,
        renderedFontSize,
    };
}

/**
 * Merge adjacent text items into logical groups:
 *   Pass 1: Merge items on the same line (horizontal — same baseline, adjacent)
 *   Pass 2: Merge consecutive lines into paragraphs (vertical — similar left edge,
 *           similar font size, vertical gap ≈ line height)
 */
/**
 * Whether two sampled text colors are close enough to be considered the same.
 * Sampling picks up anti-aliased glyph edges, so the threshold needs to tolerate
 * shade variance while still distinguishing genuinely different colors
 * (e.g. black vs blue, black vs red).
 */
function sameTextColor(a, b) {
    const ca = a.textColor, cb = b.textColor;
    if (!ca || !cb) return true;
    return Math.abs(ca.r - cb.r) < 0.04 &&
           Math.abs(ca.g - cb.g) < 0.04 &&
           Math.abs(ca.b - cb.b) < 0.04;
}

function sameTextStyle(a, b) {
    return a.fontName === b.fontName && Math.abs(a.renderedFontSize-b.renderedFontSize) < 0.1 &&
        Math.abs(Math.atan2(a.transform[1],a.transform[0])-Math.atan2(b.transform[1],b.transform[0])) < 0.001;
}

function mergeAdjacentTextItems(items) {
    if (items.length <= 1) return items;

    // Sort by Y position (top), then X position (left)
    const sorted = items.filter(item=>item.originalText.length).sort((a, b) => {
        const yDiff = a.cssTop - b.cssTop;
        if (Math.abs(yDiff) > 5) return yDiff;
        return a.cssLeft - b.cssLeft;
    });

    if(!sorted.length)return [];
    // Pass 1: Merge items on the same line
    const lines = [];
    let current = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
        const next = sorted[i];

        const baselineA = current.cssTop + current.renderedFontSize;
        const baselineB = next.cssTop + next.renderedFontSize;
        const baselineTolerance = Math.max(current.renderedFontSize, next.renderedFontSize) * 0.3;
        const sameBaseline = Math.abs(baselineA - baselineB) < baselineTolerance;

        const currentRight = current.cssLeft + current.originalWidth;
        const gap = next.cssLeft - currentRight;
        const maxGap = Math.max(current.renderedFontSize, next.renderedFontSize) * 0.5;
        const adjacent = gap >= -2 && gap < maxGap;

        if (sameBaseline && adjacent && sameTextStyle(current, next) && (sameTextColor(current,next)||!next.originalText.trim()||!current.originalText.trim())) {
            current = mergeInline(current, next);
        } else {
            lines.push(current);
            current = next;
        }
    }
    lines.push(current);

    // Pass 2: Merge consecutive lines into paragraphs.
    // Use baseline-to-baseline distance as the metric — this is the most reliable
    // way to detect line spacing vs paragraph breaks in PDFs.
    // Within a paragraph: baseline distance ≈ 1.1–1.3x font size (normal line spacing)
    // Paragraph break: baseline distance ≈ 1.6x+ font size (extra gap)
    const paragraphs = [];
    for (const nextLine of lines) {
        // Find the preceding line in this column, even when another column
        // occurs between them in the PDF's drawing order.
        let candidate=-1,nearest=Infinity;
        for(let i=0;i<paragraphs.length;i++){
            const prev=paragraphs[i],fontSize=prev.renderedFontSize;
            const distance=nextLine.cssTop+nextLine.renderedFontSize-(prev.lastBaselineY??prev.cssTop+fontSize);
            if(distance<=fontSize*.5||distance>=fontSize*1.5||distance>=nearest)continue;
            if(Math.abs(prev.cssLeft-nextLine.cssLeft)>=fontSize*.5||!sameTextStyle(prev,nextLine)||!sameTextColor(prev,nextLine))continue;
            if(!prev.originalText.trim()||!nextLine.originalText.trim())continue;
            if(prev.lineHeight&&Math.abs(distance-prev.lineHeight)>fontSize*.15)continue;
            // Do not join through a differently styled intervening line.
            if(lines.some(line=>line!==nextLine&&line.cssTop>prev.cssTop&&line.cssTop<nextLine.cssTop-fontSize*.5&&Math.abs(line.cssLeft-nextLine.cssLeft)<fontSize*.5&&line.cssTop>=(prev.lastBaselineY??prev.cssTop+fontSize)))continue;
            candidate=i;nearest=distance;
        }
        if(candidate<0)paragraphs.push(nextLine);
        else paragraphs[candidate]=mergeLines(paragraphs[candidate],nextLine);
    }

    return paragraphs;
}

/** Merge two horizontally adjacent items on the same line. */
function mergeInline(a, b) {
    const gap=b.cssLeft-(a.cssLeft+a.originalWidth);
    const separator=gap>a.renderedFontSize*.15&&!/\s$/.test(a.originalText)&&!/^\s/.test(b.originalText)?' ':'';
    const mergedText = a.originalText + separator + b.originalText;
    const mergedRight = Math.max(a.cssLeft + a.originalWidth, b.cssLeft + b.originalWidth);
    const mergedWidth = mergedRight - a.cssLeft;
    const fontSize = Math.max(a.renderedFontSize, b.renderedFontSize);
    const mergedTop = Math.min(a.cssTop, b.cssTop);

    a.element.textContent = mergedText;
    a.element.style.fontSize = fontSize + 'px';
    a.element.style.top = mergedTop + 'px';

    if (b.element.parentNode) b.element.parentNode.removeChild(b.element);

    const subItems = [...(a.subItems || [a]), ...(b.subItems || [b])];

    return {
        ...a,
        originalText: mergedText,
        currentText: mergedText,
        width: mergedWidth / a.scale,
        originalWidth: mergedWidth,
        renderedFontSize: fontSize,
        cssTop: mergedTop,
        subItems,
    };
}

/** Merge two lines into a multi-line paragraph. */
function mergeLines(a, b) {
    const mergedText = a.originalText + '\n' + b.originalText;
    const mergedLeft = Math.min(a.cssLeft, b.cssLeft);
    const mergedRight = Math.max(a.cssLeft + a.originalWidth, b.cssLeft + b.originalWidth);
    const mergedWidth = mergedRight - mergedLeft;
    const mergedTop = Math.min(a.cssTop, b.cssTop);
    const mergedBottom = Math.max(
        b.cssTop + (b.mergedHeight || b.renderedFontSize),
        a.cssTop + (a.mergedHeight || a.renderedFontSize)
    );
    const mergedHeight = mergedBottom - mergedTop;
    const fontSize = Math.max(a.renderedFontSize, b.renderedFontSize);

    // For multi-line, use white-space: pre-wrap so \n renders as line breaks
    a.element.textContent = mergedText;
    a.element.style.fontSize = fontSize + 'px';
    a.element.style.left = mergedLeft + 'px';
    a.element.style.top = mergedTop + 'px';
    a.element.style.whiteSpace = 'pre';
    const lineHeight=(b.cssTop-a.cssTop)/a.originalText.split('\n').length;
    a.element.style.lineHeight=lineHeight+'px';
    a.element.style.width = mergedWidth + 'px';

    if (b.element.parentNode) b.element.parentNode.removeChild(b.element);

    const subItems = [...(a.subItems || [a]), ...(b.subItems || [b])];

    return {
        ...a,
        originalText: mergedText,
        currentText: mergedText,
        width: mergedWidth / a.scale,
        originalWidth: mergedWidth,
        renderedFontSize: fontSize,
        cssLeft: mergedLeft,
        cssTop: mergedTop,
        mergedHeight,
        lineHeight,
        lastBaselineY: b.cssTop + b.renderedFontSize,
        subItems,
    };
}

// ============================================
// Font detection — map PDF font names to CSS font families
// ============================================
function detectFont(item, textContent, page) {
    let nativePreview=false;
    let fontFamily = 'Calibri, Arial, Helvetica, sans-serif';
    let fontWeight = '400';
    let fontStyle = 'normal';
    const fontName = item.fontName.toLowerCase();
    const styleInfo = textContent.styles?.[item.fontName];

    // Try to get the actual font name from the PDF font object
    let resolvedName = '';
    let sourceFontName = '', loadedFontName = '';
    try {
        const fontObj = page.commonObjs.get(item.fontName);
        nativePreview=!!fontObj?.isType3Font;
        if (fontObj?.name) { sourceFontName = fontObj.name; resolvedName = fontObj.name.toLowerCase(); }
        if (fontObj?.loadedName && !fontObj?.missingFile) loadedFontName = fontObj.loadedName;
    } catch (_) {}

    const nameToCheck = resolvedName || fontName;

    // Family
    if (nameToCheck.includes('times') || (nameToCheck.includes('serif') && !nameToCheck.includes('sans'))) {
        fontFamily = 'Times New Roman, serif';
    } else if (nameToCheck.includes('courier') || nameToCheck.includes('mono')) {
        fontFamily = 'Courier New, monospace';
    } else if (nameToCheck.includes('calibri')) {
        fontFamily = 'Calibri, Arial, Helvetica, sans-serif';
    } else if (nameToCheck.includes('helvetica')) {
        fontFamily = 'Helvetica, Arial, sans-serif';
    } else if (nameToCheck.includes('arial')) {
        fontFamily = 'Arial, Helvetica, sans-serif';
    } else if (nameToCheck.includes('verdana')) {
        fontFamily = 'Verdana, Geneva, sans-serif';
    } else if (nameToCheck.includes('tahoma')) {
        fontFamily = 'Tahoma, Geneva, sans-serif';
    } else if (nameToCheck.includes('georgia')) {
        fontFamily = 'Georgia, serif';
    } else if (styleInfo?.fontFamily) {
        const styleFontFamily = styleInfo.fontFamily.toLowerCase();
        if (styleFontFamily.includes('times') || (styleFontFamily.includes('serif') && !styleFontFamily.includes('sans'))) {
            fontFamily = 'Times New Roman, serif';
        } else if (styleFontFamily.includes('courier') || styleFontFamily.includes('mono')) {
            fontFamily = 'Courier New, monospace';
        }
    }

    // Weight
    if (fontName.includes('bold') || nameToCheck.includes('bold') ||
        (styleInfo?.fontWeight >= 700)) {
        fontWeight = '700';
    } else if (fontName.includes('light') || nameToCheck.includes('light')) {
        fontWeight = '300';
    } else if (fontName.includes('medium') || nameToCheck.includes('medium')) {
        fontWeight = '500';
    }

    // Style
    if (fontName.includes('italic') || fontName.includes('oblique') ||
        nameToCheck.includes('italic') || nameToCheck.includes('oblique') ||
        styleInfo?.italic) {
        fontStyle = 'italic';
    }

    return { fontFamily, fontWeight, fontStyle, sourceFontName, loadedFontName, nativePreview };
}

// ============================================
// Extract images from PDF page
// ============================================

/**
 * Walk the PDF operator list to find painted images and create draggable overlays.
 * Uses a CTM (Current Transformation Matrix) stack to track each image's position
 * and size on the canvas, matching PDF.js's graphics state model.
 */
async function extractImages(page, viewport, canvas, textLayerDiv, imageItems, pageNum) {
    const operatorList = await page.getOperatorList();
    const OPS = pdfjsLib.OPS;

    // CTM stack tracks coordinate transforms as PDF.js processes draw operations
    const matrixStack = [viewport.transform.slice()];
    const alphaStack=[1];

    function currentMatrix() {
        return matrixStack[matrixStack.length - 1];
    }

    /** Multiply two 2D affine matrices: [a, b, c, d, tx, ty] */
    function multiply(a, b) {
        return [
            a[0] * b[0] + a[2] * b[1],
            a[1] * b[0] + a[3] * b[1],
            a[0] * b[2] + a[2] * b[3],
            a[1] * b[2] + a[3] * b[3],
            a[0] * b[4] + a[2] * b[5] + a[4],
            a[1] * b[4] + a[3] * b[5] + a[5],
        ];
    }

    let imageSeqIndex = 0;

    for (let i = 0; i < operatorList.fnArray.length; i++) {
        const op = operatorList.fnArray[i];
        const operands = operatorList.argsArray[i];

        if (op === OPS.save) {
            matrixStack.push(currentMatrix().slice());
            alphaStack.push(alphaStack.at(-1));
        } else if (op === OPS.restore) {
            if (matrixStack.length > 1) {matrixStack.pop();alphaStack.pop();}
        } else if(op === OPS.setGState){
            for(const [key,value] of operands[0])if(key==='ca')alphaStack[alphaStack.length-1]=value;
        } else if (op === OPS.transform) {
            matrixStack[matrixStack.length - 1] = multiply(currentMatrix(), operands);
        } else if (op === OPS.paintFormXObjectBegin) {
            matrixStack.push(operands[0]?multiply(currentMatrix(),operands[0]):currentMatrix().slice());
            alphaStack.push(alphaStack.at(-1));
        } else if (op === OPS.paintFormXObjectEnd) {
            if(matrixStack.length>1){matrixStack.pop();alphaStack.pop();}
        } else if (op === OPS.paintImageXObject || op === OPS.paintImageXObjectRepeat) {
            const placements=op===OPS.paintImageXObjectRepeat?Array.from({length:operands[3].length/2},(_,j)=>multiply(currentMatrix(),[operands[1],0,0,operands[2],operands[3][j*2],operands[3][j*2+1]])):[currentMatrix()];
            for(const matrix of placements){
            // Image dimensions come from the CTM: width = magnitude of [a, b], height = magnitude of [c, d]
            const imgWidth = Math.abs(matrix[0])+Math.abs(matrix[2]);
            const imgHeight = Math.abs(matrix[1])+Math.abs(matrix[3]);

            if (imgWidth < MIN_IMAGE_SIZE || imgHeight < MIN_IMAGE_SIZE) continue;

            // CTM[4], CTM[5] is the bottom-left corner in canvas coords.
            // CSS top = y - height (since canvas Y goes downward).
            const corners=[[0,0],[1,0],[0,1],[1,1]].map(p=>[matrix[0]*p[0]+matrix[2]*p[1]+matrix[4],matrix[1]*p[0]+matrix[3]*p[1]+matrix[5]]);
            const cssLeft = Math.min(...corners.map(p=>p[0]));
            const cssTop = Math.min(...corners.map(p=>p[1]));
            const bgColor = sampleImageBgColor(canvas, cssLeft, cssTop, imgWidth);
            const imageDataURL = isolatedImagePreview(page,operands[0],matrix,cssLeft,cssTop,imgWidth,imgHeight) || captureCanvasRegion(canvas, cssLeft, cssTop, imgWidth, imgHeight);

            const overlay = document.createElement('div');
            overlay.className = 'draggable-image';
            overlay.style.position = 'absolute';
            overlay.style.left = cssLeft + 'px';
            overlay.style.top = cssTop + 'px';
            overlay.style.width = imgWidth + 'px';
            overlay.style.height = imgHeight + 'px';
            overlay.style.pointerEvents = 'auto';
            overlay.style.opacity=String(alphaStack.at(-1));
            if (imageDataURL) {
                overlay.style.backgroundImage = `url(${imageDataURL})`;
                overlay.style.backgroundSize = '100% 100%';
            }
            overlay.style.setProperty('--bg-color', rgbToCss(bgColor));

            /** @type {ImageItem} see js/types.js */
            const imageItemData = {
                element: overlay,
                pageNum,
                type: 'image',
                imageName: operands[0],
                imageSeqIndex: imageSeqIndex++,
                imageTransform: pdfjsLib.Util.transform(pdfjsLib.Util.inverseTransform(viewport.transform),matrix),
                viewportTransform: [...viewport.transform],
                scale: viewport.scale,
                cssLeft, cssTop,
                cssWidth: imgWidth,
                cssHeight: imgHeight,
                bgColor,
                moveOffsetX: 0,
                moveOffsetY: 0,
                originalCovered: false,
                canvas,
                originCanvas: canvas,
                imageDataURL,
            };

            imageItems.push(imageItemData);
            setupImageDrag(overlay, imageItemData, canvas);
            textLayerDiv.appendChild(overlay);
            }
        }
    }
}

/** Decode just the image, including alpha, instead of capturing artwork behind it. */
function isolatedImagePreview(page,name,matrix,left,top,width,height){
    try{
        const image=(name.startsWith('g_')?page.commonObjs:page.objs).get(name);
        if(!image)return '';
        const raw=document.createElement('canvas');raw.width=image.width;raw.height=image.height;
        const context=raw.getContext('2d');
        if(image.bitmap)context.drawImage(image.bitmap,0,0);
        else{
            const rgba=new Uint8ClampedArray(image.width*image.height*4),data=image.data;
            if(image.kind===pdfjsLib.ImageKind.RGBA_32BPP)rgba.set(data);
            else if(image.kind===pdfjsLib.ImageKind.RGB_24BPP){for(let i=0,j=0;i<data.length;i+=3,j+=4){rgba.set(data.subarray(i,i+3),j);rgba[j+3]=255;}}
            else return '';
            context.putImageData(new ImageData(rgba,image.width,image.height),0,0);
        }
        const out=document.createElement('canvas');out.width=Math.ceil(width);out.height=Math.ceil(height);
        const ctx=out.getContext('2d');ctx.setTransform(matrix[0]/image.width,matrix[1]/image.width,-matrix[2]/image.height,-matrix[3]/image.height,matrix[4]+matrix[2]-left,matrix[5]+matrix[3]-top);ctx.drawImage(raw,0,0);
        return out.toDataURL();
    }catch{return '';}
}

// ============================================
// Image drag, resize, and toolbar integration
// ============================================

/** The viewer page container under the given client Y (pages are stacked vertically). */
function pageContainerAtPoint(viewerEl, clientY) {
    const containers = viewerEl.querySelectorAll(':scope > div');
    for (const c of containers) {
        const r = c.getBoundingClientRect();
        if (clientY >= r.top && clientY <= r.bottom) return c;
    }
    return null;
}

/**
 * Move a dragged element onto the page container under the cursor when it
 * differs from the item's current page. Updates item.canvas (item.originCanvas
 * keeps pointing at the page the item came from, for covers and saving).
 * Returns the item's (possibly new) canvas.
 */
function crossPageIfNeeded(element, item, e) {
    const curCanvas = item.canvas;
    const viewerEl = curCanvas.closest('.pdf-viewer');
    if (!viewerEl) return curCanvas;
    const target = pageContainerAtPoint(viewerEl, e.clientY);
    if (!target || target.contains(curCanvas)) return curCanvas;
    const layer = target.querySelector('.custom-text-layer');
    const targetCanvas = target.querySelector('canvas');
    if (!layer || !targetCanvas) return curCanvas;
    layer.appendChild(element);
    if(e.buttons)element.setPointerCapture(e.pointerId);
    item.canvas = targetCanvas;
    return targetCanvas;
}

/**
 * Touch flow for text items: page scrolling must keep working over text (spans
 * cover most of a page), so text spans don't block touch gestures by default.
 * The first tap "arms" the item — its touch-action turns off and the toolbar
 * shows — then it can be dragged with the finger; a second tap edits it.
 */
let touchArmedItem = null;

function armForTouch(item) {
    disarmTouch();
    touchArmedItem = item;
    item.element.classList.add('touch-armed');
    item.element.style.touchAction = 'none';
}

function disarmTouch() {
    if (!touchArmedItem) return;
    touchArmedItem.element.classList.remove('touch-armed');
    touchArmedItem.element.style.touchAction = '';
    touchArmedItem = null;
}

document.addEventListener('pointerdown', (e) => {
    if (touchArmedItem && !touchArmedItem.element.contains(e.target)) disarmTouch();
});

/**
 * Auto-scroll the viewer while a drag hovers near its top/bottom edge, so
 * items can be dragged to pages that aren't currently visible. Re-invokes the
 * drag's move handler with the last mouse event so the dragged element follows.
 * Returns a stop() function — call it on mouseup.
 */
function startDragAutoScroll(getViewer, getLastEvent, onMove) {
    const EDGE = 48;
    const STEP = 16;
    const timer = setInterval(() => {
        const viewerEl = getViewer();
        const e = getLastEvent();
        if (!viewerEl || !e) return;
        const vr = viewerEl.getBoundingClientRect();
        if (e.clientY < vr.top + EDGE) viewerEl.scrollTop -= STEP;
        else if (e.clientY > vr.bottom - EDGE) viewerEl.scrollTop += STEP;
        else return;
        onMove(e);
    }, 16);
    return () => clearInterval(timer);
}

/** Restore/apply a drag result (position, page, offsets) — used by undo/redo. */
function applyDragPlacement(element, item, s) {
    if (element.parentElement !== s.parent && s.parent) s.parent.appendChild(element);
    element.style.left = s.left + 'px';
    element.style.top = s.top + 'px';
    item.canvas = s.canvas;
    item.moveOffsetX = s.offX;
    item.moveOffsetY = s.offY;
}

/**
 * Group-drag support. When the dragged item is part of a multi-selection, the
 * other selected items follow with the same delta (clamped to their own page,
 * no page-crossing for groups). Returns helpers used by both drag handlers.
 */
function makeGroupDrag(leadItem) {
    const others = (isMultiSelected(leadItem) && multiSelectionSize() > 1)
        ? getMultiSelection().filter(i => i !== leadItem)
        : [];
    const starts = others.map(item => ({
        item,
        left: parseFloat(item.element.style.left),
        top: parseFloat(item.element.style.top),
        offX: item.moveOffsetX,
        offY: item.moveOffsetY,
    }));

    return {
        active: others.length > 0,
        onCoverStart() {
            for (const s of starts) {
                if (s.item.type) coverOriginalImage(s.item);
                else coverOriginalText(s.item, s.item.lastCoverWidth || s.item.originalWidth);
                s.item.element.classList.add('moved');
                if (!s.item.type) s.item.element.classList.add('modified');
            }
        },
        onMove(dx, dy) {
            for (const s of starts) {
                const c = s.item.canvas;
                const el = s.item.element;
                const w = parseFloat(el.style.width) || el.getBoundingClientRect().width;
                const h = parseFloat(el.style.height) || el.getBoundingClientRect().height;
                el.style.left = clamp(s.left + dx, 0, layoutWidth(c) - w) + 'px';
                el.style.top = clamp(s.top + dy, 0, layoutHeight(c) - h) + 'px';
            }
        },
        onDrop(recordEntries) {
            for (const s of starts) {
                s.item.moveOffsetX = parseFloat(s.item.element.style.left) - s.item.cssLeft;
                s.item.moveOffsetY = parseFloat(s.item.element.style.top) - s.item.cssTop;
                recordEntries.push({
                    element: s.item.element,
                    item: s.item,
                    prev: { parent: s.item.element.parentElement, canvas: s.item.canvas, left: s.left, top: s.top, offX: s.offX, offY: s.offY },
                    next: {
                        parent: s.item.element.parentElement, canvas: s.item.canvas,
                        left: parseFloat(s.item.element.style.left), top: parseFloat(s.item.element.style.top),
                        offX: s.item.moveOffsetX, offY: s.item.moveOffsetY,
                    },
                });
            }
        },
    };
}

/** Set up drag-to-move, click-to-select, and resize handles for an image overlay. */
export function setupImageDrag(overlay, imageItemData, canvas) {
    let dragState = null;

    overlay.addEventListener('dragstart', (e) => e.preventDefault());

    // Create resize handles on all 8 edges/corners
    for (const edge of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']) {
        const handle = document.createElement('div');
        handle.className = `img-resize-handle img-resize-${edge}`;
        handle.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            startResize(e, edge, overlay, imageItemData);
        });
        overlay.appendChild(handle);
    }

    overlay.addEventListener('pointerdown', (e) => {
        if (e.target !== overlay) return;
        e.preventDefault();
        e.stopPropagation();

        // Shift+click: toggle multi-selection instead of dragging
        if (e.shiftKey) {
            toggleMultiSelect(imageItemData);
            return;
        }

        overlay.setPointerCapture(e.pointerId);
        const group = makeGroupDrag(imageItemData);
        const imgW = parseFloat(overlay.style.width);
        const imgH = parseFloat(overlay.style.height);

        // Grab offsets in layout pixels so the overlay stays anchored under the
        // cursor while dragging, including across pages and under zoom.
        const startCanvas = imageItemData.canvas;
        const startCanvasRect = startCanvas.getBoundingClientRect();
        const startPxScale = layoutWidth(startCanvas) / startCanvasRect.width;
        const overlayRect = overlay.getBoundingClientRect();

        dragState = {
            startX: e.clientX,
            startY: e.clientY,
            grabDx: (e.clientX - overlayRect.left) * startPxScale,
            grabDy: (e.clientY - overlayRect.top) * startPxScale,
            startParent: overlay.parentElement,
            startCanvas,
            origLeft: parseFloat(overlay.style.left),
            origTop: parseFloat(overlay.style.top),
            prevOffsetX: imageItemData.moveOffsetX,
            prevOffsetY: imageItemData.moveOffsetY,
            hasMoved: false,
        };

        let lastMoveEvent = null;
        const onMouseMove = (e) => {
            if (!dragState) return;
            lastMoveEvent = e;
            const dx = e.clientX - dragState.startX;
            const dy = e.clientY - dragState.startY;

            if (!dragState.hasMoved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
                dragState.hasMoved = true;
                overlay.classList.add('dragging');
                coverOriginalImage(imageItemData);
                if (group.active) group.onCoverStart();
                showImageToolbar(imageItemData);
            }
            if (!dragState.hasMoved) return;

            // Groups move together and stay on their own pages
            const curCanvas = group.active ? imageItemData.canvas : crossPageIfNeeded(overlay, imageItemData, e);

            // Anchor the overlay under the cursor, clamped to the page canvas
            const rect = curCanvas.getBoundingClientRect();
            const pxScale = layoutWidth(curCanvas) / rect.width;
            const newLeft = clamp((e.clientX - rect.left) * pxScale - dragState.grabDx, 0, layoutWidth(curCanvas) - imgW);
            const newTop = clamp((e.clientY - rect.top) * pxScale - dragState.grabDy, 0, layoutHeight(curCanvas) - imgH);
            overlay.style.left = newLeft + 'px';
            overlay.style.top = newTop + 'px';
            if (group.active) group.onMove(newLeft - dragState.origLeft, newTop - dragState.origTop);
            repositionImageToolbar(imageItemData);
        };

        const stopAutoScroll = startDragAutoScroll(
            () => imageItemData.canvas.closest('.pdf-viewer'),
            () => dragState?.hasMoved ? lastMoveEvent : null,
            onMouseMove
        );

        const onMouseUp = () => {
            document.removeEventListener('pointermove', onMouseMove);
            document.removeEventListener('pointerup', onMouseUp);
            document.removeEventListener('pointercancel', onMouseUp);
            stopAutoScroll();
            if (!dragState) return;

            if (dragState.hasMoved) {
                overlay.classList.remove('dragging');
                overlay.classList.add('moved');

                // Offsets are relative to the item's original css position; on a
                // different page they represent the position on that page.
                imageItemData.moveOffsetX = parseFloat(overlay.style.left) - imageItemData.cssLeft;
                imageItemData.moveOffsetY = parseFloat(overlay.style.top) - imageItemData.cssTop;

                const entries = [{
                    element: overlay, item: imageItemData,
                    prev: {
                        parent: dragState.startParent, canvas: dragState.startCanvas,
                        left: dragState.origLeft, top: dragState.origTop,
                        offX: dragState.prevOffsetX, offY: dragState.prevOffsetY,
                    },
                    next: {
                        parent: overlay.parentElement, canvas: imageItemData.canvas,
                        left: parseFloat(overlay.style.left), top: parseFloat(overlay.style.top),
                        offX: imageItemData.moveOffsetX, offY: imageItemData.moveOffsetY,
                    },
                }];
                if (group.active) group.onDrop(entries);
                recordAction({
                    undo() { for (const en of entries) applyDragPlacement(en.element, en.item, en.prev); },
                    redo() { for (const en of entries) applyDragPlacement(en.element, en.item, en.next); },
                });
            }
            showImageToolbar(imageItemData);
            dragState = null;
        };

        document.addEventListener('pointermove', onMouseMove);
        document.addEventListener('pointerup', onMouseUp);
        document.addEventListener('pointercancel', onMouseUp);
    });
}

/**
 * Handle image resize from an edge/corner handle.
 * Supports shift-key for aspect ratio locking.
 */
function startResize(mouseDownEvent, edge, overlay, imageItemData) {
    const startX = mouseDownEvent.clientX;
    const startY = mouseDownEvent.clientY;
    const origLeft = parseFloat(overlay.style.left);
    const origTop = parseFloat(overlay.style.top);
    const origWidth = parseFloat(overlay.style.width);
    const origHeight = parseFloat(overlay.style.height);
    const aspectRatio = origWidth / origHeight;
    let hasResized = false;

    // Convert mouse deltas (css px) to layout px so resizing is accurate under zoom
    const canvasEl = imageItemData.canvas;
    const pxScale = layoutWidth(canvasEl) / canvasEl.getBoundingClientRect().width;

    const isEdgeOnly = edge.length === 1; // 'n', 's', 'e', or 'w'
    const isHorizontalEdge = edge === 'e' || edge === 'w';
    const isVerticalEdge = edge === 'n' || edge === 's';

    const onMouseMove = (e) => {
        const dx = (e.clientX - startX) * pxScale;
        const dy = (e.clientY - startY) * pxScale;

        if (!hasResized && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
            hasResized = true;
            overlay.classList.add('resizing');
            coverOriginalImage(imageItemData);
        }
        if (!hasResized) return;

        let newLeft = origLeft, newTop = origTop;
        let newWidth = origWidth, newHeight = origHeight;

        // Apply free resize based on which edges are being dragged
        if (edge.includes('e')) newWidth = Math.max(MIN_RESIZE_PX, origWidth + dx);
        if (edge.includes('w')) { newWidth = Math.max(MIN_RESIZE_PX, origWidth - dx); newLeft = origLeft + origWidth - newWidth; }
        if (edge.includes('s')) newHeight = Math.max(MIN_RESIZE_PX, origHeight + dy);
        if (edge.includes('n')) { newHeight = Math.max(MIN_RESIZE_PX, origHeight - dy); newTop = origTop + origHeight - newHeight; }

        // Shift key: constrain to original aspect ratio
        if (e.shiftKey) {
            if (isVerticalEdge) {
                // Vertical edge only: height drives width, centered horizontally
                newWidth = newHeight * aspectRatio;
                newLeft = origLeft + (origWidth - newWidth) / 2;
            } else if (isHorizontalEdge) {
                // Horizontal edge only: width drives height, centered vertically
                newHeight = newWidth / aspectRatio;
                newTop = origTop + (origHeight - newHeight) / 2;
            } else {
                // Corner: whichever axis moved more drives the other
                if (Math.abs(newWidth - origWidth) > Math.abs(newHeight - origHeight)) {
                    newHeight = newWidth / aspectRatio;
                } else {
                    newWidth = newHeight * aspectRatio;
                }
                if (edge.includes('w')) newLeft = origLeft + origWidth - newWidth;
                if (edge.includes('n')) newTop = origTop + origHeight - newHeight;
            }
            if (newWidth < MIN_RESIZE_PX) { newWidth = MIN_RESIZE_PX; newHeight = MIN_RESIZE_PX / aspectRatio; }
            if (newHeight < MIN_RESIZE_PX) { newHeight = MIN_RESIZE_PX; newWidth = MIN_RESIZE_PX * aspectRatio; }
        }

        overlay.style.left = newLeft + 'px';
        overlay.style.top = newTop + 'px';
        overlay.style.width = newWidth + 'px';
        overlay.style.height = newHeight + 'px';
    };

    const prevResizedWidth = imageItemData.resizedWidth;
    const prevResizedHeight = imageItemData.resizedHeight;
    const prevMoveOffsetX = imageItemData.moveOffsetX;
    const prevMoveOffsetY = imageItemData.moveOffsetY;

    const onMouseUp = () => {
        document.removeEventListener('pointermove', onMouseMove);
        document.removeEventListener('pointerup', onMouseUp);
            document.removeEventListener('pointercancel', onMouseUp);
        if (!hasResized) return;

        const newLeft = parseFloat(overlay.style.left);
        const newTop = parseFloat(overlay.style.top);
        const newWidth = parseFloat(overlay.style.width);
        const newHeight = parseFloat(overlay.style.height);

        imageItemData.moveOffsetX += newLeft - origLeft;
        imageItemData.moveOffsetY += newTop - origTop;
        imageItemData.resizedWidth = newWidth;
        imageItemData.resizedHeight = newHeight;
        overlay.classList.remove('resizing');
        overlay.classList.add('moved');

        const savedMoveX = imageItemData.moveOffsetX;
        const savedMoveY = imageItemData.moveOffsetY;
        recordAction({
            undo() {
                overlay.style.left = origLeft + 'px';
                overlay.style.top = origTop + 'px';
                overlay.style.width = origWidth + 'px';
                overlay.style.height = origHeight + 'px';
                imageItemData.moveOffsetX = prevMoveOffsetX;
                imageItemData.moveOffsetY = prevMoveOffsetY;
                imageItemData.resizedWidth = prevResizedWidth;
                imageItemData.resizedHeight = prevResizedHeight;
            },
            redo() {
                overlay.style.left = newLeft + 'px';
                overlay.style.top = newTop + 'px';
                overlay.style.width = newWidth + 'px';
                overlay.style.height = newHeight + 'px';
                imageItemData.moveOffsetX = savedMoveX;
                imageItemData.moveOffsetY = savedMoveY;
                imageItemData.resizedWidth = newWidth;
                imageItemData.resizedHeight = newHeight;
            },
        });
    };

    document.addEventListener('pointermove', onMouseMove);
    document.addEventListener('pointerup', onMouseUp);
        document.addEventListener('pointercancel', onMouseUp);
}

// ============================================
// Text drag-to-move
// ============================================

/** Set up drag-to-move for a text span. Click without drag enters edit mode. */
export function setupTextDrag(span, textItemData, canvas) {
    let dragState = null;

    span.addEventListener('dragstart', (e) => e.preventDefault());

    span.addEventListener('pointerdown', (e) => {
        if (textItemData.element.isContentEditable) return;
        e.preventDefault();
        e.stopPropagation();

        // Shift+click: toggle multi-selection instead of dragging/editing
        if (e.shiftKey) {
            toggleMultiSelect(textItemData);
            return;
        }

        // Touch: first tap arms the item (so the page can still scroll over
        // text); once armed it can be finger-dragged, a second tap edits.
        if (e.pointerType === 'touch' && touchArmedItem !== textItemData) {
            armForTouch(textItemData);
            showFormatToolbar(textItemData);
            return;
        }

        span.setPointerCapture(e.pointerId);
        const group = makeGroupDrag(textItemData);
        const spanRect = span.getBoundingClientRect();
        const startCanvas = textItemData.canvas;
        const startCanvasRect = startCanvas.getBoundingClientRect();
        const startPxScale = layoutWidth(startCanvas) / startCanvasRect.width;

        dragState = {
            startX: e.clientX,
            startY: e.clientY,
            grabDx: (e.clientX - spanRect.left) * startPxScale,
            grabDy: (e.clientY - spanRect.top) * startPxScale,
            // Span dimensions in canvas pixels (for clamping and covers)
            spanWidth: spanRect.width * startPxScale,
            spanHeight: spanRect.height * startPxScale,
            startParent: span.parentElement,
            startCanvas,
            origLeft: parseFloat(span.style.left),
            origTop: parseFloat(span.style.top),
            prevOffsetX: textItemData.moveOffsetX,
            prevOffsetY: textItemData.moveOffsetY,
            hasMoved: false,
        };

        let lastMoveEvent = null;
        const onMouseMove = (e) => {
            if (!dragState) return;
            lastMoveEvent = e;
            const dx = e.clientX - dragState.startX;
            const dy = e.clientY - dragState.startY;

            if (!dragState.hasMoved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
                dragState.hasMoved = true;
                span.classList.add('dragging');
                if(textItemData.nativePreview){span.removeAttribute('data-native-preview');document.dispatchEvent(new Event('text-background-change'));}
                showFormatToolbar(textItemData);
                coverOriginalText(textItemData, dragState.spanWidth);
                if (group.active) group.onCoverStart();
            }
            if (!dragState.hasMoved) return;

            // Groups move together and stay on their own pages
            const curCanvas = group.active ? textItemData.canvas : crossPageIfNeeded(span, textItemData, e);

            // Anchor the span under the cursor, clamped to the page canvas
            const rect = curCanvas.getBoundingClientRect();
            const pxScale = layoutWidth(curCanvas) / rect.width;
            const newLeft = clamp((e.clientX - rect.left) * pxScale - dragState.grabDx, 0, layoutWidth(curCanvas) - dragState.spanWidth);
            const newTop = clamp((e.clientY - rect.top) * pxScale - dragState.grabDy, 0, layoutHeight(curCanvas) - dragState.spanHeight);
            span.style.left = newLeft + 'px';
            span.style.top = newTop + 'px';
            if (group.active) group.onMove(newLeft - dragState.origLeft, newTop - dragState.origTop);
            repositionToolbar(textItemData);
        };

        const stopAutoScroll = startDragAutoScroll(
            () => textItemData.canvas.closest('.pdf-viewer'),
            () => dragState?.hasMoved ? lastMoveEvent : null,
            onMouseMove
        );

        const onMouseUp = () => {
            document.removeEventListener('pointermove', onMouseMove);
            document.removeEventListener('pointerup', onMouseUp);
            document.removeEventListener('pointercancel', onMouseUp);
            stopAutoScroll();
            if (!dragState) return;

            if (dragState.hasMoved) {
                span.classList.remove('dragging');
                span.classList.add('modified', 'moved');

                // Offsets are relative to the item's original css position; on a
                // different page they represent the position on that page.
                textItemData.moveOffsetX = parseFloat(span.style.left) - textItemData.cssLeft;
                textItemData.moveOffsetY = parseFloat(span.style.top) - textItemData.cssTop;
                showFormatToolbar(textItemData);

                const entries = [{
                    element: span, item: textItemData,
                    prev: {
                        parent: dragState.startParent, canvas: dragState.startCanvas,
                        left: dragState.origLeft, top: dragState.origTop,
                        offX: dragState.prevOffsetX, offY: dragState.prevOffsetY,
                    },
                    next: {
                        parent: span.parentElement, canvas: textItemData.canvas,
                        left: parseFloat(span.style.left), top: parseFloat(span.style.top),
                        offX: textItemData.moveOffsetX, offY: textItemData.moveOffsetY,
                    },
                }];
                if (group.active) group.onDrop(entries);
                recordAction({
                    undo() { for (const en of entries) applyDragPlacement(en.element, en.item, en.prev); },
                    redo() { for (const en of entries) applyDragPlacement(en.element, en.item, en.next); },
                });
            } else {
                makeEditable(textItemData);
            }

            dragState = null;
        };

        document.addEventListener('pointermove', onMouseMove);
        document.addEventListener('pointerup', onMouseUp);
        document.addEventListener('pointercancel', onMouseUp);
    });
}
