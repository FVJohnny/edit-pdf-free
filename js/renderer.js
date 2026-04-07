import { showFormatToolbar, repositionToolbar } from './toolbar.js';
import { makeEditable } from './editor.js';

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
        const context = canvas.getContext('2d', { willReadFrequently: true });
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.className = 'pdf-page';

        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };

        await page.render(renderContext).promise;

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

            const span = document.createElement('span');
            span.textContent = item.str;
            span.className = 'editable-text';
            span.style.position = 'absolute';
            span.style.left = tx[4] + 'px';
            span.style.top = (tx[5] - item.height) + 'px';

            const fontSizeRaw = Math.sqrt(item.transform[0] * item.transform[0] + item.transform[1] * item.transform[1]);
            const fontSize = fontSizeRaw * viewport.scale;
            span.style.fontSize = fontSize + 'px';
            span.style.lineHeight = '1';

            const { fontFamily, fontWeight, fontStyle } = detectFont(item, textContent, page);

            if (fontStyle === 'italic') span.style.fontStyle = 'italic';
            span.style.fontFamily = fontFamily;
            span.style.fontWeight = fontWeight;
            span.style.transformOrigin = 'left bottom';
            span.style.pointerEvents = 'auto';
            span.style.letterSpacing = '-0.02em';
            span.style.textRendering = 'geometricPrecision';
            span.style.webkitFontSmoothing = 'antialiased';
            span.style.mozOsxFontSmoothing = 'grayscale';

            const originalWidth = item.width * viewport.scale;

            const bgColor = sampleBgColor(canvas, tx, originalWidth);
            const textColor = sampleTextColor(canvas, tx, originalWidth, fontSize, item.str);

            // Store colors as CSS custom properties
            const bgR = Math.round(bgColor.r * 255);
            const bgG = Math.round(bgColor.g * 255);
            const bgB = Math.round(bgColor.b * 255);
            span.style.setProperty('--bg-color', `rgb(${bgR}, ${bgG}, ${bgB})`);

            const tcR = Math.round(textColor.r * 255);
            const tcG = Math.round(textColor.g * 255);
            const tcB = Math.round(textColor.b * 255);
            span.style.setProperty('--text-color', `rgb(${tcR}, ${tcG}, ${tcB})`);

            const textItemData = {
                element: span,
                pageNum: pageNum,
                originalText: item.str,
                currentText: item.str,
                index: index,
                transform: item.transform,
                width: item.width,
                height: item.height,
                fontName: item.fontName,
                fontFamily: fontFamily,
                fontWeight: fontWeight,
                fontStyle: fontStyle,
                scale: viewport.scale,
                originalWidth: originalWidth,
                bgColor: bgColor,
                textColor: textColor,
                moveOffsetX: 0,
                moveOffsetY: 0,
                originalCovered: false,
                cssLeft: parseFloat(span.style.left),
                cssTop: parseFloat(span.style.top),
                canvas: canvas,
                renderedFontSize: fontSize
            };

            textItems.push(textItemData);

            setupDrag(span, textItemData, canvas, fontSize);

            textLayerDiv.appendChild(span);
        });

        // Extract and create draggable image overlays
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

    const fontNameToCheck = actualFontName || fontName;

    if (fontNameToCheck.includes('times') || (fontNameToCheck.includes('serif') && !fontNameToCheck.includes('sans'))) {
        fontFamily = 'Times New Roman, serif';
    } else if (fontNameToCheck.includes('courier') || fontNameToCheck.includes('mono')) {
        fontFamily = 'Courier New, monospace';
    } else if (fontNameToCheck.includes('calibri')) {
        fontFamily = 'Calibri, Arial, Helvetica, sans-serif';
    } else if (fontNameToCheck.includes('helvetica')) {
        fontFamily = 'Helvetica, Arial, sans-serif';
    } else if (fontNameToCheck.includes('arial')) {
        fontFamily = 'Arial, Helvetica, sans-serif';
    } else if (fontNameToCheck.includes('verdana')) {
        fontFamily = 'Verdana, Geneva, sans-serif';
    } else if (fontNameToCheck.includes('tahoma')) {
        fontFamily = 'Tahoma, Geneva, sans-serif';
    } else if (fontNameToCheck.includes('georgia')) {
        fontFamily = 'Georgia, serif';
    } else if (styleInfo && styleInfo.fontFamily) {
        const sfam = styleInfo.fontFamily.toLowerCase();
        if (sfam.includes('times') || (sfam.includes('serif') && !sfam.includes('sans'))) {
            fontFamily = 'Times New Roman, serif';
        } else if (sfam.includes('courier') || sfam.includes('mono')) {
            fontFamily = 'Courier New, monospace';
        }
    }

    if (fontName.includes('bold') || fontNameToCheck.includes('bold') ||
        (styleInfo && styleInfo.fontWeight && styleInfo.fontWeight >= 700)) {
        fontWeight = '700';
    } else if (fontName.includes('light') || fontNameToCheck.includes('light')) {
        fontWeight = '300';
    } else if (fontName.includes('medium') || fontNameToCheck.includes('medium')) {
        fontWeight = '500';
    }

    if (fontName.includes('italic') || fontName.includes('oblique') ||
        fontNameToCheck.includes('italic') || fontNameToCheck.includes('oblique') ||
        (styleInfo && styleInfo.italic)) {
        fontStyle = 'italic';
    }

    return { fontFamily, fontWeight, fontStyle };
}

