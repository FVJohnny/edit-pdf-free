// PDF.js worker setup
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

let pdfDoc = null;
let pdfBytes = null;
let textItems = [];
let originalFileName = '';

const pdfInput = document.getElementById('pdfInput');
const saveBtn = document.getElementById('saveBtn');
const pdfViewer = document.getElementById('pdfViewer');
const uploadZone = document.getElementById('uploadZone');
const toolbar = document.getElementById('toolbar');
const fileNameEl = document.getElementById('fileName');
const newFileBtn = document.getElementById('newFileBtn');
const placeholder = document.getElementById('placeholder');

// ============================================
// Scroll-triggered animations
// ============================================
const animateElements = document.querySelectorAll('[data-animate]');

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

animateElements.forEach(el => observer.observe(el));

// ============================================
// Drag and drop (full page)
// ============================================
let dragCounter = 0;

document.addEventListener('dragover', (e) => {
    e.preventDefault();
});

document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    document.body.classList.add('drag-over-page');
});

document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
        document.body.classList.remove('drag-over-page');
    }
});

document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    document.body.classList.remove('drag-over-page');
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
        loadPDF(file);
        document.getElementById('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (file) {
        showToast("This is a PDF editor. What part of that was unclear?");
    }
});

// ============================================
// File input
// ============================================
pdfInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    loadPDF(file);
});

// Open new file button
newFileBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) loadPDF(file);
    };
    input.click();
});

// ============================================
// Load PDF
// ============================================
async function loadPDF(file) {
    try {
        originalFileName = file.name.replace(/\.pdf$/i, '');

        const arrayBuffer = await file.arrayBuffer();
        pdfBytes = new Uint8Array(arrayBuffer);

        const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
        pdfDoc = await loadingTask.promise;

        // Update UI
        uploadZone.classList.add('hidden');
        toolbar.classList.add('visible');
        fileNameEl.textContent = file.name;
        saveBtn.disabled = false;

        await renderPDF();
    } catch (error) {
        console.error('Error loading PDF:', error);
        alert('Error loading PDF file. Please try another file.');
    }
}

