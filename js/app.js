import { initDragDrop, showToast } from './ui.js';
import { renderPDF, setupImageDrag } from './renderer.js';
import { savePDF } from './saver.js';

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
    // Find the first visible page container
    const pageContainers = pdfViewer.querySelectorAll(':scope > div');
    if (pageContainers.length === 0) return;

    // Find which page is most visible in the scroll viewport
    let targetPage = pageContainers[0];
    let targetPageNum = 1;
    const viewerRect = pdfViewer.getBoundingClientRect();
    const viewerMid = viewerRect.top + viewerRect.height / 2;

    for (let i = 0; i < pageContainers.length; i++) {
        const rect = pageContainers[i].getBoundingClientRect();
        if (rect.top <= viewerMid && rect.bottom >= viewerMid) {
            targetPage = pageContainers[i];
            targetPageNum = i + 1;
            break;
        }
    }

    const canvas = targetPage.querySelector('canvas');
    const textLayer = targetPage.querySelector('.custom-text-layer');
    if (!canvas || !textLayer) return;

    // Load the image to get its natural dimensions
    const img = new Image();
    const imageDataURL = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
    });

    await new Promise((resolve) => {
        img.onload = resolve;
        img.src = imageDataURL;
    });

    // Scale image to fit reasonably within the page (max 50% of page width)
    const maxWidth = canvas.width * 0.5;
    const maxHeight = canvas.height * 0.5;
    let imgWidth = img.naturalWidth;
    let imgHeight = img.naturalHeight;

    if (imgWidth > maxWidth) {
        const ratio = maxWidth / imgWidth;
        imgWidth = maxWidth;
        imgHeight *= ratio;
    }
    if (imgHeight > maxHeight) {
        const ratio = maxHeight / imgHeight;
        imgHeight = maxHeight;
        imgWidth *= ratio;
    }

    // Place in the center of the visible area
    const scrollTop = pdfViewer.scrollTop;
    const pageRect = targetPage.getBoundingClientRect();
    const viewerVisibleTop = viewerRect.top - pageRect.top;
    const cssLeft = (canvas.width - imgWidth) / 2;
    const cssTop = Math.max(10, viewerVisibleTop + (viewerRect.height - imgHeight) / 2);

    // Compute scale from the page's canvas (same as renderPDF uses)
    const scale = canvas.width / (pdfDoc ? (await pdfDoc.getPage(targetPageNum)).getViewport({ scale: 1 }).width : canvas.width);

    // Create the overlay
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

    // Read the image file bytes for embedding at save time
    const imageBytes = new Uint8Array(await file.arrayBuffer());

    const imageItemData = {
        element: overlay,
        pageNum: targetPageNum,
        type: 'imported-image',
        scale: scale,
        cssLeft: cssLeft,
        cssTop: cssTop,
        cssWidth: imgWidth,
        cssHeight: imgHeight,
        bgColor: { r: 1, g: 1, b: 1 },
        moveOffsetX: 0,
        moveOffsetY: 0,
        originalCovered: false,
        canvas: canvas,
        importedImageBytes: imageBytes,
        importedImageType: file.type,
        importedImageDataURL: imageDataURL,
    };

    imageItems.push(imageItemData);
    setupImageDrag(overlay, imageItemData, canvas);
    textLayer.appendChild(overlay);

    showToast('Image imported — drag to position, resize as needed');
}

// ============================================
// Save PDF
// ============================================
saveBtn.addEventListener('click', () => {
    savePDF(pdfBytes, textItems, imageItems, originalFileName);
});
