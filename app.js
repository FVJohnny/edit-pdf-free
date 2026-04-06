// PDF.js worker setup
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

let pdfDoc = null;
let pdfBytes = null;
let textItems = [];
let originalFileName = '';

const pdfInput = document.getElementById('pdfInput');
const saveBtn = document.getElementById('saveBtn');
const pdfViewer = document.getElementById('pdfViewer');

// Load PDF file
pdfInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
        // Store the original filename (remove .pdf extension if present)
        originalFileName = file.name.replace(/\.pdf$/i, '');

        const arrayBuffer = await file.arrayBuffer();
        // Store as Uint8Array to prevent detachment
        pdfBytes = new Uint8Array(arrayBuffer);

        // Load with PDF.js for viewing
        const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
        pdfDoc = await loadingTask.promise;

        await renderPDF();
        saveBtn.disabled = false;
    } catch (error) {
        console.error('Error loading PDF:', error);
        alert('Error loading PDF file');
    }
});

// Render PDF pages
async function renderPDF() {
    pdfViewer.innerHTML = '';
    textItems = [];

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });

        // Create canvas for page
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.className = 'pdf-page';

        // Render page (this renders everything including text as graphics)
        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };

        await page.render(renderContext).promise;

        // Get text content first
        const textContent = await page.getTextContent();

        // Cover the rendered text with white rectangles
        textContent.items.forEach(item => {
            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const x = tx[4];
            const y = tx[5] - item.height;
            const width = item.width * viewport.scale;
            const height = item.height;

            context.fillStyle = 'white';
            context.fillRect(x - 1, y - 1, width + 2, height + 3);
        });

        // Create container for this page
        const pageContainer = document.createElement('div');
        pageContainer.style.position = 'relative';
        pageContainer.style.marginBottom = '20px';

        pageContainer.appendChild(canvas);

        // Create custom editable text layer
        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'custom-text-layer';
        textLayerDiv.style.position = 'absolute';
        textLayerDiv.style.left = '0';
        textLayerDiv.style.top = '0';
        textLayerDiv.style.width = viewport.width + 'px';
        textLayerDiv.style.height = viewport.height + 'px';
        textLayerDiv.style.pointerEvents = 'none';

        // Render text items with precise positioning
        textContent.items.forEach((item, index) => {
            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);

            const span = document.createElement('span');
            span.textContent = item.str;
            span.className = 'editable-text';
            span.style.position = 'absolute';
            span.style.left = tx[4] + 'px';
            span.style.top = (tx[5] - item.height) + 'px';

            // Get font size from transform
            const fontSize = Math.sqrt(item.transform[0] * item.transform[0] + item.transform[1] * item.transform[1]);
            span.style.fontSize = fontSize + 'px';

            // Map PDF fonts to web fonts
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

            // Detect font weight
            if (fontName.includes('bold')) {
                fontWeight = '700';
            } else if (fontName.includes('light')) {
                fontWeight = '300';
            } else if (fontName.includes('medium')) {
                fontWeight = '500';
            }

            // Detect font style
            if (fontName.includes('italic') || fontName.includes('oblique')) {
                span.style.fontStyle = 'italic';
            }

            span.style.fontFamily = fontFamily;
            span.style.fontWeight = fontWeight;
            span.style.transformOrigin = 'left bottom';
            span.style.pointerEvents = 'auto';

            // Fine-tune rendering for better matching
            span.style.letterSpacing = '-0.02em';  // Slightly tighter tracking
            span.style.textRendering = 'geometricPrecision';
            span.style.webkitFontSmoothing = 'antialiased';
            span.style.mozOsxFontSmoothing = 'grayscale';

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
                scale: viewport.scale
            };

            // Log font info for debugging
            if (index === 0) {
                console.log('Font used:', item.fontName, 'Family:', fontFamily, 'Weight:', fontWeight);
            }

            textItems.push(textItemData);

            // Make text editable on click
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

