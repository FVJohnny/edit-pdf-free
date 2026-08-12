/**
 * Minimap scrollbar — a thin live preview of all pages beside the viewer,
 * with a light strip showing the currently visible region.
 * Click or drag on it to scroll the viewer.
 *
 * When the stacked thumbnails are taller than the minimap, the content is
 * shifted proportionally with the scroll position (like a code-editor minimap)
 * so the strip always stays in view.
 */
import { layoutWidth, layoutHeight } from './utils/canvas.js';

let viewer = null;
let minimapEl = null;
let innerEl = null;
let stripEl = null;
let rebuildTimer = null;
let callbacks = {}; // { onReorder(from, to), onDelete(index) }

export function initMinimap(viewerEl, mapEl, contentEl, stripElement, cbs = {}) {
    viewer = viewerEl;
    minimapEl = mapEl;
    innerEl = contentEl;
    stripEl = stripElement;
    callbacks = cbs;

    viewer.addEventListener('scroll', updateMinimapViewport);
    window.addEventListener('resize', updateMinimapViewport);

    let dragging = false;
    const scrollToEvent = (e) => {
        const rect = minimapEl.getBoundingClientRect();
        const contentH = innerEl.offsetHeight;
        if (contentH === 0) return;
        const yInContent = (e.clientY - rect.top) + currentContentOffset(contentH);
        const frac = yInContent / contentH;
        viewer.scrollTop = frac * viewer.scrollHeight - viewer.clientHeight / 2;
    };
    minimapEl.addEventListener('pointerdown', (e) => {
        dragging = true;
        scrollToEvent(e);
        e.preventDefault();
    });
    document.addEventListener('pointermove', (e) => {
        if (dragging) scrollToEvent(e);
    });
    document.addEventListener('pointerup', () => { dragging = false; });
    document.addEventListener('pointercancel', () => { dragging = false; });
}

/** How far the minimap content is shifted up so the strip stays in view. */
function currentContentOffset(contentH) {
    const visH = minimapEl.clientHeight;
    if (contentH <= visH) return 0;
    const maxScroll = viewer.scrollHeight - viewer.clientHeight;
    const frac = maxScroll > 0 ? viewer.scrollTop / maxScroll : 0;
    return (contentH - visH) * frac;
}

/** Debounced rebuild — call after anything that changes page content/count. */
export function scheduleMinimapRebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuildMinimap, 250);
}

// Cache of loaded overlay background images, keyed by their (data) URL.
const overlayImageCache = new Map();

function loadOverlayImage(url) {
    if (overlayImageCache.has(url)) return overlayImageCache.get(url);
    const promise = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
    overlayImageCache.set(url, promise);
    return promise;
}

/** Redraw all page thumbnails from the page canvases plus the DOM overlays. */
export async function rebuildMinimap() {
    if (!innerEl || !viewer) return;
    innerEl.innerHTML = '';
    const containers = viewer.querySelectorAll(':scope > div');
    const width = (minimapEl.clientWidth || 64) - 12; // minus inner padding
    for (const container of containers) {
        // A page can have several stacked canvases (page + draw overlay) —
        // composite them all into one thumbnail, in DOM order.
        const canvases = container.querySelectorAll('canvas');
        const base = canvases[0];
        if (!base || !base.width || !base.height) continue;
        const height = Math.max(8, Math.round(width * base.height / base.width));
        const thumb = document.createElement('canvas');
        thumb.width = width * 2; // 2x for sharpness at the small size
        thumb.height = height * 2;
        thumb.className = 'pdf-minimap-thumb';
        const ctx = thumb.getContext('2d');
        for (const cv of canvases) {
            ctx.drawImage(cv, 0, 0, thumb.width, thumb.height);
        }
        // Overlay positions are in layout px — scale from layout, not backing
        await drawOverlaysOnThumb(ctx, container, thumb.width / layoutWidth(base), thumb.height / layoutHeight(base));

        // Wrap: drag handle (reorder) + delete button appear on hover
        const wrap = document.createElement('div');
        wrap.className = 'pdf-minimap-page';
        wrap.appendChild(thumb);
        const handle = document.createElement('button');
        handle.className = 'minimap-handle';
        handle.setAttribute('aria-label', 'Drag to reorder page');
        handle.textContent = '⠿';
        handle.addEventListener('pointerdown', (e) => startReorder(e, wrap));
        const del = document.createElement('button');
        del.className = 'minimap-delete';
        del.setAttribute('aria-label', 'Delete page');
        del.textContent = '✕';
        del.addEventListener('pointerdown', (e) => e.stopPropagation());
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = pageWraps().indexOf(wrap);
            if (idx !== -1) callbacks.onDelete?.(idx);
        });
        const rotate = document.createElement('button');
        rotate.className = 'minimap-rotate';
        rotate.setAttribute('aria-label', 'Rotate page 90°');
        rotate.textContent = '⟳';
        rotate.addEventListener('pointerdown', (e) => e.stopPropagation());
        rotate.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = pageWraps().indexOf(wrap);
            if (idx !== -1) callbacks.onRotate?.(idx);
        });
        wrap.append(handle, rotate, del);
        innerEl.appendChild(wrap);
    }
    updateMinimapViewport();
}

