import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';

/* ── helpers ────────────────────────────────────────── */
const getPrettyStep = (minPixels: number, pixelsPerUnit: number) => {
    const minUnits = minPixels / pixelsPerUnit;
    // standard clean steps: 1, 2, 5, 10, 25, 50, 100...
    const steps = [
        1, 2, 5, 10, 20, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000
    ];
    return steps.find(s => s >= minUnits) || steps[steps.length - 1];
};

function seqStart(seq: string): number {
    for (let i = 0; i < seq.length; i++) if (seq[i] !== '-') return i;
    return 0;
}

function seqEnd(seq: string): number {
    for (let i = seq.length - 1; i >= 0; i--) if (seq[i] !== '-') return i;
    return seq.length - 1;
}

export interface ParsedSequence {
    id: string;
    seq: string;
}

interface MSAViewerProps {
    alignment: string;
    onVisibleQueryChange?: (data: { id: string; seq: string; start: number; end: number }) => void;
    jobName?: string;
    primers?: { p1: { start: number, end: number }, p2: { start: number, end: number } } | null;
    /** Flanking primers designed in the lower panel — drawn as distinct bars in the minimap */
    flankingPrimers?: { fwd: { start: number; end: number } | null; rev: { start: number; end: number } | null } | null;
    isDarkMode?: boolean;
    /** When set, MSA will zoom/pan to show these global gapped column indices */
    navigateTarget?: { colStart: number; colEnd: number; ts: number } | null;
    /** Called when user drag-selects a region in the GC%/MSA header for oligo placement */
    onOligoRegionSelect?: (startCol: number, endCol: number) => void;
}

/* ── constants ────────────────────────────────────────── */
// Removed fixed labelWidth; now calculated dynamically in the component.
const RIGHT_PADDING = 20;
const MINIMAP_LABEL_W = 35; // narrow label column in the overview minimap
const RULER_HEIGHT = 24;
const ROW_HEIGHT = 18;
const MAX_VIEWER_HEIGHT = 500;
const BP_THRESHOLD = 100;
const HYSTERESIS = 15;
const MINIMAP_GC_H = 40;
const MINIMAP_RULER_H = 14;
const MINIMAP_HANDLE_H = 8;
const MINIMAP_HEIGHT = MINIMAP_GC_H + MINIMAP_RULER_H + 50 + MINIMAP_HANDLE_H;

const MAIN_GC_TRACK_H = 40;
const MAIN_MSA_TRACK_H = 30;

