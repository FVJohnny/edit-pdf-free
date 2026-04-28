/**
 * Free-hand drawing tool.
 *
 * When draw mode is active, an SVG overlay is added to each page container.
 * Mouse interactions on those overlays capture strokes as quadratic-Bezier
 * smoothed SVG paths. Each completed stroke is recorded in the history stack
 * and stored in the strokes array so the saver can convert it to a PDF
 * vector path on save.
 *
 * Coordinates: stroke points are stored in canvas pixels (same convention as
 * other items — see js/types.js). The saver converts to PDF points by
 * dividing by the page's canvas-pixel-per-PDF-point scale.
 */
import { recordAction } from './history.js';
import { DRAG_THRESHOLD } from './utils/constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Active drawing settings, mutated via the palette UI. */
const settings = {
    color: '#e84444',
    size: 4,
    opacity: 1,
};

let drawMode = false;
let pdfViewerEl = null;
let strokesArray = null; // shared with app.js

/**
 * Initialise draw module with the viewer and the strokes-list reference.
 * @param {HTMLElement} pdfViewer
 * @param {Array} strokes  shared array app.js owns; we push DrawStroke objects here
 */
export function initDraw(pdfViewer, strokes) {
    pdfViewerEl = pdfViewer;
    strokesArray = strokes;
}

export function isDrawMode() {
    return drawMode;
}

export function setDrawSettings(partial) {
    Object.assign(settings, partial);
}

export function getDrawSettings() {
    return { ...settings };
}

/** Enable/disable draw mode. Adds/removes per-page overlays. */
export function setDrawMode(active) {
    drawMode = active;
    if (!pdfViewerEl) return;
    pdfViewerEl.classList.toggle('draw-mode', active);
    if (active) {
        ensureOverlays();
    } else {
        // Overlays stay so previously-drawn strokes remain visible, but become
        // pointer-events none via .draw-mode CSS rules being absent.
        for (const overlay of pdfViewerEl.querySelectorAll('.draw-overlay')) {
            overlay.style.pointerEvents = 'none';
        }
    }
}

/**
 * Public hook: ensure overlays are attached/refreshed for all current pages.
 * Call this after pages are added/removed while draw mode is active.
 */
export function refreshDrawOverlays() {
    if (!drawMode) return;
    ensureOverlays();
}

/** Make sure each page container has a draw overlay attached. */
function ensureOverlays() {
    const pages = pdfViewerEl.querySelectorAll(':scope > div');
    for (const page of pages) {
        if (page.querySelector(':scope > .draw-overlay')) {
            const existing = page.querySelector(':scope > .draw-overlay');
            existing.style.pointerEvents = 'auto';
            continue;
        }
        attachOverlay(page);
    }
}

/** Create and wire an SVG overlay for one page. */
function attachOverlay(pageContainer) {
    const canvas = pageContainer.querySelector('canvas');
    if (!canvas) return;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'draw-overlay');
    svg.setAttribute('viewBox', `0 0 ${canvas.width} ${canvas.height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'auto';
    pageContainer.appendChild(svg);

    svg.addEventListener('mousedown', (e) => beginStroke(e, svg, pageContainer, canvas));
}

/** Begin tracking a new stroke. */
function beginStroke(mouseDownEvent, svg, pageContainer, canvas) {
    if (!drawMode) return;
    mouseDownEvent.preventDefault();
    mouseDownEvent.stopPropagation();

    const { color, size, opacity } = settings;
    const points = [];
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(size));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('opacity', String(opacity));
    svg.appendChild(path);

    const pushPoint = (clientX, clientY) => {
        const rect = canvas.getBoundingClientRect();
        const cssX = clientX - rect.left;
        const cssY = clientY - rect.top;
        // Convert CSS pixels to canvas pixels (the SVG viewBox is in canvas pixels).
        const cssToCanvas = canvas.width / rect.width;
        const x = cssX * cssToCanvas;
        const y = cssY * cssToCanvas;
        // Skip very-close-together points to keep paths compact.
        const last = points[points.length - 1];
        if (last && Math.hypot(x - last.x, y - last.y) < 1.5) return;
        points.push({ x, y });
        path.setAttribute('d', buildSmoothPath(points));
    };

    pushPoint(mouseDownEvent.clientX, mouseDownEvent.clientY);

    const onMove = (e) => pushPoint(e.clientX, e.clientY);
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);

        // Discard accidental clicks that didn't move
        if (points.length < 2) {
            // Treat single tap as a tiny dot for visual feedback
            const p = points[0];
            const totalMove = 0;
            if (totalMove < DRAG_THRESHOLD) {
                path.remove();
                return;
            }
        }

        const stroke = {
            pageContainer,
            canvas,
            element: path,
            color,
            size,
            opacity,
            points: points.slice(),
        };
        strokesArray.push(stroke);

        recordAction({
            undo() {
                if (path.parentNode) path.parentNode.removeChild(path);
                const idx = strokesArray.indexOf(stroke);
                if (idx !== -1) strokesArray.splice(idx, 1);
            },
            redo() {
                svg.appendChild(path);
                strokesArray.push(stroke);
            },
        });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

/**
 * Build an SVG path "d" attribute from a list of points using quadratic-Bezier
 * smoothing through midpoints — gives a soft, natural look without overshoot.
 */
function buildSmoothPath(points) {
    if (points.length === 0) return '';
    if (points.length === 1) {
        const p = points[0];
        return `M ${p.x} ${p.y} L ${p.x + 0.01} ${p.y + 0.01}`;
    }
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        d += ` Q ${a.x} ${a.y} ${midX} ${midY}`;
    }
    const last = points[points.length - 1];
    d += ` L ${last.x} ${last.y}`;
    return d;
}
