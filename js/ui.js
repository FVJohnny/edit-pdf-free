// ============================================
// Scroll-triggered animations
// ============================================
const animateElements = document.querySelectorAll('[data-animate]');

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

animateElements.forEach(el => observer.observe(el));

// ============================================
// Drag and drop (full page)
// ============================================
let dragCounter = 0;

export function initDragDrop(onFileDrop) {
    function hasFiles(e) {
        return e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files');
    }

    document.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        if (!hasFiles(e)) return;
        dragCounter++;
        document.body.classList.add('drag-over-page');
    });

    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        if (!hasFiles(e)) return;
        dragCounter--;
        if (dragCounter === 0) {
            document.body.classList.remove('drag-over-page');
        }
    });

    document.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        document.body.classList.remove('drag-over-page');
        const file = e.dataTransfer.files[0];
        if (file && file.type === 'application/pdf') {
            // loadPDF scrolls to the editor itself once rendering settles
            onFileDrop(file);
        } else if (file) {
            showToast("This is a PDF editor. What part of that was unclear?");
        }
    });
}

// ============================================
// Smooth scroll for anchor links
// ============================================
document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(link.getAttribute('href'));
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
});

// ============================================
// Toast notification
// ============================================
export function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================
// Choice modal — pick one option from a stacked list
// ============================================

/**
 * Show a modal with a list of choice buttons.
 * @param {string} title
 * @param {string} label - explanatory text under the title
 * @param {Array<{label: string, hint?: string, value: any}>} choices
 * @returns {Promise<any>} the chosen value, or undefined if cancelled
 */
export function showChoices(title, label, choices) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        overlay.innerHTML = `
            <div class="modal">
                <h3 class="modal-title">${title}</h3>
                <label class="modal-label">${label}</label>
                <div class="modal-choices"></div>
                <div class="modal-actions">
                    <button class="modal-btn modal-btn--cancel">Cancel</button>
                </div>
            </div>
        `;

        const list = overlay.querySelector('.modal-choices');
        for (const choice of choices) {
            const btn = document.createElement('button');
            btn.className = 'modal-choice';
            btn.innerHTML = `<span class="modal-choice-label">${choice.label}</span>` +
                (choice.hint ? `<span class="modal-choice-hint">${choice.hint}</span>` : '');
            btn.addEventListener('click', () => close(choice.value));
            list.appendChild(btn);
        }

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));

        const close = (value) => {
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 300);
            document.removeEventListener('keydown', onKey);
            resolve(value);
        };
        const onKey = (e) => { if (e.key === 'Escape') close(undefined); };

        overlay.querySelector('.modal-btn--cancel').addEventListener('click', () => close(undefined));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(undefined); });
        document.addEventListener('keydown', onKey);
    });
}

// ============================================
// Custom prompt modal
// ============================================
export function showPrompt(title, label, defaultValue) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        overlay.innerHTML = `
            <div class="modal">
                <h3 class="modal-title">${title}</h3>
                <label class="modal-label">${label}</label>
                <div class="modal-input-row">
                    <input type="text" class="modal-input" value="${defaultValue}" />
                    <span class="modal-ext">.pdf</span>
                </div>
                <div class="modal-actions">
                    <button class="modal-btn modal-btn--cancel">Cancel</button>
                    <button class="modal-btn modal-btn--confirm">Save</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));

        const input = overlay.querySelector('.modal-input');
        input.focus();
        input.select();

        const close = (value) => {
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 300);
            resolve(value);
        };

        overlay.querySelector('.modal-btn--cancel').addEventListener('click', () => close(null));
        overlay.querySelector('.modal-btn--confirm').addEventListener('click', () => close(input.value));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') close(input.value);
            if (e.key === 'Escape') close(null);
        });
    });
}