// ============================================
// Color sampling
// ============================================
function sampleBgColor(canvas, tx, originalWidth) {
    const ctx = canvas.getContext('2d');
    let bgColor = { r: 1, g: 1, b: 1 };

    const stripY = Math.round(tx[5]);
    const stripX = Math.max(0, Math.round(tx[4]));
    const stripW = Math.min(Math.round(originalWidth), canvas.width - stripX);
    if (stripW > 0 && stripY >= 0 && stripY < canvas.height) {
        const stripData = ctx.getImageData(stripX, stripY, stripW, 1).data;
        const colorCounts = {};
        for (let i = 0; i < stripData.length; i += 4) {
            const r = stripData[i], g = stripData[i+1], b = stripData[i+2];
            const brightness = r * 0.299 + g * 0.587 + b * 0.114;
            if (brightness < 80) continue;
            const qr = Math.round(r / 4) * 4;
            const qg = Math.round(g / 4) * 4;
            const qb = Math.round(b / 4) * 4;
            const key = `${qr},${qg},${qb}`;
            if (!colorCounts[key]) colorCounts[key] = { count: 0, r, g, b };
            colorCounts[key].count++;
        }
        let bestCount = 0;
        for (const c of Object.values(colorCounts)) {
            if (c.count > bestCount) {
                bestCount = c.count;
                bgColor = { r: c.r / 255, g: c.g / 255, b: c.b / 255 };
            }
        }
    }
    return bgColor;
}

function sampleTextColor(canvas, tx, originalWidth, fontSize, str) {
    const ctx = canvas.getContext('2d');
    let textColor = { r: 0, g: 0, b: 0 };

    if (str.trim().length === 0) return textColor;

    const textStripY = Math.round(tx[5] - fontSize * 0.5);
    const textStripX = Math.max(0, Math.round(tx[4]));
    const textStripW = Math.min(Math.round(originalWidth), canvas.width - textStripX);
    if (textStripW > 0 && textStripY >= 0 && textStripY < canvas.height) {
        const textStripData = ctx.getImageData(textStripX, textStripY, textStripW, 1).data;
        const darkColorCounts = {};
        for (let i = 0; i < textStripData.length; i += 4) {
            const r = textStripData[i], g = textStripData[i+1], b = textStripData[i+2];
            const brightness = r * 0.299 + g * 0.587 + b * 0.114;
            const saturation = Math.max(r, g, b) - Math.min(r, g, b);
            if (brightness >= 200 && saturation < 50) continue;
            const qr = Math.round(r / 8) * 8;
            const qg = Math.round(g / 8) * 8;
            const qb = Math.round(b / 8) * 8;
            const key = `${qr},${qg},${qb}`;
            if (!darkColorCounts[key]) darkColorCounts[key] = { count: 0, r, g, b };
            darkColorCounts[key].count++;
        }
        let bestDarkCount = 0;
        for (const c of Object.values(darkColorCounts)) {
            if (c.count > bestDarkCount) {
                bestDarkCount = c.count;
                textColor = { r: c.r / 255, g: c.g / 255, b: c.b / 255 };
            }
        }
    }
    return textColor;
}

