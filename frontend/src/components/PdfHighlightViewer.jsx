import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

/* ── text normalisation ──────────────────────────────────────────────── */

function normalize(text) {
    return text.normalize('NFKC').replaceAll(/\s+/g, ' ').trim().toLowerCase();
}

function buildNormMap(text) {
    let norm = '';
    const map = [];
    let ws = true;
    for (let i = 0; i < text.length; i++) {
        if (/\s/.test(text[i])) {
            if (!ws && norm.length > 0) { norm += ' '; map.push(i); ws = true; }
        } else {
            norm += text[i].toLowerCase(); map.push(i); ws = false;
        }
    }
    if (ws && norm.endsWith(' ')) { norm = norm.slice(0, -1); map.pop(); }
    return { norm, map };
}

/* ── substring search ────────────────────────────────────────────────── */

function findAll(haystack, needle) {
    const hits = [];
    let pos = 0;
    while (pos < haystack.length) {
        const idx = haystack.indexOf(needle, pos);
        if (idx === -1) break;
        hits.push({ start: idx, end: idx + needle.length });
        pos = idx + 1;
    }
    return hits;
}

function findClause(normPageText, rawText) {
    const full = normalize(rawText);
    if (full.length < 6) return [];
    const exact = findAll(normPageText, full);
    if (exact.length) return exact;
    for (const frac of [0.75, 0.5, 0.3]) {
        const len = Math.max(30, Math.floor(full.length * frac));
        if (len >= full.length) continue;
        const prefix = full.slice(0, len);
        const hits = findAll(normPageText, prefix);
        if (hits.length) {
            return hits.map(h => {
                const rest = full.slice(len);
                const ext = normPageText.slice(h.end, h.end + rest.length) === rest ? rest.length : 0;
                return { start: h.start, end: h.end + ext };
            });
        }
    }
    return [];
}

/* ── compute coloured rectangles for one PDF page ────────────────────── */

async function computePageHighlights(page, clauses, scale) {
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items.filter(it => it.str?.trim());
    if (!items.length || !clauses?.length) return [];

    let fullText = '';
    const charItem = [];
    for (const [idx, item] of items.entries()) {
        for (const ch of item.str) { charItem.push(idx); fullText += ch; }
        charItem.push(-1); fullText += ' ';
    }
    const { norm, map: n2o } = buildNormMap(fullText);
    const relevant = clauses.filter(c => c.raw_text && (c.severity === 'HIGH' || c.severity === 'MEDIUM' || c.severity === 'UNKNOWN'));
    const rects = [];

    for (const clause of relevant) {
        for (const hit of findClause(norm, clause.raw_text)) {
            const oStart = n2o[hit.start];
            const oEnd   = n2o[Math.min(hit.end - 1, n2o.length - 1)] + 1;
            const covered = new Set();
            for (let i = oStart; i < oEnd && i < charItem.length; i++) {
                if (charItem[i] >= 0) covered.add(charItem[i]);
            }
            for (const idx of covered) {
                const it = items[idx];
                const tx = it.transform;
                const fh = Math.hypot(tx[2], tx[3]) || 12;
                rects.push({
                    left:   tx[4] * scale,
                    top:    (vp.height - tx[5] - fh) * scale,
                    width:  it.width * scale,
                    height: fh * 1.15 * scale,
                    severity: clause.severity,
                });
            }
        }
    }
    return rects;
}

/* ── single page with overlays ───────────────────────────────────────── */

function HighlightedPage({ pageNumber, width, clauses, pdfDoc }) {
    const [rects, setRects] = useState([]);
    const [vpH, setVpH] = useState(0);
    const scaleRef = useRef(1);

    useEffect(() => {
        if (!pdfDoc || !width) return;
        let dead = false;
        pdfDoc.getPage(pageNumber).then(page => {
            if (dead) return;
            const vp = page.getViewport({ scale: 1 });
            scaleRef.current = width / vp.width;
            setVpH(vp.height * scaleRef.current);
            if (!clauses?.length) { setRects([]); return; }
            computePageHighlights(page, clauses, scaleRef.current).then(r => { if (!dead) setRects(r); });
        });
        return () => { dead = true; };
    }, [pdfDoc, pageNumber, width, clauses]);

    return (
        <div style={{ position: 'relative', marginBottom: 4 }}>
            <Page pageNumber={pageNumber} width={width} renderTextLayer renderAnnotationLayer={false} />
            {rects.length > 0 && (
                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: vpH || '100%', pointerEvents: 'none', zIndex: 3 }}>
                    {rects.map((r, i) => (
                        <div key={i} style={{
                            position: 'absolute', left: r.left, top: r.top, width: r.width, height: r.height,
                            backgroundColor: r.severity === 'HIGH' ? 'rgba(239,68,68,0.28)' : r.severity === 'MEDIUM' ? 'rgba(250,204,21,0.38)' : 'rgba(156,163,175,0.30)',
                            borderRadius: 2, mixBlendMode: 'multiply',
                        }} />
                    ))}
                </div>
            )}
        </div>
    );
}

/* ── full document viewer ────────────────────────────────────────────── */

export default function PdfHighlightViewer({ url, clauses, className }) {
    const [numPages, setNumPages] = useState(null);
    const [pdfDoc, setPdfDoc] = useState(null);
    const [pageWidth, setPageWidth] = useState(null);
    const [loadError, setLoadError] = useState(false);
    const [pdfData, setPdfData] = useState(null);
    const containerRef = useRef(null);

    useEffect(() => {
        if (!url) return;
        let dead = false;
        fetch(url)
            .then(r => { if (!r.ok) throw new Error(); return r.arrayBuffer(); })
            .then(buf => { if (!dead) setPdfData({ data: buf }); })
            .catch(() => { if (!dead) setLoadError(true); });
        return () => { dead = true; };
    }, [url]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const obs = new ResizeObserver(entries => { for (const e of entries) setPageWidth(e.contentRect.width); });
        obs.observe(el);
        return () => obs.disconnect();
    }, []);

    const onLoad = useCallback(pdf => { setNumPages(pdf.numPages); setPdfDoc(pdf); }, []);

    const pages = useMemo(() => {
        if (!numPages || !pageWidth) return null;
        return Array.from({ length: numPages }, (_, i) => (
            <HighlightedPage key={i + 1} pageNumber={i + 1} width={pageWidth} clauses={clauses} pdfDoc={pdfDoc} />
        ));
    }, [numPages, pageWidth, clauses, pdfDoc]);

    if (loadError) return (
        <div className={className}><div className="flex items-center justify-center h-full p-8"><p className="text-sm text-red-600">Failed to load PDF.</p></div></div>
    );

    return (
        <div ref={containerRef} className={className} style={{ overflowY: 'auto' }}>
            {pdfData ? (
                <Document file={pdfData} onLoadSuccess={onLoad} onLoadError={() => setLoadError(true)}
                    loading={<div className="flex items-center justify-center h-full p-8"><p className="text-sm text-[#604B42] animate-pulse">Loading document…</p></div>}>
                    {pages}
                </Document>
            ) : (
                <div className="flex items-center justify-center h-full p-8"><p className="text-sm text-[#604B42] animate-pulse">Loading document…</p></div>
            )}
        </div>
    );
}
