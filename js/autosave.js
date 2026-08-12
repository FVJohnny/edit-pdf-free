/**
 * Autosave — keeps the latest built PDF (all edits applied) in IndexedDB so a
 * closed tab or accidental reload doesn't lose work. The size-estimator
 * already rebuilds the document after every action, so persisting it here is
 * nearly free. Recovery loads it back as a regular PDF (edits are baked in).
 */

const DB_NAME = 'editpdffree';
const STORE = 'session';
const KEY = 'last';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // sessions older than a week are stale

function openDb() {
    return new Promise((resolve, reject) => {
        const rq = indexedDB.open(DB_NAME, 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => reject(rq.error);
    });
}

/** Persist the current session (fire and forget). */
export async function saveSession(bytes, name) {
    try {
        const db = await openDb();
        db.transaction(STORE, 'readwrite')
            .objectStore(STORE)
            .put({ bytes, name, savedAt: Date.now() }, KEY);
    } catch (_) { /* private mode / quota — autosave is best-effort */ }
}

/** The stored session ({bytes, name, savedAt}) or null. */
export async function loadSession() {
    try {
        const db = await openDb();
        const session = await new Promise((resolve, reject) => {
            const rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
            rq.onsuccess = () => resolve(rq.result || null);
            rq.onerror = () => reject(rq.error);
        });
        if (!session || Date.now() - session.savedAt > MAX_AGE_MS) return null;
        return session;
    } catch (_) {
        return null;
    }
}

export async function clearSession() {
    try {
        const db = await openDb();
        db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY);
    } catch (_) { /* best-effort */ }
}

/** "just now", "5 min ago", "3 h ago", "2 days ago" */
export function timeAgo(timestamp) {
    const mins = Math.round((Date.now() - timestamp) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.round(hours / 24)} day${hours >= 48 ? 's' : ''} ago`;
}