// ============================================
// Extract images from PDF page
// ============================================
async function extractImages(page, viewport, canvas, textLayerDiv, imageItems, pageNum) {
    const operatorList = await page.getOperatorList();
    const OPS = pdfjsLib.OPS;

    // Walk the operator list tracking the current transform matrix (CTM)
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
            const m = args;
            ctmStack[ctmStack.length - 1] = multiplyMatrices(currentCTM(), m);
        } else if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
            const ctm = currentCTM();

            // The image dimensions in CSS pixels come from the CTM
            const imgWidth = Math.sqrt(ctm[0] * ctm[0] + ctm[1] * ctm[1]);
            const imgHeight = Math.sqrt(ctm[2] * ctm[2] + ctm[3] * ctm[3]);

            // Skip tiny images (likely artifacts or patterns)
            if (imgWidth < 10 || imgHeight < 10) continue;

            // Position: CTM[4], CTM[5] is the bottom-left corner in PDF.js canvas coords
            // Since canvas Y increases downward and the image is drawn from bottom-left,
            // the CSS top = ctm[5] - imgHeight
            const cssLeft = ctm[4];
            const cssTop = ctm[5] - imgHeight;

            const bgColor = sampleImageBgColor(canvas, cssLeft, cssTop, imgWidth, imgHeight);

            // Capture the image pixels from the canvas for the overlay
            const ctx = canvas.getContext('2d');
            const sx = Math.max(0, Math.round(cssLeft));
            const sy = Math.max(0, Math.round(cssTop));
            const sw = Math.min(Math.round(imgWidth), canvas.width - sx);
            const sh = Math.min(Math.round(imgHeight), canvas.height - sy);

            let imageDataURL = '';
            if (sw > 0 && sh > 0) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = sw;
                tempCanvas.height = sh;
                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
                imageDataURL = tempCanvas.toDataURL();
            }

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

            const bgR = Math.round(bgColor.r * 255);
            const bgG = Math.round(bgColor.g * 255);
            const bgB = Math.round(bgColor.b * 255);
            overlay.style.setProperty('--bg-color', `rgb(${bgR}, ${bgG}, ${bgB})`);

            const imageItemData = {
                element: overlay,
                pageNum: pageNum,
                type: 'image',
                imageName: args[0],
                imageSeqIndex: imageSeqIndex,
                scale: viewport.scale,
                cssLeft: cssLeft,
                cssTop: cssTop,
                cssWidth: imgWidth,
                cssHeight: imgHeight,
                bgColor: bgColor,
                moveOffsetX: 0,
                moveOffsetY: 0,
                originalCovered: false,
                canvas: canvas,
            };

            imageSeqIndex++;

            imageItems.push(imageItemData);
            setupImageDrag(overlay, imageItemData, canvas);
            textLayerDiv.appendChild(overlay);
        }
    }
}

function sampleImageBgColor(canvas, x, y, w, h) {
    const ctx = canvas.getContext('2d');
    let bgColor = { r: 1, g: 1, b: 1 };

    // Sample a strip just above the image
    const stripY = Math.max(0, Math.round(y) - 2);
    const stripX = Math.max(0, Math.round(x));
    const stripW = Math.min(Math.round(w), canvas.width - stripX);
    if (stripW > 0 && stripY >= 0 && stripY < canvas.height) {
        const stripData = ctx.getImageData(stripX, stripY, stripW, 1).data;
        const colorCounts = {};
        for (let i = 0; i < stripData.length; i += 4) {
            const r = stripData[i], g = stripData[i+1], b = stripData[i+2];
            const qr = Math.round(r / 4) * 4;
            const qg = Math.round(g / 4) * 4;
            const qb = Math.round(b / 4) * 4;
            const key = `${qr},${qg},${qb}`;
            if (!colorCounts[key]) colorCounts[key] = { count: 0, r, g, b };
            colorCounts[key].count++;
        }
        let bestCount = 0;
        for (const c of Object.values(colorCounts)) {
            if (c.count > bestCount) {
                bestCount = c.count;
                bgColor = { r: c.r / 255, g: c.g / 255, b: c.b / 255 };
            }
        }
    }
    return bgColor;
}

// ============================================
// Drag-to-move and resize images
// ============================================
function coverOriginalImage(imageItemData, canvas) {
    if (imageItemData.originalCovered) return;
    const ctx = canvas.getContext('2d');
    const bgR = Math.round(imageItemData.bgColor.r * 255);
    const bgG = Math.round(imageItemData.bgColor.g * 255);
    const bgB = Math.round(imageItemData.bgColor.b * 255);
    ctx.fillStyle = `rgb(${bgR}, ${bgG}, ${bgB})`;
    ctx.fillRect(
        imageItemData.cssLeft,
        imageItemData.cssTop,
        imageItemData.cssWidth,
        imageItemData.cssHeight
    );
    imageItemData.originalCovered = true;
}

