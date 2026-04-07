/**
 * Undo/Redo history manager.
 *
 * Actions are recorded as { undo(), redo() } pairs.
 * Each function fully reverses or re-applies the change.
 */

const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 100;

let onChangeCallback = null;

/** Register a callback to be notified when undo/redo availability changes. */
export function onHistoryChange(callback) {
    onChangeCallback = callback;
}

function notifyChange() {
    if (onChangeCallback) onChangeCallback({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
}

/** Record a new action. Clears the redo stack. */
export function recordAction(action) {
    undoStack.push(action);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    notifyChange();
}

/** Undo the most recent action. */
export function undo() {
    const action = undoStack.pop();
    if (!action) return;
    action.undo();
    redoStack.push(action);
    notifyChange();
}

/** Redo the most recently undone action. */
export function redo() {
    const action = redoStack.pop();
    if (!action) return;
    action.redo();
    undoStack.push(action);
    notifyChange();
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

/** Clear all history (e.g. when loading a new PDF). */
export function clearHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
    notifyChange();
}
