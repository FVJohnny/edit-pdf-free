import { initDragDrop, showToast } from './ui.js';
import { renderPDF, setupImageDrag, setupTextDrag, createBlankPageContainer } from './renderer.js';
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
let addedPages = []; // [{ position: 'start'|'end', width, height, container }]
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
const addPageBeforeBtn = document.getElementById('addPageBeforeBtn');
const addPageAfterBtn = document.getElementById('addPageAfterBtn');
const pageIndicator = document.getElementById('pageIndicator');

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
        addedPages.length = 0;
        await renderPDF(pdfDoc, pdfViewer, textItems, imageItems);
        updatePageIndicator();
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

pdfViewer.addEventListener('click', async (e) => {
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
    // PDF-to-canvas scale: derive from the page's PDF width when available,
    // falling back to letter-width (612pt) for legacy paths.
    let pdfWidthPts = 612;
    if (targetPage.dataset.blankPage === 'true') {
        pdfWidthPts = parseFloat(targetPage.dataset.pdfWidth) || 612;
    } else if (pdfDoc) {
        try {
            // Map DOM index → original PDF page number by counting non-blank containers up to target.
            const containers = Array.from(pdfViewer.querySelectorAll(':scope > div'));
            let originalIdx = -1;
            for (let i = 0; i <= containers.indexOf(targetPage); i++) {
                if (containers[i].dataset.blankPage !== 'true') originalIdx++;
            }
            if (originalIdx >= 0 && originalIdx < pdfDoc.numPages) {
                const pdfPage = await pdfDoc.getPage(originalIdx + 1);
                pdfWidthPts = pdfPage.getViewport({ scale: 1 }).width;
            }
        } catch (_) {}
    }
    const pdfScale = canvas.width / pdfWidthPts;

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

    // Compute scale factor (canvas pixels per PDF point). For original pages, derive
    // from the underlying PDF page; for blank pages, use the dimensions stored on the container.
    let scale;
    if (targetPage.dataset.blankPage === 'true') {
        scale = canvas.width / parseFloat(targetPage.dataset.pdfWidth);
    } else {
        const pdfPage = await pdfDoc.getPage(pageNum);
        scale = canvas.width / pdfPage.getViewport({ scale: 1 }).width;
    }

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
// Page indicator (current / total)
// ============================================
function updatePageIndicator() {
    const containers = pdfViewer.querySelectorAll(':scope > div');
    const total = containers.length;
    if (total === 0) {
        pageIndicator.textContent = 'Page 0 / 0';
        return;
    }
    // Pick the page whose vertical midpoint is closest to the viewer's midpoint.
    const viewerRect = pdfViewer.getBoundingClientRect();
    const viewerMidY = viewerRect.top + viewerRect.height / 2;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < total; i++) {
        const r = containers[i].getBoundingClientRect();
        const mid = r.top + r.height / 2;
        const dist = Math.abs(mid - viewerMidY);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    pageIndicator.textContent = `Page ${bestIdx + 1} / ${total}`;
}

pdfViewer.addEventListener('scroll', updatePageIndicator);
window.addEventListener('resize', updatePageIndicator);

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
// Add blank page
// ============================================
async function addBlankPage(position) {
    // Reference an existing page to inherit dimensions. Prefer first page for 'start',
    // last page for 'end'. Use the original PDF page (not a previously-added blank)
    // so dimensions match the document.
    if (!pdfDoc || pdfDoc.numPages === 0) return;
    const refPageNum = position === 'start' ? 1 : pdfDoc.numPages;
    const refPdfPage = await pdfDoc.getPage(refPageNum);
    const refViewport = refPdfPage.getViewport({ scale: 1 });
    const pdfWidth = refViewport.width;
    const pdfHeight = refViewport.height;

    // Match the canvas size of the original pages (rendered at viewer's available content width)
    const viewerStyle = getComputedStyle(pdfViewer);
    const horizontalPadding = parseFloat(viewerStyle.paddingLeft) + parseFloat(viewerStyle.paddingRight);
    const availableWidth = pdfViewer.clientWidth - horizontalPadding - 2;
    const canvasScale = availableWidth / pdfWidth;
    const canvasWidth = pdfWidth * canvasScale;
    const canvasHeight = pdfHeight * canvasScale;

    const container = createBlankPageContainer(canvasWidth, canvasHeight);
    container.dataset.pdfWidth = String(pdfWidth);
    container.dataset.pdfHeight = String(pdfHeight);
    const entry = { position, pdfWidth, pdfHeight, container };

    if (position === 'start') {
        pdfViewer.insertBefore(container, pdfViewer.firstChild);
        addedPages.unshift(entry);
    } else {
        pdfViewer.appendChild(container);
        addedPages.push(entry);
    }
    applyZoom();
    updatePageIndicator();

    recordAction({
        undo() {
            container.remove();
            const idx = addedPages.indexOf(entry);
            if (idx !== -1) addedPages.splice(idx, 1);
            applyZoom();
            updatePageIndicator();
        },
        redo() {
            if (entry.position === 'start') {
                pdfViewer.insertBefore(container, pdfViewer.firstChild);
                addedPages.unshift(entry);
            } else {
                pdfViewer.appendChild(container);
                addedPages.push(entry);
            }
            applyZoom();
            updatePageIndicator();
        },
    });

    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast(position === 'start' ? 'Blank page added at the beginning' : 'Blank page added at the end');
}

addPageBeforeBtn.addEventListener('click', () => addBlankPage('start'));
addPageAfterBtn.addEventListener('click', () => addBlankPage('end'));

// ============================================
// Save PDF
// ============================================
saveBtn.addEventListener('click', () => {
    // Resolve each item's final page index (0-based) from its canvas's container
    // position in the viewer. This handles items that were added on blank pages
    // and shifts caused by added-before-start blanks.
    const pageContainers = Array.from(pdfViewer.querySelectorAll(':scope > div'));
    const containerIndex = (item) => {
        const c = item.canvas?.parentElement;
        return c ? pageContainers.indexOf(c) : -1;
    };
    for (const item of textItems) item.finalPageIndex = containerIndex(item);
    for (const item of imageItems) item.finalPageIndex = containerIndex(item);

    savePDF(pdfBytes, textItems, imageItems, addedPages, originalFileName);
});
