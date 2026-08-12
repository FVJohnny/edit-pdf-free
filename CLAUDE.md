# PDF Editor

A free, browser-based PDF text editor at EditPDFFree.com. No signup, no subscription, no watermarks. All processing happens client-side — PDFs never leave the user's device.

## Stack

- **Frontend only** — static HTML/CSS/JS (ES modules), no backend/bundler
- **pdf-lib** for PDF manipulation (editing, saving)
- **PDF.js** (pdfjs-dist) for rendering PDFs in the browser
- **fontkit** for font embedding support
- Served locally with `npx serve .`

## Project Structure

```
index.html              — landing page + editor section
styles.css              — CSS imports (delegates to css/ modules)
js/
  app.js                — entry point: state, file loading, image import, wiring
  ui.js                 — animations, drag-drop upload, toast, modal, smooth scroll
  toolbar.js            — text format toolbar (bold, italic, size, color, delete)
  image-toolbar.js      — image toolbar (delete, selection highlight)
  editor.js             — inline text editing (contentEditable)
  history.js            — undo/redo history manager (action stack)
  renderer.js           — PDF rendering, text/image extraction, drag-to-move, resize
  saver.js              — PDF save: text, images, CMap fonts, download
  types.js              — JSDoc type definitions (TextItem, ImageItem, coordinate docs)
  utils/
    constants.js        — shared numeric constants (thresholds, sizes, margins)
    color.js            — RGB/hex conversion, color sampling from canvas
    canvas.js           — cover original positions, capture canvas regions
    floating-toolbar.js — shared floating toolbar positioning and dismiss logic
css/
  base.css              — variables, reset, buttons, animations
  nav.css               — navigation bar
  hero.css              — hero section with orb animations
  editor.css            — editor UI, upload zone, toolbar, PDF viewer, format toolbar
  features.css          — features grid
  footer.css            — footer
  components.css        — toast, modal, responsive breakpoints
assets/
  favicon.png           — site favicon
  logo.png              — site logo
tests/
  fixtures/             — test PDF files (test.pdf, add more here)
```

## Running Locally

```
npm install
npm start
```

Opens on `http://localhost:3000` by default.

## Testing

Use the MCP Chrome tools (`mcp__chrome__*`) to test features in the browser. Launch Chrome, navigate to `http://localhost:3000`, and upload `tests/fixtures/with-colored-texts-and-images.pdf`.

**Important:** Always interact like a real user — use `click`, `type`, `scroll`, `press_key`, and `screenshot` tools. Do NOT use `eval` to manipulate DOM, change text, or simulate events. Only use `eval` for setup that can't be done through the UI (e.g. uploading a file via the file input).

### Test plan (run after every significant change)

1. **Load PDF** — Upload `test.pdf`, verify all pages render and text items appear as invisible overlays (hover to reveal).

2. **Edit multiple texts** — Click on at least 3 different text items across different pages. Change their content. Verify:
   - The text becomes editable (red outline, cursor appears).
   - Format toolbar appears above the text.
   - After editing, the text shows a green "modified" outline.

3. **Format toolbar** — For each edited text, test:
   - **Bold** — Toggle bold on/off, verify the text weight changes visually.
   - **Italic** — Toggle italic on/off, verify the text style changes.
   - **Font size** — Increase and decrease size with A+/A-, verify the text resizes.
   - **Color** — Change the text color using the color picker, verify it updates.
   - Verify the toolbar state (active buttons, size label, color swatch) reflects the current formatting.

4. **Drag-to-move** — Drag a text item to a new position. Verify:
   - The original position is covered (white/bg-color rect) **immediately when the drag starts**, not after dropping.
   - The text moves smoothly with the cursor.
   - The format toolbar follows the text during the drag.
   - After dropping, the text stays at the new position with a dashed green outline.

5. **Drag-to-move images** — Drag an image (e.g. the Accelio logo) to a new position. Verify:
   - Images in the PDF are detected and show a hover highlight (red border) when moused over.
   - The original position is covered (white/bg-color rect) **immediately when the drag starts**.
   - The image moves smoothly with the cursor, showing the captured image content.
   - After dropping, the image stays at the new position with a dashed green outline.
   - **Resize** — Hover over an image to reveal resize handles (red corner dots, edge cursors). Drag a corner or edge to resize. Verify the image scales and the original position is covered.
   - **Shift+Resize (aspect ratio lock)** — Hold Shift while dragging any resize handle. Verify the image maintains its original aspect ratio throughout the resize. Test with both corner and edge handles.

6. **Add blank pages** — Scroll to a page in the middle of the document, click "Page Before" and "Page After". Verify:
   - The blank pages are inserted immediately before/after the **current** page (not at the document ends).
   - Page dimensions match the current page, white background.
   - You can place text and import images on a blank page (test at least one).
   - Undo/redo correctly removes/re-adds the blank pages.
   - The saved PDF has the blank pages at the same positions.

