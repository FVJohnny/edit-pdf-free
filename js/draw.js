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
import { layoutWidth, layoutHeight } from './utils/canvas.js';
import { combineHexAlpha } from './utils/color.js';
import { openColorPopover } from './utils/color-popover.js';
import { createFloatingToolbar } from './utils/floating-toolbar.js';
// Circular with image-toolbar.js (it imports clearStrokeSelection) — safe:
// both are function declarations only called at event time.
import { hideImageToolbar } from './image-toolbar.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Active drawing settings, mutated via the palette UI. */
const settings = {
    tool: 'pen', // 'pen' | 'highlighter' | 'rect' | 'arrow'
    color: '#e84444',
    size: 4,
    opacity: 1,
};

let drawMode = false;
let pdfViewerEl = null;
let strokesArray = null; // shared with app.js
let onStrokeComplete = null; // app hook, called after a stroke/shape is finished

export function setOnStrokeComplete(cb) {
    onStrokeComplete = cb;
}

export function getSelectedStroke() {
    return selectedStroke;
}

/** Drop any stroke selection UI (outline, handles, toolbar). For new-doc loads. */
export function clearStrokeSelection() {
    if (selectedStroke) deselectStrokeIfSelected(selectedStroke);
    else strokeToolbar.hide();
}

export function deleteSelectedStroke() {
    if (selectedStroke) deleteStroke(selectedStroke);
}

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

/**
 * Find a stroke on this page near the given layout-coordinate point.
 * Widens each path's stroke temporarily so taps don't need pixel accuracy;
 * filled shapes also hit anywhere inside their fill. Topmost wins.
 */
function findStrokeNear(pageContainer, x, y) {
    const TOLERANCE = 22;
    const pt = new DOMPoint(x, y);
    let best = null;
    for (const stroke of strokesArray) {
        if (stroke.pageContainer !== pageContainer) continue;
        const p = stroke.element;
        if (!p.isConnected) continue;
        const orig = p.getAttribute('stroke-width');
        // stroke-width widens both sides of the centerline, so double the
        // tolerance to get TOLERANCE px of actual reach from the line.
        p.setAttribute('stroke-width', String((stroke.size || 2) + TOLERANCE * 2));
        let hit = false;
        try {
            hit = p.isPointInStroke(pt) || (!!stroke.fillColor && p.isPointInFill(pt));
        } catch (_) { /* older engines without geometry APIs */ }
        p.setAttribute('stroke-width', orig);
        if (hit) best = stroke;
    }
    return best;
}

