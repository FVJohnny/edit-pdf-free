import { initDragDrop, showToast } from './ui.js';
import { renderPDF, setupImageDrag } from './renderer.js';
import { savePDF } from './saver.js';
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
const uploadZone = document.getElementById('uploadZone');
const toolbar = document.getElementById('toolbar');
const fileNameEl = document.getElementById('fileName');
const newFileBtn = document.getElementById('newFileBtn');
const pdfTools = document.getElementById('pdfTools');
const importImageBtn = document.getElementById('importImageBtn');
const imageInput = document.getElementById('imageInput');

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
        fileNameEl.textContent = file.name;
        saveBtn.disabled = false;

        await renderPDF(pdfDoc, pdfViewer, textItems, imageItems);
    } catch (error) {
        console.error('Error loading PDF:', error);
        alert('Error loading PDF file. Please try another file.');
    }
}

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

    // Center on the visible area of the page
    const viewerRect = pdfViewer.getBoundingClientRect();
    const pageRect = targetPage.getBoundingClientRect();
    const visibleTopOnPage = viewerRect.top - pageRect.top;
    const cssLeft = (canvas.width - imgWidth) / 2;
    const cssTop = Math.max(10, visibleTopOnPage + (viewerRect.height - imgHeight) / 2);

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
// Save PDF
// ============================================
saveBtn.addEventListener('click', () => {
    savePDF(pdfBytes, textItems, imageItems, originalFileName);
});
