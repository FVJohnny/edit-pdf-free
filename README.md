# [editpdffree.com](https://editpdffree.com)

A free, browser-based PDF text editor. No subscription, no account, no uploads — everything runs locally in your browser.

## Features

- Import PDF files
- View PDF pages
- Click on text to edit it
- Save modified PDF

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open your browser and navigate to:
```
http://localhost:3000
```

## How to Use

1. **Import PDF**: Click on the file input and select a PDF file from your computer
2. **View PDF**: The PDF will be displayed in the viewer on the left side
3. **Edit Text**: Click on any text in the PDF to select it. The text will appear in the editor on the right
4. **Update Text**: Modify the text in the text area and click "Update Text"
5. **Save PDF**: Click "Save PDF" to download the modified PDF file

## Technologies Used

- **PDF.js**: For rendering and displaying PDF files
- **pdf-lib**: For modifying and saving PDF files
- **HTML/CSS/JavaScript**: For the user interface

## Notes

- Only text content can be edited (no images or other elements)
- The editor uses Helvetica font for replaced text
- Original formatting may change slightly when text is edited
