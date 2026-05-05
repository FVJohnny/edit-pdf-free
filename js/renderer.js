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
import { showFormatToolbar, repositionToolbar } from './toolbar.js';
import { showImageToolbar, repositionImageToolbar, coverOriginalImage } from './image-toolbar.js';
import { makeEditable } from './editor.js';
import { sampleBgColor, sampleTextColor, sampleImageBgColor, rgbToCss } from './utils/color.js';
import { coverOriginalText, captureCanvasRegion } from './utils/canvas.js';
import { DRAG_THRESHOLD, MIN_RESIZE_PX, MIN_IMAGE_SIZE, FONT_BASELINE_RATIO } from './utils/constants.js';
import { recordAction } from './history.js';

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// ============================================
// Render PDF pages
// ============================================
export async function renderPDF(pdfDoc, pdfViewer, textItems, imageItems) {
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
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.className = 'pdf-page';

        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

        const textContent = await page.getTextContent();

        // Page container holds the canvas and the overlay text layer
        const pageContainer = document.createElement('div');
        pageContainer.style.position = 'relative';
        pageContainer.style.marginBottom = '20px';
        pageContainer.appendChild(canvas);

        const textLayerDiv = createTextLayerDiv(viewport);

        const pageTextItems = [];
        textContent.items.forEach((item, index) => {
            pageTextItems.push(createTextItem(item, index, pageNum, viewport, canvas, textContent, page));
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
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.className = 'pdf-page';
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    const container = document.createElement('div');
    container.style.position = 'relative';
    container.style.marginBottom = '20px';
    container.dataset.mergedPage = 'true';
    container.appendChild(canvas);

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
    canvas.width = width;
    canvas.height = height;
    canvas.className = 'pdf-page';
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    container.appendChild(canvas);

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
function createTextItem(item, index, pageNum, viewport, canvas, textContent, page) {
    // Transform the item's PDF coordinates into canvas pixel coordinates
    const coords = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const canvasX = coords[4];
    const canvasY = coords[5];

    // Font size: extract from the transform matrix (magnitude of the [a, b] vector)
    const pdfFontSize = Math.sqrt(item.transform[0] ** 2 + item.transform[1] ** 2);
    const renderedFontSize = pdfFontSize * viewport.scale;
    const renderedWidth = item.width * viewport.scale;

    const { fontFamily, fontWeight, fontStyle } = detectFont(item, textContent, page);
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
    span.style.fontFamily = fontFamily;
    span.style.fontWeight = fontWeight;
    if (fontStyle === 'italic') span.style.fontStyle = 'italic';
    span.style.transformOrigin = 'left bottom';
    span.style.pointerEvents = 'auto';
    // Tight letter-spacing and subpixel rendering to match PDF appearance
    span.style.letterSpacing = '-0.02em';
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
        width: item.width,
        height: item.height,
        fontName: item.fontName,
        fontFamily, fontWeight, fontStyle,
        scale: viewport.scale,
        originalWidth: renderedWidth,
        bgColor, textColor,
        moveOffsetX: 0,
        moveOffsetY: 0,
        originalCovered: false,
        cssLeft: canvasX,
        cssTop,
        canvas,
        renderedFontSize,
    };
}

/**
 * Merge adjacent text items into logical groups:
 *   Pass 1: Merge items on the same line (horizontal — same baseline, adjacent)
 *   Pass 2: Merge consecutive lines into paragraphs (vertical — similar left edge,
 *           similar font size, vertical gap ≈ line height)
 */
function mergeAdjacentTextItems(items) {
    if (items.length <= 1) return items;

    // Sort by Y position (top), then X position (left)
    const sorted = [...items].sort((a, b) => {
        const yDiff = a.cssTop - b.cssTop;
        if (Math.abs(yDiff) > 5) return yDiff;
        return a.cssLeft - b.cssLeft;
    });

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

        if (sameBaseline && adjacent && current.originalText.trim() !== '' && next.originalText.trim() !== '') {
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
    current = lines[0];
    let lastBaselineDist = null;

    for (let i = 1; i < lines.length; i++) {
        const nextLine = lines[i];

        // Similar font size (within 20%)
        const similarSize = Math.abs(current.renderedFontSize - nextLine.renderedFontSize) <
            current.renderedFontSize * 0.2;

        // Similar left edge (within 1 font size)
        const similarLeft = Math.abs(current.cssLeft - nextLine.cssLeft) < current.renderedFontSize;

        // Baseline-to-baseline distance: from the last line's baseline to next line's baseline
        // For single-line items: baseline = cssTop + renderedFontSize
        // For merged items: use lastBaselineY which tracks the bottom-most line's baseline
        const currentBaseline = current.lastBaselineY ?? (current.cssTop + current.renderedFontSize);
        const nextBaseline = nextLine.cssTop + nextLine.renderedFontSize;
        const baselineDist = nextBaseline - currentBaseline;

        // Normal line spacing is 1.1–1.4x font size. Paragraph breaks are 1.6x+.
        const fontSize = Math.max(current.renderedFontSize, nextLine.renderedFontSize);
        const normalSpacing = baselineDist > 0 && baselineDist < fontSize * 1.5;

        // Consistency check: if we've seen within-paragraph spacing, reject
        // distances that are 25%+ larger (indicates a paragraph break)
        let consistent = true;
        if (lastBaselineDist !== null && baselineDist > lastBaselineDist * 1.25 + 1) {
            consistent = false;
        }

        const bothNonEmpty = current.originalText.trim() !== '' && nextLine.originalText.trim() !== '';

        if (similarSize && similarLeft && normalSpacing && consistent && bothNonEmpty) {
            if (lastBaselineDist === null) lastBaselineDist = baselineDist;
            current = mergeLines(current, nextLine);
        } else {
            paragraphs.push(current);
            current = nextLine;
            lastBaselineDist = null;
        }
    }
    paragraphs.push(current);

    return paragraphs;
}

/** Merge two horizontally adjacent items on the same line. */
function mergeInline(a, b) {
    const mergedText = a.originalText + b.originalText;
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
    a.element.style.whiteSpace = 'pre-wrap';
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
        lastBaselineY: b.cssTop + b.renderedFontSize,
        subItems,
    };
}

// ============================================
// Font detection — map PDF font names to CSS font families
// ============================================
function detectFont(item, textContent, page) {
    let fontFamily = 'Calibri, Arial, Helvetica, sans-serif';
    let fontWeight = '400';
    let fontStyle = 'normal';
    const fontName = item.fontName.toLowerCase();
    const styleInfo = textContent.styles?.[item.fontName];

    // Try to get the actual font name from the PDF font object
    let resolvedName = '';
    try {
        const fontObj = page.commonObjs.get(item.fontName);
        if (fontObj?.name) resolvedName = fontObj.name.toLowerCase();
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

    return { fontFamily, fontWeight, fontStyle };
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
        } else if (op === OPS.restore) {
            if (matrixStack.length > 1) matrixStack.pop();
        } else if (op === OPS.transform) {
            matrixStack[matrixStack.length - 1] = multiply(currentMatrix(), operands);
        } else if (op === OPS.paintImageXObject || op === OPS.paintImageXObjectRepeat) {
            const matrix = currentMatrix();
            // Image dimensions come from the CTM: width = magnitude of [a, b], height = magnitude of [c, d]
            const imgWidth = Math.sqrt(matrix[0] ** 2 + matrix[1] ** 2);
            const imgHeight = Math.sqrt(matrix[2] ** 2 + matrix[3] ** 2);

            if (imgWidth < MIN_IMAGE_SIZE || imgHeight < MIN_IMAGE_SIZE) continue;

            // CTM[4], CTM[5] is the bottom-left corner in canvas coords.
            // CSS top = y - height (since canvas Y goes downward).
            const cssLeft = matrix[4];
            const cssTop = matrix[5] - imgHeight;
            const bgColor = sampleImageBgColor(canvas, cssLeft, cssTop, imgWidth);
            const imageDataURL = captureCanvasRegion(canvas, cssLeft, cssTop, imgWidth, imgHeight);

            const overlay = document.createElement('div');
            overlay.className = 'draggable-image';
            overlay.style.position = 'absolute';
            overlay.style.left = cssLeft + 'px';
            overlay.style.top = cssTop + 'px';
            overlay.style.width = imgWidth + 'px';
            overlay.style.height = imgHeight + 'px';
            overlay.style.pointerEvents = 'auto';
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
                scale: viewport.scale,
                cssLeft, cssTop,
                cssWidth: imgWidth,
                cssHeight: imgHeight,
                bgColor,
                moveOffsetX: 0,
                moveOffsetY: 0,
                originalCovered: false,
                canvas,
                imageDataURL,
            };

            imageItems.push(imageItemData);
            setupImageDrag(overlay, imageItemData, canvas);
            textLayerDiv.appendChild(overlay);
        }
    }
}

