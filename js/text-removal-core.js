/** Real text removal. Runs in a worker; never paints over page graphics. */
import * as mupdf from '../vendor/mupdf/mupdf.js';
import { removeImages } from './image-removal-core.js';

const point = (p, m) => [
    p[0] * m[0] + p[1] * m[2] + m[4],
    p[0] * m[1] + p[1] * m[3] + m[5]
];

export function removeText(bytes, regions, imageRegions = {}) {
    const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
    const styles = {};
    try {
        const imageResources = removeImages(doc, imageRegions);
        for (const [index, spans] of Object.entries(regions)) {
            const page = doc.loadPage(Number(index));
            try {
                if (
                    page.getAnnotations().some((a) => a.getType() === 'Redact')
                ) {
                    throw new Error(
                        'This page has pending redactions. Apply or remove them before editing its text.'
                    );
                }
                const originalAnnotations = [];
                page.getObject()
                    .get('Annots')
                    .forEach((ref) => originalAnnotations.push(ref));
                const matrix = page.getTransform();
                const inverse = mupdf.Matrix.invert(matrix);
                const chars = [];
                const paints = [];
                const device = new mupdf.Device({
                    fillText(text, ctm, colorspace, color, alpha) {
                        text.walk({
                            showGlyph(font, trm) {
                                paints.push({
                                    origin: point(
                                        point([trm[4], trm[5]], ctm),
                                        inverse
                                    ),
                                    alpha
                                });
                            }
                        });
                    }
                });
                try {
                    page.runPageContents(device, mupdf.Matrix.identity);
                } finally {
                    device.close();
                    device.destroy();
                }
                const text = page.toStructuredText(
                    'preserve-whitespace,preserve-ligatures'
                );
                try {
                    text.walk({
                        onChar(c, origin, font, size, quad, color) {
                            chars.push({
                                c,
                                origin: point(origin, inverse),
                                quad,
                                color,
                                box: [
                                    Math.min(
                                        quad[0],
                                        quad[2],
                                        quad[4],
                                        quad[6]
                                    ),
                                    Math.min(
                                        quad[1],
                                        quad[3],
                                        quad[5],
                                        quad[7]
                                    ),
                                    Math.max(
                                        quad[0],
                                        quad[2],
                                        quad[4],
                                        quad[6]
                                    ),
                                    Math.max(quad[1], quad[3], quad[5], quad[7])
                                ]
                            });
                        }
                    });
                } finally {
                    text.destroy();
                }
                const selected = new Set();
                for (const span of spans) {
                    if (!span.text.trim() || span.width <= 0) continue;
                    const [a, b, , , x, y] = span.transform;
                    const size = Math.hypot(a, b);
                    const ux = a / size,
                        uy = b / size;
                    const hits = chars.filter((ch) => {
                        const dx = ch.origin[0] - x,
                            dy = ch.origin[1] - y;
                        const along = dx * ux + dy * uy,
                            across = -dx * uy + dy * ux;
                        return (
                            Math.abs(across) < Math.max(0.3, size * 0.08) &&
                            along >= -0.3 &&
                            along < span.width - 0.1
                        );
                    });
                    const comparable = (s) =>
                        s.normalize('NFKC').replace(/\s/g, '');
                    if (
                        !hits.length ||
                        comparable(hits.map((ch) => ch.c).join('')) !==
                            comparable(span.text)
                    ) {
                        throw new Error(
                            'Could not isolate this text from neighbouring content. The PDF was not saved.'
                        );
                    }
                    const first = hits.find((ch) => ch.c.trim()) || hits[0];
                    const color = first.color;
                    const opacity =
                        paints.find(
                            (p) =>
                                Math.hypot(
                                    p.origin[0] - first.origin[0],
                                    p.origin[1] - first.origin[1]
                                ) < 0.01
                        )?.alpha ?? 1;
                    styles[
                        JSON.stringify([
                            Number(index),
                            span.transform,
                            span.width
                        ])
                    ] = { r: color[0], g: color[1], b: color[2], opacity };
                    for (const ch of hits) selected.add(ch);
                }
                // Keep font resources, including a font whose last text is removed:
                // the replacement still needs its embedded program and encoding.
                const fonts = page.getObject().get('Resources').get('Font');
                const savedImages = [];
                page.getObject()
                    .get('Resources', 'XObject')
                    .forEach((ref, name) => {
                        if (name.startsWith('EPFImage'))
                            savedImages.push([name, ref]);
                    });
                const annots = [];
                const neighbours = chars.filter(
                    (ch) => !selected.has(ch) && ch.c.trim()
                );
                for (const ch of selected) {
                    // A tiny rectangle inside each glyph selects that character
                    // without the broad line boxes that also erase nearby lines.
                    const q = ch.quad;
                    let location;
                    for (const u of [0.5, 0.25, 0.75]) {
                        for (const v of [0.5, 0.25, 0.75]) {
                            const cx =
                                q[0] + u * (q[2] - q[0]) + v * (q[4] - q[0]);
                            const cy =
                                q[1] + u * (q[3] - q[1]) + v * (q[5] - q[1]);
                            if (
                                !neighbours.some(
                                    ({ box: b }) =>
                                        cx + 0.01 > b[0] &&
                                        cx - 0.01 < b[2] &&
                                        cy + 0.01 > b[1] &&
                                        cy - 0.01 < b[3]
                                )
                            ) {
                                location = [cx, cy];
                                break;
                            }
                        }
                        if (location) break;
                    }
                    if (!location)
                        throw new Error(
                            'This text overlaps another text object and cannot be removed independently.'
                        );
                    const [cx, cy] = location;
                    const annot = page.createAnnotation('Redact');
                    annot.setRect([cx - 0.01, cy - 0.01, cx + 0.01, cy + 0.01]);
                    annots.push(annot);
                }
                if (annots.length) {
                    page.applyRedactions(
                        false,
                        mupdf.PDFPage.REDACT_IMAGE_NONE,
                        mupdf.PDFPage.REDACT_LINE_ART_NONE,
                        mupdf.PDFPage.REDACT_TEXT_REMOVE
                    );
                    const resources = page.getObject().get('Resources');
                    if (!fonts.isNull()) resources.put('Font', fonts);
                    if (savedImages.length) {
                        if (resources.get('XObject').isNull())
                            resources.put('XObject', {});
                        for (const [name, ref] of savedImages)
                            resources.get('XObject').put(name, ref);
                    }
                    // Redaction drops overlapping links as well as text. Editing
                    // a label must retain its link and existing form widgets.
                    page.getObject().put('Annots', originalAnnotations);
                }
                annots.forEach((a) => a.destroy());
            } finally {
                page.destroy();
            }
        }
        const buffer = doc.saveToBuffer('garbage=4,compress=yes');
        try {
            return {
                bytes: buffer.asUint8Array().slice(),
                styles,
                imageResources
            };
        } finally {
            buffer.destroy();
        }
    } finally {
        doc.destroy();
    }
}
