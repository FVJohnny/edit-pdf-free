# PDF Editor

A free, browser-based PDF text editor at EditPDFFree.com. No signup, no subscription, no watermarks. All processing happens client-side — PDFs never leave the user's device.

## Stack

- **Frontend only** — static HTML/CSS/JS, no backend
- **pdf-lib** for PDF manipulation (editing, saving)
- **PDF.js** (pdfjs-dist) for rendering PDFs in the browser
- **fontkit** for font embedding support
- Served locally with `npx serve .`

## Key Files

- `index.html` — landing page + editor section
- `app.js` — all editor logic (PDF loading, text overlay editing, drag-to-move, format toolbar, save)
- `styles.css` — full styling including animations and editor UI

## Running Locally

```
npm install
npm start
```

Opens on `http://localhost:3000` by default.

## Testing

Use the MCP Chrome tools (`mcp__chrome__*`) to test features in the browser. Launch the app, navigate to it, upload `test.pdf`, and interact with the editor to verify text editing, drag-to-move, the format toolbar, and PDF saving all work correctly.

## Rules

- **Never commit without explicit user approval.** Always ask before committing.
