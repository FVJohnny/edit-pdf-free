import { showFormatToolbar, repositionToolbar } from './toolbar.js';
import { showImageToolbar, repositionImageToolbar, coverOriginalImage } from './image-toolbar.js';
import { makeEditable } from './editor.js';
import { sampleBgColor, sampleTextColor, sampleImageBgColor, rgbToCss } from './utils/color.js';

// ============================================
// Render PDF pages
// ============================================
export async function renderPDF(pdfDoc, pdfViewer, textItems, imageItems) {
    pdfViewer.innerHTML = '';
    textItems.length = 0;
    imageItems.length = 0;

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const containerWidth = pdfViewer.clientWidth;
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = containerWidth / unscaledViewport.width;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.getContext('2d', { willReadFrequently: true });
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.className = 'pdf-page';

        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

        const textContent = await page.getTextContent();

        const pageContainer = document.createElement('div');
        pageContainer.style.position = 'relative';
        pageContainer.style.marginBottom = '20px';
        pageContainer.appendChild(canvas);

        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'custom-text-layer';
        textLayerDiv.style.position = 'absolute';
        textLayerDiv.style.left = '0';
        textLayerDiv.style.top = '0';
        textLayerDiv.style.width = viewport.width + 'px';
        textLayerDiv.style.height = viewport.height + 'px';
        textLayerDiv.style.pointerEvents = 'none';

        textContent.items.forEach((item, index) => {
            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const fontSizeRaw = Math.sqrt(item.transform[0] ** 2 + item.transform[1] ** 2);
            const fontSize = fontSizeRaw * viewport.scale;
            const originalWidth = item.width * viewport.scale;
            const { fontFamily, fontWeight, fontStyle } = detectFont(item, textContent, page);
            const bgColor = sampleBgColor(canvas, tx[4], tx[5], originalWidth);
            const textColor = sampleTextColor(canvas, tx, originalWidth, fontSize, item.str);

            const span = document.createElement('span');
            span.textContent = item.str;
            span.className = 'editable-text';
            span.style.position = 'absolute';
            span.style.left = tx[4] + 'px';
            span.style.top = (tx[5] - item.height) + 'px';
            span.style.fontSize = fontSize + 'px';
            span.style.lineHeight = '1';
            span.style.fontFamily = fontFamily;
            span.style.fontWeight = fontWeight;
            if (fontStyle === 'italic') span.style.fontStyle = 'italic';
            span.style.transformOrigin = 'left bottom';
            span.style.pointerEvents = 'auto';
            span.style.letterSpacing = '-0.02em';
            span.style.textRendering = 'geometricPrecision';
            span.style.webkitFontSmoothing = 'antialiased';
            span.style.mozOsxFontSmoothing = 'grayscale';
            span.style.setProperty('--bg-color', rgbToCss(bgColor));
            span.style.setProperty('--text-color', rgbToCss(textColor));

            const textItemData = {
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
                originalWidth,
                bgColor, textColor,
                moveOffsetX: 0,
                moveOffsetY: 0,
                originalCovered: false,
                cssLeft: parseFloat(span.style.left),
                cssTop: parseFloat(span.style.top),
                canvas,
                renderedFontSize: fontSize
            };

            textItems.push(textItemData);
            setupTextDrag(span, textItemData, canvas, fontSize);
            textLayerDiv.appendChild(span);
        });

        await extractImages(page, viewport, canvas, textLayerDiv, imageItems, pageNum);

        pageContainer.appendChild(textLayerDiv);
        pdfViewer.appendChild(pageContainer);
    }
}

// ============================================
// Font detection
// ============================================
function detectFont(item, textContent, page) {
    let fontFamily = 'Calibri, Arial, Helvetica, sans-serif';
    let fontWeight = '400';
    let fontStyle = 'normal';
    const fontName = item.fontName.toLowerCase();
    const styleInfo = textContent.styles && textContent.styles[item.fontName];

    let actualFontName = '';
    try {
        const fontObj = page.commonObjs.get(item.fontName);
        if (fontObj && fontObj.name) actualFontName = fontObj.name.toLowerCase();
    } catch (e) {}

    const nameToCheck = actualFontName || fontName;

    // Font family detection
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
    } else if (styleInfo && styleInfo.fontFamily) {
        const sfam = styleInfo.fontFamily.toLowerCase();
        if (sfam.includes('times') || (sfam.includes('serif') && !sfam.includes('sans'))) {
            fontFamily = 'Times New Roman, serif';
        } else if (sfam.includes('courier') || sfam.includes('mono')) {
            fontFamily = 'Courier New, monospace';
        }
    }

    // Weight
    if (fontName.includes('bold') || nameToCheck.includes('bold') ||
        (styleInfo && styleInfo.fontWeight && styleInfo.fontWeight >= 700)) {
        fontWeight = '700';
    } else if (fontName.includes('light') || nameToCheck.includes('light')) {
        fontWeight = '300';
    } else if (fontName.includes('medium') || nameToCheck.includes('medium')) {
        fontWeight = '500';
    }

    // Style
    if (fontName.includes('italic') || fontName.includes('oblique') ||
        nameToCheck.includes('italic') || nameToCheck.includes('oblique') ||
        (styleInfo && styleInfo.italic)) {
        fontStyle = 'italic';
    }

    return { fontFamily, fontWeight, fontStyle };
}