// ============================================
// Render PDF pages
// ============================================
async function renderPDF() {
    pdfViewer.innerHTML = '';
    textItems = [];

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

            let fontFamily = 'Calibri, Arial, Helvetica, sans-serif';
            let fontWeight = '400';
            let fontStyle = 'normal';
            const fontName = item.fontName.toLowerCase();

            // Check PDF.js style info for this font (includes fontFamily and weight flags)
            const styleInfo = textContent.styles && textContent.styles[item.fontName];

            // Try to get the actual font name from PDF.js common objects
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

            // Detect bold from fontName, actual PDF font name, or styleInfo
            if (fontName.includes('bold') || fontNameToCheck.includes('bold') ||
                (styleInfo && styleInfo.fontWeight && styleInfo.fontWeight >= 700)) {
                fontWeight = '700';
            } else if (fontName.includes('light') || fontNameToCheck.includes('light')) {
                fontWeight = '300';
            } else if (fontName.includes('medium') || fontNameToCheck.includes('medium')) {
                fontWeight = '500';
            }

            // Detect italic from fontName, actual PDF font name, or styleInfo
            if (fontName.includes('italic') || fontName.includes('oblique') ||
                fontNameToCheck.includes('italic') || fontNameToCheck.includes('oblique') ||
                (styleInfo && styleInfo.italic)) {
                fontStyle = 'italic';
                span.style.fontStyle = 'italic';
            }

            span.style.fontFamily = fontFamily;
            span.style.fontWeight = fontWeight;
            span.style.transformOrigin = 'left bottom';
            span.style.pointerEvents = 'auto';
            span.style.letterSpacing = '-0.02em';
            span.style.textRendering = 'geometricPrecision';
            span.style.webkitFontSmoothing = 'antialiased';
            span.style.mozOsxFontSmoothing = 'grayscale';

            const originalWidth = item.width * viewport.scale;

            // Sample background color from the canvas behind this text.
            // Scan a horizontal strip across the text area and find the dominant
            // (most frequent) color, ignoring very dark pixels which are likely text.
            const ctx = canvas.getContext('2d');
            let bgColor = { r: 1, g: 1, b: 1 }; // default white

            const stripY = Math.round(tx[5]);  // just below baseline where bg is visible
            const stripX = Math.max(0, Math.round(tx[4]));
            const stripW = Math.min(Math.round(originalWidth), canvas.width - stripX);
            if (stripW > 0 && stripY >= 0 && stripY < canvas.height) {
                const stripData = ctx.getImageData(stripX, stripY, stripW, 1).data;
                const colorCounts = {};
                for (let i = 0; i < stripData.length; i += 4) {
                    const r = stripData[i], g = stripData[i+1], b = stripData[i+2];
                    // Skip very dark pixels (likely text) and nearly-dark pixels
                    const brightness = r * 0.299 + g * 0.587 + b * 0.114;
                    if (brightness < 80) continue;
                    // Quantize to reduce noise (group similar colors)
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

            // Sample text color from the canvas (most common dark color in the text area)
            let textColor = { r: 0, g: 0, b: 0 }; // default black
            if (item.str.trim().length > 0) {
                const textStripY = Math.round(tx[5] - fontSize * 0.5);
                const textStripX = Math.max(0, Math.round(tx[4]));
                const textStripW = Math.min(Math.round(originalWidth), canvas.width - textStripX);
                if (textStripW > 0 && textStripY >= 0 && textStripY < canvas.height) {
                    const textStripData = ctx.getImageData(textStripX, textStripY, textStripW, 1).data;
                    const darkColorCounts = {};
                    for (let i = 0; i < textStripData.length; i += 4) {
                        const r = textStripData[i], g = textStripData[i+1], b = textStripData[i+2];
                        const brightness = r * 0.299 + g * 0.587 + b * 0.114;
                        // Only consider dark-ish pixels (text) or strongly colored pixels
                        const saturation = Math.max(r, g, b) - Math.min(r, g, b);
                        if (brightness >= 200 && saturation < 50) continue; // skip light bg pixels
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
            }

            // Store bg color as CSS custom property for hover/editing states
            const bgR = Math.round(bgColor.r * 255);
            const bgG = Math.round(bgColor.g * 255);
            const bgB = Math.round(bgColor.b * 255);
            span.style.setProperty('--bg-color', `rgb(${bgR}, ${bgG}, ${bgB})`);

            // Set text color for editing states
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
                textColor: textColor
            };

            // Track movement offset (in CSS/canvas pixels)
            textItemData.moveOffsetX = 0;
            textItemData.moveOffsetY = 0;
            textItemData.originalCovered = false;
            // Store original CSS position for covering
            textItemData.cssLeft = parseFloat(span.style.left);
            textItemData.cssTop = parseFloat(span.style.top);

            textItems.push(textItemData);

            // Drag to move, click to edit
            let dragState = null;

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
                    }

                    if (dragState.moved) {
                        span.style.left = (dragState.origLeft + dx) + 'px';
                        span.style.top = (dragState.origTop + dy) + 'px';
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

                        // Cover the original position on the canvas only once
                        if (!textItemData.originalCovered) {
                            const ctx = canvas.getContext('2d');
                            const bgR = Math.round(textItemData.bgColor.r * 255);
                            const bgG = Math.round(textItemData.bgColor.g * 255);
                            const bgB = Math.round(textItemData.bgColor.b * 255);
                            ctx.fillStyle = `rgb(${bgR}, ${bgG}, ${bgB})`;
                            // cssLeft/cssTop match canvas buffer coordinates
                            // Offset Y up by fontSize*0.4 because cssTop is near the baseline,
                            // but the text renders above it
                            const coverX = textItemData.cssLeft;
                            const coverY = textItemData.cssTop - fontSize * 0.4;
                            const coverW = dragState.spanW + 8;
                            const coverH = fontSize * 1.5;
                            ctx.fillRect(coverX, coverY, coverW, coverH);
                            textItemData.originalCovered = true;
                        }

                        // Show text with no background (transparent overlay)
                        span.style.color = span.style.getPropertyValue('--text-color') || 'black';

                        // Show format toolbar after move
                        showFormatToolbar(textItemData);
                    } else {
                        // It was a click, not a drag — edit the text
                        makeEditable(textItemData);
                    }

                    dragState = null;
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            textLayerDiv.appendChild(span);
        });

        pageContainer.appendChild(textLayerDiv);
        pdfViewer.appendChild(pageContainer);
    }
}

