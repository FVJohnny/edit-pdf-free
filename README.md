# [EditPDFFree.com](https://editpdffree.com)

A free, browser-based PDF editor. No signup, no subscription, no watermarks. Everything runs locally in your browser. Your PDF never leaves your device.

## Features

### Opening documents
- **Drop or browse** any PDF — rendering, editing and saving all happen client-side
- **Start from blank** — create an empty one-page PDF without uploading anything
- **Password-protected PDFs** — prompts for the password (and retries on a wrong one)
- **Merge PDFs** — append another PDF's pages to the current document
- **Session recovery** — the document (with edits baked in) autosaves to IndexedDB; after closing or reloading, one click restores the last session

### Text editing
- **Click to edit** — click any text in the PDF to edit it inline
- **Smart text detection** — adjacent fragments and multi-line paragraphs merge into single editable blocks
- **Add new text** — click "Add Text", then click anywhere (including blank pages) to place a text block and start typing immediately
- **Multi-line text** — Shift+Enter (or Cmd/Ctrl+Enter) inserts a line break; plain Enter confirms
- **Format toolbar** — bold, italic, font size (A+/A-), font family (Original / Helvetica / Times / Courier) and left/center/right alignment
- **Color & opacity** — custom color picker (spectrum, hue, opacity slider, preset swatches) for text color, including transparency
- **Drag to move** — reposition any text, constrained to page boundaries
- **Cross-page drag** — drag a text toward the viewer edge and it auto-scrolls until you drop it on another page
- **Multi-select** — Shift+click several texts/images, then move or delete them as a group
- **Delete text** — toolbar trash button or Delete/Backspace

### Drawing & annotations
- **Pen** — free-hand drawing with quadratic-Bézier smoothing
- **Highlighter** — wide, translucent marker strokes
- **Shapes** — rectangle, circle, arrow and star, drawn by dragging
- **Color & opacity in one picker** — the same custom popover everywhere: line color + opacity, and (for closed shapes) fill color with its own opacity — 0% fill opacity means no fill
- **Line width slider** — adjust any stroke's thickness after drawing
- **Easy selection** — tap near a stroke (not pixel-perfect on it) to select it; filled shapes select from anywhere inside
- **Move & resize** — drag a selected stroke from anywhere inside its dashed selection box; shapes get corner/endpoint handles with generous touch hit areas
- **Everything saves as vector paths** in the PDF and shows in the minimap

### Signature
- **Draw your signature** in a modal (white paper, black or blue ink) with mouse, trackpad or finger
- Placed as a transparent PNG image — drag, resize, rotate and delete like any image
- Background stays fully transparent in the saved PDF

### Images
- **Import images** — PNG/JPG via button or by dropping them straight onto a page
- **Multi-image import** — select several at once; a compression dialog offers High quality / Balanced / Smallest / Original (with size feedback)
- **EXIF orientation** — phone photos with rotation tags import upright, in the editor and in the saved PDF
- **Drag, resize, rotate** — move anywhere (cross-page too), corner/edge handles, Shift locks aspect ratio, rotate in 90° steps
- **Download images** — extract any image from the PDF
- **Delete images** — toolbar or Delete/Backspace

### Pages
- **Add blank pages** — before or after the current page, sized to match
- **Delete page** — removes the current page and everything on it (refuses to delete the last one)
- **Reorder, rotate & delete from the minimap** — hover a thumbnail for a drag handle (⠿), rotate (⟳) and delete (✕)
- **Minimap scrollbar** — a live thumbnail strip of all pages (including your edits and drawings) that tracks and controls scrolling

### Editor
- **Undo / Redo for everything** — text, styles, moves, strokes, images, pages (Ctrl+Z / Ctrl+Shift+Z)
- **Find** — Ctrl+F (or the magnifier) highlights matches and cycles with Enter / Shift+Enter
- **Sharp zoom** — 25%–300%; pages re-render at the zoom resolution so nothing goes blurry
- **Size indicator** — live, byte-accurate size of the PDF as it would save right now
- **Touch-friendly** — works on phones: big grab targets, no accidental scrolling while drawing, keyboard-aware floating toolbars

### Saving
- Original positions of moved/edited content are covered with the sampled background color
- Unchanged text keeps the original PDF font (CMap encoding); styled text falls back to Helvetica/Times/Courier
- Text color and opacity, stroke colors/opacity/fill and line widths are all preserved
- Drawings save as vector paths; signatures keep their transparency
- Inserted, deleted and reordered pages come out exactly as arranged on screen

## Setup

```bash
npm install
npm start
```

Opens at [http://localhost:3000](http://localhost:3000).

## Testing

End-to-end tests (Playwright) cover every feature, plus a regression test for
every bug ever found:

```bash
npm test            # full suite (starts its own server)
npm run test:headed # watch it run
```

## How to Use

1. **Drop or browse** a PDF file (or start from a blank page)
2. **Click text** to edit it — a format toolbar appears next to it
3. **Draw, annotate or sign** with the pen, shapes and signature tools
4. **Drag text or images** to reposition them, across pages if you want
5. **Save** — click "Save PDF" to download the edited file

## Tech Stack

- **PDF.js** (pdfjs-dist) — PDF rendering in the browser
- **pdf-lib** — PDF manipulation and saving
- **fontkit** — font embedding support
- **Vanilla HTML/CSS/JS** — no framework, no bundler, ES modules
- **Playwright** — end-to-end test suite

## Architecture

```
index.html              — landing page + editor UI
js/
  app.js                — entry point: state, file loading, image import, tools
  renderer.js           — PDF rendering, text/image extraction, drag, resize
  saver.js              — PDF save: text, images, CMap fonts, strokes, download
  toolbar.js            — text format toolbar (style, family, alignment, color)
  image-toolbar.js      — image toolbar (rotate, download, delete)
  editor.js             — inline text editing (contentEditable)
  draw.js               — pen/highlighter/shapes, stroke selection & editing
  signature.js          — draw-your-signature modal
  minimap.js            — live page thumbnails, reorder/rotate/delete pages
  search.js             — find text (Ctrl+F)
  selection.js          — multi-select (Shift+click) group operations
  autosave.js           — IndexedDB session persistence & recovery
  history.js            — undo/redo history manager
  ui.js                 — drag-drop upload, toast, modal, animations
  types.js              — JSDoc type definitions and coordinate system docs
  utils/
    constants.js        — shared numeric constants
    color.js            — RGB/hex conversion, color sampling
    color-popover.js    — custom color + opacity picker popover
    canvas.js           — cover original positions, capture canvas regions
    floating-toolbar.js — shared toolbar positioning and dismiss logic
css/
  base.css              — variables, reset, buttons, animations
  editor.css            — editor UI, toolbars, PDF viewer, text/image styles
  components.css        — toast, modal, color popover, tooltips, responsive
  nav.css / hero.css / features.css / footer.css — landing page sections
tests/
  e2e/                  — Playwright suite (features + regressions)
  fixtures/             — test PDFs and images
```

## License

MIT
