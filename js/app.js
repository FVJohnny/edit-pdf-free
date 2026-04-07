import { initDragDrop, showToast } from './ui.js';
import { renderPDF, setupImageDrag, setupTextDrag } from './renderer.js';
import { makeEditable } from './editor.js';
import { savePDF } from './saver.js';
import { undo, redo, onHistoryChange, clearHistory, recordAction } from './history.js';
import { getActiveTextItem } from './toolbar.js';
import { MAX_IMPORT_SCALE } from './utils/constants.js';

// PDF.js worker setup
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

let pdfDoc = null;
let pdfBytes = null;
let textItems = [];
let imageItems = [];
let originalFileName = '';

const pdfInput = document.getElementById('pdfInput');
const saveBtn = document.getElementById('saveBtn');
const pdfViewer = document.getElementById('pdfViewer');
const pdfContainer = document.querySelector('.pdf-container');
const uploadZone = document.getElementById('uploadZone');
const toolbar = document.getElementById('toolbar');
const fileNameEl = document.getElementById('fileName');
const newFileBtn = document.getElementById('newFileBtn');
const pdfTools = document.getElementById('pdfTools');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const addTextBtn = document.getElementById('addTextBtn');
const importImageBtn = document.getElementById('importImageBtn');
const imageInput = document.getElementById('imageInput');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomLabel = document.getElementById('zoomLabel');

// ============================================
// Undo / Redo
// ============================================
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

onHistoryChange(({ canUndo, canRedo }) => {
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
});

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
    }

    // Delete/Backspace: delete selected text or image (only when not editing text)
    if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't interfere with text editing
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.contentEditable === 'true' || activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;

        // Try text delete button
        const textItem = getActiveTextItem();
        if (textItem) {
            e.preventDefault();
            document.getElementById('fmtDelete').click();
            return;
        }

        // Try image delete button
        const imgDeleteBtn = document.getElementById('imgDelete');
        const imgToolbar = document.getElementById('imageToolbar');
        if (imgToolbar && imgToolbar.style.display !== 'none') {
            e.preventDefault();
            imgDeleteBtn.click();
        }
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
// Drag and drop
// ============================================
initDragDrop(loadPDF);

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

        uploadZone.classList.add('hidden');
        toolbar.classList.add('visible');
        pdfTools.classList.add('visible');
        pdfContainer.classList.add('visible');
        fileNameEl.textContent = file.name;
        saveBtn.disabled = false;

        clearHistory();
        await renderPDF(pdfDoc, pdfViewer, textItems, imageItems);
    } catch (error) {
        console.error('Error loading PDF:', error);
        alert('Error loading PDF file. Please try another file.');
    }
}

// ============================================
// Add Text
// ============================================
let addTextMode = false;

addTextBtn.addEventListener('click', () => {
    addTextMode = !addTextMode;
    addTextBtn.classList.toggle('active', addTextMode);
    pdfViewer.classList.toggle('placement-mode', addTextMode);
    if (addTextMode) {
        showToast('Click on the PDF to place new text');
    }
});

