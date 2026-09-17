/** One lazy local WASM worker, shared by saving, autosave and preview. */
let worker,
    nextId = 0;
const pending = new Map();
export function removeOriginalText(bytes, regions, imageRegions = {}) {
    if (!Object.keys(regions).length && !Object.keys(imageRegions).length)
        return Promise.resolve({ bytes, styles: {} });
    prepareTextRemoval();
    return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(
            () =>
                resetWorker(
                    new Error(
                        'Text editing timed out. Please try a smaller document.'
                    )
                ),
            120000
        );
        pending.set(id, { resolve, reject, timer });
        worker.postMessage({ id, bytes, regions, imageRegions });
    });
}

/** Load the engine while the pointer approaches an existing editable item. */
export function prepareTextRemoval() {
    if (!worker) {
        worker = new Worker(
            new URL('./text-removal-worker.js', import.meta.url),
            { type: 'module' }
        );
        worker.onmessage = ({ data }) => {
            const task = pending.get(data.id);
            if (!task) return;
            pending.delete(data.id);
            clearTimeout(task.timer);
            data.error
                ? task.reject(new Error(data.error))
                : task.resolve({
                      bytes: data.bytes,
                      styles: data.styles,
                      imageResources: data.imageResources
                  });
        };
        worker.onerror = () =>
            resetWorker(
                new Error(
                    'The text editing engine could not load. Please reload and try again.'
                )
            );
    }
}
function resetWorker(error) {
    worker?.terminate();
    worker = null;
    for (const task of pending.values()) {
        clearTimeout(task.timer);
        task.reject(error);
    }
    pending.clear();
}
export function isTextModified(item) {
    return (
        item.deleted ||
        item.currentText !== item.originalText ||
        (item.moveOffsetX || 0) !== 0 ||
        (item.moveOffsetY || 0) !== 0 ||
        item.fontWeightOverride ||
        item.fontStyleOverride ||
        item.fontSizeOverride ||
        item.textColorOverride ||
        item.fontFamilyOverride ||
        item.alignOverride ||
        item.textOpacityOverride != null
    );
}
export function textRegions(items, backgroundOnly = false) {
    const regions = {};
    for (const item of items) {
        if (!(backgroundOnly ? item.originalCovered : isTextModified(item)))
            continue;
        const page = item.originPageIndex;
        if (page == null || page < 0 || !item.originalText) continue;
        for (const sub of item.subItems || [item]) {
            (regions[page] ||= []).push({
                transform: [...sub.transform],
                width: sub.width,
                text: sub.originalText
            });
        }
    }
    return regions;
}

export function isImageModified(item) {
    return (
        item.deleted ||
        item.moveOffsetX ||
        item.moveOffsetY ||
        item.resizedWidth ||
        item.resizedHeight
    );
}
export function imageRegions(items, backgroundOnly = false) {
    const regions = {};
    for (const item of items) {
        if (
            item.type !== 'image' ||
            !(backgroundOnly ? item.originalCovered : isImageModified(item)) ||
            item.originPageIndex == null ||
            item.originPageIndex < 0
        )
            continue;
        if (!item.imageTransform)
            throw new Error(
                'Reload this PDF before editing its original images.'
            );
        const key = JSON.stringify([item.originPageIndex, item.imageTransform]);
        (regions[item.originPageIndex] ||= []).push({
            key,
            transform: item.imageTransform,
            deleted: item.deleted || backgroundOnly
        });
    }
    return regions;
}
