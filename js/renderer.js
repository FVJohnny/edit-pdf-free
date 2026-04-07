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
import { DRAG_THRESHOLD, MIN_RESIZE_PX, MIN_IMAGE_SIZE } from './utils/constants.js';

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

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        // Scale the page to fill the viewer width
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = pdfViewer.clientWidth / unscaledViewport.width;
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

        textContent.items.forEach((item, index) => {
            const textItem = createTextItem(item, index, pageNum, viewport, canvas, textContent, page);
            textItems.push(textItem);
            setupTextDrag(textItem.element, textItem, canvas);
            textLayerDiv.appendChild(textItem.element);
        });

        await extractImages(page, viewport, canvas, textLayerDiv, imageItems, pageNum);

        pageContainer.appendChild(textLayerDiv);
        pdfViewer.appendChild(pageContainer);
    }
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

    const span = document.createElement('span');
    span.textContent = item.str;
    span.className = 'editable-text';
    span.style.position = 'absolute';
    span.style.left = canvasX + 'px';
    span.style.top = (canvasY - item.height) + 'px';
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
        cssTop: canvasY - item.height,
        canvas,
        renderedFontSize,
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
                imageItemData.moveOffsetX += parseFloat(overlay.style.left) - dragState.origLeft;
                imageItemData.moveOffsetY += parseFloat(overlay.style.top) - dragState.origTop;
                overlay.classList.remove('dragging');
                overlay.classList.add('moved');
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

    const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (!hasResized) return;

        imageItemData.moveOffsetX += parseFloat(overlay.style.left) - origLeft;
        imageItemData.moveOffsetY += parseFloat(overlay.style.top) - origTop;
        imageItemData.resizedWidth = parseFloat(overlay.style.width);
        imageItemData.resizedHeight = parseFloat(overlay.style.height);
        overlay.classList.remove('resizing');
        overlay.classList.add('moved');
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

// ============================================
// Text drag-to-move
// ============================================

/** Set up drag-to-move for a text span. Click without drag enters edit mode. */
function setupTextDrag(span, textItemData, canvas) {
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
                textItemData.moveOffsetX += parseFloat(span.style.left) - dragState.origLeft;
                textItemData.moveOffsetY += parseFloat(span.style.top) - dragState.origTop;
                span.classList.remove('dragging');
                span.classList.add('modified', 'moved');
                showFormatToolbar(textItemData);
            } else {
                makeEditable(textItemData);
            }

            dragState = null;
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
}