pdfViewer.addEventListener('click', (e) => {
    if (!addTextMode) return;

    // Find which page container was clicked
    const pageContainers = pdfViewer.querySelectorAll(':scope > div');
    let targetPage = null;
    let pageNum = 0;
    for (let i = 0; i < pageContainers.length; i++) {
        if (pageContainers[i].contains(e.target)) {
            targetPage = pageContainers[i];
            pageNum = i + 1;
            break;
        }
    }
    if (!targetPage) return;

    const canvas = targetPage.querySelector('canvas');
    const textLayer = targetPage.querySelector('.custom-text-layer');
    if (!canvas || !textLayer) return;

    // Convert click position to canvas coordinates
    const canvasRect = canvas.getBoundingClientRect();
    const cssLeft = e.clientX - canvasRect.left;
    const cssTop = e.clientY - canvasRect.top;

    const scale = canvas.width / canvas.getBoundingClientRect().width;
    const canvasX = cssLeft * scale;
    const canvasY = cssTop * scale;

    const defaultFontSize = 16;
    const pdfScale = canvas.width / 612; // approximate viewport.scale (letter width = 612pt)

    const span = document.createElement('span');
    span.textContent = 'New text';
    span.className = 'editable-text modified';
    span.style.position = 'absolute';
    span.style.left = canvasX + 'px';
    span.style.top = canvasY + 'px';
    span.style.fontSize = defaultFontSize + 'px';
    span.style.lineHeight = '1';
    span.style.fontFamily = 'Helvetica, Arial, sans-serif';
    span.style.fontWeight = '400';
    span.style.transformOrigin = 'left bottom';
    span.style.pointerEvents = 'auto';
    span.style.letterSpacing = '-0.02em';
    span.style.textRendering = 'geometricPrecision';
    span.style.webkitFontSmoothing = 'antialiased';
    span.style.mozOsxFontSmoothing = 'grayscale';
    span.style.setProperty('--bg-color', 'rgb(255, 255, 255)');
    span.style.setProperty('--text-color', 'rgb(0, 0, 0)');

    /** @type {TextItem} */
    const textItemData = {
        element: span,
        pageNum,
        originalText: '',
        currentText: 'New text',
        index: textItems.length,
        // Build a transform matrix: [fontSize, 0, 0, fontSize, x, y] in PDF coordinates
        transform: [defaultFontSize / pdfScale, 0, 0, defaultFontSize / pdfScale, canvasX / pdfScale, (canvas.height - canvasY) / pdfScale],
        width: 0,
        height: defaultFontSize / pdfScale,
        fontName: '',
        fontFamily: 'Helvetica, Arial, sans-serif',
        fontWeight: '400',
        fontStyle: 'normal',
        scale: pdfScale,
        originalWidth: 0,
        bgColor: { r: 1, g: 1, b: 1 },
        textColor: { r: 0, g: 0, b: 0 },
        moveOffsetX: 0,
        moveOffsetY: 0,
        originalCovered: true, // No original to cover
        cssLeft: canvasX,
        cssTop: canvasY,
        canvas,
        renderedFontSize: defaultFontSize,
    };

    textItems.push(textItemData);
    setupTextDrag(span, textItemData, canvas);
    textLayer.appendChild(span);

    recordAction({
        undo() { span.style.display = 'none'; textItemData.deleted = true; },
        redo() { span.style.display = ''; textItemData.deleted = false; },
    });

    // Exit placement mode and immediately make the text editable
    addTextMode = false;
    addTextBtn.classList.remove('active');
    pdfViewer.classList.remove('placement-mode');
    makeEditable(textItemData);
});

// ============================================
// Import Image
// ============================================
importImageBtn.addEventListener('click', () => {
    imageInput.click();
});

imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    importImage(file);
    imageInput.value = '';
});

