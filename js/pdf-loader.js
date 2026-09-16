/** Shared local PDF.js resources and parser options for every loading path. */
export function loadPdfDocument(data) {
    return pdfjsLib.getDocument({
        data,
        standardFontDataUrl: new URL('../vendor/pdfjs-standard-fonts/', import.meta.url).href,
        // Official mitigation for CVE-2024-4367 in the bundled PDF.js 3.x engine.
        isEvalSupported: false
    });
}
