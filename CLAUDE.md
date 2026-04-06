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
  app.js                — entry point: state, file loading, wiring
  ui.js                 — animations, drag-drop upload, toast, modal, smooth scroll
  toolbar.js            — format toolbar logic and event handlers
  editor.js             — inline text editing (contentEditable)
  renderer.js           — PDF rendering, text layer, font/color detection, drag-to-move
  saver.js              — PDF save with CMap parsing, font embedding, cover rects
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

5. **Save PDF** — Click "Save PDF", enter a filename, and confirm. Intercept or download the generated PDF.

6. **Verify saved PDF** — Re-load the saved PDF back into the editor (or open in a new tab). Check:
   - **Cover rects** — The original positions of moved/edited text are cleanly covered with the correct background color. The cover rects should NOT bleed over adjacent text or graphics.
   - **New text placement** — Edited and moved texts appear at their expected positions.
   - **Font fidelity** — Text that wasn't changed in style should use the original PDF font (via CMap encoding). Text with style overrides should use the correct fallback font (Helvetica/Times/Courier family).
   - **Font size** — Any size changes are reflected correctly in the saved PDF.
   - **Colors** — Text color overrides are preserved in the saved output.
   - **Bold/Italic** — Style overrides render correctly in the saved PDF.
   - **Unmodified text** — Text that was NOT edited should be completely unchanged — no artifacts, no cover rects, no font substitution.

### Quick smoke test

At minimum, for small changes: edit one text, drag another, change the color of a third, save the PDF, reload it, and verify nothing is broken.

### Keeping tests up to date

When adding or removing features, update this test plan accordingly. New features need corresponding test steps. Removed features should have their test steps deleted. The test plan should always reflect the current state of the app.

## Rules

- **Never commit without explicit user approval.** Always ask before committing.