// Make text editable inline
function makeEditable(textItem) {
    // If already editing, return
    if (textItem.element.contentEditable === 'true') return;

    // Disable editing on other items
    document.querySelectorAll('.text-item').forEach(el => {
        el.contentEditable = false;
        el.classList.remove('editing');
    });

    // Make this item editable
    textItem.element.contentEditable = true;
    textItem.element.classList.add('editing');
    textItem.element.focus();

    // Select all text
    const range = document.createRange();
    range.selectNodeContents(textItem.element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    // Update text on blur or Enter key
    const finishEditing = () => {
        textItem.element.contentEditable = false;
        textItem.element.classList.remove('editing');
        textItem.currentText = textItem.element.textContent;
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

// Save modified PDF
saveBtn.addEventListener('click', async () => {
    try {
        // Check if PDFLib is loaded
        if (typeof PDFLib === 'undefined') {
            alert('PDF library is still loading. Please wait a moment and try again.');
            return;
        }

        // Load PDF with pdf-lib for editing
        const pdfLibDoc = await PDFLib.PDFDocument.load(pdfBytes);
        const pages = pdfLibDoc.getPages();

        // Group text items by page
        const pageTexts = {};
        textItems.forEach(item => {
            if (!pageTexts[item.pageNum]) {
                pageTexts[item.pageNum] = [];
            }
            if (item.currentText !== item.originalText) {
                pageTexts[item.pageNum].push(item);
            }
        });

        // Embed fonts once
        const helvetica = await pdfLibDoc.embedFont(PDFLib.StandardFonts.Helvetica);
        const helveticaBold = await pdfLibDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
        const helveticaOblique = await pdfLibDoc.embedFont(PDFLib.StandardFonts.HelveticaOblique);
        const helveticaBoldOblique = await pdfLibDoc.embedFont(PDFLib.StandardFonts.HelveticaBoldOblique);
        const timesRoman = await pdfLibDoc.embedFont(PDFLib.StandardFonts.TimesRoman);
        const timesRomanBold = await pdfLibDoc.embedFont(PDFLib.StandardFonts.TimesRomanBold);
        const timesRomanItalic = await pdfLibDoc.embedFont(PDFLib.StandardFonts.TimesRomanItalic);
        const timesRomanBoldItalic = await pdfLibDoc.embedFont(PDFLib.StandardFonts.TimesRomanBoldItalic);
        const courier = await pdfLibDoc.embedFont(PDFLib.StandardFonts.Courier);
        const courierBold = await pdfLibDoc.embedFont(PDFLib.StandardFonts.CourierBold);
        const courierOblique = await pdfLibDoc.embedFont(PDFLib.StandardFonts.CourierOblique);
        const courierBoldOblique = await pdfLibDoc.embedFont(PDFLib.StandardFonts.CourierBoldOblique);

        // Apply text changes to each page
        for (const [pageNum, items] of Object.entries(pageTexts)) {
            const page = pages[parseInt(pageNum) - 1];
            const { height } = page.getSize();

            items.forEach(item => {
                // Get the actual PDF coordinates
                const x = item.transform[4];
                const y = item.transform[5];
                const fontSize = item.transform[0];

                // Try to match font based on stored fontFamily and fontWeight
                let font = helvetica;

                // Use the font family we detected during rendering
                if (item.fontFamily && item.fontFamily.includes('Times')) {
                    if (item.fontWeight === '700') {
                        font = timesRomanBold;
                    } else {
                        font = timesRoman;
                    }
                } else if (item.fontFamily && item.fontFamily.includes('Courier')) {
                    if (item.fontWeight === '700') {
                        font = courierBold;
                    } else {
                        font = courier;
                    }
                } else {
                    // Default to Helvetica - try to match the look of custom fonts
                    // For custom fonts, use regular Helvetica which tends to match better
                    font = helvetica;
                }

                // Remove newlines and special characters that can't be encoded
                const cleanOriginalText = item.originalText.replace(/[\r\n]/g, ' ');
                const cleanCurrentText = item.currentText.replace(/[\r\n]/g, ' ');

                // Adjust font size to compensate for font metrics differences
                // Custom fonts often have different metrics than standard fonts
                let adjustedFontSize = fontSize;

                // For custom fonts (g_d0_*), Helvetica tends to render slightly larger
                // Reduce size by about 3-5% to better match
                if (item.fontName && item.fontName.startsWith('g_d0_')) {
                    adjustedFontSize = fontSize * 0.97;
                }

                // Calculate text width for covering old text
                const oldTextWidth = font.widthOfTextAtSize(cleanOriginalText, adjustedFontSize);
                const newTextWidth = font.widthOfTextAtSize(cleanCurrentText, adjustedFontSize);

                // Draw white rectangle to cover old text with better coverage
                page.drawRectangle({
                    x: x - 1,
                    y: y - 2,
                    width: Math.max(oldTextWidth, newTextWidth) + 12,
                    height: fontSize + 6,
                    color: PDFLib.rgb(1, 1, 1),
                });

                // Draw new text at the same position with adjusted settings
                page.drawText(cleanCurrentText, {
                    x: x,
                    y: y,
                    size: adjustedFontSize,
                    font: font,
                    color: PDFLib.rgb(0, 0, 0),
                    lineHeight: fontSize,
                });
            });
        }

        // Save the PDF
        const modifiedPdfBytes = await pdfLibDoc.save();

        // Ask user for filename
        const defaultFilename = originalFileName || 'edited-document';
        const fileName = prompt('Enter filename (without .pdf extension):', defaultFilename);

        // If user cancelled, don't save
        if (fileName === null) {
            return;
        }

        // Use provided filename or default
        const finalFilename = (fileName.trim() || defaultFilename) + '.pdf';

        // Download the file
        const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = finalFilename;
        a.click();
        URL.revokeObjectURL(url);

        alert('PDF saved successfully as ' + finalFilename);
    } catch (error) {
        console.error('Error saving PDF:', error);
        alert('Error saving PDF file');
    }
});
