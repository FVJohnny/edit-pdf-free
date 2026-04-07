import { initDragDrop, showToast } from './ui.js';
import { renderPDF } from './renderer.js';
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
        fileNameEl.textContent = file.name;
        saveBtn.disabled = false;

        await renderPDF(pdfDoc, pdfViewer, textItems, imageItems);
    } catch (error) {
        console.error('Error loading PDF:', error);
        alert('Error loading PDF file. Please try another file.');
    }
}

// ============================================
// Save PDF
// ============================================
saveBtn.addEventListener('click', () => {
    savePDF(pdfBytes, textItems, imageItems, originalFileName);
});
