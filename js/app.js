import { initDragDrop, showToast, showChoices, showPrompt } from './ui.js';
import { renderPDF, setupImageDrag, setupTextDrag, createBlankPageContainer, renderMergedPage, rerenderAllPages } from './renderer.js';
import { coverOriginalText, coverOriginalImage, layoutWidth, layoutHeight } from './utils/canvas.js';
import { makeEditable } from './editor.js';
import { savePDF, buildPdfBytes } from './saver.js';
import { undo, redo, onHistoryChange, clearHistory, recordAction } from './history.js';
import { getActiveTextItem, hideFormatToolbar } from './toolbar.js';
import { hideImageToolbar, showImageToolbar } from './image-toolbar.js';
import { initDraw, setDrawMode, isDrawMode, setDrawSettings, refreshDrawOverlays, setOnStrokeComplete, getSelectedStroke, deleteSelectedStroke } from './draw.js';
import { initMinimap, rebuildMinimap, scheduleMinimapRebuild } from './minimap.js';
import { initSignature } from './signature.js';
import { saveSession, loadSession, timeAgo } from './autosave.js';
import { initSearch } from './search.js';
import { getMultiSelection, multiSelectionSize, clearMultiSelection } from './selection.js';
import { MAX_IMPORT_SCALE, FONT_BASELINE_RATIO } from './utils/constants.js';

// PDF.js worker setup (vendored locally — no CDN dependency)
pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

let pdfDoc = null;
let pdfBytes = null;
let textItems = [];
let imageItems = [];
let addedPages = []; // [{ position: 'start'|'end', width, height, container }]
let mergedPages = []; // [{ sourceBytes, sourceId, sourcePageIndex, container }]
let drawnStrokes = []; // [{ pageContainer, canvas, element, color, size, opacity, points }]
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
const mergePdfBtn = document.getElementById('mergePdfBtn');
const mergePdfInput = document.getElementById('mergePdfInput');
const pageIndicator = document.getElementById('pageIndicator');
const drawBtn = document.getElementById('drawBtn');
const drawPalette = document.getElementById('drawPalette');
const drawColor = document.getElementById('drawColor');
const drawSize = document.getElementById('drawSize');
const drawSizeLabel = document.getElementById('drawSizeLabel');
const drawOpacity = document.getElementById('drawOpacity');
const drawOpacityLabel = document.getElementById('drawOpacityLabel');
const drawDoneBtn = document.getElementById('drawDone');

// ============================================
// Minimap scrollbar
// ============================================
initMinimap(
    pdfViewer,
    document.getElementById('pdfMinimap'),
    document.getElementById('minimapInner'),
    document.getElementById('minimapStrip'),
    { onReorder: reorderPage, onDelete: deletePage, onRotate: rotatePage }
);

/**
 * Rotate a page 90° clockwise. All pending edits are baked into the document
 * first, then the rotated PDF is reloaded — same trade-off as session
 * recovery: the result is exact, but per-item undo history restarts.
 */
let rotatingPage = false;
async function rotatePage(index) {
    if (rotatingPage || !pdfBytes) return;
    rotatingPage = true;
    try {
        showToast(`Rotating page ${index + 1}…`);
        const pageOrder = collectSaveState();
        const edited = await buildPdfBytes(pdfBytes, textItems, imageItems, pageOrder, drawnStrokes);
        const doc = await PDFLib.PDFDocument.load(edited);
        const page = doc.getPage(index);
        page.setRotation(PDFLib.degrees((page.getRotation().angle + 90) % 360));
        const bytes = await doc.save();
        const scrollBefore = pdfViewer.scrollTop;
        await loadPDF(new File([bytes], `${originalFileName}.pdf`, { type: 'application/pdf' }));
        pdfViewer.scrollTop = scrollBefore;
    } catch (err) {
        console.error('Rotate failed:', err);
        showToast('Could not rotate that page');
    } finally {
        rotatingPage = false;
    }
}

/** Move the page at DOM index `from` so it sits at index `to` (insertion index). */
function reorderPage(from, to) {
    const containers = [...pdfViewer.querySelectorAll(':scope > div')];
    const moving = containers[from];
    if (!moving) return;
    const prevNext = moving.nextSibling;
    const ref = to >= containers.length ? null : containers[to];
    pdfViewer.insertBefore(moving, ref);
    updatePageIndicator();

    recordAction({
        undo() {
            pdfViewer.insertBefore(moving, prevNext && prevNext.parentElement === pdfViewer ? prevNext : null);
            updatePageIndicator();
        },
        redo() {
            pdfViewer.insertBefore(moving, ref && ref.parentElement === pdfViewer ? ref : null);
            updatePageIndicator();
        },
    });
    showToast(`Page moved to position ${[...pdfViewer.querySelectorAll(':scope > div')].indexOf(moving) + 1}`);
}

