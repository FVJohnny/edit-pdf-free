/**
 * Custom color popover — replaces native <input type="color"> everywhere.
 *
 * Why not native: mobile pickers bring system chrome we can't control (iOS
 * saved-colors row with its "+" button), desktop pickers can't do alpha, and
 * the alpha attribute is not supported in every browser. This popover gives
 * the same UI on PC and mobile: saturation/value square, hue slider, preset
 * swatches and (optionally) an opacity slider.
 *
 * Usage:
 *   openColorPopover({
 *     anchor,               // element to position under + toggle from
 *     color: '#rrggbb',
 *     alpha: 0..1 | null,   // null hides the opacity control
 *     onChange(hex, alpha), // live, fires on every tweak
 *     onCommit(hex, alpha), // once, when the popover closes
 *   });
 *
 * The popover node is re-parented into the anchor's toolbar container so the
 * various "dismiss on outside click" listeners treat clicks inside it as
 * inside the toolbar.
 */
import { TOOLBAR_MARGIN } from './constants.js';
import { hexToRgb, rgbToHex } from './color.js';

const SWATCHES = [
    '#1a1a1a', '#ffffff', '#e84444', '#ff8a00', '#ffe83a', '#35c759',
    '#00b8d9', '#1f6bff', '#7a5cff', '#ff5ca8', '#8b5a2b', '#9aa0a6',
];

let popoverEl = null;
let svEl, svDot, hueInput, alphaRowEl, alphaInput, alphaValueEl;
let state = { h: 0, s: 1, v: 1, a: 1 };
let current = { anchor: null, onChange: null, onCommit: null };

function hsvToRgb(h, s, v) {
    const f = (n) => {
        const k = (n + h / 60) % 6;
        return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return { r: f(5), g: f(3), b: f(1) };
}

function rgbToHsv({ r, g, b }) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d > 0) {
        if (max === r) h = 60 * (((g - b) / d) % 6);
        else if (max === g) h = 60 * ((b - r) / d + 2);
        else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return { h, s: max === 0 ? 0 : d / max, v: max };
}

function currentHex() {
    const { r, g, b } = hsvToRgb(state.h, state.s, state.v);
    return rgbToHex(r, g, b);
}

function build() {
    if (popoverEl) return;
    popoverEl = document.createElement('div');
    popoverEl.className = 'color-popover';
    popoverEl.style.display = 'none';
    popoverEl.innerHTML = `
        <div class="cp-sv"><div class="cp-sv-dot"></div></div>
        <input type="range" class="cp-hue" min="0" max="360" step="1" aria-label="Hue">
        <label class="cp-alpha-row">
            <input type="range" class="cp-alpha" min="0" max="100" step="5" aria-label="Opacity">
            <span class="cp-alpha-value">100%</span>
        </label>
        <div class="cp-swatches"></div>
    `;
    svEl = popoverEl.querySelector('.cp-sv');
    svDot = popoverEl.querySelector('.cp-sv-dot');
    hueInput = popoverEl.querySelector('.cp-hue');
    alphaRowEl = popoverEl.querySelector('.cp-alpha-row');
    alphaInput = popoverEl.querySelector('.cp-alpha');
    alphaValueEl = popoverEl.querySelector('.cp-alpha-value');

    const swatchesEl = popoverEl.querySelector('.cp-swatches');
    for (const hex of SWATCHES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cp-swatch';
        b.style.background = hex;
        b.setAttribute('aria-label', hex);
        b.addEventListener('click', () => {
            Object.assign(state, rgbToHsv(hexToRgb(hex)));
            state.a = 1; // presets are solid colors — reset any leftover opacity
            syncUI();
            emitChange();
        });
        swatchesEl.appendChild(b);
    }

    // Saturation/value square: drag anywhere inside
    svEl.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        svEl.setPointerCapture(e.pointerId);
        const move = (ev) => {
            const r = svEl.getBoundingClientRect();
            state.s = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
            state.v = Math.max(0, Math.min(1, 1 - (ev.clientY - r.top) / r.height));
            syncUI();
            emitChange();
        };
        move(e);
        svEl.addEventListener('pointermove', move);
        const up = () => {
            svEl.removeEventListener('pointermove', move);
            svEl.removeEventListener('pointerup', up);
            svEl.removeEventListener('pointercancel', up);
        };
        svEl.addEventListener('pointerup', up);
        svEl.addEventListener('pointercancel', up);
    });

    hueInput.addEventListener('input', () => {
        state.h = parseInt(hueInput.value, 10);
        syncUI();
        emitChange();
    });
    alphaInput.addEventListener('input', () => {
        state.a = parseInt(alphaInput.value, 10) / 100;
        alphaValueEl.textContent = alphaInput.value + '%';
        emitChange();
    });

    // Dismiss on any pointerdown outside the popover and its anchor.
    // Capture phase: editor elements (strokes, overlays, drag handles) stop
    // propagation of their pointerdowns, which would otherwise keep the
    // popover open when tapping the page.
    document.addEventListener('pointerdown', (e) => {
        if (!current.anchor) return;
        if (popoverEl.contains(e.target)) return;
        if (current.anchor.contains(e.target)) return;
        closeColorPopover();
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && current.anchor) closeColorPopover();
    });

    // Keep the popover inside the visible band when the mobile keyboard
    // opens/closes or the page scrolls — positioning only at open time left
    // it buried under the keyboard.
    const track = () => { if (current.anchor) position(current.anchor); };
    window.visualViewport?.addEventListener('resize', track);
    window.visualViewport?.addEventListener('scroll', track);
    window.addEventListener('scroll', track, true);
}