async function importImage(file) {
    const { page: targetPage, pageNum } = findVisiblePage();
    if (!targetPage) return;

    const canvas = targetPage.querySelector('canvas');
    const textLayer = targetPage.querySelector('.custom-text-layer');
    if (!canvas || !textLayer) return;

    // Load the image to get its natural dimensions
    const imageDataURL = await readFileAsDataURL(file);
    const img = await loadImage(imageDataURL);

    // Scale to fit within the page (max MAX_IMPORT_SCALE of page dimensions)
    const { width: imgWidth, height: imgHeight } = scaleToFit(
        img.naturalWidth, img.naturalHeight,
        canvas.width * MAX_IMPORT_SCALE,
        canvas.height * MAX_IMPORT_SCALE
    );

    // Place centered horizontally, near the top of the visible area
    const viewerRect = pdfViewer.getBoundingClientRect();
    const pageRect = targetPage.getBoundingClientRect();
    const visibleTopOnPage = viewerRect.top - pageRect.top;
    const cssLeft = (canvas.width - imgWidth) / 2;
    const cssTop = Math.max(10, visibleTopOnPage + 20);

    // Compute scale factor (canvas pixels per PDF point) — same as renderPDF uses
    const pdfPage = await pdfDoc.getPage(pageNum);
    const scale = canvas.width / pdfPage.getViewport({ scale: 1 }).width;

    // Create the draggable overlay
    const overlay = document.createElement('div');
    overlay.className = 'draggable-image moved';
    overlay.style.position = 'absolute';
    overlay.style.left = cssLeft + 'px';
    overlay.style.top = cssTop + 'px';
    overlay.style.width = imgWidth + 'px';
    overlay.style.height = imgHeight + 'px';
    overlay.style.pointerEvents = 'auto';
    overlay.style.backgroundImage = `url(${imageDataURL})`;
    overlay.style.backgroundSize = '100% 100%';

    /** @type {ImageItem} see js/types.js */
    const imageItemData = {
        element: overlay,
        pageNum,
        type: 'imported-image',
        scale,
        cssLeft,
        cssTop,
        cssWidth: imgWidth,
        cssHeight: imgHeight,
        bgColor: { r: 1, g: 1, b: 1 },
        moveOffsetX: 0,
        moveOffsetY: 0,
        originalCovered: false,
        canvas,
        importedImageBytes: new Uint8Array(await file.arrayBuffer()),
        importedImageType: file.type,
        importedImageDataURL: imageDataURL,
    };

    imageItems.push(imageItemData);
    setupImageDrag(overlay, imageItemData, canvas);
    textLayer.appendChild(overlay);

    recordAction({
        undo() { overlay.style.display = 'none'; imageItemData.deleted = true; },
        redo() { overlay.style.display = ''; imageItemData.deleted = false; },
    });

    showToast('Image imported — drag to position, resize as needed');
}

// ============================================
// Import helpers
// ============================================

/** Find the page container most visible in the viewer's scroll viewport. */
function findVisiblePage() {
    const pageContainers = pdfViewer.querySelectorAll(':scope > div');
    if (pageContainers.length === 0) return { page: null, pageNum: 0 };

    const viewerMidY = pdfViewer.getBoundingClientRect().top + pdfViewer.getBoundingClientRect().height / 2;
    for (let i = 0; i < pageContainers.length; i++) {
        const rect = pageContainers[i].getBoundingClientRect();
        if (rect.top <= viewerMidY && rect.bottom >= viewerMidY) {
            return { page: pageContainers[i], pageNum: i + 1 };
        }
    }
    return { page: pageContainers[0], pageNum: 1 };
}

function readFileAsDataURL(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
    });
}

function loadImage(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = src;
    });
}

/** Scale dimensions to fit within maxWidth/maxHeight while preserving aspect ratio. */
function scaleToFit(width, height, maxWidth, maxHeight) {
    if (width > maxWidth) {
        height *= maxWidth / width;
        width = maxWidth;
    }
    if (height > maxHeight) {
        width *= maxHeight / height;
        height = maxHeight;
    }
    return { width, height };
}

// ============================================
// Zoom
// ============================================
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
let currentZoom = 1;

function applyZoom() {
    zoomLabel.textContent = Math.round(currentZoom * 100) + '%';
    const pages = pdfViewer.querySelectorAll(':scope > div');
    for (const page of pages) {
        page.style.transformOrigin = 'top center';
        page.style.transform = currentZoom === 1 ? '' : `scale(${currentZoom})`;
        // Adjust margin to account for scaled size so pages don't overlap
        const canvas = page.querySelector('canvas');
        if (canvas) {
            const scaledHeight = canvas.height * currentZoom;
            const originalHeight = canvas.height;
            page.style.marginBottom = (scaledHeight - originalHeight + 20) + 'px';
        }
    }
}

zoomInBtn.addEventListener('click', () => {
    currentZoom = Math.min(ZOOM_MAX, Math.round((currentZoom + ZOOM_STEP) * 10) / 10);
    applyZoom();
});

zoomOutBtn.addEventListener('click', () => {
    currentZoom = Math.max(ZOOM_MIN, Math.round((currentZoom - ZOOM_STEP) * 10) / 10);
    applyZoom();
});

// ============================================
// Save PDF
// ============================================
saveBtn.addEventListener('click', () => {
    savePDF(pdfBytes, textItems, imageItems, originalFileName);
});