const MSAViewer: React.FC<MSAViewerProps> = ({ alignment, onVisibleQueryChange, primers, flankingPrimers, isDarkMode, navigateTarget, onOligoRegionSelect }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const hoverOverlayRef = useRef<HTMLCanvasElement>(null);
    const minimapRef = useRef<HTMLCanvasElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const targetScrollRef = useRef<number | null>(null);
    const isDragging = useRef(false);
    const [isBarDragging, setIsBarDragging] = useState(false);
    const scrollTrackRef = useRef<HTMLDivElement>(null);
    const [availableWidth, setAvailableWidth] = useState(900);
    const [labelHoverInfo, setLabelHoverInfo] = useState<{ text: string, x: number, y: number } | null>(null);
    const [scrollLeft, setScrollLeft] = useState(0);
    const [scrollTop, setScrollTop] = useState(0);

    // Initial label width calculation
    const calculateAutoWidth = useCallback((seqs: ParsedSequence[]) => {
        if (seqs.length === 0) return 140;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return 220;
        ctx.font = 'bold 10px ui-sans-serif, system-ui, sans-serif';
        let maxW = 0;
        seqs.forEach(s => {
            const w = ctx.measureText(s.id).width;
            if (w > maxW) maxW = w;
        });
        return Math.min(280, Math.max(80, Math.ceil(maxW + 16)));
    }, []);

    const [labelWidth, setLabelWidth] = useState(140);
    const [isResizingLabel, setIsResizingLabel] = useState(false);
    const [oligoSelection, setOligoSelection] = useState<{ startCol: number; endCol: number } | null>(null);

    const [viewFraction, setViewFraction] = useState(1);
    const [viewMode, setViewMode] = useState<'bars' | 'letters'>('bars');
    const [copyFeedback, setCopyFeedback] = useState('');
    const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
    const hoverColRef = useRef<number | null>(null);
    const hoverRafRef = useRef<number>(0);
    const redrawRef = useRef<() => void>(() => { });
    const [showOverview, setShowOverview] = useState(true);
    const scrollPressRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Live-value refs for use inside setInterval (avoid stale closures)
    const viewFractionRef = useRef(viewFraction);
    const seqAreaWRef = useRef(0);
    const totalVirtualWRef = useRef(0);

    const panBy = (dir: -1 | 1) => {
        const el = scrollRef.current;
        if (!el) return;
        const vf = viewFractionRef.current;
        const saw = seqAreaWRef.current;
        const tvw = totalVirtualWRef.current;
        const step = Math.max(40, saw * vf * 0.25);
        const newSL = Math.max(0, Math.min(tvw - saw, el.scrollLeft + dir * step));
        el.scrollLeft = newSL;
        setScrollLeft(newSL);
    };

    const startPan = (dir: -1 | 1) => {
        panBy(dir);
        scrollPressRef.current = setInterval(() => panBy(dir), 120);
    };

    const stopPan = () => {
        if (scrollPressRef.current) { clearInterval(scrollPressRef.current); scrollPressRef.current = null; }
    };

    const handleBarMouseDown = (e: React.MouseEvent) => {
        if (!scrollTrackRef.current || !scrollRef.current) return;
        setIsBarDragging(true);

        const performMove = (clientX: number) => {
            if (!scrollTrackRef.current || !scrollRef.current) return;
            const rect = scrollTrackRef.current.getBoundingClientRect();
            const x = clientX - rect.left;
            const frac = Math.max(0, Math.min(1, x / rect.width));

            // We want the indicator (which represents viewFraction) to be centered on the click if possible
            let targetStart = frac - (viewFractionRef.current / 2);
            targetStart = Math.max(0, Math.min(1 - viewFractionRef.current, targetStart));

            const sl = targetStart * totalVirtualWRef.current;
            scrollRef.current.scrollLeft = sl;
            setScrollLeft(sl);
        };

        const onMouseMove = (moveEvent: MouseEvent) => {
            performMove(moveEvent.clientX);
        };

        const onMouseUp = () => {
            setIsBarDragging(false);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            document.body.style.userSelect = '';
        };

        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        performMove(e.clientX);
    };

    // Offscreen canvas for minimap static background
    const offscreenMinimapRef = useRef<HTMLCanvasElement | null>(null);
    const staticMinimapDrawnRef = useRef<boolean>(false);

    /* ── parse FASTA ────────────────────────────────────── */
    const sequences = useMemo<ParsedSequence[]>(() => {
        if (!alignment) return [];
        const lines = alignment.trim().split('\n');
        const seqs: ParsedSequence[] = [];
        let cur = '';
        let seq = '';
        lines.forEach((l) => {
            if (l.startsWith('>')) {
                if (cur) seqs.push({ id: cur, seq });
                
                const header = l.substring(1).trim();
                let displayName = header;

                // Try to find organism info (often in brackets like [organism=Homo sapiens] or [Homo sapiens])
                const bracketMatch = header.match(/\[([^\]]+)\]/);
                if (bracketMatch) {
                    const content = bracketMatch[1];
                    const orgMatch = content.match(/organism=([^;]+)/i);
                    displayName = orgMatch ? orgMatch[1] : content;
                } else {
                    // Standard NCBI header format: ">Accession Genus species Description..."
                    const parts = header.split(/\s+/);
                    if (parts.length >= 2) {
                        // Remove the accession part (first word)
                        const afterAcc = header.substring(parts[0].length).trim();
                        
                        // Capture everything until we hit common technical metadata or separators
                        // This allows capturing "Human papillomavirus 6" or "Staphylococcus aureus subsp. aureus"
                        const match = afterAcc.match(/^([^,;()\[\]]+?)(?:\s+(?:complete|partial|sequence|rRNA|genomic|DNA|isolate|strain|clone|16S|mRNA|chromosome|segment|internal|v\d+|genome)|$)/i);
                        
                        if (match && match[1].trim()) {
                            displayName = match[1].trim();
                        } else {
                            // Fallback to first few words if regex fails
                            displayName = parts.slice(1, 5).join(' ');
                        }
                    }
                }
                
                // Cap at 35 chars at a word boundary so gene/protein suffixes don't inflate the label column
                if (displayName.length > 35) {
                    const cut = displayName.substring(0, 35);
                    displayName = cut.includes(' ') ? cut.replace(/\s+\S*$/, '') : cut;
                }

                cur = displayName;
                seq = '';
            } else {
                seq += l.trim();
            }
        });
        if (cur) seqs.push({ id: cur, seq });
        return seqs;
    }, [alignment]);

    const seqLen = sequences.length > 0 ? Math.max(...sequences.map((s) => s.seq.length)) : 0;
    const querySeq = sequences.length > 0 ? sequences[0].seq : '';

    useEffect(() => {
        setLabelWidth(calculateAutoWidth(sequences));
    }, [sequences, calculateAutoWidth]);

    const handleResizeMouseDown = (e: React.MouseEvent) => {
        setIsResizingLabel(true);
        const startX = e.clientX;
        const startW = labelWidth;

        const onMouseMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startX;
            setLabelWidth(Math.max(80, Math.min(600, startW + delta)));
        };

        const onMouseUp = () => {
            setIsResizingLabel(false);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            document.body.style.userSelect = '';
        };

        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    };

    /* ── sizing ─────────────────────────────────────────── */
    const seqAreaW = Math.max(1, availableWidth - labelWidth - RIGHT_PADDING);
    const totalVirtualW = seqAreaW / viewFraction;
    const cellW = seqLen > 0 ? totalVirtualW / seqLen : 1;
    const visibleBases = seqLen * viewFraction;
    const totalH = MAIN_GC_TRACK_H + MAIN_MSA_TRACK_H + RULER_HEIGHT + sequences.length * ROW_HEIGHT + 4;

    // Keep live refs up-to-date for use inside setInterval (avoids stale closures)
    viewFractionRef.current = viewFraction;
    seqAreaWRef.current = seqAreaW;
    totalVirtualWRef.current = totalVirtualW;

    /* ── viewport fractions ────────────────────────────── */
    const startFrac = totalVirtualW > 0 ? scrollLeft / totalVirtualW : 0;
    const endFrac = Math.min(1, startFrac + viewFraction);
    const startCol = Math.max(0, Math.floor(startFrac * seqLen));
    const endCol = Math.min(seqLen - 1, Math.ceil(endFrac * seqLen) - 1);

    /* ── broadcast visible query range ─────────────────── */
    useEffect(() => {
        if (sequences.length > 0 && onVisibleQueryChange) {
            // Provide the visible slice of the query (first sequence)
            const query = sequences[0];
            const start = Math.max(0, startCol);
            const end = Math.min(query.seq.length - 1, endCol);
            const slice = query.seq.slice(start, end + 1);
            onVisibleQueryChange({
                id: query.id,
                seq: slice,
                start: start,
                end: end
            });
        }
    }, [sequences, startCol, endCol, onVisibleQueryChange]);

    /* ── auto-switch mode with hysteresis ──────────────── */
    useEffect(() => {
        if (viewMode === 'bars' && visibleBases < BP_THRESHOLD - HYSTERESIS) {
            setViewMode('letters');
        } else if (viewMode === 'letters' && visibleBases > BP_THRESHOLD + HYSTERESIS) {
            setViewMode('bars');
        }
    }, [visibleBases, viewMode]);

    /* ── container resize tracking ──────────────────────── */
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const obs = new ResizeObserver((e) => {
            for (const entry of e) setAvailableWidth(entry.contentRect.width);
        });
        obs.observe(el);
        return () => obs.disconnect();
    }, []);

    /* ── sync programmatic scroll after render ─────────── */
    useEffect(() => {
        if (targetScrollRef.current !== null && scrollRef.current) {
            scrollRef.current.scrollLeft = targetScrollRef.current;
            targetScrollRef.current = null;
        }
    });

    /* ── zoom helpers (anchored to viewport center) ───── */
    const applyZoom = (factor: number) => {
        const newVF = Math.max(0.005, Math.min(1, viewFraction * factor));

        // Calculate the current horizontal center (global fraction 0..1)
        const currentTotalVirtualW = seqAreaW / viewFraction;
        const centerFracGlobal = (scrollLeft + seqAreaW / 2) / currentTotalVirtualW;

        // Calculate new scrollLeft to keep centerFracGlobal at the new viewport center
        const newTotalVirtualW = seqAreaW / newVF;
        let newSL = centerFracGlobal * newTotalVirtualW - seqAreaW / 2;

        // Clamp scroll
        newSL = Math.max(0, Math.min(newTotalVirtualW - seqAreaW, newSL));

        setViewFraction(newVF);
        setScrollLeft(newSL);
        // Sync with ref so it's immediate
        if (scrollRef.current) scrollRef.current.scrollLeft = newSL;
    };

    const zoomIn = () => applyZoom(0.75);
    const zoomOut = () => applyZoom(1.33);

    /* ── navigate to a specific column range ────────────── */
    useEffect(() => {
        if (!navigateTarget || seqLen === 0) return;
        const { colStart, colEnd } = navigateTarget;
        const PADDING = 150; // extra columns of context on each side
        const visStart = Math.max(0, colStart - PADDING);
        const visEnd = Math.min(seqLen - 1, colEnd + PADDING);
        const spanCols = visEnd - visStart + 1;
        const newVF = Math.max(0.005, Math.min(1, spanCols / seqLen));
        const centerFrac = (colStart + colEnd) / (2 * seqLen);
        const newTotalVW = seqAreaW / newVF;
        let newSL = centerFrac * newTotalVW - seqAreaW / 2;
        newSL = Math.max(0, Math.min(newTotalVW - seqAreaW, newSL));
        setViewFraction(newVF);
        setScrollLeft(newSL);
        if (scrollRef.current) scrollRef.current.scrollLeft = newSL;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigateTarget]); // intentionally only react to the navigate command

    /* ── copy helpers ─────────────────────────────────── */
    const showCopyFeedback = (msg: string) => {
        setCopyFeedback(msg);
        setTimeout(() => setCopyFeedback(''), 2000);
    };

    const isDark = isDarkMode ?? document.documentElement.classList.contains('dark');

    const copySequence = (seq: ParsedSequence) => {
        const raw = seq.seq.replace(/-/g, '');
        navigator.clipboard.writeText(raw).then(() => {
            showCopyFeedback(`Copied ${seq.id} (${raw.length} bp)`);
        });
    };

    const copyAllFasta = () => {
        const fasta = sequences.map((s) => `>${s.id}\n${s.seq}`).join('\n');
        navigator.clipboard.writeText(fasta).then(() => {
            showCopyFeedback(`Copied ${sequences.length} sequences (FASTA)`);
        });
    };

    const copySelection = () => {
        if (sequences.length === 0) return;
        const query = sequences[0];
        const sub = query.seq.slice(startCol, endCol + 1);
        navigator.clipboard.writeText(sub).then(() => {
            showCopyFeedback(`Copied query pos ${startCol + 1}–${endCol + 1} (${sub.length} bp)`);
        });
    };

    /* ── compute GC content per column ──────────── */
    const gcContent = useMemo(() => {
        if (seqLen === 0 || sequences.length === 0) return [];
        const gc: number[] = new Array(seqLen);
        for (let col = 0; col < seqLen; col++) {
            let gcCount = 0;
            let total = 0;
            for (const s of sequences) {
                const ch = (s.seq[col] || '-').toUpperCase();
                if (ch === '-') continue;
                total++;
                if (ch === 'G' || ch === 'C') gcCount++;
            }
            gc[col] = total > 0 ? gcCount / total : 0;
        }
        return gc;
    }, [sequences, seqLen]);

    /* ── precompute mismatch columns for O(1) hover lookup ── */
    const mismatchCols = useMemo(() => {
        const set = new Set<number>();
        if (sequences.length < 2 || seqLen === 0) return set;
        for (let col = 0; col < seqLen; col++) {
            const qch = (sequences[0].seq[col] || '-').toUpperCase();
            if (qch === '-') continue;
            for (let row = 1; row < sequences.length; row++) {
                const ch = (sequences[row].seq[col] || '-').toUpperCase();
                if (ch !== '-' && ch !== qch) { set.add(col); break; }
            }
        }
        return set;
    }, [sequences, seqLen]);

    /* ── selection statistics (visible range) ─────── */
    const selectionStats = useMemo(() => {
        if (sequences.length === 0) return null;
        const query = sequences[0];
        const sub = query.seq.slice(startCol, endCol + 1).toUpperCase();
        let g = 0, c = 0, a = 0, t = 0, total = 0;
        for (const char of sub) {
            if (char === 'G') g++;
            else if (char === 'C') c++;
            else if (char === 'A') a++;
            else if (char === 'T') t++;
            if (char !== '-') total++;
        }
        const gcPct = total > 0 ? ((g + c) / total) * 100 : 0;
        return { g, c, a, t, total, gcPct };
    }, [sequences, startCol, endCol]);

    const drawMinimapBackground = useCallback(() => {
        if (!sequences.length) return;
        if (!offscreenMinimapRef.current) {
            offscreenMinimapRef.current = document.createElement('canvas');
        }
        const cvs = offscreenMinimapRef.current;
        const ctx = cvs.getContext('2d', { alpha: false });
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        cvs.width = availableWidth * dpr;
        cvs.height = MINIMAP_HEIGHT * dpr;
        ctx.scale(dpr, dpr);

        const mmSeqW = availableWidth - MINIMAP_LABEL_W - RIGHT_PADDING;
        const rowsTop = MINIMAP_GC_H + MINIMAP_RULER_H;
        const rowAreaH = MINIMAP_HEIGHT - rowsTop - MINIMAP_HANDLE_H;
        const rowH = rowAreaH / sequences.length;
        const rowDrawH = Math.max(1, rowH);

        ctx.fillStyle = isDark ? '#0f172a' : '#f8fafc';
        ctx.fillRect(0, 0, availableWidth, MINIMAP_HEIGHT);

        ctx.fillStyle = isDark ? '#94a3b8' : '#94a3b8';
        ctx.font = '7px ui-monospace, SFMono-Regular, monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('GC%', MINIMAP_LABEL_W - 4, MINIMAP_GC_H / 2);
        ctx.fillText('MSA', MINIMAP_LABEL_W - 4, rowsTop + rowAreaH / 2);

        for (let col = 0; col < seqLen; col++) {
            const x = MINIMAP_LABEL_W + (col / seqLen) * mmSeqW;
            const w = Math.max(1, mmSeqW / seqLen);
            const gc = gcContent[col] || 0;
            const r = Math.round(255 - gc * 150);
            const g = Math.round(180 + gc * 60);
            const b = Math.round(50 + gc * 100);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            const barH = gc * MINIMAP_GC_H;
            ctx.fillRect(x, MINIMAP_GC_H - barH, w, barH);
        }
        ctx.fillStyle = isDark ? '#334155' : '#e2e8f0';
        ctx.fillRect(MINIMAP_LABEL_W, MINIMAP_GC_H - 0.5, mmSeqW, 0.5);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '8px ui-monospace, SFMono-Regular, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const tickInt = getPrettyStep(150, mmSeqW / seqLen);
        for (let col = 0; col < seqLen; col++) {
            if ((col + 1) % tickInt === 0) {
                const x = MINIMAP_LABEL_W + ((col + 0.5) / seqLen) * mmSeqW;
                ctx.fillStyle = isDark ? '#334155' : '#cbd5e1';
                ctx.fillRect(x, MINIMAP_GC_H + MINIMAP_RULER_H - 4, 1, 4);
                ctx.fillStyle = '#94a3b8';
                ctx.fillText(String(col + 1), x, MINIMAP_GC_H + MINIMAP_RULER_H - 5);
            }
        }
        ctx.fillStyle = isDark ? '#334155' : '#e2e8f0';
        ctx.fillRect(MINIMAP_LABEL_W, rowsTop - 0.5, mmSeqW, 0.5);

        const sampleStep = Math.max(1, Math.floor(sequences.length / 200));
        for (let row = 0; row < sequences.length; row += sampleStep) {
            const s = sequences[row];
            const y = rowsTop + row * rowH;
            const isQuery = row === 0;

            const sStart = seqStart(s.seq);
            const sEnd = seqEnd(s.seq);
            if (sStart <= sEnd) {
                const x1 = MINIMAP_LABEL_W + (sStart / seqLen) * mmSeqW;
                const x2 = MINIMAP_LABEL_W + ((sEnd + 1) / seqLen) * mmSeqW;
                ctx.fillStyle = isQuery ? (isDark ? '#1e3a8a' : '#bfdbfe') : (isDark ? '#334155' : '#d1d5db');
                ctx.fillRect(x1, y, x2 - x1, rowDrawH);
            }

            const pxStep = Math.max(1, seqLen / mmSeqW);
            for (let x = 0; x < mmSeqW; x++) {
                const colBase = Math.floor((x / mmSeqW) * seqLen);
                const sampleCols = [colBase];
                if (pxStep > 2) sampleCols.push(colBase + Math.floor(pxStep / 2));

                for (const col of sampleCols) {
                    if (col >= seqLen) continue;
                    const ch = (s.seq[col] || '-').toUpperCase();
                    const qch = (querySeq[col] || '-').toUpperCase();
                    const isInternalDeletion = !isQuery && ch === '-' && col >= sStart && col <= sEnd;
                    const isInsertion = !isQuery && qch === '-' && ch !== '-';

                    if (isInternalDeletion || isInsertion) {
                        ctx.fillStyle = '#9333ea';
                        ctx.fillRect(MINIMAP_LABEL_W + x, y, 1.2, rowDrawH);
                        break;
                    } else if (!isQuery && ch !== '-' && ch !== qch && qch !== '-') {
                        ctx.fillStyle = '#dc2626';
                        ctx.fillRect(MINIMAP_LABEL_W + x, y, 1.2, rowDrawH);
                        break;
                    }
                }
            }
        }

        if (primers) {
            const mmRulerY = MINIMAP_GC_H;
            const mmRulerH = MINIMAP_RULER_H;
            const p1x = MINIMAP_LABEL_W + (primers.p1.start / seqLen) * mmSeqW;
            const p1w = Math.max(1, ((primers.p1.end - primers.p1.start) / seqLen) * mmSeqW);
            ctx.fillStyle = '#22c55e';
            ctx.fillRect(p1x, mmRulerY + mmRulerH - 4, p1w, 4);
            const p2x = MINIMAP_LABEL_W + (primers.p2.start / seqLen) * mmSeqW;
            const p2w = Math.max(1, ((primers.p2.end - primers.p2.start) / seqLen) * mmSeqW);
            ctx.fillStyle = '#facc15';
            ctx.fillRect(p2x, mmRulerY + mmRulerH - 4, p2w, 4);
        }

        // Flanking primers (designed in lower panel) — drawn above the oligo bars
        if (flankingPrimers) {
            const mmRulerY = MINIMAP_GC_H;
            if (flankingPrimers.fwd) {
                const fx = MINIMAP_LABEL_W + (flankingPrimers.fwd.start / seqLen) * mmSeqW;
                const fw = Math.max(2, ((flankingPrimers.fwd.end - flankingPrimers.fwd.start) / seqLen) * mmSeqW);
                ctx.fillStyle = '#10b981'; // emerald-500
                ctx.fillRect(fx, mmRulerY, fw, 3);
            }
            if (flankingPrimers.rev) {
                const rx = MINIMAP_LABEL_W + (flankingPrimers.rev.start / seqLen) * mmSeqW;
                const rw = Math.max(2, ((flankingPrimers.rev.end - flankingPrimers.rev.start) / seqLen) * mmSeqW);
                ctx.fillStyle = '#14b8a6'; // teal-500
                ctx.fillRect(rx, mmRulerY, rw, 3);
            }
        }

        ctx.fillStyle = isDark ? '#334155' : '#cbd5e1';
        ctx.fillRect(MINIMAP_LABEL_W - 1, 0, 1, MINIMAP_HEIGHT);

        staticMinimapDrawnRef.current = true;
    }, [sequences, querySeq, seqLen, availableWidth, gcContent, primers, flankingPrimers, isDark]);

    const drawMinimap = useCallback(() => {
        const cvs = minimapRef.current;
        if (!cvs || sequences.length === 0) return;
        const ctx = cvs.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        cvs.width = availableWidth * dpr;
        cvs.height = MINIMAP_HEIGHT * dpr;
        cvs.style.width = `${availableWidth}px`;
        cvs.style.height = `${MINIMAP_HEIGHT}px`;
        ctx.scale(dpr, dpr);

        if (!staticMinimapDrawnRef.current) {
            drawMinimapBackground();
        }

        if (offscreenMinimapRef.current) {
            ctx.drawImage(offscreenMinimapRef.current, 0, 0, availableWidth * dpr, MINIMAP_HEIGHT * dpr, 0, 0, availableWidth, MINIMAP_HEIGHT);
        }

        const mmSeqW = availableWidth - MINIMAP_LABEL_W - RIGHT_PADDING;
        const rowsTop = MINIMAP_GC_H + MINIMAP_RULER_H;
        const rowAreaH = MINIMAP_HEIGHT - rowsTop - MINIMAP_HANDLE_H;

        if (selectionRange) {
            const s = Math.min(selectionRange.start, selectionRange.end);
            const e = Math.max(selectionRange.start, selectionRange.end);
            const selX = Math.floor(MINIMAP_LABEL_W + s * mmSeqW) + 0.5;
            const selW = Math.max(1, Math.floor((e - s) * mmSeqW));
            ctx.fillStyle = 'rgba(74, 222, 128, 0.4)';
            ctx.fillRect(selX, rowsTop, selW, rowAreaH);
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 1;
            ctx.strokeRect(selX, rowsTop, selW, rowAreaH);
        }

        if (viewFraction < 0.99) {
            const selX = Math.floor(MINIMAP_LABEL_W + startFrac * mmSeqW) + 0.5;
            const selW = Math.max(1, Math.ceil((endFrac - startFrac) * mmSeqW));
            ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.6)' : 'rgba(255,255,255,0.6)';
            ctx.fillRect(MINIMAP_LABEL_W, rowsTop, selX - MINIMAP_LABEL_W - 0.5, rowAreaH);
            ctx.fillRect(selX + selW, rowsTop, availableWidth - (selX + selW), rowAreaH);
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 1;
            ctx.strokeRect(selX, rowsTop, selW, rowAreaH);
            ctx.fillStyle = isDark ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.08)';
            ctx.fillRect(selX, rowsTop, selW, rowAreaH);

            const minHandleW = 16;
            const handleDrawW = Math.max(selW, minHandleW);
            let handleX = selX + selW / 2 - handleDrawW / 2;
            handleX = Math.max(MINIMAP_LABEL_W, Math.min(MINIMAP_LABEL_W + mmSeqW - handleDrawW, handleX));
            ctx.fillStyle = '#3b82f6';
            ctx.fillRect(Math.floor(handleX), rowsTop + rowAreaH, handleDrawW, MINIMAP_HANDLE_H - 1);
        }

        const hoverCol = hoverColRef.current;
        if (hoverCol !== null && hoverCol >= 0 && hoverCol < seqLen) {
            const hx = MINIMAP_LABEL_W + (hoverCol / seqLen) * mmSeqW;
            ctx.strokeStyle = mismatchCols.has(hoverCol) ? '#ef4444' : '#3b82f6';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(Math.floor(hx) + 0.5, rowsTop);
            ctx.lineTo(Math.floor(hx) + 0.5, rowsTop + rowAreaH);
            ctx.stroke();
        }

        ctx.fillStyle = isDark ? '#334155' : '#cbd5e1';
        ctx.fillRect(MINIMAP_LABEL_W - 1, 0, 1, MINIMAP_HEIGHT);
    }, [sequences.length, availableWidth, startFrac, endFrac, viewFraction, selectionRange, isDark, drawMinimapBackground, seqLen, mismatchCols]);

    useEffect(() => {
        staticMinimapDrawnRef.current = false;
        drawMinimapBackground();
    }, [drawMinimapBackground]);

    useEffect(() => { drawMinimap(); }, [drawMinimap]);

    /* ══════════════════════════════════════════════════════
       MINIMAP DRAG
       ══════════════════════════════════════════════════════ */
    const handleMinimapMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = minimapRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mmSeqW = rect.width - MINIMAP_LABEL_W - RIGHT_PADDING;
        const mouseXFrac = Math.max(0, Math.min(1, (e.clientX - rect.left - MINIMAP_LABEL_W) / mmSeqW));

        // Capture current viewport
        const curSeqAreaW = availableWidth - labelWidth - RIGHT_PADDING;
        const curStart = scrollLeft / (curSeqAreaW / viewFraction);
        const curEnd = curStart + viewFraction;
        const handleZone = 10 / mmSeqW; // 10px side handle zone

        let dragType: 'select' | 'left' | 'right';

        // Check for handles ONLY if blue box is visible
        const blueBoxVisible = viewFraction < 0.99;

        if (blueBoxVisible) {
            if (Math.abs(mouseXFrac - curStart) < handleZone && mouseXFrac < curEnd) {
                dragType = 'left';
            } else if (Math.abs(mouseXFrac - curEnd) < handleZone && mouseXFrac > curStart) {
                dragType = 'right';
            } else {
                dragType = 'select';
            }
        } else {
            dragType = 'select';
        }

        if (dragType === 'select') {
            // Init selection
            setSelectionRange({ start: mouseXFrac, end: mouseXFrac });
            // No need to set scroll/view yet
        }

        const startClientX = e.clientX;
        const onMove = makeMoveHandler(dragType, startClientX, curStart, curEnd, curSeqAreaW, mmSeqW, mouseXFrac);

        const onUp = () => {
            isDragging.current = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);

            // Finalize selection logic
            if (dragType === 'select') {
                setSelectionRange((prev) => {
                    if (!prev) return null;
                    const s = Math.min(prev.start, prev.end);
                    const e = Math.max(prev.start, prev.end);
                    // If selection is tiny (click), maybe just ignore or zoom in a bit?
                    // Let's enforce a minimum 0.5% width to avoid accidental clicks
                    if (e - s < 0.005) {
                        return null; // Cancel
                    }

                    // Apply zoom
                    const newVF = e - s;
                    const newTotalW = curSeqAreaW / newVF;
                    const newSL = s * newTotalW;

                    setViewFraction(newVF);
                    setScrollLeft(newSL);
                    targetScrollRef.current = newSL;

                    return null; // Clear selection rectangle
                });
            }
        };
        isDragging.current = true;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
    }, [availableWidth, viewFraction, scrollLeft, seqAreaW]);

    const makeMoveHandler = useCallback((
        dragType: 'select' | 'left' | 'right',
        startClientX: number,
        origStart: number,
        origEnd: number,
        curSeqAreaW: number,
        mmSeqW: number,
        origMouseFrac: number
    ) => {
        return (ev: MouseEvent) => {
            const deltaFrac = (ev.clientX - startClientX) / mmSeqW;

            if (dragType === 'select') {
                const currentMouseFrac = Math.max(0, Math.min(1, origMouseFrac + deltaFrac));
                setSelectionRange({ start: origMouseFrac, end: currentMouseFrac });
                return;
            }

            // Standard Resize Logic
            let newStart = origStart;
            let newEnd = origEnd;

            if (dragType === 'left') {
                newStart = Math.max(0, Math.min(origEnd - 0.005, origStart + deltaFrac));
            } else {
                newEnd = Math.min(1, Math.max(origStart + 0.005, origEnd + deltaFrac));
            }

            const newVF = Math.max(0.005, newEnd - newStart);
            const newTotalW = curSeqAreaW / newVF;
            const newSL = newStart * newTotalW;

            setViewFraction(newVF);
            setScrollLeft(newSL);
            targetScrollRef.current = newSL;
        };
    }, []);

    /* ── minimap cursor style + hover column ───────────────── */
    const handleMinimapMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = minimapRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mmSeqW = rect.width - MINIMAP_LABEL_W - RIGHT_PADDING;
        const mouseXFrac = (e.clientX - rect.left - MINIMAP_LABEL_W) / mmSeqW;

        // Set hover column for cursor line
        const col = Math.floor(mouseXFrac * seqLen);
        const newCol = col >= 0 && col < seqLen ? col : null;
        if (newCol !== hoverColRef.current) {
            hoverColRef.current = newCol;
            cancelAnimationFrame(hoverRafRef.current);
            hoverRafRef.current = requestAnimationFrame(() => redrawRef.current());
        }

        const curSeqAreaW = availableWidth - labelWidth - RIGHT_PADDING;
        const curTotalVW = curSeqAreaW / viewFraction;
        const curStart = scrollLeft / curTotalVW;
        const curEnd = curStart + viewFraction;
        const handleZone = 10 / mmSeqW;

        const blueBoxVisible = viewFraction < 0.99;

        if (blueBoxVisible) {
            if (Math.abs(mouseXFrac - curStart) < handleZone || Math.abs(mouseXFrac - curEnd) < handleZone) {
                canvas.style.cursor = 'ew-resize';
            } else {
                canvas.style.cursor = 'crosshair';
            }
        } else {
            canvas.style.cursor = 'crosshair';
        }
    }, [viewFraction, scrollLeft, availableWidth, seqLen]);

    const handleMinimapMouseLeave = useCallback(() => {
        if (hoverColRef.current !== null) {
            hoverColRef.current = null;
            cancelAnimationFrame(hoverRafRef.current);
            hoverRafRef.current = requestAnimationFrame(() => redrawRef.current());
        }
    }, []);

    /* ══════════════════════════════════════════════════════
       MAIN CANVAS DRAWING
       ══════════════════════════════════════════════════════ */
    const draw = useCallback(() => {
        const cvs = canvasRef.current;
        if (!cvs || sequences.length === 0) return;
        const ctx = cvs.getContext('2d');
        if (!ctx) return;

        const canvasH = Math.min(totalH, MAX_VIEWER_HEIGHT);
        const dpr = window.devicePixelRatio || 1;
        cvs.width = availableWidth * dpr;
        cvs.height = canvasH * dpr;
        cvs.style.width = `${availableWidth}px`;
        cvs.style.height = `${canvasH}px`;
        ctx.scale(dpr, dpr);

        ctx.fillStyle = isDark ? '#0f172a' : '#ffffff';
        ctx.fillRect(0, 0, availableWidth, canvasH);

        // Virtualize Y rendering using context translation
        ctx.save();
        ctx.translate(0, -scrollTop);

        const firstCol = Math.max(0, Math.floor(scrollLeft / cellW));
        const lastCol = Math.min(seqLen - 1, Math.ceil((scrollLeft + seqAreaW) / cellW));

        /* ── clip sequence area so it never bleeds into labels ── */
        ctx.save();
        ctx.beginPath();
        // Allow drawing into the right padding for labels/ticks, but limit Y to entire virtual height
        ctx.rect(labelWidth, scrollTop, availableWidth - labelWidth, canvasH);
        ctx.clip();

        /* ── row contents (within clip) ── */
        // Calculate visible rows for Y-virtualization
        const rowsStartY = MAIN_GC_TRACK_H + MAIN_MSA_TRACK_H + RULER_HEIGHT;
        const firstRow = Math.max(0, Math.floor((scrollTop - rowsStartY) / ROW_HEIGHT));
        const lastRow = Math.min(sequences.length - 1, Math.ceil((scrollTop + canvasH - rowsStartY) / ROW_HEIGHT) + 2);

        for (let row = firstRow; row <= lastRow; row++) {
            const s = sequences[row];
            const y = MAIN_GC_TRACK_H + MAIN_MSA_TRACK_H + RULER_HEIGHT + row * ROW_HEIGHT;
            const isQuery = row === 0;

            const sStart = seqStart(s.seq);
            const sEnd = seqEnd(s.seq);

            if (viewMode === 'letters') {
                for (let col = firstCol; col <= lastCol; col++) {
                    const ch = (s.seq[col] || '-').toUpperCase();
                    const qch = (querySeq[col] || '-').toUpperCase();

                    const x = labelWidth + col * cellW - scrollLeft;

                    let bg = '#f3f4f6'; // default/match gray
                    let fg = '#374151';

                    if (ch === '-') {
                        if (!isQuery && col >= sStart && col <= sEnd) {
                            bg = isDark ? '#3b0764' : '#f3e8ff';
                            fg = isDark ? '#d8b4fe' : '#7e22ce';
                        } else {
                            bg = isDark ? '#0f172a' : '#f3f4f6';
                            fg = isDark ? '#475569' : '#9ca3af';
                        }
                    } else if (!isQuery && qch === '-' && ch !== '-') {
                        bg = isDark ? '#3b0764' : '#f3e8ff';
                        fg = isDark ? '#d8b4fe' : '#7e22ce';
                    } else if (!isQuery && ch !== qch && qch !== '-') {
                        bg = isDark ? '#7f1d1d' : '#fee2e2';
                        fg = isDark ? '#fecaca' : '#b91c1c';
                    } else {
                        bg = isDark ? '#1e293b' : '#f3f4f6';
                        fg = isDark ? '#cbd5e1' : '#374151';

                        if (isQuery) {
                            if (primers && col >= primers.p1.start && col < primers.p1.end) {
                                bg = isDark ? '#065f46' : '#86efac';
                                fg = isDark ? '#a7f3d0' : '#064e3b';
                            } else if (primers && col >= primers.p2.start && col < primers.p2.end) {
                                bg = isDark ? '#92400e' : '#fde047';
                                fg = isDark ? '#fef3c7' : '#78350f';
                            } else if (flankingPrimers?.fwd && col >= flankingPrimers.fwd.start && col < flankingPrimers.fwd.end) {
                                bg = isDark ? '#047857' : '#34d399';
                                fg = isDark ? '#d1fae5' : '#022c22';
                            } else if (flankingPrimers?.rev && col >= flankingPrimers.rev.start && col < flankingPrimers.rev.end) {
                                bg = isDark ? '#0f766e' : '#2dd4bf';
                                fg = isDark ? '#ccfbf1' : '#042f2e';
                            }
                        }
                    }

                    ctx.fillStyle = bg;
                    ctx.fillRect(x, y, cellW + 0.5, ROW_HEIGHT);
                    ctx.fillStyle = fg;
                    const fs = Math.min(13, Math.max(8, cellW * 0.8));
                    ctx.font = `${fs}px ui-monospace, SFMono-Regular, monospace`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(ch, x + cellW / 2, y + ROW_HEIGHT / 2);
                }
            }
            else {
                if (sStart <= sEnd) {
                    const barX1 = Math.floor(Math.max(labelWidth, labelWidth + sStart * cellW - scrollLeft));
                    const barX2 = Math.ceil(Math.min(labelWidth + seqAreaW, labelWidth + (sEnd + 1) * cellW - scrollLeft));
                    if (barX2 > barX1) {
                        ctx.fillStyle = isQuery
                            ? (isDark ? '#1e3a8a' : '#bfdbfe')
                            : (isDark ? '#334155' : '#e2e8f0');
                        ctx.fillRect(barX1, y + 3, barX2 - barX1, ROW_HEIGHT - 6);
                    }
                }
                const barW = Math.max(1, Math.ceil(cellW));
                for (let col = firstCol; col <= lastCol; col++) {
                    const ch = (s.seq[col] || '-').toUpperCase();
                    const qch = (querySeq[col] || '-').toUpperCase();
                    if (ch === '-') continue;

                    const x = Math.floor(labelWidth + col * cellW - scrollLeft);

                    const isInternalDeletion = !isQuery && ch === '-' && col >= sStart && col <= sEnd;
                    const isInsertion = !isQuery && qch === '-' && ch !== '-';

                    if (isInternalDeletion || isInsertion) {
                        ctx.fillStyle = '#9333ea';
                        ctx.fillRect(x, y + 2, barW, ROW_HEIGHT - 4);
                    } else if (!isQuery && ch !== '-' && ch !== qch && qch !== '-') {
                        ctx.fillStyle = '#dc2626';
                        ctx.fillRect(x, y + 2, barW, ROW_HEIGHT - 4);
                    } else if (isQuery && ch !== '-') {
                        if (primers && col >= primers.p1.start && col < primers.p1.end) {
                            ctx.fillStyle = '#22c55e';
                            ctx.fillRect(x, y + 2, barW, ROW_HEIGHT - 4);
                        } else if (primers && col >= primers.p2.start && col < primers.p2.end) {
                            ctx.fillStyle = '#facc15';
                            ctx.fillRect(x, y + 2, barW, ROW_HEIGHT - 4);
                        } else if (flankingPrimers?.fwd && col >= flankingPrimers.fwd.start && col < flankingPrimers.fwd.end) {
                            ctx.fillStyle = '#10b981';
                            ctx.fillRect(x, y + 2, barW, ROW_HEIGHT - 4);
                        } else if (flankingPrimers?.rev && col >= flankingPrimers.rev.start && col < flankingPrimers.rev.end) {
                            ctx.fillStyle = '#14b8a6';
                            ctx.fillRect(x, y + 2, barW, ROW_HEIGHT - 4);
                        }
                    }
                }
            }

            ctx.fillStyle = isDark ? '#1e293b' : '#f1f5f9';
            ctx.fillRect(labelWidth, y + ROW_HEIGHT - 0.5, seqAreaW, 0.5);
        }

        /* ══════════════════════════════════════════════════════
           STICKY HEADER: GC bar + MSA overview + Ruler
           Drawn ON TOP of sequence rows so they stay visible
           when scrolling. All Y positions use scrollTop offset.
           ══════════════════════════════════════════════════════ */
        const stickyY = scrollTop; // base Y for sticky header (screen Y=0 in translated coords)

        // ── GC content track (sticky) ──
        ctx.fillStyle = isDark ? '#1e293b' : '#f8fafc';
        ctx.fillRect(labelWidth, stickyY, availableWidth - labelWidth, MAIN_GC_TRACK_H);
        const gcBarW = Math.max(1, Math.ceil(cellW));
        for (let col = firstCol; col <= lastCol; col++) {
            const x = Math.floor(labelWidth + col * cellW - scrollLeft);
            const gc = gcContent[col] || 0;
            const r = Math.round(255 - gc * 150);
            const g = Math.round(180 + gc * 60);
            const b = Math.round(50 + gc * 100);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            const barH = gc * MAIN_GC_TRACK_H;
            ctx.fillRect(x, stickyY + MAIN_GC_TRACK_H - barH, gcBarW, barH);
        }
        ctx.fillStyle = isDark ? '#334155' : '#e2e8f0';
        ctx.fillRect(labelWidth, stickyY + MAIN_GC_TRACK_H - 0.5, availableWidth - labelWidth, 0.5);

        // ── MSA overview track (sticky) ──
        const msaTop = stickyY + MAIN_GC_TRACK_H;
        const msaRowH = MAIN_MSA_TRACK_H / sequences.length; // fractional for positioning
        const msaDrawH = Math.max(1, msaRowH); // minimum 1px for visibility
        ctx.fillStyle = isDark ? '#0f172a' : '#f1f5f9';
        ctx.fillRect(labelWidth, msaTop, availableWidth - labelWidth, MAIN_MSA_TRACK_H);

        const sampleStep = Math.max(1, Math.floor(sequences.length / 200));
        for (let row = 0; row < sequences.length; row += sampleStep) {
            const s = sequences[row];
            const y = msaTop + row * msaRowH;
            const isQuery = row === 0;
            const sStart = seqStart(s.seq);
            const sEnd = seqEnd(s.seq);
            if (sStart <= sEnd) {
                const barX1 = Math.max(labelWidth, labelWidth + sStart * cellW - scrollLeft);
                const barX2 = Math.min(labelWidth + seqAreaW, labelWidth + (sEnd + 1) * cellW - scrollLeft);
                if (barX2 > barX1) {
                    ctx.fillStyle = isQuery
                        ? (isDark ? '#1e3a8a' : '#bfdbfe')
                        : (isDark ? '#334155' : '#e2e8f0');
                    ctx.fillRect(barX1, y, barX2 - barX1, msaDrawH);
                }
            }
            const seqW = availableWidth - labelWidth - RIGHT_PADDING;
            const pxStep = Math.max(1, seqLen / seqW);

            // Optimized: Iterate over visible pixels, not every column.
            // (availableWidth - labelWidth) is the visible sequence area width.
            for (let x = 0; x < availableWidth - labelWidth; x++) {
                const colBase = Math.floor(((x + scrollLeft) / seqW) * seqLen * viewFraction);
                if (colBase < 0 || colBase >= seqLen) continue;

                // Sample 2 points per pixel area
                const sampleCols = [colBase];
                if (pxStep > 2) sampleCols.push(colBase + Math.floor(pxStep / 2));

                for (const col of sampleCols) {
                    if (col >= seqLen) continue;
                    const ch = (s.seq[col] || '-').toUpperCase();
                    const qch = (querySeq[col] || '-').toUpperCase();
                    if (ch === '-' && !(col >= sStart && col <= sEnd && !isQuery)) continue;

                    const isInternalDeletion = !isQuery && ch === '-' && col >= sStart && col <= sEnd;
                    const isInsertion = !isQuery && qch === '-' && ch !== '-';

                    if (isInternalDeletion || isInsertion) {
                        ctx.fillStyle = '#9333ea';
                        ctx.fillRect(labelWidth + x, y, 1.2, msaDrawH);
                        break;
                    } else if (!isQuery && ch !== '-' && ch !== qch && qch !== '-') {
                        ctx.fillStyle = '#dc2626';
                        ctx.fillRect(labelWidth + x, y, 1.2, msaDrawH);
                        break;
                    }
                }
            }
        }

        ctx.fillStyle = isDark ? '#334155' : '#e2e8f0';
        ctx.fillRect(labelWidth, msaTop + MAIN_MSA_TRACK_H - 0.5, availableWidth - labelWidth, 0.5);

        /* ── Oligo selection highlight on GC%/MSA header ── */
        if (oligoSelection) {
            const s = Math.min(oligoSelection.startCol, oligoSelection.endCol);
            const e = Math.max(oligoSelection.startCol, oligoSelection.endCol);
            const selX1 = Math.max(labelWidth, labelWidth + s * cellW - scrollLeft);
            const selX2 = Math.min(labelWidth + seqAreaW, labelWidth + (e + 1) * cellW - scrollLeft);
            if (selX2 > selX1) {
                const trackH = MAIN_GC_TRACK_H + MAIN_MSA_TRACK_H;
                ctx.fillStyle = 'rgba(251, 191, 36, 0.25)';
                ctx.fillRect(selX1, stickyY, selX2 - selX1, trackH);
                ctx.strokeStyle = '#f59e0b';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(selX1 + 0.5, stickyY + 0.5, selX2 - selX1 - 1, trackH - 1);
                // label bp range
                ctx.fillStyle = '#f59e0b';
                ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                const midX = (selX1 + selX2) / 2;
                ctx.fillText(`${s + 1}–${e + 1}`, Math.max(selX1 + 2, Math.min(selX2 - 2, midX)), stickyY + 2);
            }
        }

        /* ── ruler (sticky) ── */
        const rulerY = stickyY + MAIN_GC_TRACK_H + MAIN_MSA_TRACK_H;
        ctx.fillStyle = isDark ? '#1e293b' : '#f8fafc';
        ctx.fillRect(labelWidth, rulerY, availableWidth - labelWidth, RULER_HEIGHT);
        ctx.strokeStyle = isDark ? '#334155' : '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(labelWidth, rulerY + RULER_HEIGHT - 0.5);
        ctx.lineTo(availableWidth, rulerY + RULER_HEIGHT - 0.5);
        ctx.stroke();

        const tickInterval = getPrettyStep(100, cellW);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px ui-monospace, SFMono-Regular, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        for (let col = firstCol; col <= lastCol; col++) {
            if ((col + 1) % tickInterval === 0) {
                const x = labelWidth + col * cellW - scrollLeft;
                ctx.fillStyle = isDark ? '#334155' : '#cbd5e1';
                ctx.fillRect(x, rulerY + RULER_HEIGHT - 6, 1, 6);
                ctx.fillStyle = '#94a3b8';
                ctx.fillText(String(col + 1), x, rulerY + RULER_HEIGHT - 7);
            }
        }

        /* ── Oligo markers in main ruler ── */
        if (primers) {
            const p1x = labelWidth + primers.p1.start * cellW - scrollLeft;
            const p1w = (primers.p1.end - primers.p1.start) * cellW;
            ctx.fillStyle = '#22c55e';
            ctx.fillRect(p1x, rulerY + RULER_HEIGHT - 4, p1w, 4);

            const p2x = labelWidth + primers.p2.start * cellW - scrollLeft;
            const p2w = (primers.p2.end - primers.p2.start) * cellW;
            ctx.fillStyle = '#facc15';
            ctx.fillRect(p2x, rulerY + RULER_HEIGHT - 4, p2w, 4);
        }

        /* ── Flanking primer markers in main ruler ── */
        if (flankingPrimers) {
            if (flankingPrimers.fwd) {
                const fx = labelWidth + flankingPrimers.fwd.start * cellW - scrollLeft;
                const fw = Math.max(3, (flankingPrimers.fwd.end - flankingPrimers.fwd.start) * cellW);
                ctx.fillStyle = 'rgba(16, 185, 129, 0.25)'; // emerald fill
                ctx.fillRect(fx, rulerY, fw, RULER_HEIGHT - 4);
                ctx.fillStyle = '#10b981';
                ctx.fillRect(fx, rulerY, fw, 3); // top stripe
                ctx.fillRect(fx, rulerY + RULER_HEIGHT - 7, fw, 3); // bottom stripe
                // label
                if (fw > 20) {
                    ctx.fillStyle = '#059669';
                    ctx.font = 'bold 8px ui-monospace, SFMono-Regular, monospace';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('FWD', fx + fw / 2, rulerY + RULER_HEIGHT / 2);
                }
            }
            if (flankingPrimers.rev) {
                const rx = labelWidth + flankingPrimers.rev.start * cellW - scrollLeft;
                const rw = Math.max(3, (flankingPrimers.rev.end - flankingPrimers.rev.start) * cellW);
                ctx.fillStyle = 'rgba(20, 184, 166, 0.25)'; // teal fill
                ctx.fillRect(rx, rulerY, rw, RULER_HEIGHT - 4);
                ctx.fillStyle = '#14b8a6';
                ctx.fillRect(rx, rulerY, rw, 3);
                ctx.fillRect(rx, rulerY + RULER_HEIGHT - 7, rw, 3);
                if (rw > 20) {
                    ctx.fillStyle = '#0d9488';
                    ctx.font = 'bold 8px ui-monospace, SFMono-Regular, monospace';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('REV', rx + rw / 2, rulerY + RULER_HEIGHT / 2);
                }
            }
        }

        ctx.restore(); /* end clip */

        /* ── labels (drawn OUTSIDE clip so they're never obscured) ── */

        // Background covers entire label column at sticky position
        ctx.fillStyle = isDark ? '#0f172a' : '#ffffff';
        ctx.fillRect(0, scrollTop, labelWidth, canvasH);

        // Border line for labels
        ctx.fillStyle = isDark ? '#334155' : '#e2e8f0';
        ctx.fillRect(labelWidth - 1, scrollTop, 1, canvasH);

        // GC track label (sticky) — right-aligned so they sit immediately left of the bars
        ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
        ctx.font = '10px ui-monospace, SFMono-Regular, monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('GC%', labelWidth - 8, scrollTop + MAIN_GC_TRACK_H / 2);

        // MSA overview label (sticky)
        ctx.fillText('MSA', labelWidth - 8, scrollTop + MAIN_GC_TRACK_H + MAIN_MSA_TRACK_H / 2);

        // Sequence row labels (culled by Y-axis, skip rows behind sticky header)
        const headerH = MAIN_GC_TRACK_H + MAIN_MSA_TRACK_H + RULER_HEIGHT;
        for (let row = firstRow; row <= lastRow; row++) {
            const y = MAIN_GC_TRACK_H + MAIN_MSA_TRACK_H + RULER_HEIGHT + row * ROW_HEIGHT;
            const isQuery = row === 0;

            const labelY = y + ROW_HEIGHT / 2;
            const text = sequences[row].id;

            // Skip labels behind sticky header or off screen
            if (y + ROW_HEIGHT < scrollTop + headerH) continue;
            if (y > scrollTop + canvasH) continue;

            const pColor = isQuery
                ? (isDark ? '#3b82f6' : '#2563eb')
                : (isDark ? '#94a3b8' : '#64748b');

            ctx.fillStyle = pColor;
            ctx.font = `${isQuery ? 'bold ' : ''}10px ui-sans-serif, system-ui, sans-serif`;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';

            let displayTxt = text;
            if (ctx.measureText(displayTxt).width > labelWidth - 20) {
                while (displayTxt.length > 5 && ctx.measureText(displayTxt + '…').width > labelWidth - 20) {
                    displayTxt = displayTxt.slice(0, -1);
                }
                displayTxt += '…';
            }
            ctx.fillText(displayTxt, labelWidth - 8, labelY);
        }

        ctx.restore(); // restore translate

        /* size the hover overlay to match main canvas */
        const hoverCvs = hoverOverlayRef.current;
        if (hoverCvs) {
            hoverCvs.width = availableWidth * dpr;
            hoverCvs.height = canvasH * dpr;
            hoverCvs.style.width = `${availableWidth}px`;
            hoverCvs.style.height = `${canvasH}px`;
        }
    }, [sequences, querySeq, scrollLeft, scrollTop, cellW, seqAreaW, availableWidth, totalH, seqLen, viewMode, primers, flankingPrimers, gcContent, isDarkMode, oligoSelection]);

    /* ── lightweight hover overlay (draws only a thin line) ── */
    const drawHoverOverlay = useCallback(() => {
        const cvs = hoverOverlayRef.current;
        const mainCvs = canvasRef.current;
        if (!cvs || !mainCvs) return;
        const ctx = cvs.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        // Sync resolution if physical size changed
        if (cvs.width !== mainCvs.width || cvs.height !== mainCvs.height) {
            cvs.width = mainCvs.width;
            cvs.height = mainCvs.height;
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const w = cvs.width / dpr;
        const h = cvs.height / dpr;
        ctx.clearRect(0, 0, w, h);

        const hoverCol = hoverColRef.current;
        if (hoverCol === null || hoverCol < 0 || hoverCol >= seqLen) return;

        const hx = labelWidth + hoverCol * cellW - scrollLeft + cellW / 2;
        if (hx < labelWidth || hx > labelWidth + seqAreaW) return;

        ctx.strokeStyle = mismatchCols.has(hoverCol) ? '#ef4444' : '#3b82f6';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.floor(hx) + 0.5, 0);
        ctx.lineTo(Math.floor(hx) + 0.5, h);
        ctx.stroke();
    }, [cellW, scrollLeft, seqAreaW, seqLen, mismatchCols]);

    useEffect(() => { draw(); }, [draw]);
    useEffect(() => { drawHoverOverlay(); }, [drawHoverOverlay]);

    // redrawRef now calls the lightweight hover overlay and redraws the minimap for the cursor
    useEffect(() => {
        redrawRef.current = () => {
            drawHoverOverlay();
            drawMinimap();
        };
    }, [drawHoverOverlay, drawMinimap]);

    /* ── scroll handler ─────────────────────────────────── */
    const handleScroll = () => {
        if (!isDragging.current && scrollRef.current) {
            setScrollLeft(scrollRef.current.scrollLeft);
            setScrollTop(scrollRef.current.scrollTop);
        }
    };

    /* ── Ctrl/⌘ + wheel = zoom ─────────────────────────── */
    const handleWheel = (e: React.WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 1.15 : 0.87;

            // Calculate mouse position relative to the sequence view
            const rect = scrollRef.current?.getBoundingClientRect();
            if (!rect) return;

            const offsetX = e.clientX - rect.left - labelWidth;
            const seqAreaWidth = rect.width - labelWidth - RIGHT_PADDING; // Should match seqAreaW effectively

            // If mouse is over labels, just zoom center or left? Let's assume clamping to 0 if < 0.
            const validOffsetX = Math.max(0, Math.min(seqAreaWidth, offsetX));

            // Current global fraction under mouse
            const currentTotalVirtualW = seqAreaWidth / viewFraction;
            const mouseFracGlobal = (scrollLeft + validOffsetX) / currentTotalVirtualW;

            // Apply new zoom
            const newVF = Math.max(0.005, Math.min(1, viewFraction * factor));

            // Calculate new ScrollLeft to keep mouseFracGlobal at validOffsetX
            const newTotalVirtualW = seqAreaWidth / newVF;
            let newSL = mouseFracGlobal * newTotalVirtualW - validOffsetX;

            // Clamp scroll
            newSL = Math.max(0, Math.min(newTotalVirtualW - seqAreaWidth, newSL));

            setViewFraction(newVF);
            setScrollLeft(newSL);

            // Sync with ref if needed, though we updated state directly
            if (scrollRef.current) scrollRef.current.scrollLeft = newSL;
        }
    };

    /* ── main canvas mouse move for hover column ── */
    const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const cvs = canvasRef.current;
        if (!cvs) return;
        const rect = cvs.getBoundingClientRect();
        const mouseXRaw = e.clientX - rect.left;
        const mouseYRaw = e.clientY - rect.top;

        // Label Area Hover Detection
        if (mouseXRaw < labelWidth) {
            const rowsStartY = MAIN_GC_TRACK_H + MAIN_MSA_TRACK_H + RULER_HEIGHT;
            const virtualY = mouseYRaw + scrollTop;
            const row = Math.floor((virtualY - rowsStartY) / ROW_HEIGHT);

            if (row >= 0 && row < sequences.length && virtualY >= rowsStartY) {
                setLabelHoverInfo({
                    text: sequences[row].id,
                    x: e.clientX,
                    y: e.clientY
                });
                cvs.style.cursor = 'help';
            } else {
                setLabelHoverInfo(null);
                cvs.style.cursor = 'default';
            }
            // Clear sequence hover
            if (hoverColRef.current !== null) {
                hoverColRef.current = null;
                cancelAnimationFrame(hoverRafRef.current);
                hoverRafRef.current = requestAnimationFrame(() => redrawRef.current());
            }
            return;
        }

        setLabelHoverInfo(null);
        // GC%/MSA track area gets a special crosshair for oligo selection
        if (mouseYRaw < MAIN_GC_TRACK_H + MAIN_MSA_TRACK_H) {
            cvs.style.cursor = 'crosshair';
        } else {
            cvs.style.cursor = viewMode === 'letters' ? 'pointer' : 'crosshair';
        }

        const mouseX = mouseXRaw - labelWidth;
        const col = Math.floor((scrollLeft + mouseX) / cellW);
        const newCol = col >= 0 && col < seqLen ? col : null;
        if (newCol === hoverColRef.current) return;
        hoverColRef.current = newCol;
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = requestAnimationFrame(() => redrawRef.current());
    }, [scrollLeft, cellW, seqLen, sequences, scrollTop, viewMode]);

    const handleCanvasMouseLeave = useCallback(() => {
        setLabelHoverInfo(null);
        if (hoverColRef.current === null) return;
        hoverColRef.current = null;
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = requestAnimationFrame(() => redrawRef.current());
    }, []);

    /* ── main canvas mouse down → oligo region selection everywhere ── */
    const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const cvs = canvasRef.current;
        if (!cvs) return;
        const rect = cvs.getBoundingClientRect();
        const mouseXCanvas = e.clientX - rect.left;
        if (mouseXCanvas < labelWidth) return; // ignore clicks on label column

        const mouseX = mouseXCanvas - labelWidth;
        const startC = Math.max(0, Math.min(seqLen - 1, Math.floor((scrollLeft + mouseX) / cellW)));
        setOligoSelection({ startCol: startC, endCol: startC });

        const onMove = (ev: MouseEvent) => {
            const newX = ev.clientX - rect.left - labelWidth;
            const endC = Math.max(0, Math.min(seqLen - 1, Math.floor((scrollLeft + newX) / cellW)));
            setOligoSelection({ startCol: startC, endCol: endC });
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            setOligoSelection(prev => {
                if (!prev) return null;
                const s = Math.min(prev.startCol, prev.endCol);
                const e2 = Math.max(prev.startCol, prev.endCol);
                // Require at least 5 columns to avoid accidental click-as-selection
                if (e2 - s >= 5 && onOligoRegionSelect) {
                    onOligoRegionSelect(s, e2);
                }
                return prev;
            });
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
    }, [labelWidth, seqLen, scrollLeft, cellW, onOligoRegionSelect]);

    /* ── canvas click → copy sequence OR select ─────────────────── */
    const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const cvs = canvasRef.current;
        if (!cvs) return;
        const rect = cvs.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const rowsStartY = MAIN_GC_TRACK_H + MAIN_MSA_TRACK_H + RULER_HEIGHT;
        const row = Math.floor((y - rowsStartY) / ROW_HEIGHT);

        if (row >= 0 && row < sequences.length) {
            const seq = sequences[row];
            if (viewMode === 'letters') {
                copySequence(seq);
            }
        }
    };

    if (!alignment || sequences.length === 0) return null;

    return (
        <div ref={containerRef} className="mt-6 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden bg-white dark:bg-slate-800 transition-colors">
            {/* ── header ── */}
            <div className="px-5 py-3 bg-gradient-to-r from-slate-50 to-indigo-50/50 dark:from-slate-800 dark:to-indigo-900/20 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                        Multiple sequence alignment <span className="text-sm font-normal text-slate-500 dark:text-slate-400">({sequences.length} seq, {seqLen} bp)</span>
                    </h2>
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={copyAllFasta}
                            className="px-2 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-colors flex items-center gap-1"
                            title="Copy full alignment as FASTA"
                        >
                            <ClipboardIcon /> FASTA
                        </button>
                        <button
                            onClick={copySelection}
                            className="px-2 py-1 text-xs font-medium rounded-md border border-indigo-300 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors flex items-center gap-1"
                            title={`Copy visible selection (pos ${startCol + 1}–${endCol + 1})`}
                        >
                            <ClipboardIcon /> {startCol + 1}–{endCol + 1}
                        </button>
                    </div>
                    <button
                        onClick={() => setShowOverview((v) => !v)}
                        className={`px-2 py-1 text-xs font-medium rounded-md border transition-colors flex items-center gap-1 ${showOverview
                            ? 'border-indigo-300 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30'
                            : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                            }`}
                        title={showOverview ? 'Hide overview bar' : 'Show overview bar'}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            {showOverview
                                ? <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                                : <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                            }
                            <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM10 4a6 6 0 100 12 6 6 0 000-12z" opacity={showOverview ? 0 : 0.3} />
                        </svg>
                        {showOverview ? 'Hide overview' : 'Show overview'}
                    </button>
                    {copyFeedback && (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium animate-pulse">{copyFeedback}</span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex rounded-md overflow-hidden border border-slate-300 dark:border-slate-600">
                        <button
                            onClick={() => {
                                setViewMode('bars');
                                setViewFraction(1);
                                setScrollLeft(0);
                                targetScrollRef.current = 0;
                            }}
                            className={`px-3 py-1 text-xs font-medium transition-colors ${viewMode === 'bars'
                                ? 'bg-indigo-500 text-white'
                                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                                }`}
                        >
                            Overview
                        </button>
                        <button
                            onClick={() => {
                                // Keep the current center
                                const seqAreaW = availableWidth - labelWidth - RIGHT_PADDING;
                                const currentTotalW = seqAreaW / viewFraction;
                                const centerFrac = (scrollLeft + seqAreaW / 2) / currentTotalW;

                                setViewMode('letters');
                                const newVF = Math.min(1, 100 / seqLen); // ~100 bp zoom
                                const newTotalW = seqAreaW / newVF;

                                // Recalculate scroll to keep same center
                                const newSL = centerFrac * newTotalW - seqAreaW / 2;
                                const clampedSL = Math.max(0, Math.min(newTotalW - seqAreaW, newSL));

                                setViewFraction(newVF);
                                setScrollLeft(clampedSL);
                                targetScrollRef.current = clampedSL;
                            }}
                            className={`px-3 py-1 text-xs font-medium transition-colors border-l border-slate-300 dark:border-slate-600 ${viewMode === 'letters'
                                ? 'bg-indigo-500 text-white'
                                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                                }`}
                        >
                            Sequence
                        </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={zoomOut}
                            className="w-6 h-6 flex items-center justify-center rounded border border-slate-300 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors text-sm font-bold"
                            title="Zoom out"
                        >−</button>
                        <input
                            type="range"
                            min={0.005}
                            max={1}
                            step={0.005}
                            value={viewFraction}
                            onChange={(e) => {
                                const newVF = parseFloat(e.target.value);
                                const factor = newVF / viewFraction;
                                // We use factor to adjust zoom but anchored to center
                                applyZoom(factor);
                            }}
                            className="w-24 h-1.5 accent-indigo-500"
                            style={{ direction: 'rtl' }}
                        />
                        <button
                            onClick={zoomIn}
                            className="w-6 h-6 flex items-center justify-center rounded border border-slate-300 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors text-sm font-bold"
                            title="Zoom in"
                        >+</button>
                    </div>
                    <span className="text-xs text-slate-400 font-mono w-20 text-right">{Math.round(visibleBases)} bp</span>
                </div>
            </div>

            {/* ── minimap navigator ── */}
            {showOverview && (
                <div className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                    <canvas
                        ref={minimapRef}
                        style={{ display: 'block', cursor: 'crosshair' }}
                        onMouseDown={handleMinimapMouseDown}
                        onMouseMove={handleMinimapMouseMove}
                        onMouseLeave={handleMinimapMouseLeave}
                    />
                </div>
            )}

            {/* ── legend ── */}
            <div className="px-5 py-1.5 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm border border-slate-200 dark:border-slate-700" style={{ background: isDark ? '#1e293b' : '#f3f4f6' }} />
                    Sequence / Match
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm border border-red-100 dark:border-red-900" style={{ background: isDark ? '#7f1d1d' : '#fee2e2' }} />
                    Mismatch
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm border border-purple-100 dark:border-purple-900" style={{ background: isDark ? '#3b0764' : '#f3e8ff' }} />
                    Insertion / Deletion
                </span>
                <span className="ml-auto italic text-slate-400">
                    {viewMode === 'letters' ? 'Click a row to copy' : 'Drag minimap to zoom/select · Ctrl/⌘ + scroll to zoom'}
                </span>
            </div>

            {/* ── scroll arrow bar ── */}
            <div className="py-1 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center" style={{ paddingRight: `${RIGHT_PADDING}px` }}>
                {/* Arrows live in the label column so the track aligns with the sequence bars */}
                <div style={{ width: `${labelWidth}px`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', paddingRight: '4px' }}>
                    <button
                        onMouseDown={() => startPan(-1)}
                        onMouseUp={stopPan}
                        onMouseLeave={stopPan}
                        className="flex items-center justify-center w-7 h-7 rounded-md border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:border-indigo-300 dark:hover:border-indigo-700 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-bold select-none"
                        title="Scroll left"
                    >
                        ←
                    </button>
                    <button
                        onMouseDown={() => startPan(1)}
                        onMouseUp={stopPan}
                        onMouseLeave={stopPan}
                        className="flex items-center justify-center w-7 h-7 rounded-md border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:border-indigo-300 dark:hover:border-indigo-700 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors font-bold select-none"
                        title="Scroll right"
                    >
                        →
                    </button>
                </div>
                <div
                    ref={scrollTrackRef}
                    onMouseDown={handleBarMouseDown}
                    className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden cursor-pointer relative"
                >
                    <div
                        className={`h-full bg-indigo-400 dark:bg-indigo-600 rounded-full transition-all ${isBarDragging ? 'duration-0' : 'duration-75'}`}
                        style={{ marginLeft: `${startFrac * 100}%`, width: `${viewFraction * 100}%` }}
                    />
                </div>
            </div>

            {/* ── scrollable canvas area ── */}
            <div
                ref={scrollRef}
                className={`overflow-y-auto overscroll-contain relative ${viewFraction >= 0.99 ? 'overflow-x-hidden' : 'overflow-x-auto'}`}
                style={{ height: `${Math.min(totalH, MAX_VIEWER_HEIGHT)}px` }}
                onScroll={handleScroll}
                onWheel={handleWheel}
            >
                <div style={{ width: `${labelWidth + totalVirtualW}px`, height: `${totalH}px`, position: 'absolute', pointerEvents: 'none' }} />
                <div style={{ position: 'sticky', top: 0, left: 0, zIndex: 10, width: 'fit-content' }}>
                    <canvas
                        ref={canvasRef}
                        style={{ display: 'block', cursor: viewMode === 'letters' ? 'pointer' : 'crosshair' }}
                        onClick={handleCanvasClick}
                        onMouseDown={handleCanvasMouseDown}
                        onMouseMove={handleCanvasMouseMove}
                        onMouseLeave={handleCanvasMouseLeave}
                    />
                    <canvas
                        ref={hoverOverlayRef}
                        style={{
                            display: 'block',
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            pointerEvents: 'none',
                            zIndex: 20
                        }}
                    />
                    {/* ── Resizable Handle ── */}
                    <div
                        onMouseDown={handleResizeMouseDown}
                        className={`absolute top-0 bottom-0 z-[30] w-1.5 cursor-col-resize hover:bg-indigo-400/30 transition-colors ${isResizingLabel ? 'bg-indigo-500/50' : 'bg-transparent'}`}
                        style={{ left: `${labelWidth - 3}px` }}
                    />
                </div>
            </div>

            {/* ── selection stats footer ── */}
            {
                selectionStats && (
                    <div className="bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 px-5 py-2 text-xs text-slate-600 dark:text-slate-400 font-mono flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <span className="font-semibold text-slate-700 dark:text-slate-300">Visible Range: {startCol + 1}–{endCol + 1}</span>
                            <span>Length: {selectionStats.total} bp</span>
                            <span className="text-emerald-700 dark:text-emerald-400 font-medium">GC: {selectionStats.gcPct.toFixed(1)}%</span>
                        </div>
                        <div className="flex items-center gap-3 text-slate-500 dark:text-slate-500">
                            <span>A: {selectionStats.a}</span>
                            <span>T: {selectionStats.t}</span>
                            <span>G: {selectionStats.g}</span>
                            <span>C: {selectionStats.c}</span>
                        </div>
                    </div>
                )
            }

            {/* ── label tooltip ── */}
            {labelHoverInfo && (
                <div
                    className="fixed z-[9999] px-2 py-1 bg-slate-800 text-white text-xs rounded shadow-lg pointer-events-none whitespace-nowrap border border-slate-600"
                    style={{
                        left: `${labelHoverInfo.x + 12}px`,
                        top: `${labelHoverInfo.y + 12}px`
                    }}
                >
                    {labelHoverInfo.text}
                </div>
            )}
        </div >
    );
};

/* ── small clipboard icon component ── */
const ClipboardIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
        <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
    </svg>
);

/* ── helpers ── */
export default MSAViewer;
