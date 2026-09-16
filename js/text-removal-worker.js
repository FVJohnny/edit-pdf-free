// Install the listener before importing WASM. Its top-level await would otherwise
// discard messages sent while the engine is still starting (first edit/save).
const core = import('./text-removal-core.js');
self.onmessage = async ({ data: { id, bytes, regions, imageRegions } }) => {
    try {
        const { removeText } = await core;
        const result = removeText(bytes, regions, imageRegions);
        self.postMessage({ id, ...result }, [result.bytes.buffer]);
    } catch (error) {
        self.postMessage({ id, error: error.message });
    }
};
