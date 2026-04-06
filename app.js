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
        const viewport = page.getViewport({ scale: 1.5 });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
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

            let fontFamily = 'Arial, Helvetica, sans-serif';
            let fontWeight = '400';
            const fontName = item.fontName.toLowerCase();

            if (fontName.includes('times') || fontName.includes('serif')) {
                fontFamily = 'Times New Roman, serif';
            } else if (fontName.includes('courier') || fontName.includes('mono')) {
                fontFamily = 'Courier New, monospace';
            } else if (fontName.includes('helvetica') || fontName.includes('arial')) {
                fontFamily = 'Arial, Helvetica, sans-serif';
            }

            if (fontName.includes('bold')) {
                fontWeight = '700';
            } else if (fontName.includes('light')) {
                fontWeight = '300';
            } else if (fontName.includes('medium')) {
                fontWeight = '500';
            }

            if (fontName.includes('italic') || fontName.includes('oblique')) {
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
                scale: viewport.scale,
                originalWidth: originalWidth
            };

            textItems.push(textItemData);

            span.addEventListener('click', (e) => {
                e.stopPropagation();
                makeEditable(textItemData);
            });

            textLayerDiv.appendChild(span);
        });

        pageContainer.appendChild(textLayerDiv);
        pdfViewer.appendChild(pageContainer);
    }
}

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

    const finishEditing = () => {
        textItem.element.contentEditable = false;
        textItem.element.classList.remove('editing');
        textItem.currentText = textItem.element.textContent;
        if (textItem.currentText !== textItem.originalText) {
            textItem.element.classList.add('modified');
            textItem.element.style.minWidth = textItem.originalWidth + 'px';
        } else {
            textItem.element.classList.remove('modified');
            textItem.element.style.minWidth = '';
        }
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
// Save modified PDF
// ============================================
saveBtn.addEventListener('click', async () => {
    try {
        if (typeof PDFLib === 'undefined') {
            alert('PDF library is still loading. Please wait a moment and try again.');
            return;
        }

        const pdfLibDoc = await PDFLib.PDFDocument.load(pdfBytes);
        const pages = pdfLibDoc.getPages();

        const pageTexts = {};
        textItems.forEach(item => {
            if (!pageTexts[item.pageNum]) {
                pageTexts[item.pageNum] = [];
            }
            if (item.currentText !== item.originalText) {
                pageTexts[item.pageNum].push(item);
            }
        });

        const helvetica = await pdfLibDoc.embedFont(PDFLib.StandardFonts.Helvetica);
        const helveticaBold = await pdfLibDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
        const timesRoman = await pdfLibDoc.embedFont(PDFLib.StandardFonts.TimesRoman);
        const timesRomanBold = await pdfLibDoc.embedFont(PDFLib.StandardFonts.TimesRomanBold);
        const courier = await pdfLibDoc.embedFont(PDFLib.StandardFonts.Courier);
        const courierBold = await pdfLibDoc.embedFont(PDFLib.StandardFonts.CourierBold);

        for (const [pageNum, items] of Object.entries(pageTexts)) {
            const page = pages[parseInt(pageNum) - 1];

            items.forEach(item => {
                const x = item.transform[4];
                const y = item.transform[5];
                const fontSize = Math.sqrt(item.transform[0] * item.transform[0] + item.transform[1] * item.transform[1]);

                let font = helvetica;

                if (item.fontFamily && item.fontFamily.includes('Times')) {
                    font = item.fontWeight === '700' ? timesRomanBold : timesRoman;
                } else if (item.fontFamily && item.fontFamily.includes('Courier')) {
                    font = item.fontWeight === '700' ? courierBold : courier;
                } else {
                    font = item.fontWeight === '700' ? helveticaBold : helvetica;
                }

                const cleanCurrentText = item.currentText.replace(/[\r\n]/g, ' ');

                // Use the original width from pdf.js (already in PDF units)
                const originalPdfWidth = item.width;
                const newTextWidth = font.widthOfTextAtSize(cleanCurrentText, fontSize);
                const coverWidth = Math.max(originalPdfWidth, newTextWidth) + 6;

                page.drawRectangle({
                    x: x - 2,
                    y: y - (fontSize * 0.3),
                    width: coverWidth,
                    height: fontSize * 1.4,
                    color: PDFLib.rgb(1, 1, 1),
                });

                page.drawText(cleanCurrentText, {
                    x: x,
                    y: y,
                    size: fontSize,
                    font: font,
                    color: PDFLib.rgb(0, 0, 0),
                });
            });
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
