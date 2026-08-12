/**
 * Signature tool — draw a signature in a modal, then place it on the PDF as a
 * transparent PNG image item (it goes through the normal image-import
 * pipeline, so it can be dragged, resized, moved across pages and deleted).
 */

const CANVAS_W = 560;
const CANVAS_H = 220;
const BACKING = 2; // 2x backing for a crisp stroke
const INK_COLORS = [
    { label: 'Black', value: '#1a1a1a' },
    { label: 'Blue', value: '#1f4dbc' },
];

/**
 * @param {(dataURL: string) => void} onReady - called with the trimmed
 *   transparent-PNG data URL when the user confirms.
 */
export function initSignature(onReady) {
    document.getElementById('signBtn').addEventListener('click', () => openSignatureModal(onReady));
}

function openSignatureModal(onReady) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal modal--signature">
            <h3 class="modal-title">Draw your signature</h3>
            <label class="modal-label">Use your mouse, trackpad or finger</label>
            <canvas class="signature-canvas" width="${CANVAS_W * BACKING}" height="${CANVAS_H * BACKING}"></canvas>
            <div class="signature-controls">
                <div class="signature-colors"></div>
                <button class="modal-btn modal-btn--cancel signature-clear">Clear</button>
            </div>
            <div class="modal-actions">
                <button class="modal-btn modal-btn--cancel">Cancel</button>
                <button class="modal-btn modal-btn--confirm" disabled>Place signature</button>
            </div>
        </div>
    `;

    const canvas = overlay.querySelector('.signature-canvas');
    canvas.style.width = CANVAS_W + 'px';
    canvas.style.height = CANVAS_H + 'px';
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.5 * BACKING;

    const confirmBtn = overlay.querySelector('.modal-btn--confirm');
    let hasInk = false;
    let color = INK_COLORS[0].value;

    // Color swatches
    const colorsEl = overlay.querySelector('.signature-colors');
    for (const ink of INK_COLORS) {
        const swatch = document.createElement('button');
        swatch.className = 'signature-swatch' + (ink.value === color ? ' active' : '');
        swatch.style.background = ink.value;
        swatch.setAttribute('aria-label', ink.label);
        swatch.addEventListener('click', () => {
            color = ink.value;
            colorsEl.querySelectorAll('.signature-swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
        });
        colorsEl.appendChild(swatch);
    }

    // Drawing (pointer events — mouse, trackpad, touch, stylus)
    let drawing = false;
    let last = null;
    const toCanvas = (e) => {
        const r = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * (canvas.width / r.width),
            y: (e.clientY - r.top) * (canvas.height / r.height),
        };
    };
    canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        drawing = true;
        last = toCanvas(e);
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        const p = toCanvas(e);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        // Midpoint smoothing keeps the line soft
        ctx.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        last = p;
        if (!hasInk) {
            hasInk = true;
            confirmBtn.disabled = false;
        }
    });
    const stopDrawing = () => { drawing = false; };
    canvas.addEventListener('pointerup', stopDrawing);
    canvas.addEventListener('pointercancel', stopDrawing);

    overlay.querySelector('.signature-clear').addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasInk = false;
        confirmBtn.disabled = true;
    });

    const close = () => {
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 300);
    };
    overlay.querySelector('.modal-btn--cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    confirmBtn.addEventListener('click', () => {
        const trimmed = trimToInk(canvas);
        if (trimmed) onReady(trimmed.toDataURL('image/png'));
        close();
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));
}

/** Crop the canvas to the inked bounding box (plus padding). Null if empty. */
function trimToInk(canvas) {
    const ctx = canvas.getContext('2d');
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] > 0) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) return null;
    const pad = 8;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad);
    maxY = Math.min(height - 1, maxY + pad);
    const out = document.createElement('canvas');
    out.width = maxX - minX + 1;
    out.height = maxY - minY + 1;
    out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out;
}