// ============================================
// Format toolbar
// ============================================
const formatToolbar = document.getElementById('formatToolbar');
const fmtBold = document.getElementById('fmtBold');
const fmtItalic = document.getElementById('fmtItalic');
const fmtSizeDown = document.getElementById('fmtSizeDown');
const fmtSizeUp = document.getElementById('fmtSizeUp');
const fmtSizeLabel = document.getElementById('fmtSizeLabel');
const fmtColor = document.getElementById('fmtColor');

let activeTextItem = null;

function showFormatToolbar(textItem) {
    activeTextItem = textItem;
    const el = textItem.element;
    const rect = el.getBoundingClientRect();

    // Make visible off-screen first to measure, then position
    formatToolbar.style.left = '-9999px';
    formatToolbar.style.top = '-9999px';
    formatToolbar.style.display = 'flex';

    // Force reflow to get accurate measurements
    const tbRect = formatToolbar.getBoundingClientRect();

    let left = rect.left + rect.width / 2 - tbRect.width / 2;
    let top = rect.top - tbRect.height - 8;

    // Keep within viewport
    if (left < 8) left = 8;
    if (left + tbRect.width > window.innerWidth - 8) left = window.innerWidth - tbRect.width - 8;
    if (top < 8) top = rect.bottom + 8; // flip below if no room above

    formatToolbar.style.left = left + 'px';
    formatToolbar.style.top = top + 'px';

    // Sync toolbar state with textItem
    updateToolbarState(textItem);
}

function hideFormatToolbar() {
    formatToolbar.style.display = 'none';
    activeTextItem = null;
}

function updateToolbarState(textItem) {
    const currentWeight = textItem.fontWeightOverride ?? textItem.fontWeight;
    const currentStyle = textItem.fontStyleOverride ?? textItem.fontStyle;
    const currentSize = textItem.fontSizeOverride ?? Math.round(parseFloat(textItem.element.style.fontSize));
    const tc = textItem.textColorOverride ?? textItem.textColor;

    fmtBold.classList.toggle('active', currentWeight === '700');
    fmtItalic.classList.toggle('active', currentStyle === 'italic');
    fmtSizeLabel.textContent = currentSize;

    // Convert rgb 0-1 to hex
    const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
    fmtColor.value = `#${toHex(tc.r)}${toHex(tc.g)}${toHex(tc.b)}`;
}

function applyFormat(textItem) {
    const el = textItem.element;
    const weight = textItem.fontWeightOverride ?? textItem.fontWeight;
    const style = textItem.fontStyleOverride ?? textItem.fontStyle;
    const size = textItem.fontSizeOverride ?? Math.round(parseFloat(el.style.fontSize));

    el.style.fontWeight = weight;
    el.style.fontStyle = style;
    el.style.fontSize = size + 'px';

    if (textItem.textColorOverride) {
        const tc = textItem.textColorOverride;
        const r = Math.round(tc.r * 255), g = Math.round(tc.g * 255), b = Math.round(tc.b * 255);
        el.style.setProperty('--text-color', `rgb(${r}, ${g}, ${b})`);
    }

    el.classList.add('modified');
    updateToolbarState(textItem);
}

// Prevent toolbar clicks from blurring the editable text
formatToolbar.addEventListener('mousedown', (e) => {
    e.preventDefault();
});

// Hide toolbar when clicking outside of it and outside editable text
document.addEventListener('mousedown', (e) => {
    if (!activeTextItem) return;
    if (formatToolbar.contains(e.target)) return;
    if (activeTextItem.element.contains(e.target)) return;
    hideFormatToolbar();
});