function setupImageDrag(overlay, imageItemData, canvas) {
    let dragState = null;

    overlay.addEventListener('dragstart', (e) => {
        e.preventDefault();
    });

    // Add resize handles
    const edges = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
    edges.forEach(edge => {
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
        // Don't start drag if clicking a resize handle
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
                coverOriginalImage(imageItemData, canvas);
            }

            if (dragState.moved) {
                overlay.style.left = (dragState.origLeft + dx) + 'px';
                overlay.style.top = (dragState.origTop + dy) + 'px';
            }
        };

        const onMouseUp = (e) => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            if (!dragState) return;

            if (dragState.moved) {
                const dx = e.clientX - dragState.startX;
                const dy = e.clientY - dragState.startY;
                imageItemData.moveOffsetX += dx;
                imageItemData.moveOffsetY += dy;
                overlay.classList.remove('dragging');
                overlay.classList.add('moved');
            }

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
    let resized = false;

    const aspectRatio = origWidth / origHeight;

    const onMouseMove = (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!resized && Math.abs(dx) + Math.abs(dy) > 3) {
            resized = true;
            overlay.classList.add('resizing');
            coverOriginalImage(imageItemData, canvas);
        }

        if (!resized) return;

        let newLeft = origLeft;
        let newTop = origTop;
        let newWidth = origWidth;
        let newHeight = origHeight;

        if (edge.includes('e')) newWidth = Math.max(20, origWidth + dx);
        if (edge.includes('w')) {
            newWidth = Math.max(20, origWidth - dx);
            newLeft = origLeft + (origWidth - newWidth);
        }
        if (edge.includes('s')) newHeight = Math.max(20, origHeight + dy);
        if (edge.includes('n')) {
            newHeight = Math.max(20, origHeight - dy);
            newTop = origTop + (origHeight - newHeight);
        }

        // Shift key: lock aspect ratio
        if (e.shiftKey) {
            if (edge === 'n' || edge === 's') {
                // Vertical-only edge: derive width from height
                newWidth = newHeight * aspectRatio;
                // Center horizontally relative to original
                newLeft = origLeft + (origWidth - newWidth) / 2;
            } else if (edge === 'e' || edge === 'w') {
                // Horizontal-only edge: derive height from width
                newHeight = newWidth / aspectRatio;
                // Center vertically relative to original
                newTop = origTop + (origHeight - newHeight) / 2;
            } else {
                // Corner: use whichever axis changed more to drive the ratio
                const widthDelta = Math.abs(newWidth - origWidth);
                const heightDelta = Math.abs(newHeight - origHeight);
                if (widthDelta > heightDelta) {
                    newHeight = newWidth / aspectRatio;
                } else {
                    newWidth = newHeight * aspectRatio;
                }
                // Recalculate position for corners that anchor to right/bottom
                if (edge.includes('w')) newLeft = origLeft + (origWidth - newWidth);
                if (edge.includes('n')) newTop = origTop + (origHeight - newHeight);
            }
            // Enforce minimums after aspect ratio adjustment
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

        if (resized) {
            const newLeft = parseFloat(overlay.style.left);
            const newTop = parseFloat(overlay.style.top);
            const newWidth = parseFloat(overlay.style.width);
            const newHeight = parseFloat(overlay.style.height);

            // Update move offsets based on position change
            imageItemData.moveOffsetX += (newLeft - origLeft);
            imageItemData.moveOffsetY += (newTop - origTop);

            // Store new dimensions
            imageItemData.resizedWidth = newWidth;
            imageItemData.resizedHeight = newHeight;

            overlay.classList.remove('resizing');
            overlay.classList.add('moved');
        }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

// ============================================
// Drag-to-move text
// ============================================
function setupDrag(span, textItemData, canvas, fontSize) {
    let dragState = null;

    // Prevent native browser drag (e.g. dragging selected text) from interfering
    span.addEventListener('dragstart', (e) => {
        e.preventDefault();
    });

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
            spanW: spanRect.width,
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

                // Cover the original position on the canvas immediately
                if (!textItemData.originalCovered) {
                    const ctx = canvas.getContext('2d');
                    const bgR = Math.round(textItemData.bgColor.r * 255);
                    const bgG = Math.round(textItemData.bgColor.g * 255);
                    const bgB = Math.round(textItemData.bgColor.b * 255);
                    ctx.fillStyle = `rgb(${bgR}, ${bgG}, ${bgB})`;
                    const coverX = textItemData.cssLeft;
                    const coverY = textItemData.cssTop - fontSize * 0.4;
                    const coverW = dragState.spanW + 8;
                    const coverH = fontSize * 1.5;
                    ctx.fillRect(coverX, coverY, coverW, coverH);
                    textItemData.originalCovered = true;
                }

                // Text color is handled by the .dragging/.moved CSS classes via --text-color
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
                const dx = e.clientX - dragState.startX;
                const dy = e.clientY - dragState.startY;
                textItemData.moveOffsetX += dx;
                textItemData.moveOffsetY += dy;
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
