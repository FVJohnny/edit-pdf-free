# TODO

## PDF Toolbar (above PDF viewer)

A small toolbar that appears above the PDF once loaded.

- [x] **Import Image** — Add an external image (PNG/JPG) to the pdf
- [x] **Multi-image import** — Select several images at once; they import with a cascade offset
- [x] **Add Text** — Insert a new text block
- [x] **Undo / Redo** — Undo and redo all actions (Ctrl+Z / Ctrl+Shift+Z)
- [x] **Zoom In / Zoom Out** — Control the PDF view zoom level
- [x] **Add Page** — Insert a blank page before or after the current page
- [x] **Merge PDF** — Select another PDF file and append its pages after the current PDF
- [x] **Size indicator** — Live, byte-accurate size of the PDF as it would save right now
- [x] **Start blank PDF** — Create a one-page blank PDF from the upload zone, no file needed
- [x] **Cross-page drag** — Drag text and images between pages (auto-scrolls at viewer edges)
- [x] **Minimap scrollbar** — Thin live preview of all pages with a strip showing the viewport; click/drag to scroll

## Image Toolbar

A floating toolbar that appears when clicking on an image (similar to text format toolbar).

- [x] **Delete Image** — Remove an image from the PDF (trash icon button)
- [x] **Download Image** — Download the image as a file

## Drag Constraints

- [x] **Page-bound dragging** — Prevent dragging text or images outside their page boundaries

## Bug Fixes

- [x] **EXIF orientation on imported photos** — Photos with an EXIF rotation tag (phone cameras) were embedded with raw bytes, so the saved PDF showed them rotated. Now re-encoded upright at import.
- [x] **Image compression on import** — Ask for a compression level (High/Balanced/Smallest/Original) when importing images; re-encodes and downscales client-side
- [x] **Minimap shows overlays** — Imported/moved images and new/edited text render in the minimap thumbnails
- [x] **Sticky editor bars** — Toolbar and tools bar stay pinned to the top of the viewport while the editor is on screen
- [x] **UX polish** — Auto-scroll (smooth) to the editor on PDF load; drawings render in the minimap; reduced empty space below the editor