// ============================================
// Extract images from PDF page
// ============================================
async function extractImages(page, viewport, canvas, textLayerDiv, imageItems, pageNum) {
    const operatorList = await page.getOperatorList();
    const OPS = pdfjsLib.OPS;
    const ctmStack = [viewport.transform.slice()];

    function currentCTM() {
        return ctmStack[ctmStack.length - 1];
    }

    function multiplyMatrices(a, b) {
        return [
            a[0] * b[0] + a[2] * b[1],
            a[1] * b[0] + a[3] * b[1],
            a[0] * b[2] + a[2] * b[3],
            a[1] * b[2] + a[3] * b[3],
            a[0] * b[4] + a[2] * b[5] + a[4],
            a[1] * b[4] + a[3] * b[5] + a[5]
        ];
    }

    let imageSeqIndex = 0;

    for (let i = 0; i < operatorList.fnArray.length; i++) {
        const fn = operatorList.fnArray[i];
        const args = operatorList.argsArray[i];

        if (fn === OPS.save) {
            ctmStack.push(currentCTM().slice());
        } else if (fn === OPS.restore) {
            if (ctmStack.length > 1) ctmStack.pop();
        } else if (fn === OPS.transform) {
            ctmStack[ctmStack.length - 1] = multiplyMatrices(currentCTM(), args);
        } else if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
            const ctm = currentCTM();
            const imgWidth = Math.sqrt(ctm[0] ** 2 + ctm[1] ** 2);
            const imgHeight = Math.sqrt(ctm[2] ** 2 + ctm[3] ** 2);

            if (imgWidth < 10 || imgHeight < 10) continue;

            const cssLeft = ctm[4];
            const cssTop = ctm[5] - imgHeight;
            const bgColor = sampleImageBgColor(canvas, cssLeft, cssTop, imgWidth);

            // Capture image pixels from the canvas
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

            const imageItemData = {
                element: overlay,
                pageNum,
                type: 'image',
                imageName: args[0],
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
            };

            imageItems.push(imageItemData);
            setupImageDrag(overlay, imageItemData, canvas);
            textLayerDiv.appendChild(overlay);
        }
    }
}

function captureCanvasRegion(canvas, x, y, w, h) {
    const sx = Math.max(0, Math.round(x));
    const sy = Math.max(0, Math.round(y));
    const sw = Math.min(Math.round(w), canvas.width - sx);
    const sh = Math.min(Math.round(h), canvas.height - sy);
    if (sw <= 0 || sh <= 0) return '';

    const temp = document.createElement('canvas');
    temp.width = sw;
    temp.height = sh;
    temp.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return temp.toDataURL();
}

