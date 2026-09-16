import * as mupdf from '../vendor/mupdf/mupdf.js';
const point = (p, m) => [
    p[0] * m[0] + p[1] * m[2] + m[4],
    p[0] * m[1] + p[1] * m[3] + m[5]
];
const transformed = (m, inv) => {
    const o = point([m[4], m[5]], inv),
        x = point([m[4] + m[0], m[5] + m[1]], inv),
        y = point([m[4] + m[2], m[5] + m[3]], inv);
    return [x[0] - o[0], x[1] - o[1], y[0] - o[0], y[1] - o[1], ...o];
};
export function removeImages(doc, regions) {
    const resources = {};
    for (const [index, requests] of Object.entries(regions)) {
        const page = doc.loadPage(Number(index));
        try {
            if (page.getAnnotations().some((a) => a.getType() === 'Redact'))
                throw new Error(
                    'Resolve pending redactions before editing images.'
                );
            const inverse = mupdf.Matrix.invert(page.getTransform()),
                occurrences = [];
            const device = new mupdf.Device({
                fillImage(image, ctm, alpha) {
                    // MuPDF images use a top-left unit square; PDF image operators use bottom-left.
                    const pdfImageMatrix = [
                        ctm[0],
                        ctm[1],
                        -ctm[2],
                        -ctm[3],
                        ctm[4] + ctm[2],
                        ctm[5] + ctm[3]
                    ];
                    const matrix = transformed(pdfImageMatrix, inverse);
                    const matches = requests.filter((r) =>
                        r.transform.every(
                            (v, i) => Math.abs(v - matrix[i]) < 0.1
                        )
                    );
                    const ref = matches.some((r) => !r.deleted)
                        ? doc.addImage(image)
                        : null;
                    const corners = [
                        [0, 0],
                        [1, 0],
                        [0, 1],
                        [1, 1]
                    ].map((p) => point(p, ctm));
                    occurrences.push({
                        matrix,
                        ctm,
                        alpha,
                        ref,
                        matches,
                        box: [
                            Math.min(...corners.map((p) => p[0])),
                            Math.min(...corners.map((p) => p[1])),
                            Math.max(...corners.map((p) => p[0])),
                            Math.max(...corners.map((p) => p[1]))
                        ]
                    });
                }
            });
            try {
                page.runPageContents(device, mupdf.Matrix.identity);
            } finally {
                device.close();
                device.destroy();
            }
            const selected = [];
            for (const request of requests) {
                const hits = occurrences.filter((o) =>
                    o.matches.includes(request)
                );
                if (hits.length !== 1)
                    throw new Error(
                        'This image cannot be isolated from overlapping image content.'
                    );
                selected.push({ request, occurrence: hits[0] });
            }
            const originalAnnotations = [];
            page.getObject()
                .get('Annots')
                .forEach((r) => originalAnnotations.push(r));
            const annotations = [];
            for (const { occurrence: o } of selected) {
                let location;
                for (const u of [0.5, 0.1, 0.9, 0.25, 0.75])
                    for (const v of [0.5, 0.1, 0.9, 0.25, 0.75]) {
                        const p = point([u, v], o.ctm);
                        if (
                            !occurrences.some(
                                (other) =>
                                    other !== o &&
                                    !selected.some(
                                        (s) => s.occurrence === other
                                    ) &&
                                    p[0] + 0.01 > other.box[0] &&
                                    p[0] - 0.01 < other.box[2] &&
                                    p[1] + 0.01 > other.box[1] &&
                                    p[1] - 0.01 < other.box[3]
                            )
                        )
                            location = p;
                    }
                if (!location)
                    throw new Error(
                        'Overlapping images cannot be removed independently.'
                    );
                const a = page.createAnnotation('Redact');
                a.setRect([
                    location[0] - 0.01,
                    location[1] - 0.01,
                    location[0] + 0.01,
                    location[1] + 0.01
                ]);
                annotations.push(a);
            }
            page.applyRedactions(
                false,
                mupdf.PDFPage.REDACT_IMAGE_REMOVE,
                mupdf.PDFPage.REDACT_LINE_ART_NONE,
                mupdf.PDFPage.REDACT_TEXT_NONE
            );
            page.getObject().put('Annots', originalAnnotations);
            let xobjects = page.getObject().get('Resources', 'XObject');
            if (xobjects.isNull()) {
                page.getObject().get('Resources').put('XObject', {});
                xobjects = page.getObject().get('Resources', 'XObject');
            }
            for (const { request, occurrence } of selected) {
                if (!occurrence.ref) continue;
                let serial = 0,
                    name;
                do {
                    name = `EPFImage${++serial}`;
                } while (!xobjects.get(name).isNull());
                xobjects.put(name, occurrence.ref);
                resources[request.key] = { name, opacity: occurrence.alpha };
            }
            annotations.forEach((a) => a.destroy());
        } finally {
            page.destroy();
        }
    }
    return resources;
}
