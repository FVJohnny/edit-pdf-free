# [EditPDFFree.com](https://editpdffree.com)

A free, browser-based PDF editor. No signup, no subscription, no watermarks. Everything runs locally in your browser. Your PDF never leaves your device.

## Features

### Text Editing
- **Click to edit** — click any text in the PDF to edit it inline
- **Smart text detection** — adjacent text fragments and multi-line paragraphs are merged into single editable blocks
- **Format toolbar** — bold, italic, font size (A+/A-), and color picker appear when you select text
- **Add new text** — click "Add Text", then click anywhere on a page to place a new text block
- **Drag to move** — drag any text to reposition it (constrained to page boundaries)
- **Delete text** — use the toolbar trash button or press Delete/Backspace

### Image Editing
- **Drag to move** — drag images to reposition them on the page
- **Resize** — drag corner or edge handles to resize images
- **Shift+Resize** — hold Shift to lock aspect ratio while resizing
- **Import images** — import PNG/JPG images into the PDF via the "Import Image" button
- **Download images** — extract and download images from the PDF
- **Delete images** — remove images via the toolbar or Delete/Backspace key

### Editor Tools
- **Undo / Redo** — full undo/redo for all actions (Ctrl+Z / Ctrl+Shift+Z)
- **Zoom** — zoom in/out (25%–300%) with preserved overlays and interactions
- **Save PDF** — download the edited PDF with all changes embedded
- **Font fidelity** — unchanged text preserves the original PDF font via CMap encoding; styled text falls back to Helvetica/Times/Courier families

### Saving
- Cover rectangles hide original text/image positions with the correct background color
- Moved and resized images are redrawn at their new positions
- Imported images are embedded as PNG/JPG in the saved PDF
- Multi-line paragraphs save each line at the correct position
- Deleted items are cleanly removed (covered, not redrawn)

## Setup

```bash
npm install
npm start
```

Opens at [http://localhost:3000](http://localhost:3000).

## How to Use

1. **Drop or browse** a PDF file
2. **Click text** to edit it — a format toolbar appears above
3. **Drag text or images** to reposition them
4. **Use the toolbar** to add text, import images, undo/redo, or zoom
5. **Save** — click "Save PDF" to download the edited file

## Tech Stack

- **PDF.js** (pdfjs-dist) — PDF rendering in the browser
- **pdf-lib** — PDF manipulation and saving
- **fontkit** — font embedding support
- **Vanilla HTML/CSS/JS** — no framework, no bundler, ES modules

## Architecture

```
index.html              — landing page + editor UI
js/
  app.js                — entry point: state, file loading, image import, tools
  renderer.js           — PDF rendering, text/image extraction, drag, resize
  saver.js              — PDF save: text, images, CMap fonts, download
  toolbar.js            — text format toolbar (bold, italic, size, color, delete)
  image-toolbar.js      — image toolbar (download, delete)
  editor.js             — inline text editing (contentEditable)
  history.js            — undo/redo history manager
  types.js              — JSDoc type definitions and coordinate system docs
  utils/
    constants.js        — shared numeric constants
    color.js            — RGB/hex conversion, color sampling
    canvas.js           — cover original positions, capture canvas regions
    floating-toolbar.js — shared toolbar positioning and dismiss logic
css/
  base.css              — variables, reset, buttons, animations
  editor.css            — editor UI, toolbars, PDF viewer, text/image styles
  components.css        — toast, modal, instant tooltips, responsive
  nav.css / hero.css / features.css / footer.css — landing page sections
```

## License

MIT