/** Create and wire an SVG overlay for one page. */
function attachOverlay(pageContainer) {
    const canvas = pageContainer.querySelector('canvas');
    if (!canvas) return;

    // Outside draw mode, taps near (not exactly on) a stroke select it — the
    // painted line alone is a hopeless touch target. Only background taps
    // reach this listener: text/image handlers stopPropagation their own.
    pageContainer.addEventListener('pointerdown', (e) => {
        if (drawMode) return;
        if (e.target.closest?.('.draw-overlay path, .shape-handles')) return;
        const r = canvas.getBoundingClientRect();
        const s = layoutWidth(canvas) / r.width;
        const stroke = findStrokeNear(pageContainer, (e.clientX - r.left) * s, (e.clientY - r.top) * s);
        if (stroke) startStrokeDrag(e, stroke);
    });

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'draw-overlay');
    svg.setAttribute('viewBox', `0 0 ${layoutWidth(canvas)} ${layoutHeight(canvas)}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'auto';
    pageContainer.appendChild(svg);

    svg.addEventListener('pointerdown', (e) => beginStroke(e, svg, pageContainer, canvas));
    // iOS Safari ignores touch-action on SVG elements, so the scroll gesture
    // must be suppressed explicitly or drawing with a finger pans the page.
    svg.addEventListener('touchstart', (e) => {
        if (drawMode) e.preventDefault();
    }, { passive: false });
}

/** Begin tracking a new stroke or shape. */
function beginStroke(mouseDownEvent, svg, pageContainer, canvas) {
    if (!drawMode) return;
    mouseDownEvent.preventDefault();
    mouseDownEvent.stopPropagation();

    const { tool, color, size, opacity } = settings;
    // Highlighter is just a wide translucent pen stroke
    const effSize = tool === 'highlighter' ? size * 4 : size;
    const effOpacity = tool === 'highlighter' ? Math.min(opacity, 0.4) : opacity;
    const isShape = tool === 'rect' || tool === 'arrow' || tool === 'circle' || tool === 'star';

    const points = [];
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(effSize));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('opacity', String(effOpacity));
    svg.appendChild(path);

    const toLayout = (clientX, clientY) => {
        const rect = canvas.getBoundingClientRect();
        const cssToCanvas = layoutWidth(canvas) / rect.width;
        return { x: (clientX - rect.left) * cssToCanvas, y: (clientY - rect.top) * cssToCanvas };
    };

    const pushPoint = (clientX, clientY) => {
        const p = toLayout(clientX, clientY);
        if (isShape) {
            // Shapes track only start + current point
            if (points.length === 0) points.push(p);
            points[1] = p;
        } else {
            // Skip very-close-together points to keep paths compact.
            const last = points[points.length - 1];
            if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1.5) return;
            points.push(p);
        }
        path.setAttribute('d', buildShapePath(tool, points, effSize));
    };

    pushPoint(mouseDownEvent.clientX, mouseDownEvent.clientY);

    const onMove = (e) => pushPoint(e.clientX, e.clientY);
    const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);

        // Discard accidental clicks that didn't move
        if (points.length < 2 ||
            (isShape && Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) < DRAG_THRESHOLD)) {
            path.remove();
            return;
        }

        const stroke = {
            pageContainer,
            canvas,
            element: path,
            shape: tool,
            color,
            fillColor: null,
            size: effSize,
            opacity: effOpacity,
            points: points.slice(),
        };
        strokesArray.push(stroke);
        makeStrokeInteractive(stroke);
        // Select the fresh stroke right away so it can be tweaked immediately
        selectStroke(stroke);
        onStrokeComplete?.(stroke);

        recordAction({
            undo() {
                deselectStrokeIfSelected(stroke);
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

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
}

// ============================================
// Stroke selection & editing — click a drawn stroke/shape to select it: a
// floating toolbar (line color, fill color, transparent fill, delete) follows
// it like the text toolbar. Dragging moves the stroke. A freshly drawn stroke
// selects itself so it can be tweaked immediately.
// ============================================

const strokeToolbarEl = document.getElementById('strokeToolbar');
const strokeColorInput = document.getElementById('strokeColorInput');
const strokeFillInput = document.getElementById('strokeFillInput');
const strokeDeleteBtn = document.getElementById('strokeDelete');
const strokeWidthInput = document.getElementById('strokeWidthInput');
const strokeWidthLabel = document.getElementById('strokeWidthLabel');

const strokeToolbar = createFloatingToolbar(strokeToolbarEl, {
    shouldIgnoreTarget: (target) => target.classList?.contains('stroke-path'),
    // Single cleanup point — runs on programmatic hide AND self-dismissal
    // (outside clicks), so outline/handles can never outlive the toolbar.
    onHide: (stroke) => {
        stroke.element.classList.remove('stroke-selected');
        if (selectedStroke === stroke) selectedStroke = null;
        if (handlesStroke === stroke) removeShapeHandles();
    },
});

let selectedStroke = null;

/** Clear selection state (outline, handles, toolbar) if this stroke is selected. */
function deselectStrokeIfSelected(stroke) {
    if (selectedStroke !== stroke) return;
    strokeToolbar.hide(); // onHide does the cleanup
}

/** Paint the toolbar's swatch buttons with the stroke's current colors. */
function refreshStrokeSwatches(stroke) {
    strokeColorInput.style.setProperty('--swatch-color', combineHexAlpha(stroke.color, stroke.opacity));
    strokeFillInput.style.setProperty('--swatch-color',
        stroke.fillColor ? combineHexAlpha(stroke.fillColor, stroke.fillOpacity ?? 1) : 'transparent');
}

function selectStroke(stroke) {
    hideImageToolbar(); // selections are exclusive: drop any selected image
    if (selectedStroke) selectedStroke.element.classList.remove('stroke-selected');
    selectedStroke = stroke;
    stroke.element.classList.add('stroke-selected');
    refreshStrokeSwatches(stroke);
    // Fill only makes sense for closed shapes — a pen/highlighter line has
    // just its line color, so hide the fill control for it.
    const fillable = TWO_POINT_SHAPES.includes(stroke.shape) && stroke.shape !== 'arrow';
    strokeFillInput.style.display = fillable ? '' : 'none';
    strokeWidthInput.value = String(Math.round(stroke.size));
    strokeWidthLabel.textContent = String(Math.round(stroke.size));
    strokeToolbar.show(stroke);
    showShapeHandles(stroke);
}

/** Re-apply a stroke's size/opacity to its SVG path (arrow heads scale with size). */
function applyStrokeGeometry(stroke) {
    stroke.element.setAttribute('stroke-width', String(stroke.size));
    stroke.element.setAttribute('opacity', String(stroke.opacity));
    stroke.element.setAttribute('d', buildShapePath(stroke.shape || 'pen', stroke.points, stroke.size));
    positionShapeHandles(stroke); // selection padding tracks the width
}

// ============================================
// Shape resize handles — corners for rect/circle/star, endpoints for arrows
// ============================================

const TWO_POINT_SHAPES = ['rect', 'circle', 'star', 'arrow'];
let handlesBox = null;
let handlesStroke = null;

function removeShapeHandles() {
    handlesBox?.remove();
    handlesBox = null;
    handlesStroke = null;
}

function showShapeHandles(stroke) {
    removeShapeHandles();
    const layer = stroke.pageContainer.querySelector('.custom-text-layer');
    if (!layer) return;

    const isTwoPoint = TWO_POINT_SHAPES.includes(stroke.shape);
    // Normalize box shapes so points[0]=top-left, points[1]=bottom-right —
    // makes the corner-handle math unambiguous. (Arrows keep their direction.)
    if (isTwoPoint && stroke.shape !== 'arrow') {
        const [a, b] = stroke.points;
        stroke.points = [
            { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
            { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
        ];
    }

    handlesBox = document.createElement('div');
    handlesBox.className = 'shape-handles';
    handlesStroke = stroke;
    // Dashed selection rectangle around the shape (like text selection).
    // It doubles as the drag surface: a selected shape can be moved by
    // grabbing anywhere inside its bounding box, not just the stroke itself.
    const rect = document.createElement('div');
    rect.className = 'shape-selection-rect';
    rect.addEventListener('pointerdown', (e) => startStrokeDrag(e, stroke));
    rect.addEventListener('touchstart', (e) => {
        if (!drawMode) e.preventDefault();
    }, { passive: false });
    handlesBox.appendChild(rect);
    // Free-hand strokes get the selection box (for visibility + drag surface)
    // but no resize handles — their geometry isn't two-point.
    const roles = !isTwoPoint ? [] : stroke.shape === 'arrow' ? ['p0', 'p1'] : ['nw', 'ne', 'sw', 'se'];
    for (const role of roles) {
        const h = document.createElement('div');
        h.className = 'shape-handle';
        h.dataset.role = role;
        h.addEventListener('pointerdown', (e) => startHandleDrag(e, stroke, role));
        handlesBox.appendChild(h);
    }
    layer.appendChild(handlesBox);
    positionShapeHandles(stroke);
}

function positionShapeHandles(stroke) {
    if (!handlesBox || handlesStroke !== stroke) return;
    const [a, b] = stroke.points;
    const pos = stroke.shape === 'arrow'
        ? { p0: a, p1: b }
        : { nw: a, se: b, ne: { x: b.x, y: a.y }, sw: { x: a.x, y: b.y } };
    for (const h of handlesBox.querySelectorAll('.shape-handle')) {
        const p = pos[h.dataset.role];
        h.style.left = p.x + 'px';
        h.style.top = p.y + 'px';
    }
    // Selection rectangle spans the bounding box of ALL points (free-hand
    // strokes have many), plus stroke padding.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of stroke.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    const rect = handlesBox.querySelector('.shape-selection-rect');
    const pad = (stroke.size || 2) / 2 + 3;
    rect.style.left = (minX - pad) + 'px';
    rect.style.top = (minY - pad) + 'px';
    rect.style.width = (maxX - minX + pad * 2) + 'px';
    rect.style.height = (maxY - minY + pad * 2) + 'px';
}

function startHandleDrag(e, stroke, role) {
    e.preventDefault();
    e.stopPropagation();
    const canvas = stroke.canvas;
    const before = stroke.points.map(p => ({ ...p }));

    const applyPoints = (pts) => {
        stroke.points = pts.map(p => ({ ...p }));
        stroke.element.setAttribute('d', buildShapePath(stroke.shape, stroke.points, stroke.size));
        positionShapeHandles(stroke);
        strokeToolbar.reposition(stroke);
    };

    const onMove = (ev) => {
        const r = canvas.getBoundingClientRect();
        const s = layoutWidth(canvas) / r.width;
        const x = (ev.clientX - r.left) * s;
        const y = (ev.clientY - r.top) * s;
        const [a, b] = stroke.points.map(p => ({ ...p }));
        if (role === 'p0') { a.x = x; a.y = y; }
        else if (role === 'p1' || role === 'se') { b.x = x; b.y = y; }
        else if (role === 'nw') { a.x = x; a.y = y; }
        else if (role === 'ne') { b.x = x; a.y = y; }
        else if (role === 'sw') { a.x = x; b.y = y; }
        applyPoints([a, b]);
    };
    const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        const after = stroke.points.map(p => ({ ...p }));
        if (JSON.stringify(after) === JSON.stringify(before)) return;
        recordAction({
            undo() { applyPoints(before); },
            redo() { applyPoints(after); },
        });
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
}

/** Re-apply a stroke's colors + opacity to its SVG path. */
function applyStrokeStyle(stroke) {
    stroke.element.setAttribute('stroke', stroke.color);
    stroke.element.setAttribute('fill', stroke.fillColor || 'none');
    if (stroke.fillColor && stroke.fillOpacity != null) {
        stroke.element.setAttribute('fill-opacity', String(stroke.fillOpacity));
    } else {
        stroke.element.removeAttribute('fill-opacity');
    }
    stroke.element.setAttribute('opacity', String(stroke.opacity));
    if (selectedStroke === stroke) refreshStrokeSwatches(stroke);
}

// Line color & opacity: one popover, live preview, one undo entry on close
strokeColorInput.addEventListener('click', () => {
    const s = strokeToolbar.getActiveItem();
    if (!s) return;
    const before = { color: s.color, opacity: s.opacity };
    openColorPopover({
        anchor: strokeColorInput,
        color: s.color,
        alpha: s.opacity,
        onChange(hex, a) {
            s.color = hex;
            s.opacity = Math.max(0.05, a); // fully invisible lines help no one
            applyStrokeStyle(s);
        },
        onCommit() {
            if (before.color === s.color && before.opacity === s.opacity) return;
            const after = { color: s.color, opacity: s.opacity };
            recordAction({
                undo() { Object.assign(s, before); applyStrokeStyle(s); },
                redo() { Object.assign(s, after); applyStrokeStyle(s); },
            });
        },
    });
});

// Fill color & opacity — 0% opacity means "no fill" (replaces the old
// dedicated transparent-fill button)
strokeFillInput.addEventListener('click', () => {
    const s = strokeToolbar.getActiveItem();
    if (!s) return;
    const before = { fillColor: s.fillColor, fillOpacity: s.fillOpacity ?? null };
    openColorPopover({
        anchor: strokeFillInput,
        color: s.fillColor || '#ffffff',
        alpha: s.fillColor ? (s.fillOpacity ?? 1) : 0,
        onChange(hex, a) {
            s.fillColor = a === 0 ? null : hex;
            s.fillOpacity = a === 0 ? null : a;
            applyStrokeStyle(s);
        },
        onCommit() {
            if (before.fillColor === s.fillColor && before.fillOpacity === (s.fillOpacity ?? null)) return;
            const after = { fillColor: s.fillColor, fillOpacity: s.fillOpacity ?? null };
            recordAction({
                undo() { Object.assign(s, before); applyStrokeStyle(s); },
                redo() { Object.assign(s, after); applyStrokeStyle(s); },
            });
        },
    });
});

// Width slider: live preview on input, one undo entry on release
let strokeWidthBefore = null;
const rememberWidth = () => {
    const s = strokeToolbar.getActiveItem();
    strokeWidthBefore = s ? s.size : null;
};
strokeWidthInput.addEventListener('pointerdown', rememberWidth);
strokeWidthInput.addEventListener('input', () => {
    const s = strokeToolbar.getActiveItem();
    if (!s) return;
    if (strokeWidthBefore === null) rememberWidth(); // keyboard-driven changes skip pointerdown
    s.size = parseInt(strokeWidthInput.value, 10);
    strokeWidthLabel.textContent = strokeWidthInput.value;
    applyStrokeGeometry(s);
});
strokeWidthInput.addEventListener('change', () => {
    const s = strokeToolbar.getActiveItem();
    if (!s || strokeWidthBefore === null) return;
    const before = strokeWidthBefore;
    strokeWidthBefore = null;
    if (before === s.size) return;
    const after = s.size;
    recordAction({
        undo() { s.size = before; applyStrokeGeometry(s); },
        redo() { s.size = after; applyStrokeGeometry(s); },
    });
});

strokeDeleteBtn.addEventListener('click', () => {
    const s = strokeToolbar.getActiveItem();
    if (s) deleteStroke(s);
});

function deleteStroke(stroke) {
    const svg = stroke.element.parentNode;
    deselectStrokeIfSelected(stroke);
    stroke.element.remove();
    const idx = strokesArray.indexOf(stroke);
    if (idx !== -1) strokesArray.splice(idx, 1);
    recordAction({
        undo() {
            svg.appendChild(stroke.element);
            strokesArray.push(stroke);
        },
        redo() {
            deselectStrokeIfSelected(stroke);
            stroke.element.remove();
            const i = strokesArray.indexOf(stroke);
            if (i !== -1) strokesArray.splice(i, 1);
        },
    });
}

/** Shift a stroke's points and re-render its path. */
function applyStrokeOffset(stroke, dx, dy) {
    stroke.points = stroke.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
    stroke.element.setAttribute('d', buildShapePath(stroke.shape || 'pen', stroke.points, stroke.size));
    positionShapeHandles(stroke);
}

/** Visually shift the selection handles during a drag (no point mutation). */
function offsetShapeHandles(stroke, dx, dy) {
    if (!handlesBox || handlesStroke !== stroke) return;
    handlesBox.style.transform = `translate(${dx}px, ${dy}px)`;
}

function makeStrokeInteractive(stroke) {
    const path = stroke.element;
    path.classList.add('stroke-path');
    // iOS Safari ignores touch-action on SVG paths — suppress the scroll
    // gesture explicitly so strokes can be dragged by finger.
    path.addEventListener('touchstart', (e) => {
        if (!drawMode) e.preventDefault();
    }, { passive: false });
    path.addEventListener('pointerdown', (e) => startStrokeDrag(e, stroke));
}

/**
 * Drag-to-move a stroke. Shared by the stroke path itself and the dashed
 * selection rectangle, so a selected shape can be grabbed anywhere inside
 * its bounding box (corners stay reserved for resizing).
 */
function startStrokeDrag(e, stroke) {
    if (drawMode) return; // while drawing, strokes are not draggable
    e.preventDefault();
    e.stopPropagation();

    const path = stroke.element;
    const canvas = stroke.canvas;
    const s = layoutWidth(canvas) / canvas.getBoundingClientRect().width;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;

    const onMove = (ev) => {
        const dx = (ev.clientX - startX) * s;
        const dy = (ev.clientY - startY) * s;
        if (!moved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
            moved = true;
            selectStroke(stroke);
        }
        if (moved) {
            path.setAttribute('transform', `translate(${dx} ${dy})`);
            offsetShapeHandles(stroke, dx, dy); // selection rect + handles follow
            strokeToolbar.reposition(stroke); // toolbar follows the drag
        }
    };
    const onUp = (ev) => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        if (!moved) {
            selectStroke(stroke);
            return;
        }
        const dx = (ev.clientX - startX) * s;
        const dy = (ev.clientY - startY) * s;
        path.removeAttribute('transform');
        if (handlesBox && handlesStroke === stroke) handlesBox.style.transform = '';
        applyStrokeOffset(stroke, dx, dy);
        recordAction({
            undo() { applyStrokeOffset(stroke, -dx, -dy); },
            redo() { applyStrokeOffset(stroke, dx, dy); },
        });
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
}

/**
 * Build the SVG path "d" for a stroke of the given tool. Shared with the saver
 * so on-screen shapes and saved shapes are identical.
 */
export function buildShapePath(tool, points, size) {
    if (tool === 'rect') {
        const [a, b] = points;
        if (!b) return '';
        return `M ${a.x} ${a.y} L ${b.x} ${a.y} L ${b.x} ${b.y} L ${a.x} ${b.y} Z`;
    }
    if (tool === 'circle') {
        const [a, b] = points;
        if (!b) return '';
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const rx = Math.max(0.5, Math.abs(b.x - a.x) / 2);
        const ry = Math.max(0.5, Math.abs(b.y - a.y) / 2);
        return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
    }
    if (tool === 'star') {
        const [a, b] = points;
        if (!b) return '';
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const rx = Math.max(1, Math.abs(b.x - a.x) / 2);
        const ry = Math.max(1, Math.abs(b.y - a.y) / 2);
        const pts = [];
        for (let i = 0; i < 10; i++) {
            const angle = -Math.PI / 2 + (i * Math.PI) / 5;
            const k = i % 2 === 0 ? 1 : 0.42; // outer / inner radius
            pts.push(`${cx + Math.cos(angle) * rx * k} ${cy + Math.sin(angle) * ry * k}`);
        }
        return `M ${pts[0]} L ${pts.slice(1).join(' L ')} Z`;
    }
    if (tool === 'arrow') {
        const [a, b] = points;
        if (!b) return '';
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const head = Math.max(12, size * 3.5);
        const spread = Math.PI / 7;
        const h1 = { x: b.x - head * Math.cos(angle - spread), y: b.y - head * Math.sin(angle - spread) };
        const h2 = { x: b.x - head * Math.cos(angle + spread), y: b.y - head * Math.sin(angle + spread) };
        return `M ${a.x} ${a.y} L ${b.x} ${b.y} M ${h1.x} ${h1.y} L ${b.x} ${b.y} L ${h2.x} ${h2.y}`;
    }
    return buildSmoothPath(points);
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
