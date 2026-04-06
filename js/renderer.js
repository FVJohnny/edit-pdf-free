import { showFormatToolbar, repositionToolbar } from './toolbar.js';
import { makeEditable } from './editor.js';

// ============================================
// Render PDF pages
// ============================================
export async function renderPDF(pdfDoc, pdfViewer, textItems) {
    pdfViewer.innerHTML = '';
    textItems.length = 0;

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
                cssTop: parseFloat(span.style.top)
            };

            textItems.push(textItemData);

            setupDrag(span, textItemData, canvas, fontSize);

            textLayerDiv.appendChild(span);
        });

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

                // Show text with no background (transparent overlay)
                span.style.color = span.style.getPropertyValue('--text-color') || 'black';
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