function pageWraps() {
    return [...innerEl.querySelectorAll(':scope > .pdf-minimap-page')];
}

/** Pointer-driven thumbnail reorder: drag the handle, drop between pages. */
function startReorder(e, wrap) {
    e.preventDefault();
    e.stopPropagation();
    const from = pageWraps().indexOf(wrap);
    if (from === -1) return;
    wrap.classList.add('dragging');
    const marker = document.createElement('div');
    marker.className = 'minimap-drop-marker';
    innerEl.appendChild(marker);
    let dropIdx = null;

    const moveMarker = (clientY) => {
        const wraps = pageWraps();
        dropIdx = wraps.length;
        for (let i = 0; i < wraps.length; i++) {
            const r = wraps[i].getBoundingClientRect();
            if (clientY < r.top + r.height / 2) { dropIdx = i; break; }
        }
        const innerRect = innerEl.getBoundingClientRect();
        const y = dropIdx < wraps.length
            ? wraps[dropIdx].getBoundingClientRect().top - innerRect.top - 3
            : wraps[wraps.length - 1].getBoundingClientRect().bottom - innerRect.top + 1;
        marker.style.top = y + 'px';
    };
    moveMarker(e.clientY);

    const onMove = (ev) => moveMarker(ev.clientY);
    const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        wrap.classList.remove('dragging');
        marker.remove();
        // Dropping right before or right after itself is a no-op
        if (dropIdx != null && dropIdx !== from && dropIdx !== from + 1) {
            callbacks.onReorder?.(from, dropIdx);
        }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
}

/**
 * Draw the page's DOM overlays onto its thumbnail: image overlays (imported or
 * moved images live only in the DOM, not on the page canvas), text spans that
 * differ from the rendered canvas (new/edited/moved text), and free-hand
 * drawing strokes (SVG paths on the page's draw overlay).
 */
async function drawOverlaysOnThumb(ctx, container, sx, sy) {
    const drawOverlay = container.querySelector(':scope > .draw-overlay');
    if (drawOverlay) {
        for (const path of drawOverlay.querySelectorAll('path')) {
            const d = path.getAttribute('d');
            if (!d) continue;
            ctx.save();
            ctx.scale(sx, sy);
            ctx.globalAlpha = parseFloat(path.getAttribute('opacity') ?? '1');
            const p2d = new Path2D(d);
            const fill = path.getAttribute('fill');
            if (fill && fill !== 'none') {
                ctx.fillStyle = fill;
                ctx.fill(p2d);
            }
            ctx.strokeStyle = path.getAttribute('stroke') || '#000';
            // Enforce a minimum on-thumbnail width so thin strokes stay visible
            const strokeWidth = parseFloat(path.getAttribute('stroke-width')) || 1;
            ctx.lineWidth = Math.max(strokeWidth, 2.5 / sx);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke(p2d);
            ctx.restore();
        }
    }
    for (const el of container.querySelectorAll('.draggable-image')) {
        if (el.style.display === 'none') continue;
        const match = el.style.backgroundImage?.match(/url\("?([^")]+)"?\)/);
        if (!match) continue;
        const img = await loadOverlayImage(match[1]);
        if (!img) continue;
        ctx.drawImage(img,
            parseFloat(el.style.left) * sx,
            parseFloat(el.style.top) * sy,
            parseFloat(el.style.width) * sx,
            parseFloat(el.style.height) * sy);
    }
    for (const span of container.querySelectorAll('.editable-text')) {
        if (span.style.display === 'none') continue;
        if (!span.classList.contains('modified') && !span.classList.contains('moved')) continue;
        const fontSize = parseFloat(span.style.fontSize) * sy;
        if (!fontSize) continue;
        ctx.font = `${span.style.fontWeight || '400'} ${fontSize}px sans-serif`;
        ctx.fillStyle = span.style.getPropertyValue('--text-color') || '#000';
        const left = parseFloat(span.style.left) * sx;
        const top = parseFloat(span.style.top) * sy;
        span.textContent.split('\n').forEach((line, i) => {
            ctx.fillText(line, left, top + fontSize * (i + 0.85));
        });
    }
}

/** Reposition the visible-region strip (and shift content when needed). */
export function updateMinimapViewport() {
    if (!innerEl || !viewer) return;
    const contentH = innerEl.offsetHeight;
    if (contentH === 0 || viewer.scrollHeight === 0) {
        stripEl.style.display = 'none';
        return;
    }
    stripEl.style.display = '';
    const offset = currentContentOffset(contentH);
    innerEl.style.transform = `translateY(${-offset}px)`;
    const top = (viewer.scrollTop / viewer.scrollHeight) * contentH - offset;
    const height = (viewer.clientHeight / viewer.scrollHeight) * contentH;
    stripEl.style.top = top + 'px';
    stripEl.style.height = Math.max(12, height) + 'px';
}