/** Delete the page at DOM index (kept in memory so undo can restore it). */
function deletePage(index) {
    const containers = [...pdfViewer.querySelectorAll(':scope > div')];
    if (containers.length <= 1) {
        showToast("Can't delete the only page");
        return;
    }
    const container = containers[index];
    if (!container) return;
    const next = container.nextSibling;
    container.remove();
    updatePageIndicator();

    recordAction({
        undo() {
            pdfViewer.insertBefore(container, next && next.parentElement === pdfViewer ? next : null);
            updatePageIndicator();
        },
        redo() {
            container.remove();
            updatePageIndicator();
        },
    });
    showToast(`Page ${index + 1} deleted`);
}

// ============================================
// Undo / Redo
// ============================================
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

onHistoryChange(({ canUndo, canRedo }) => {
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
    scheduleSizeEstimate();
    scheduleMinimapRebuild();
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

    // Escape: exit any active tool mode (draw, shapes, add-text)
    if (e.key === 'Escape') {
        const activeEl = document.activeElement;
        if (!activeEl || (!activeEl.isContentEditable && activeEl.tagName !== 'INPUT' && activeEl.tagName !== 'TEXTAREA')) {
            deactivateModes();
        }
    }

    // Delete/Backspace: delete selected text or image (only when not editing text)
    if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't interfere with text editing
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.isContentEditable || activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;

        // Multi-selection: delete the whole group in one undoable action
        if (multiSelectionSize() > 0) {
            e.preventDefault();
            deleteMultiSelection();
            return;
        }

        // Selected drawn stroke/shape
        if (getSelectedStroke()) {
            e.preventDefault();
            deleteSelectedStroke();
            return;
        }

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

/** Delete every multi-selected item as one undoable action. */
function deleteMultiSelection() {
    const items = getMultiSelection();
    clearMultiSelection();
    const entries = items.map(item => ({
        item,
        isText: !item.type, // ImageItems carry a `type`, TextItems don't
        wasModified: item.element.classList.contains('modified'),
    }));
    for (const en of entries) {
        if (en.isText) coverOriginalText(en.item, en.item.lastCoverWidth || en.item.originalWidth);
        else coverOriginalImage(en.item);
        en.item.deleted = true;
        en.item.element.style.display = 'none';
    }
    showToast(`${entries.length} element${entries.length === 1 ? '' : 's'} deleted`);
    recordAction({
        undo() {
            for (const en of entries) {
                en.item.deleted = false;
                en.item.element.style.display = '';
                if (en.isText) en.item.element.classList.toggle('modified', en.wasModified || en.item.originalCovered);
            }
        },
        redo() {
            for (const en of entries) {
                en.item.deleted = true;
                en.item.element.style.display = 'none';
            }
        },
    });
}

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
// Session recovery — offer to restore the autosaved session on arrival
// ============================================
(async () => {
    const session = await loadSession();
    if (!session) return;
    const blankBtn = document.getElementById('blankPdfBtn');
    const recoverBtn = document.createElement('button');
    recoverBtn.className = 'upload-blank-btn upload-recover-btn';
    recoverBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        Recover last session — ${session.name}.pdf (${timeAgo(session.savedAt)})`;
    recoverBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        loadPDF(new File([session.bytes], `${session.name}.pdf`, { type: 'application/pdf' }));
    });
    blankBtn.insertAdjacentElement('afterend', recoverBtn);
})();

// ============================================
// Start with a blank PDF (no upload needed)
// ============================================
document.getElementById('blankPdfBtn').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (typeof PDFLib === 'undefined') {
        showToast('PDF library is still loading — try again in a moment');
        return;
    }
    const doc = await PDFLib.PDFDocument.create();
    doc.addPage([612, 792]); // US Letter
    const bytes = await doc.save();
    loadPDF(new File([bytes], 'blank.pdf', { type: 'application/pdf' }));
});

// ============================================
// Drag and drop — PDFs load, images import at the drop position
// ============================================
initDragDrop(async (files, point) => {
    const pdf = files.find(f => f.type === 'application/pdf');
    if (pdf) {
        loadPDF(pdf);
        return;
    }
    const images = files.filter(f => f.type === 'image/png' || f.type === 'image/jpeg');
    if (images.length === 0) {
        showToast("This is a PDF editor. What part of that was unclear?");
        return;
    }
    if (!pdfDoc) {
        showToast('Load a PDF first (or start a blank one), then drop your images');
        return;
    }
    // Find the page under the drop point and convert to layout coordinates
    let dropTarget = null;
    const containers = pdfViewer.querySelectorAll(':scope > div');
    for (const container of containers) {
        const r = container.getBoundingClientRect();
        if (point.y >= r.top && point.y <= r.bottom) {
            const canvas = container.querySelector('canvas');
            const cr = canvas.getBoundingClientRect();
            const pxScale = layoutWidth(canvas) / cr.width;
            dropTarget = {
                page: container,
                x: (point.x - cr.left) * pxScale,
                y: (point.y - cr.top) * pxScale,
            };
            break;
        }
    }
    await importImages(images, dropTarget);
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
        // Password-protected PDFs: ask the user (again on a wrong password)
        loadingTask.onPassword = async (updatePassword, reason) => {
            const wrong = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD;
            const pw = await showPrompt(
                'Protected PDF',
                wrong ? 'Incorrect password — try again' : 'This PDF requires a password to open',
                '',
                { ext: '', confirmLabel: 'Open', inputType: 'password' }
            );
            if (pw === null) {
                loadingTask.destroy();
                return;
            }
            updatePassword(pw);
        };
        pdfDoc = await loadingTask.promise;

        uploadZone.classList.add('hidden');
        toolbar.classList.add('visible');
        pdfTools.classList.add('visible');
        pdfContainer.classList.add('visible');
        fileNameEl.textContent = file.name;
        saveBtn.disabled = false;

        clearHistory();
        hideFormatToolbar();
        hideImageToolbar();
        addedPages.length = 0;
        mergedPages.length = 0;
        drawnStrokes.length = 0;
        // Exit draw mode on new file load (strokes cleared, palette hidden).
        if (isDrawMode()) toggleDrawMode(false);
        await renderPDF(pdfDoc, pdfViewer, textItems, imageItems);
        updatePageIndicator();
        rebuildMinimap();
        scheduleSizeEstimate();
        // Bring the whole editor into view (smooth), after the layout has
        // settled — rendering just replaced the page containers, and scrolling
        // against a still-shifting layout lands in the wrong place.
        setTimeout(() => {
            document.querySelector('.editor-wrapper').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    } catch (error) {
        console.error('Error loading PDF:', error);
        alert('Error loading PDF file. Please try another file.');
    }
}

// ============================================
// Add Text
// ============================================
let addTextMode = false;

function setAddTextMode(active) {
    addTextMode = active;
    addTextBtn.classList.toggle('active', active);
    pdfViewer.classList.toggle('placement-mode', active);
}

addTextBtn.addEventListener('click', () => {
    const next = !addTextMode;
    if (next && isDrawMode()) toggleDrawMode(false);
    setAddTextMode(next);
    if (next) showToast('Click on the PDF to place new text');
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

    // Convert click position to layout coordinates
    const canvasRect = canvas.getBoundingClientRect();
    const cssLeft = e.clientX - canvasRect.left;
    const cssTop = e.clientY - canvasRect.top;

    const scale = layoutWidth(canvas) / canvasRect.width;
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
    const pdfScale = layoutWidth(canvas) / pdfWidthPts;

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
        // Build a transform matrix: [fontSize, 0, 0, fontSize, x, y] in PDF coordinates.
        // canvasY is the span's TOP; the glyph baseline sits ~0.78em lower on
        // screen, so the PDF baseline must account for it or saved text lands high.
        transform: [defaultFontSize / pdfScale, 0, 0, defaultFontSize / pdfScale, canvasX / pdfScale, (layoutHeight(canvas) - canvasY - defaultFontSize * FONT_BASELINE_RATIO) / pdfScale],
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
        originCanvas: canvas,
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
    setAddTextMode(false);
    makeEditable(textItemData);
});

// ============================================
// Import Image
// ============================================
importImageBtn.addEventListener('click', () => {
    imageInput.click();
});

imageInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    imageInput.value = '';
    await importImages(files);
});

/**
 * Import a batch of images: ask for a compression level (unless they're small),
 * then place them cascading. dropTarget ({page, x, y} in layout px) places them
 * at a drop position instead of the default top-center.
 */
async function importImages(files, dropTarget = null) {
    if (files.length === 0) return;

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    // Small images aren't worth the interruption — import as-is
    const SKIP_COMPRESSION_BELOW = 300 * 1024;
    const compression = totalSize < SKIP_COMPRESSION_BELOW ? null : await showChoices(
        'Compress images?',
        `${files.length} image${files.length === 1 ? '' : 's'}, ${formatBytes(totalSize)}. ` +
        'Compression keeps photos looking good while making the PDF much smaller.',
        [
            { label: 'High quality', hint: 'recommended · barely visible difference', value: { quality: 0.85, maxDim: 2500 } },
            { label: 'Balanced', hint: 'smaller · slight quality loss', value: { quality: 0.7, maxDim: 1800 } },
            { label: 'Smallest', hint: 'tiny · visible quality loss', value: { quality: 0.5, maxDim: 1200 } },
            { label: 'Original', hint: 'no compression', value: null },
        ]
    );
    if (compression === undefined) return; // cancelled

    // Import sequentially, cascading each image down-right so they don't stack
    let importedBytes = 0;
    const items = [];
    for (let i = 0; i < files.length; i++) {
        const item = await importImage(files[i], i * 28, compression, dropTarget);
        if (item) {
            items.push(item);
            importedBytes += item.importedImageBytes.length;
        }
    }
    const sizeNote = compression
        ? ` (${formatBytes(totalSize)} → ${formatBytes(importedBytes)})`
        : '';
    showToast((files.length === 1
        ? 'Image imported — drag to position, resize as needed'
        : `${files.length} images imported — drag to position them`) + sizeNote);
    // A single imported image gets selected right away — handles + toolbar ready
    if (items.length === 1) showImageToolbar(items[0]);
    return items;
}

async function importImage(file, cascadeOffset = 0, compression = null, dropTarget = null) {
    const { page: targetPage, pageNum } = dropTarget
        ? { page: dropTarget.page, pageNum: [...pdfViewer.querySelectorAll(':scope > div')].indexOf(dropTarget.page) + 1 }
        : findVisiblePage();
    if (!targetPage) return null;

    const canvas = targetPage.querySelector('canvas');
    const textLayer = targetPage.querySelector('.custom-text-layer');
    if (!canvas || !textLayer) return null;

    // Load the image, applying compression (if chosen) and baking in any EXIF
    // rotation so the saved bytes match the preview
    const { bytes: imageBytes, type: imageType, dataURL: imageDataURL, img } =
        await prepareImage(file, compression);

    // Scale to fit within the page (max MAX_IMPORT_SCALE of page dimensions)
    const { width: imgWidth, height: imgHeight } = scaleToFit(
        img.naturalWidth, img.naturalHeight,
        layoutWidth(canvas) * MAX_IMPORT_SCALE,
        layoutHeight(canvas) * MAX_IMPORT_SCALE
    );

    // Place at the drop point when given; otherwise centered horizontally near
    // the top of the visible area. cascadeOffset staggers multi-image imports.
    let cssLeft, cssTop;
    if (dropTarget) {
        cssLeft = Math.min(Math.max(0, dropTarget.x - imgWidth / 2 + cascadeOffset), Math.max(0, layoutWidth(canvas) - imgWidth));
        cssTop = Math.min(Math.max(0, dropTarget.y - imgHeight / 2 + cascadeOffset), Math.max(0, layoutHeight(canvas) - imgHeight));
    } else {
        const viewerRect = pdfViewer.getBoundingClientRect();
        const pageRect = targetPage.getBoundingClientRect();
        const visibleTopOnPage = viewerRect.top - pageRect.top;
        cssLeft = Math.min((layoutWidth(canvas) - imgWidth) / 2 + cascadeOffset, Math.max(0, layoutWidth(canvas) - imgWidth));
        cssTop = Math.min(Math.max(10, visibleTopOnPage + 20) + cascadeOffset, Math.max(0, layoutHeight(canvas) - imgHeight));
    }

    // Layout pixels per PDF point — every container stores its PDF page width
    const scale = layoutWidth(canvas) / (parseFloat(targetPage.dataset.pdfWidth) || 612);

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
        originCanvas: canvas,
        importedImageBytes: imageBytes,
        importedImageType: imageType,
        importedImageDataURL: imageDataURL,
    };

    imageItems.push(imageItemData);
    setupImageDrag(overlay, imageItemData, canvas);
    textLayer.appendChild(overlay);

    recordAction({
        undo() { overlay.style.display = 'none'; imageItemData.deleted = true; },
        redo() { overlay.style.display = ''; imageItemData.deleted = false; },
    });

    return imageItemData;
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

/**
 * Load an image file and prepare it for embedding:
 *  - applies the chosen compression ({ quality, maxDim }) by re-encoding as
 *    JPEG at that quality, downscaling so the longest side fits maxDim
 *  - corrects EXIF orientation when present: pdf-lib embeds the raw bytes and
 *    PDF viewers ignore EXIF, so rotated photos (typical from phone cameras)
 *    must be re-encoded with the rotation baked into the pixels
 * Returns { bytes, type, dataURL, img } ready for both preview and embedding.
 */
async function prepareImage(file, compression = null) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const dataURL = await readFileAsDataURL(file);
    const img = await loadImage(dataURL);

    const needsExifFix = file.type === 'image/jpeg' && readExifOrientation(bytes) > 1;
    if (!compression && !needsExifFix) {
        return { bytes, type: file.type, dataURL, img };
    }

    // The browser applies EXIF rotation when drawing to a canvas, so the
    // re-encoded JPEG has upright pixels and no orientation tag.
    let width = img.naturalWidth;
    let height = img.naturalHeight;
    if (compression?.maxDim && Math.max(width, height) > compression.maxDim) {
        const k = compression.maxDim / Math.max(width, height);
        width = Math.round(width * k);
        height = Math.round(height * k);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);

    // PNGs with transparency must stay PNG — JPEG would flatten the alpha
    // channel. Downscaling still applies, so compression is not a no-op.
    const keepPng = file.type === 'image/png' && canvasHasAlpha(ctx, width, height);
    const outURL = keepPng
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', compression?.quality ?? 0.92);
    const outImg = await loadImage(outURL);
    return {
        bytes: dataURLToBytes(outURL),
        type: keepPng ? 'image/png' : 'image/jpeg',
        dataURL: outURL,
        img: outImg,
    };
}

/** Whether any pixel has alpha < 255 (sampled with a stride for speed). */
function canvasHasAlpha(ctx, width, height) {
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < data.length; i += 16) {
        if (data[i] < 255) return true;
    }
    return false;
}

/** Read the EXIF orientation tag (1 = upright) from JPEG bytes; 1 if absent. */
function readExifOrientation(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return 1;
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
        const marker = view.getUint16(offset);
        if ((marker & 0xFF00) !== 0xFF00) return 1;
        const size = view.getUint16(offset + 2);
        // APP1 segment starting with "Exif"
        if (marker === 0xFFE1 && offset + 10 <= view.byteLength &&
            view.getUint32(offset + 4) === 0x45786966) {
            const tiff = offset + 10;
            if (tiff + 8 > view.byteLength) return 1;
            const little = view.getUint16(tiff) === 0x4949;
            const ifd = tiff + view.getUint32(tiff + 4, little);
            if (ifd + 2 > view.byteLength) return 1;
            const entries = view.getUint16(ifd, little);
            for (let i = 0; i < entries; i++) {
                const entry = ifd + 2 + i * 12;
                if (entry + 12 > view.byteLength) return 1;
                if (view.getUint16(entry, little) === 0x0112) {
                    return view.getUint16(entry + 8, little);
                }
            }
            return 1;
        }
        offset += 2 + size;
    }
    return 1;
}

function dataURLToBytes(dataURL) {
    const binary = atob(dataURL.slice(dataURL.indexOf(',') + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
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
// Estimated output size — runs the real save pipeline (without downloading)
// in the background, debounced, so the number is the exact byte count.
// ============================================
const sizeIndicator = document.getElementById('sizeIndicator');
let sizeEstimateTimer = null;
let sizeEstimateRunning = false;
let sizeEstimateQueued = false;

function scheduleSizeEstimate() {
    clearTimeout(sizeEstimateTimer);
    // Rebuilding the PDF is proportional to its size — back off for big files,
    // and prefer idle time so the rebuild never competes with interaction.
    const mb = pdfBytes ? pdfBytes.length / (1024 * 1024) : 0;
    const delay = mb > 25 ? 3000 : mb > 8 ? 1500 : 700;
    sizeEstimateTimer = setTimeout(() => {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => runSizeEstimate(), { timeout: 2000 });
        } else {
            runSizeEstimate();
        }
    }, delay);
}

async function runSizeEstimate() {
    if (!pdfBytes || typeof PDFLib === 'undefined') return;
    if (sizeEstimateRunning) {
        sizeEstimateQueued = true;
        return;
    }
    sizeEstimateRunning = true;
    try {
        const pageOrder = collectSaveState();
        const bytes = await buildPdfBytes(pdfBytes, textItems, imageItems, pageOrder, drawnStrokes);
        sizeIndicator.textContent = formatBytes(bytes.length);
        // The built PDF doubles as the autosave snapshot
        saveSession(bytes, originalFileName);
    } catch (err) {
        console.error('Size estimate failed:', err);
        sizeIndicator.textContent = '–';
    } finally {
        sizeEstimateRunning = false;
        if (sizeEstimateQueued) {
            sizeEstimateQueued = false;
            scheduleSizeEstimate();
        }
    }
}

function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

// ============================================
// Page indicator (current / total)
// ============================================
/** The page container whose vertical midpoint is closest to the viewer's midpoint. */
function currentPageContainer() {
    const containers = pdfViewer.querySelectorAll(':scope > div');
    const viewerRect = pdfViewer.getBoundingClientRect();
    const viewerMidY = viewerRect.top + viewerRect.height / 2;
    let best = null;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < containers.length; i++) {
        const r = containers[i].getBoundingClientRect();
        const mid = r.top + r.height / 2;
        const dist = Math.abs(mid - viewerMidY);
        if (dist < bestDist) { bestDist = dist; best = containers[i]; bestIdx = i; }
    }
    return { container: best, index: bestIdx, total: containers.length };
}

function updatePageIndicator() {
    const { index, total } = currentPageContainer();
    pageIndicator.textContent = total === 0 ? 'Page 0 / 0' : `Page ${index + 1} / ${total}`;
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
            const originalHeight = layoutHeight(canvas);
            const scaledHeight = originalHeight * currentZoom;
            page.style.marginBottom = (scaledHeight - originalHeight + 20) + 'px';
        }
    }
    scheduleZoomRerender();
}

// Re-render page backings at the zoom resolution (debounced) so zoomed-in
// pages are sharp instead of CSS-upscaled, then repaint covers and minimap.
let zoomRerenderTimer = null;
function scheduleZoomRerender() {
    clearTimeout(zoomRerenderTimer);
    zoomRerenderTimer = setTimeout(async () => {
        await rerenderAllPages(pdfViewer, currentZoom, replayCovers);
        rebuildMinimap();
    }, 350);
}

/** After a page's canvas was re-rendered, repaint the covers that were on it. */
function replayCovers(container, canvas) {
    for (const item of textItems) {
        if (item.originalCovered && (item.originCanvas || item.canvas) === canvas) {
            item.originalCovered = false;
            coverOriginalText(item, item.lastCoverWidth || item.originalWidth);
        }
    }
    for (const item of imageItems) {
        if (item.originalCovered && (item.originCanvas || item.canvas) === canvas) {
            item.originalCovered = false;
            coverOriginalImage(item);
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
function addBlankPage(position) {
    // Insert relative to the page currently in view, inheriting its dimensions.
    const { container: refContainer } = currentPageContainer();
    if (!refContainer) return;

    const pdfWidth = parseFloat(refContainer.dataset.pdfWidth) || 612;
    const pdfHeight = parseFloat(refContainer.dataset.pdfHeight) || 792;

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
    const entry = { pdfWidth, pdfHeight, container };

    const anchor = position === 'start' ? refContainer : refContainer.nextSibling;
    pdfViewer.insertBefore(container, anchor);
    addedPages.push(entry);
    applyZoom();
    updatePageIndicator();
    refreshDrawOverlays();

    recordAction({
        undo() {
            container.remove();
            const idx = addedPages.indexOf(entry);
            if (idx !== -1) addedPages.splice(idx, 1);
            applyZoom();
            updatePageIndicator();
        },
        redo() {
            // Re-insert at the same spot; the anchor may have moved or gone,
            // in which case fall back to appending after the reference page.
            const target = anchor && anchor.parentElement === pdfViewer
                ? anchor
                : (refContainer.parentElement === pdfViewer ? refContainer.nextSibling : null);
            pdfViewer.insertBefore(container, target);
            addedPages.push(entry);
            applyZoom();
            updatePageIndicator();
            refreshDrawOverlays();
        },
    });

    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast(position === 'start' ? 'Blank page inserted before this page' : 'Blank page inserted after this page');
}

addPageBeforeBtn.addEventListener('click', () => addBlankPage('start'));
addPageAfterBtn.addEventListener('click', () => addBlankPage('end'));

// ============================================
// Draw (free-hand) tool
// ============================================
initDraw(pdfViewer, drawnStrokes);

// ============================================
// Find text
// ============================================
initSearch(pdfViewer, textItems);

// ============================================
// Signature tool — the drawn signature becomes a regular imported image
// ============================================
initSignature((dataURL) => {
    if (!pdfDoc) {
        showToast('Load a PDF first');
        return;
    }
    const file = new File([dataURLToBytes(dataURL)], 'signature.png', { type: 'image/png' });
    importImages([file]);
});

function syncDrawSettingsFromUI() {
    setDrawSettings({
        color: drawColor.value,
        size: parseInt(drawSize.value, 10),
        opacity: parseInt(drawOpacity.value, 10) / 100,
    });
    drawSizeLabel.textContent = drawSize.value;
    drawOpacityLabel.textContent = drawOpacity.value + '%';
}

function selectDrawTool(btn) {
    if (!btn) return;
    document.querySelectorAll('.draw-tool').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tool = btn.dataset.tool;
    // The highlighter defaults to a marker yellow
    if (tool === 'highlighter' && drawColor.value === '#e84444') {
        drawColor.value = '#ffe83a';
    }
    setDrawSettings({ tool });
    syncDrawSettingsFromUI();
}

document.querySelectorAll('.draw-tool').forEach(btn => {
    btn.addEventListener('click', () => selectDrawTool(btn));
});

// Draw (pen/highlighter) and Shapes (rect/circle/arrow/star) share the same
// machinery; the palette shows only the active group's tools.
const shapesBtn = document.getElementById('shapesBtn');
let paletteGroup = 'draw';

function toggleDrawMode(force, group = paletteGroup) {
    const next = typeof force === 'boolean' ? force : !(isDrawMode() && paletteGroup === group);
    paletteGroup = group;
    setDrawMode(next);
    drawPalette.dataset.group = group;
    drawBtn.classList.toggle('active', next && group === 'draw');
    shapesBtn.classList.toggle('active', next && group === 'shapes');
    drawPalette.style.display = next ? 'flex' : 'none';
    if (next) {
        const active = document.querySelector('.draw-tool.active');
        if (!active || active.dataset.group !== group) {
            selectDrawTool(document.querySelector(`.draw-tool[data-group="${group}"]`));
        }
        syncDrawSettingsFromUI();
    }
}

drawBtn.addEventListener('click', () => {
    if (addTextMode) setAddTextMode(false);
    toggleDrawMode(undefined, 'draw');
});
shapesBtn.addEventListener('click', () => {
    if (addTextMode) setAddTextMode(false);
    toggleDrawMode(undefined, 'shapes');
});
drawDoneBtn.addEventListener('click', () => toggleDrawMode(false));

/** Exit every tool mode — the app returns to plain select/edit behavior. */
function deactivateModes() {
    if (addTextMode) setAddTextMode(false);
    if (isDrawMode()) toggleDrawMode(false);
}

// Content tools are mutually exclusive: picking one drops the others, so a
// freshly placed element is always immediately selectable/resizable.
document.getElementById('signBtn').addEventListener('click', deactivateModes);
importImageBtn.addEventListener('click', deactivateModes);
mergePdfBtn.addEventListener('click', deactivateModes);

// Shapes behave like design apps: after placing one shape the tool releases,
// leaving the shape selected with its handles ready. Pen/highlighter keep the
// mode active (people draw several strokes in a row).
setOnStrokeComplete((stroke) => {
    if (stroke.shape !== 'pen' && stroke.shape !== 'highlighter') {
        toggleDrawMode(false);
    }
});
drawColor.addEventListener('input', syncDrawSettingsFromUI);
drawSize.addEventListener('input', syncDrawSettingsFromUI);
drawOpacity.addEventListener('input', syncDrawSettingsFromUI);

// ============================================
// Merge another PDF (append its pages after the current PDF)
// ============================================
mergePdfBtn.addEventListener('click', () => mergePdfInput.click());

mergePdfInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    mergePdfInput.value = '';
    if (!file) return;
    await mergePDFFile(file);
});

let mergeSourceCounter = 0;

async function mergePDFFile(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const sourceBytes = new Uint8Array(arrayBuffer);

        // Open with PDF.js for rendering
        const loadingTask = pdfjsLib.getDocument({ data: sourceBytes.slice() });
        const sourceDoc = await loadingTask.promise;

        // Compute available width once for all merged pages
        const viewerStyle = getComputedStyle(pdfViewer);
        const horizontalPadding = parseFloat(viewerStyle.paddingLeft) + parseFloat(viewerStyle.paddingRight);
        const availableWidth = pdfViewer.clientWidth - horizontalPadding - 2;

        const sourceId = `merge-${++mergeSourceCounter}`;
        const newEntries = [];
        for (let i = 1; i <= sourceDoc.numPages; i++) {
            const container = await renderMergedPage(sourceDoc, i, availableWidth);
            const entry = {
                sourceBytes,
                sourceId,
                sourcePageIndex: i - 1, // 0-based for pdf-lib
                container,
            };
            pdfViewer.appendChild(container);
            mergedPages.push(entry);
            newEntries.push(entry);
        }

        applyZoom();
        updatePageIndicator();
        refreshDrawOverlays();

        const firstNew = newEntries[0]?.container;
        if (firstNew) firstNew.scrollIntoView({ behavior: 'smooth', block: 'start' });

        recordAction({
            undo() {
                for (const entry of newEntries) {
                    entry.container.remove();
                    const idx = mergedPages.indexOf(entry);
                    if (idx !== -1) mergedPages.splice(idx, 1);
                }
                applyZoom();
                updatePageIndicator();
            },
            redo() {
                for (const entry of newEntries) {
                    pdfViewer.appendChild(entry.container);
                    mergedPages.push(entry);
                }
                applyZoom();
                updatePageIndicator();
                refreshDrawOverlays();
            },
        });

        showToast(`Merged ${sourceDoc.numPages} page${sourceDoc.numPages === 1 ? '' : 's'} from ${file.name}`);
    } catch (error) {
        console.error('Error merging PDF:', error);
        showToast('Could not merge that PDF. Please try another file.');
    }
}

// ============================================
// Save PDF
// ============================================
/**
 * Resolve every item's final page index (0-based, from its canvas's container
 * position in the viewer) and origin page index (where it was created — differs
 * after a cross-page drag), then build the ordered list of extra pages (blank
 * or merged) with their DOM positions for the saver.
 */
function collectSaveState() {
    const pageContainers = Array.from(pdfViewer.querySelectorAll(':scope > div'));
    const indexOfCanvas = (canvas) => {
        const c = canvas?.parentElement;
        return c ? pageContainers.indexOf(c) : -1;
    };
    for (const item of textItems) {
        item.finalPageIndex = indexOfCanvas(item.canvas);
        item.originPageIndex = indexOfCanvas(item.originCanvas || item.canvas);
    }
    for (const item of imageItems) {
        item.finalPageIndex = indexOfCanvas(item.canvas);
        item.originPageIndex = indexOfCanvas(item.originCanvas || item.canvas);
    }
    for (const stroke of drawnStrokes) {
        const c = stroke.pageContainer;
        stroke.finalPageIndex = c ? pageContainers.indexOf(c) : -1;
    }

    // Walk the DOM in order: every container becomes one page of the output,
    // in exactly this order (this is what makes reorder/delete work).
    const pageOrder = [];
    for (const container of pageContainers) {
        if (container.dataset.blankPage === 'true') {
            const entry = addedPages.find(p => p.container === container);
            if (entry) pageOrder.push({ kind: 'blank', entry });
        } else if (container.dataset.mergedPage === 'true') {
            const entry = mergedPages.find(p => p.container === container);
            if (entry) pageOrder.push({ kind: 'merged', entry });
        } else {
            pageOrder.push({ kind: 'original', sourcePageIndex: parseInt(container.dataset.originalPageIndex, 10) || 0 });
        }
    }
    return pageOrder;
}

saveBtn.addEventListener('click', () => {
    const pageOrder = collectSaveState();
    savePDF(pdfBytes, textItems, imageItems, pageOrder, drawnStrokes, originalFileName);
});

// ============================================
// Delete current page — the one in view, with everything on it (undoable)
// ============================================
document.getElementById('deletePageBtn').addEventListener('click', () => {
    if (!pdfBytes) return;
    const { index } = currentPageContainer();
    if (index >= 0) deletePage(index);
});
