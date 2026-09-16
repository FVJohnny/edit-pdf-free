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
- Existing text is removed from the page content before its replacement is written, so deleted/replaced text does not remain underneath
- Text removal preserves background images, fills and vector lines; the preview renders the same removal with undo and zoom support
- Original font resources are reused using PostScript names and CMap/source character encodings, including older PDFs without ToUnicode
- Mixed fonts/sizes remain separate editable fragments. Original text color and rotated baselines are retained
- Font compatibility is checked while editing and before export. Missing original glyphs require confirmation before substitution; unsupported characters block export instead of disappearing.
- Original image occurrences are removed before moving/resizing/deleting; backgrounds, original image content, transparency and affine transforms are retained for supported images. Ambiguous overlaps are reported.
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
documented bug fixes:

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
- **MuPDF.js 1.28.1** — local WebAssembly worker for real text/image removal (AGPL/commercial; see `vendor/mupdf/README.md`)
- **pdf-lib** — PDF manipulation and saving
- **fontkit** — font embedding support
- **Vanilla HTML/CSS/JS** — no framework, no bundler, ES modules
- **Playwright** — end-to-end test suite

## Architecture

```
index.html              — landing page + editor UI
js/
  app.js                — entry point: state, file loading, image import, tools
  pdf-loader.js         — shared font resources and PDF.js loading options
  renderer.js           — PDF rendering, text/image extraction, drag, resize
  viewport-renderer.js  — visible-region detail rendering, cancellation and memory limits
  document-structure.js — preserve pages, forms, links, bookmarks and catalog
  image-removal-core.js — remove selected image occurrences in the local worker
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
    canvas.js           — refresh original text/image backgrounds, capture regions
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

[IDGAF](LICENSE) — do whatever you want with it.

## Real text editing architecture

`text-removal.js` snapshots removal regions and calls one lazy local worker.
`text-removal-core.js` matches the selected source text and baseline to the
original glyphs, rejects ambiguous overlapping selections, and removes only
those characters while retaining image/vector content and font resources.
All removal happens before replacement drawing, including multi-page moves.
The worker installs its message handler before loading WASM so an immediate
first save cannot lose its request. Output is rewritten with garbage collection.

`renderer.js` reads original character encodings from PDF.js operators, avoiding
assumptions about document-wide font counters. `saver.js` reuses the original
font and encoding, including fonts inside nested Form XObjects (embedded PDF
pages), and retains the original fill opacity. An explicit fallback notice
appears when the original font cannot render the replacement. Source
files are never overwritten and processing remains on the user's device.

Scanned text is still an image and requires OCR; this change does not implement
OCR or Word-style paragraph reflow. Overlapping text that cannot be isolated is
reported rather than silently erasing a neighbour. Existing redaction annotations
must be resolved first. Editing signed PDFs does not preserve signature validity.

Runtime dependencies and interface fonts are self-hosted. After changing the
pinned MuPDF npm version, run `npm run vendor:mupdf` and review its licensing and
regression tests before publishing. The project's permissive license does not
replace the bundled MuPDF AGPL/commercial licensing terms.

## Fidelity and document preservation

- Paragraph grouping follows aligned lines within each column, keeps original
  leading, and leaves different fonts/sizes/colors as separate editable runs.
  The editing notice flags text that overlaps another text block or exceeds the
  page. Reflow across runs/pages is not automatic.
- The original document remains the destination during saving. Its metadata,
  attachments, form fields, annotations, links and bookmarks survive page edits.
  Reordering retains page references and page labels; deletion removes obsolete
  link/widget destinations. Merged forms receive a namespace to avoid duplicate
  field names and colliding font resources; donor bookmarks and links are copied.
  The editor does not expose a form-filling UI or validate digital signatures.
- Visible PDF regions render at zoom × devicePixelRatio. Original loaded pages
  share a 16-million-pixel base-preview budget; each visible detail surface is
  limited to 8 million pixels and 4096 pixels per side. Offscreen detail surfaces
  are released. Image decoding and DOM overlays consume additional memory; this
  is a bitmap budget, not a bound on total browser memory.
- Scans, image masks, ambiguous overlapping images, unusual clipping/blend groups
  and fonts without usable glyph encodings can still require a different workflow.
  The app reports an unsupported removal rather than painting a cover rectangle.

## Browser validation

Run `npm test` for Chromium desktop and touch-emulation regressions.
Run `npm run test:browsers` for the desktop suite in Firefox and WebKit, plus
mobile WebKit tap/edit/format/image/save/reopen scenarios. Install test engines
with `npx playwright install chromium firefox webkit` first.

The latest checked scenarios and limitations are recorded in [QA.md](QA.md).

These are automated browser-engine and mobile-emulation checks. They do not
substitute for testing on physical iOS/Android devices. Finger-drag coverage uses
Chromium's touch input; mobile WebKit coverage uses Playwright touchscreen taps.

Type3 fonts (vector glyph programs, including the supplied long report) are
identified through their font descriptor when `/BaseFont` is absent. Their
original glyph programs and FontMatrix are reused. Because such a font has no
browser font file, the in-progress typing layer is approximate; after confirming
an edit, the preview renders the exact PDF glyphs. The editor says this explicitly.

The PDF.js standard-font programs (including Symbol/Dingbats) are bundled under
`vendor/pdfjs-standard-fonts`, with their licenses. All document-loading paths use
`pdf-loader.js`, which also disables font-code evaluation following the
[PDF.js maintainer workaround for CVE-2024-4367](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq).
