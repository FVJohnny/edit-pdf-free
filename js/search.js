/**
 * Find text — searches the extracted text items, highlights matches on their
 * overlay spans, and cycles through them. Opens with Ctrl/Cmd+F or the toolbar
 * button; Esc closes.
 */

let viewer = null;
let textItems = null;
let barEl = null;
let inputEl = null;
let countEl = null;

let matches = [];
let activeIdx = -1;
let searchTimer = null;

export function initSearch(viewerEl, textItemsRef) {
    viewer = viewerEl;
    textItems = textItemsRef;
    barEl = document.getElementById('searchBar');
    inputEl = document.getElementById('searchInput');
    countEl = document.getElementById('searchCount');

    document.getElementById('findBtn').addEventListener('click', openSearch);
    document.getElementById('searchPrev').addEventListener('click', () => step(-1));
    document.getElementById('searchNext').addEventListener('click', () => step(1));
    document.getElementById('searchClose').addEventListener('click', closeSearch);

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'f' && viewer.querySelector('canvas')) {
            e.preventDefault();
            openSearch();
        }
    });

    inputEl.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => runSearch(inputEl.value.trim()), 200);
    });
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSearch();
        if (e.key === 'Enter') step(e.shiftKey ? -1 : 1);
        e.stopPropagation(); // don't trigger app-level shortcuts while typing
    });
}

function openSearch() {
    barEl.style.display = 'flex';
    inputEl.focus();
    inputEl.select();
    if (inputEl.value.trim()) runSearch(inputEl.value.trim());
}

function closeSearch() {
    clearHighlights();
    matches = [];
    activeIdx = -1;
    barEl.style.display = 'none';
    updateCount();
}

function clearHighlights() {
    document.querySelectorAll('.search-hit').forEach(el => el.classList.remove('search-hit', 'search-active'));
}

function runSearch(query) {
    clearHighlights();
    matches = [];
    activeIdx = -1;
    if (query) {
        const q = query.toLowerCase();
        const containers = [...viewer.querySelectorAll(':scope > div')];
        matches = textItems.filter(item =>
            !item.deleted && (item.currentText || '').toLowerCase().includes(q));
        // Reading order: page, then vertical position
        matches.sort((a, b) => {
            const pa = containers.indexOf(a.canvas?.parentElement);
            const pb = containers.indexOf(b.canvas?.parentElement);
            if (pa !== pb) return pa - pb;
            return parseFloat(a.element.style.top) - parseFloat(b.element.style.top);
        });
        matches.forEach(m => m.element.classList.add('search-hit'));
        if (matches.length) activeIdx = 0;
    }
    focusActive();
}

function step(dir) {
    if (matches.length === 0) return;
    activeIdx = (activeIdx + dir + matches.length) % matches.length;
    focusActive();
}

function focusActive() {
    document.querySelectorAll('.search-active').forEach(el => el.classList.remove('search-active'));
    if (activeIdx >= 0 && matches[activeIdx]) {
        const el = matches[activeIdx].element;
        el.classList.add('search-active');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    updateCount();
}

function updateCount() {
    countEl.textContent = matches.length ? `${activeIdx + 1}/${matches.length}` : '0/0';
}
