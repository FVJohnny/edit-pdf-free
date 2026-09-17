/** High-resolution PDF rendering is limited to the visible page region. */
const sources = new WeakMap();
const sourceDocuments = new Set();
const active = new Map();
let viewer,
    density = 1,
    generation = 0,
    timer,
    previewDocument;
export function registerPage(container, source) {
    sources.set(container, source);
    if(source.doc)sourceDocuments.add(source.doc);
}
function cancelDetails() {
    generation++;
    const pending = [];
    for (const state of active.values()) {
        state.task?.cancel();
        if (state.task) pending.push(state.task.promise.catch(() => {}));
    }
    return Promise.all(pending);
}
function removeDetail(container) {
    const state = active.get(container);
    state?.task?.cancel();
    const canvas = container.querySelector('.pdf-detail');
    if (canvas) {
        canvas.width = canvas.height = 0;
        canvas.remove();
    }
    active.delete(container);
}
export async function resetPageRendering() {
    clearTimeout(timer);
    await cancelDetails();
    for (const container of active.keys()) removeDetail(container);
    const old = previewDocument;
    previewDocument = null;
    await old?.destroy();
    await Promise.all([...sourceDocuments].map(doc=>doc.destroy()));
    sourceDocuments.clear();
    document.dispatchEvent(new Event('pdf-document-reset'));
}
export async function setPagePreviewDocument(containers, doc, commit = () => {}, isCurrent = () => true) {
    await cancelDetails();
    if (!isCurrent()) return false;
    const old = previewDocument;
    previewDocument = doc;
    containers.forEach((container, i) => {
        const source = sources.get(container);
        if (source) {
            source.preview = doc;
            source.previewPage = i + 1;
        }
        removeDetail(container);
    });
    // Remove the old detail surfaces, replace the base pixels and reveal the
    // overlays in one synchronous turn, so a frame can never show both copies.
    commit();
    await old?.destroy();
    await rerenderVisiblePages(viewer, density);
    return true;
}
export function scheduleVisiblePages() {
    clearTimeout(timer);
    timer = setTimeout(() => {
        if (viewer) rerenderVisiblePages(viewer, density);
    }, 80);
}
window.addEventListener('scroll', scheduleVisiblePages, { passive: true });
window.addEventListener('resize', scheduleVisiblePages, { passive: true });

export async function rerenderVisiblePages(pdfViewer, resolution) {
    if (!pdfViewer) return;
    if (viewer !== pdfViewer) {
        viewer?.removeEventListener('scroll', scheduleVisiblePages);
        viewer = pdfViewer;
        viewer.addEventListener('scroll', scheduleVisiblePages, {
            passive: true
        });
    }
    density = Math.max(1, resolution);
    const version = ++generation;
    const vr = viewer.getBoundingClientRect();
    const clip = {
        left: Math.max(0, vr.left),
        top: Math.max(0, vr.top),
        right: Math.min(innerWidth, vr.right),
        bottom: Math.min(innerHeight, vr.bottom)
    };
    const containers = [...viewer.querySelectorAll(':scope > div')];
    for (const container of active.keys())
        if (!containers.includes(container)) removeDetail(container);
    for (const container of containers) {
        const base = container.querySelector('canvas.pdf-page'),
            source = sources.get(container);
        if (!base || !source) continue;
        const rect = base.getBoundingClientRect();
        if (
            rect.right <= clip.left ||
            rect.left >= clip.right ||
            rect.bottom <= clip.top ||
            rect.top >= clip.bottom ||
            (source.kind === 'blank' && !source.preview)
        ) {
            removeDetail(container);
            continue;
        }
        const layoutW = parseFloat(base.style.width),
            layoutH = parseFloat(base.style.height);
        const zoom = rect.width / layoutW;
        const left = Math.max(
            0,
            Math.floor((clip.left - rect.left) / zoom) - 64
        );
        const top = Math.max(0, Math.floor((clip.top - rect.top) / zoom) - 64);
        const right = Math.min(
            layoutW,
            Math.ceil((clip.right - rect.left) / zoom) + 64
        );
        const bottom = Math.min(
            layoutH,
            Math.ceil((clip.bottom - rect.top) / zoom) + 64
        );
        const width = right - left,
            height = bottom - top;
        if (width <= 0 || height <= 0) {
            removeDetail(container);
            continue;
        }
        // At most 8 million pixels (~32 MB) for a visible region, at most 4096 per side.
        const res = Math.min(
            density,
            Math.sqrt(8e6 / (width * height)),
            4096 / width,
            4096 / height
        );
        const signature = [
            left,
            top,
            width,
            height,
            res,
            source.previewPage
        ].join(':');
        if (
            active.get(container)?.signature === signature &&
            active.get(container)?.ready &&
            container.querySelector('.pdf-detail')
        )
            continue;
        active.get(container)?.task?.cancel();
        const state = { signature };
        active.set(container, state);
        const off = document.createElement('canvas');
        off.width = Math.ceil(width * res);
        off.height = Math.ceil(height * res);
        try {
            const page = await (source.preview || source.doc).getPage(
                source.previewPage || source.pageNum
            );
            if (version !== generation) {
                if (active.get(container) === state) active.delete(container);
                continue;
            }
            const viewport = page.getViewport({
                scale: (layoutW * res) / page.getViewport({ scale: 1 }).width
            });
            state.task = page.render({
                canvasContext: off.getContext('2d'),
                viewport,
                transform: [1, 0, 0, 1, -left * res, -top * res]
            });
            await state.task.promise;
            state.task = null;
            if (version !== generation || active.get(container) !== state) {
                if (active.get(container) === state) active.delete(container);
                continue;
            }
            const old = container.querySelector('.pdf-detail');
            if (old) {
                old.width = old.height = 0;
                old.remove();
            }
            off.className = 'pdf-detail';
            Object.assign(off.style, {
                position: 'absolute',
                pointerEvents: 'none',
                left: left + 'px',
                top: top + 'px',
                width: width + 'px',
                height: height + 'px'
            });
            base.after(off);
            state.ready = true;
        } catch (error) {
            if (active.get(container) === state) active.delete(container);
            if (
                error.name !== 'RenderingCancelledException' &&
                version === generation
            )
                console.warn('Detail render failed:', error);
        }
    }
}