fmtBold.addEventListener('click', () => {
    if (!activeTextItem) return;
    const current = activeTextItem.fontWeightOverride ?? activeTextItem.fontWeight;
    activeTextItem.fontWeightOverride = current === '700' ? '400' : '700';
    applyFormat(activeTextItem);
});

fmtItalic.addEventListener('click', () => {
    if (!activeTextItem) return;
    const current = activeTextItem.fontStyleOverride ?? activeTextItem.fontStyle;
    activeTextItem.fontStyleOverride = current === 'italic' ? 'normal' : 'italic';
    applyFormat(activeTextItem);
});

fmtSizeDown.addEventListener('click', () => {
    if (!activeTextItem) return;
    const current = activeTextItem.fontSizeOverride ?? Math.round(parseFloat(activeTextItem.element.style.fontSize));
    activeTextItem.fontSizeOverride = Math.max(6, current - 1);
    applyFormat(activeTextItem);
});

fmtSizeUp.addEventListener('click', () => {
    if (!activeTextItem) return;
    const current = activeTextItem.fontSizeOverride ?? Math.round(parseFloat(activeTextItem.element.style.fontSize));
    activeTextItem.fontSizeOverride = current + 1;
    applyFormat(activeTextItem);
});

fmtColor.addEventListener('input', () => {
    if (!activeTextItem) return;
    const hex = fmtColor.value;
    activeTextItem.textColorOverride = {
        r: parseInt(hex.slice(1, 3), 16) / 255,
        g: parseInt(hex.slice(3, 5), 16) / 255,
        b: parseInt(hex.slice(5, 7), 16) / 255
    };
    applyFormat(activeTextItem);
});