// ============================================
// Image drag, resize, and toolbar integration
// ============================================

/** Set up drag-to-move, click-to-select, and resize handles for an image overlay. */
export function setupImageDrag(overlay, imageItemData, canvas) {
    let dragState = null;

    overlay.addEventListener('dragstart', (e) => e.preventDefault());

    // Create resize handles on all 8 edges/corners
    for (const edge of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']) {
        const handle = document.createElement('div');
        handle.className = `img-resize-handle img-resize-${edge}`;
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            startResize(e, edge, overlay, imageItemData);
        });
        overlay.appendChild(handle);
    }

    overlay.addEventListener('mousedown', (e) => {
        if (e.target !== overlay) return;
        e.preventDefault();
        e.stopPropagation();

        const imgW = parseFloat(overlay.style.width);
        const imgH = parseFloat(overlay.style.height);

        dragState = {
            startX: e.clientX,
            startY: e.clientY,
            origLeft: parseFloat(overlay.style.left),
            origTop: parseFloat(overlay.style.top),
            hasMoved: false,
        };

        const onMouseMove = (e) => {
            if (!dragState) return;
            const dx = e.clientX - dragState.startX;
            const dy = e.clientY - dragState.startY;

            if (!dragState.hasMoved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
                dragState.hasMoved = true;
                overlay.classList.add('dragging');
                coverOriginalImage(imageItemData);
                showImageToolbar(imageItemData);
            }

            if (dragState.hasMoved) {
                // Clamp to page canvas boundaries
                const newLeft = clamp(dragState.origLeft + dx, 0, canvas.width - imgW);
                const newTop = clamp(dragState.origTop + dy, 0, canvas.height - imgH);
                overlay.style.left = newLeft + 'px';
                overlay.style.top = newTop + 'px';
                repositionImageToolbar(imageItemData);
            }
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (!dragState) return;

            if (dragState.hasMoved) {
                const movedDx = parseFloat(overlay.style.left) - dragState.origLeft;
                const movedDy = parseFloat(overlay.style.top) - dragState.origTop;
                imageItemData.moveOffsetX += movedDx;
                imageItemData.moveOffsetY += movedDy;
                overlay.classList.remove('dragging');
                overlay.classList.add('moved');

                const savedOrigLeft = dragState.origLeft;
                const savedOrigTop = dragState.origTop;
                const savedNewLeft = parseFloat(overlay.style.left);
                const savedNewTop = parseFloat(overlay.style.top);
                recordAction({
                    undo() {
                        overlay.style.left = savedOrigLeft + 'px';
                        overlay.style.top = savedOrigTop + 'px';
                        imageItemData.moveOffsetX -= movedDx;
                        imageItemData.moveOffsetY -= movedDy;
                    },
                    redo() {
                        overlay.style.left = savedNewLeft + 'px';
                        overlay.style.top = savedNewTop + 'px';
                        imageItemData.moveOffsetX += movedDx;
                        imageItemData.moveOffsetY += movedDy;
                    },
                });
            }
            showImageToolbar(imageItemData);
            dragState = null;
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
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

    const isEdgeOnly = edge.length === 1; // 'n', 's', 'e', or 'w'
    const isHorizontalEdge = edge === 'e' || edge === 'w';
    const isVerticalEdge = edge === 'n' || edge === 's';

    const onMouseMove = (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

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
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
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

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

// ============================================
// Text drag-to-move
// ============================================

/** Set up drag-to-move for a text span. Click without drag enters edit mode. */
export function setupTextDrag(span, textItemData, canvas) {
    let dragState = null;

    span.addEventListener('dragstart', (e) => e.preventDefault());

    span.addEventListener('mousedown', (e) => {
        if (textItemData.element.contentEditable === 'true') return;
        e.preventDefault();
        e.stopPropagation();

        const spanRect = span.getBoundingClientRect();

        dragState = {
            startX: e.clientX,
            startY: e.clientY,
            origLeft: parseFloat(span.style.left),
            origTop: parseFloat(span.style.top),
            spanWidth: spanRect.width,
            spanHeight: spanRect.height,
            hasMoved: false,
        };

        const onMouseMove = (e) => {
            if (!dragState) return;
            const dx = e.clientX - dragState.startX;
            const dy = e.clientY - dragState.startY;

            if (!dragState.hasMoved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
                dragState.hasMoved = true;
                span.classList.add('dragging');
                showFormatToolbar(textItemData);
                coverOriginalText(textItemData, dragState.spanWidth);
            }

            if (dragState.hasMoved) {
                // Clamp to page canvas boundaries
                const newLeft = clamp(dragState.origLeft + dx, 0, canvas.width - dragState.spanWidth);
                const newTop = clamp(dragState.origTop + dy, 0, canvas.height - dragState.spanHeight);
                span.style.left = newLeft + 'px';
                span.style.top = newTop + 'px';
                repositionToolbar(textItemData);
            }
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (!dragState) return;

            if (dragState.hasMoved) {
                const movedDx = parseFloat(span.style.left) - dragState.origLeft;
                const movedDy = parseFloat(span.style.top) - dragState.origTop;
                textItemData.moveOffsetX += movedDx;
                textItemData.moveOffsetY += movedDy;
                span.classList.remove('dragging');
                span.classList.add('modified', 'moved');
                showFormatToolbar(textItemData);

                const savedOrigLeft = dragState.origLeft;
                const savedOrigTop = dragState.origTop;
                const savedNewLeft = parseFloat(span.style.left);
                const savedNewTop = parseFloat(span.style.top);
                recordAction({
                    undo() {
                        span.style.left = savedOrigLeft + 'px';
                        span.style.top = savedOrigTop + 'px';
                        textItemData.moveOffsetX -= movedDx;
                        textItemData.moveOffsetY -= movedDy;
                    },
                    redo() {
                        span.style.left = savedNewLeft + 'px';
                        span.style.top = savedNewTop + 'px';
                        textItemData.moveOffsetX += movedDx;
                        textItemData.moveOffsetY += movedDy;
                    },
                });
            } else {
                makeEditable(textItemData);
            }

            dragState = null;
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}