// ============================================
// Image drag, resize, and toolbar integration
// ============================================
export function setupImageDrag(overlay, imageItemData, canvas) {
    let dragState = null;

    overlay.addEventListener('dragstart', (e) => e.preventDefault());

    // Resize handles
    ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'].forEach(edge => {
        const handle = document.createElement('div');
        handle.className = `img-resize-handle img-resize-${edge}`;
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            startResize(e, edge, overlay, imageItemData, canvas);
        });
        overlay.appendChild(handle);
    });

    overlay.addEventListener('mousedown', (e) => {
        if (e.target !== overlay) return;
        e.preventDefault();
        e.stopPropagation();

        dragState = {
            startX: e.clientX,
            startY: e.clientY,
            origLeft: parseFloat(overlay.style.left),
            origTop: parseFloat(overlay.style.top),
            moved: false
        };

        const onMouseMove = (e) => {
            if (!dragState) return;
            const dx = e.clientX - dragState.startX;
            const dy = e.clientY - dragState.startY;

            if (!dragState.moved && Math.abs(dx) + Math.abs(dy) > 3) {
                dragState.moved = true;
                overlay.classList.add('dragging');
                coverOriginalImage(imageItemData);
                showImageToolbar(imageItemData);
            }

            if (dragState.moved) {
                overlay.style.left = (dragState.origLeft + dx) + 'px';
                overlay.style.top = (dragState.origTop + dy) + 'px';
                repositionImageToolbar(imageItemData);
            }
        };

        const onMouseUp = (e) => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (!dragState) return;

            if (dragState.moved) {
                imageItemData.moveOffsetX += e.clientX - dragState.startX;
                imageItemData.moveOffsetY += e.clientY - dragState.startY;
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

function startResize(e, edge, overlay, imageItemData, canvas) {
    const startX = e.clientX;
    const startY = e.clientY;
    const origLeft = parseFloat(overlay.style.left);
    const origTop = parseFloat(overlay.style.top);
    const origWidth = parseFloat(overlay.style.width);
    const origHeight = parseFloat(overlay.style.height);
    const aspectRatio = origWidth / origHeight;
    let resized = false;

    const onMouseMove = (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!resized && Math.abs(dx) + Math.abs(dy) > 3) {
            resized = true;
            overlay.classList.add('resizing');
            coverOriginalImage(imageItemData);
        }
        if (!resized) return;

        let newLeft = origLeft, newTop = origTop;
        let newWidth = origWidth, newHeight = origHeight;

        if (edge.includes('e')) newWidth = Math.max(20, origWidth + dx);
        if (edge.includes('w')) { newWidth = Math.max(20, origWidth - dx); newLeft = origLeft + origWidth - newWidth; }
        if (edge.includes('s')) newHeight = Math.max(20, origHeight + dy);
        if (edge.includes('n')) { newHeight = Math.max(20, origHeight - dy); newTop = origTop + origHeight - newHeight; }

        // Shift key: lock aspect ratio
        if (e.shiftKey) {
            if (edge === 'n' || edge === 's') {
                newWidth = newHeight * aspectRatio;
                newLeft = origLeft + (origWidth - newWidth) / 2;
            } else if (edge === 'e' || edge === 'w') {
                newHeight = newWidth / aspectRatio;
                newTop = origTop + (origHeight - newHeight) / 2;
            } else {
                if (Math.abs(newWidth - origWidth) > Math.abs(newHeight - origHeight)) {
                    newHeight = newWidth / aspectRatio;
                } else {
                    newWidth = newHeight * aspectRatio;
                }
                if (edge.includes('w')) newLeft = origLeft + origWidth - newWidth;
                if (edge.includes('n')) newTop = origTop + origHeight - newHeight;
            }
            if (newWidth < 20) { newWidth = 20; newHeight = 20 / aspectRatio; }
            if (newHeight < 20) { newHeight = 20; newWidth = 20 * aspectRatio; }
        }

        overlay.style.left = newLeft + 'px';
        overlay.style.top = newTop + 'px';
        overlay.style.width = newWidth + 'px';
        overlay.style.height = newHeight + 'px';
    };

    const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (!resized) return;

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
function setupTextDrag(span, textItemData, canvas, fontSize) {
    let dragState = null;

    span.addEventListener('dragstart', (e) => e.preventDefault());

    span.addEventListener('mousedown', (e) => {
        if (textItemData.element.contentEditable === 'true') return;
        e.preventDefault();
        e.stopPropagation();

        dragState = {
            startX: e.clientX,
            startY: e.clientY,
            origLeft: parseFloat(span.style.left),
            origTop: parseFloat(span.style.top),
            spanW: span.getBoundingClientRect().width,
            moved: false
        };

        const onMouseMove = (e) => {
            if (!dragState) return;
            const dx = e.clientX - dragState.startX;
            const dy = e.clientY - dragState.startY;

            if (!dragState.moved && Math.abs(dx) + Math.abs(dy) > 3) {
                dragState.moved = true;
                span.classList.add('dragging');
                showFormatToolbar(textItemData);

                if (!textItemData.originalCovered) {
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = rgbToCss(textItemData.bgColor);
                    ctx.fillRect(
                        textItemData.cssLeft,
                        textItemData.cssTop - fontSize * 0.4,
                        dragState.spanW + 8,
                        fontSize * 1.5
                    );
                    textItemData.originalCovered = true;
                }
            }

            if (dragState.moved) {
                span.style.left = (dragState.origLeft + dx) + 'px';
                span.style.top = (dragState.origTop + dy) + 'px';
                repositionToolbar(textItemData);
            }
        };

        const onMouseUp = (e) => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (!dragState) return;

            if (dragState.moved) {
                textItemData.moveOffsetX += e.clientX - dragState.startX;
                textItemData.moveOffsetY += e.clientY - dragState.startY;
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