function syncUI() {
    const hueRgb = hsvToRgb(state.h, 1, 1);
    svEl.style.background = `
        linear-gradient(to top, #000, transparent),
        linear-gradient(to right, #fff, ${rgbToHex(hueRgb.r, hueRgb.g, hueRgb.b)})`;
    svDot.style.left = (state.s * 100) + '%';
    svDot.style.top = ((1 - state.v) * 100) + '%';
    svDot.style.background = currentHex();
    // Opacity slider fades transparent → the currently selected color
    alphaInput.style.background = `linear-gradient(to right, transparent, ${currentHex()}), ` +
        'repeating-conic-gradient(#555 0% 25%, #888 0% 50%) 0 0 / 10px 10px';
    hueInput.value = String(Math.round(state.h));
    alphaInput.value = String(Math.round(state.a * 100));
    alphaValueEl.textContent = Math.round(state.a * 100) + '%';
}

function emitChange() {
    current.onChange?.(currentHex(), state.a);
}

function position(anchor) {
    const a = anchor.getBoundingClientRect();
    const p = popoverEl.getBoundingClientRect();
    const vv = window.visualViewport;
    const bandLeft = (vv?.offsetLeft ?? 0) + TOOLBAR_MARGIN;
    const bandTop = (vv?.offsetTop ?? 0) + TOOLBAR_MARGIN;
    const bandRight = (vv?.offsetLeft ?? 0) + (vv?.width ?? window.innerWidth) - TOOLBAR_MARGIN;
    const bandBottom = (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight) - TOOLBAR_MARGIN;

    let left = a.left + a.width / 2 - p.width / 2;
    let top = a.bottom + TOOLBAR_MARGIN;
    if (left + p.width > bandRight) left = bandRight - p.width;
    if (left < bandLeft) left = bandLeft;
    if (top + p.height > bandBottom) top = a.top - p.height - TOOLBAR_MARGIN; // flip above
    if (top < bandTop) top = bandTop;
    if (top + p.height > bandBottom) top = bandBottom - p.height;

    popoverEl.style.left = left + 'px';
    popoverEl.style.top = top + 'px';
    // Fixed-position anchoring differs on mobile while the keyboard pans the
    // visual viewport — measure the actual landing spot and compensate.
    const landed = popoverEl.getBoundingClientRect();
    const dx = landed.left - left;
    const dy = landed.top - top;
    if (dx || dy) {
        popoverEl.style.left = (left - dx) + 'px';
        popoverEl.style.top = (top - dy) + 'px';
    }
}

export function isColorPopoverOpen() {
    return !!current.anchor;
}

/** Open (or toggle, if re-invoked from the same anchor) the color popover. */
export function openColorPopover({ anchor, color, alpha = null, onChange, onCommit }) {
    build();
    if (current.anchor === anchor) { // toggle from the same control
        closeColorPopover();
        return;
    }
    closeColorPopover();

    Object.assign(state, rgbToHsv(hexToRgb(color)));
    state.a = alpha ?? 1;
    alphaRowEl.style.display = alpha === null ? 'none' : '';
    current = { anchor, onChange, onCommit };

    // Live inside the anchor's toolbar so outside-click dismissers of the
    // toolbar (and the text editor) treat popover interaction as "inside".
    const host = anchor.closest('.image-toolbar, .format-toolbar, .draw-palette') || document.body;
    host.appendChild(popoverEl);

    syncUI();
    // Render off-screen first so dimensions can be measured
    popoverEl.style.left = '-9999px';
    popoverEl.style.top = '-9999px';
    popoverEl.style.display = 'flex';
    position(anchor);
}

export function closeColorPopover() {
    if (!current.anchor) return;
    const { onCommit } = current;
    current = { anchor: null, onChange: null, onCommit: null };
    popoverEl.style.display = 'none';
    onCommit?.(currentHex(), state.a);
}