// ============================================
// Make text editable inline
// ============================================
function makeEditable(textItem) {
    if (textItem.element.contentEditable === 'true') return;

    document.querySelectorAll('.text-item').forEach(el => {
        el.contentEditable = false;
        el.classList.remove('editing');
    });

    textItem.element.style.minWidth = textItem.originalWidth + 'px';
    textItem.element.contentEditable = true;
    textItem.element.classList.add('editing');
    textItem.element.focus();

    const range = document.createRange();
    range.selectNodeContents(textItem.element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    showFormatToolbar(textItem);

    const finishEditing = () => {
        textItem.element.contentEditable = false;
        textItem.element.classList.remove('editing');
        textItem.currentText = textItem.element.textContent;
        const isMoved = textItem.moveOffsetX !== 0 || textItem.moveOffsetY !== 0;
        const hasOverrides = textItem.fontWeightOverride || textItem.fontStyleOverride ||
                             textItem.fontSizeOverride || textItem.textColorOverride;
        if (textItem.currentText !== textItem.originalText || isMoved || hasOverrides) {
            textItem.element.classList.add('modified');
            textItem.element.style.minWidth = textItem.originalWidth + 'px';
        } else {
            textItem.element.classList.remove('modified');
            textItem.element.style.minWidth = '';
        }
        hideFormatToolbar();
    };

    textItem.element.addEventListener('blur', finishEditing, { once: true });

    textItem.element.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            textItem.element.blur();
        }
        if (e.key === 'Escape') {
            textItem.element.textContent = textItem.currentText;
            textItem.element.blur();
        }
    }, { once: true });
}

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
// Save modified PDF
// ============================================
saveBtn.addEventListener('click', async () => {
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
            if (item.currentText !== item.originalText || isMoved || hasOverrides) {
                pageTexts[item.pageNum].push(item);
            }
        });

        // Parse ToUnicode CMap and get font resource info.
        // Builds a reverse mapping: Unicode codepoint -> glyph code (hex string)
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

                // Parse the ToUnicode CMap to build reverse mapping
                const toUnicodeRef = fontObj.get(PDFLib.PDFName.of('ToUnicode'));
                if (!toUnicodeRef) throw new Error('no ToUnicode CMap');

                const toUnicodeStream = pdfLibDoc.context.lookup(toUnicodeRef) || toUnicodeRef;
                if (!toUnicodeStream) throw new Error('cannot resolve ToUnicode');

                // Get CMap data — try decompressed first, then raw
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

                // Decompress if still zlib compressed
                if (cmapBytes[0] === 0x78) {
                    cmapBytes = await decompressZlib(cmapBytes);
                }

                const cmapText = new TextDecoder('latin1').decode(cmapBytes);

                const unicodeToGlyph = {};
                let match;

                // Parse bfchar: <glyphCode> <unicodeValue>
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

                // Parse bfrange: <startGlyph> <endGlyph> <startUnicode>
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

            // Collect all unique characters needed across all modified items on this page,
            // grouped by font, so we know which characters the subset font must support
            const charsByFont = {};
            for (const item of items) {
                const cleanText = item.currentText.replace(/[\r\n]/g, ' ');
                if (!charsByFont[item.fontName]) charsByFont[item.fontName] = new Set();
                for (const ch of cleanText) charsByFont[item.fontName].add(ch);
            }

            for (const item of items) {
                const origX = item.transform[4];
                const origY = item.transform[5];
                const origFontSize = Math.sqrt(item.transform[0] * item.transform[0] + item.transform[1] * item.transform[1]);

                // Use overridden font size if set, converting from CSS px back to PDF units
                const fontSize = item.fontSizeOverride
                    ? item.fontSizeOverride / item.scale
                    : origFontSize;

                // Convert CSS pixel offset to PDF units
                const moveX = (item.moveOffsetX || 0) / item.scale;
                const moveY = -(item.moveOffsetY || 0) / item.scale; // CSS Y is inverted vs PDF Y

                const newX = origX + moveX;
                const newY = origY + moveY;

                const cleanCurrentText = item.currentText.replace(/[\r\n]/g, ' ');

                // Use fallback font for width measurement
                const fallbackFont = getFallbackFont(item);
                const originalPdfWidth = item.width;
                const newTextWidth = fallbackFont.widthOfTextAtSize(cleanCurrentText, fontSize);
                const coverWidth = Math.max(originalPdfWidth, newTextWidth) + 6;

                // Draw background rectangle at ORIGINAL position to cover old text
                const bg = item.bgColor || { r: 1, g: 1, b: 1 };
                page.drawRectangle({
                    x: origX - 2,
                    y: origY - (origFontSize * 0.3),
                    width: coverWidth,
                    height: origFontSize * 1.4,
                    color: PDFLib.rgb(bg.r, bg.g, bg.b),
                });

                // Try to use the original font via raw content stream with CMap encoding
                // Draw text at NEW position (original + move offset)
                // Skip original font if weight/style was changed (need different font variant)
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
        URL.revokeObjectURL(url);

        showToast('Saved as ' + finalFilename);
    } catch (error) {
        console.error('Error saving PDF:', error);
        showToast('Error saving PDF. Please try again.');
    }
});

// ============================================
// Toast notification
// ============================================
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================
// Custom prompt modal
// ============================================
function showPrompt(title, label, defaultValue) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        overlay.innerHTML = `
            <div class="modal">
                <h3 class="modal-title">${title}</h3>
                <label class="modal-label">${label}</label>
                <div class="modal-input-row">
                    <input type="text" class="modal-input" value="${defaultValue}" />
                    <span class="modal-ext">.pdf</span>
                </div>
                <div class="modal-actions">
                    <button class="modal-btn modal-btn--cancel">Cancel</button>
                    <button class="modal-btn modal-btn--confirm">Save</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));

        const input = overlay.querySelector('.modal-input');
        input.focus();
        input.select();

        const close = (value) => {
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 300);
            resolve(value);
        };

        overlay.querySelector('.modal-btn--cancel').addEventListener('click', () => close(null));
        overlay.querySelector('.modal-btn--confirm').addEventListener('click', () => close(input.value));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') close(input.value);
            if (e.key === 'Escape') close(null);
        });
    });
}

// ============================================
// Smooth scroll for anchor links
// ============================================
document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(link.getAttribute('href'));
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
});