6b. **Cross-page drag** — Drag a text item and an image from one page onto another (drag toward the viewer edge; it auto-scrolls until the target page is visible, including targets several pages away). Verify:
   - The item reparents onto the target page and stays under the cursor.
   - For existing (extracted) items, the original position on the source page is covered.
   - Undo returns the item to its original page and position.
   - In the saved PDF the item appears on the target page (for existing images this exercises copying the XObject to the target page's resources; for existing text the cover must be on the source page).

6c. **Multi-image import + compression** — Select 2+ images in one Import Image dialog. A "Compress images?" modal offers High quality / Balanced / Smallest / Original. Verify:
   - All images are placed with a small cascade offset and each is independently draggable.
   - Choosing a compression level re-encodes the images (toast shows original → compressed size) and the size indicator drops accordingly.
   - "Original" imports unchanged bytes; Cancel aborts the import.

6d. **Start blank PDF** — On the upload zone, click "Or start with a blank PDF". Verify a one-page blank document loads and is fully editable (add text, import image, save).

6e. **Size indicator** — The toolbar shows the byte-accurate size the PDF would have if saved now. Verify it updates (debounced) after edits, and roughly matches the actual saved file size.

6f. **Minimap** — A thin page-preview strip on the right of the viewer. Verify thumbnails match the pages **including DOM overlays** (imported/moved images, new/edited text, drawings), the light strip tracks the scroll position, and clicking/dragging on the minimap scrolls the viewer.

6g. **Sticky editor bars** — Scroll the whole page (not the viewer) down past the editor. The toolbar and tools bar must stay pinned to the top of the viewport while any part of the editor is visible.

7. **Save PDF** — Click "Save PDF", enter a filename, and confirm. Intercept or download the generated PDF.

8. **Verify saved PDF** — Re-load the saved PDF back into the editor (or open in a new tab). Check:
   - **Cover rects** — The original positions of moved/edited text are cleanly covered with the correct background color. The cover rects should NOT bleed over adjacent text or graphics.
   - **New text placement** — Edited and moved texts appear at their expected positions.
   - **Font fidelity** — Text that wasn't changed in style should use the original PDF font (via CMap encoding). Text with style overrides should use the correct fallback font (Helvetica/Times/Courier family).
   - **Font size** — Any size changes are reflected correctly in the saved PDF.
   - **Colors** — Text color overrides are preserved in the saved output.
   - **Bold/Italic** — Style overrides render correctly in the saved PDF.
   - **Moved images** — Images that were dragged appear at their new positions in the saved PDF. The original positions are cleanly covered.
   - **Resized images** — Images that were resized appear at their new dimensions in the saved PDF.
   - **Imported photos with EXIF rotation** — Import `tests/fixtures/exif-rotated-photo.jpg` (raw pixels sideways, EXIF orientation tag 6). It must appear upright both in the editor preview AND in the saved PDF (PDF viewers ignore EXIF, so the save path must bake the rotation into the pixels).
   - **Unmodified content** — Text and images that were NOT edited should be completely unchanged — no artifacts, no cover rects, no font substitution.
   - **Inserted blank pages** — Pages added before/after appear in the saved PDF in the correct order with the right dimensions, and any content placed on them is preserved.

6h. **Multi-line text** — While editing, Shift+Enter (or Cmd/Ctrl+Enter) inserts a line break; plain Enter confirms. Saved PDF keeps the lines.

6i. **Find** — Ctrl+F (or the magnifier button) opens the search bar; matches highlight, Enter/Shift+Enter cycle, the active match scrolls into view.

6j. **Sign** — The Sign button opens a draw-your-signature modal; placing it creates a transparent-PNG image item (drag/resize/delete like any image) that saves correctly.

6k. **Page management from the minimap** — Hovering a thumbnail shows: drag handle (⠿) to reorder, ⟳ to rotate the page 90° (bakes pending edits and reloads), ✕ to delete. Saved PDF matches the on-screen order exactly. Reorder and delete are undoable.

6l. **Rotate imported image** — Select an imported image; the rotate button in its toolbar turns it 90° (undoable).

6m. **Delete Page button** — The toolbar's Delete Page (trash) button removes the page currently in view and everything on it, with undo. Deleting the only remaining page is refused with a toast.

6n. **Multi-select** — Shift+click several texts/images (blue dashed outline); dragging one moves the group (stays on their pages); Delete removes all; both undoable in one step.

6o. **Font & alignment** — The text toolbar has a family select (Original/Helvetica/Times/Courier) and left/center/right alignment; both reflected in the saved PDF (multi-line alignment offsets each line).

6p. **Annotations** — The draw palette has pen / highlighter / rectangle / arrow tools. Highlighter is wide and translucent. All save as vector paths and show in the minimap.

6q. **Autosave** — After editing, reload the page: the upload zone offers "Recover last session"; it restores the document with edits baked in.

6r. **Password PDFs** — Opening an encrypted PDF prompts for the password (retries on a wrong one).

6s. **Sharp zoom** — Zoom to 200%: after a moment the page re-renders sharp (no CSS blur), covers stay covered, drag/resize remain accurate.

### Quick smoke test

At minimum, for small changes: edit one text, drag another text, drag an image, change the color of a third text, save the PDF, reload it, and verify nothing is broken.

### Keeping tests up to date

When adding or removing features, update this test plan accordingly. New features need corresponding test steps. Removed features should have their test steps deleted. The test plan should always reflect the current state of the app.

## Rules

- **Never commit without explicit user approval.** Always ask before committing.
- **Track all work in TODO.md.** Every new feature or task must be added to `TODO.md` with a checkbox. Check it off when complete.
