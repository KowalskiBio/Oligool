import React, { useState, useRef, useEffect, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { findCleanRegions, computeMismatchCols, type CleanRegion } from '../utils/msa';
import { buildAnchorGrid, buildInsertRuns, groupInsertsByRow, firstAnchorAtOrAfter, lastAnchorAtOrBefore, gappedRangeToAnchor, type InsertEntry } from '../utils/anchorGrid';

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
    accession: string;
}

interface MSAViewerProps {
    alignment: string;
    onVisibleQueryChange?: (data: { id: string; seq: string; start: number; end: number; fullSeq: string; ungappedOffset: number }) => void;
    jobName?: string;
    primers?: { p1: { start: number, end: number }, p2: { start: number, end: number } } | null;
    /** Flanking primers designed in the lower panel — drawn as distinct bars in the minimap */
    flankingPrimers?: { fwd: { start: number; end: number } | null; rev: { start: number; end: number } | null } | null;
    isDarkMode?: boolean;
    /** When set, MSA will zoom/pan to show these global gapped column indices */
    navigateTarget?: { colStart: number; colEnd: number; ts: number } | null;
    /** Called when user drag-selects a region in the GC%/MSA header for oligo placement */
    onOligoRegionSelect?: (startCol: number, endCol: number) => void;
    /** Called when user clicks a clean region proposed by autofind — zoom to that region */
    onAutofindRegionSelect?: (startCol: number, endCol: number) => void;
    /** Called when user clicks on a flanking primer bar in the minimap — zoom to that primer */
    onFlankingPrimerClick?: (colStart: number, colEnd: number) => void;
    selectedAccessions?: Set<string>;
    onSelectionChange?: (accessions: Set<string>) => void;
    /** Optional region to highlight as a restored/pinned range */
    restoredRegion?: { start: number; end: number } | null;
    /** If false, hide the autofind button and clean-region proposals (green selection dots still render). */
    showAutofindUI?: boolean;
    /** When true, autofind treats insertions/deletions (gaps) in non-query sequences as mismatches. */
    autofindTreatIndelsAsMismatches?: boolean;
    /** Called when the user toggles the "count indels as mismatches" option. */
    onAutofindTreatIndelsAsMismatchesChange?: (value: boolean) => void;
    blastRid?: string;
    hitRanges?: Record<string, { sstart: number; send: number; rank: number }>;
    /** Caps the main alignment view height (px); minimap renders additionally below. Defaults to MAX_VIEWER_HEIGHT. */
    maxHeight?: number;
}

export interface MSAViewerHandle {
    getViewportSnapshot: () => { scrollLeft: number; scrollTop: number; viewFraction: number; viewMode: 'bars' | 'letters' };
    applyViewportSnapshot: (viewport: { scrollLeft: number; scrollTop: number; viewFraction: number; viewMode: 'bars' | 'letters' }) => void;
    scrollToRow: (rowIndex: number) => void;
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

const MSAViewer = forwardRef<MSAViewerHandle, MSAViewerProps>(({ alignment, onVisibleQueryChange, primers, flankingPrimers, isDarkMode, navigateTarget, onOligoRegionSelect, onAutofindRegionSelect, onFlankingPrimerClick, selectedAccessions, onSelectionChange, restoredRegion, showAutofindUI = true, autofindTreatIndelsAsMismatches = false, onAutofindTreatIndelsAsMismatchesChange, blastRid = '', hitRanges = {}, maxHeight }, ref) => {
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
    const [insertHoverInfo, setInsertHoverInfo] = useState<{ length: number; sequence: string; x: number; y: number } | null>(null);
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
    const [ncbiModalAccession, setNcbiModalAccession] = useState<string | null>(null);
    const hoverColRef = useRef<number | null>(null);
    const hoverRafRef = useRef<number>(0);
    const redrawRef = useRef<() => void>(() => { });
    const [showOverview, setShowOverview] = useState(true);
    const [autofindActive, setAutofindActive] = useState(false);
    const [lightMatchBars, setLightMatchBars] = useState(false);
    const scrollPressRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Live-value refs for use inside setInterval (avoid stale closures)
    const viewFractionRef = useRef(viewFraction);
    const seqAreaWRef = useRef(0);
    const totalVirtualWRef = useRef(0);

    useImperativeHandle(ref, () => ({
        getViewportSnapshot: () => ({
            scrollLeft,
            scrollTop,
            viewFraction,
            viewMode,
        }),
        applyViewportSnapshot: (viewport) => {
            setViewMode(viewport.viewMode);
            setViewFraction(viewport.viewFraction);
            setScrollLeft(viewport.scrollLeft);
            setScrollTop(viewport.scrollTop);
            if (scrollRef.current) {
                scrollRef.current.scrollLeft = viewport.scrollLeft;
                scrollRef.current.scrollTop = viewport.scrollTop;
            }
            targetScrollRef.current = viewport.scrollLeft;
        },
        scrollToRow: (rowIndex: number) => {
            const el = scrollRef.current;
            if (!el || rowIndex < 0) return;
            const headerH = MAIN_GC_TRACK_H + MAIN_MSA_TRACK_H + RULER_HEIGHT;
            const rowY = headerH + rowIndex * ROW_HEIGHT;
            const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
            const targetScroll = Math.max(0, Math.min(maxScroll, rowY - el.clientHeight / 2 + ROW_HEIGHT / 2));
            el.scrollTop = targetScroll;
            setScrollTop(targetScroll);
        },
    }), [scrollLeft, scrollTop, viewFraction, viewMode]);

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
        let acc = '';
        lines.forEach((l) => {
            if (l.startsWith('>')) {
                if (cur) seqs.push({ id: cur, seq, accession: acc });
                
                const header = l.substring(1).trim();
                const parts = header.split(/\s+/);
                const accession = parts[0];
                let displayName = header;
                acc = accession;

                // Try to find organism info (often in brackets like [organism=Homo sapiens] or [Homo sapiens])
                const bracketMatch = header.match(/\[([^\]]+)\]/);
                if (bracketMatch) {
                    const content = bracketMatch[1];
                    const orgMatch = content.match(/organism=([^;]+)/i);
                    displayName = orgMatch ? orgMatch[1] : content;
                } else {
                    // Standard NCBI header format: ">Accession Genus species Description..."
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
        if (cur) seqs.push({ id: cur, seq, accession: acc });
        return seqs;
    }, [alignment]);

    const seqLen = sequences.length > 0 ? Math.max(...sequences.map((s) => s.seq.length)) : 0;
    const querySeq = sequences.length > 0 ? sequences[0].seq : '';

    /* ── anchor grid: query residues only; inserts render as overlays ── */
    const anchorGrid = useMemo(() => buildAnchorGrid(querySeq), [querySeq]);
    const { anchorLen, anchorCols } = anchorGrid;
    const insertEntries = useMemo<InsertEntry[]>(() => buildInsertRuns(sequences, anchorGrid), [sequences, anchorGrid]);
    const insertsByRow = useMemo(() => groupInsertsByRow(insertEntries), [insertEntries]);

    // External props arrive as gapped column ranges; convert once to anchor space
    const primersA = useMemo(() => {
        if (!primers) return null;
        return {
            p1: gappedRangeToAnchor(anchorCols, primers.p1.start, primers.p1.end),
            p2: gappedRangeToAnchor(anchorCols, primers.p2.start, primers.p2.end),
        };
    }, [primers, anchorCols]);

    const flankingPrimersA = useMemo(() => {
        if (!flankingPrimers) return null;
        return {
            fwd: flankingPrimers.fwd ? gappedRangeToAnchor(anchorCols, flankingPrimers.fwd.start, flankingPrimers.fwd.end) : null,
            rev: flankingPrimers.rev ? gappedRangeToAnchor(anchorCols, flankingPrimers.rev.start, flankingPrimers.rev.end) : null,
        };
    }, [flankingPrimers, anchorCols]);

    const restoredA = useMemo(() => {
        if (!restoredRegion) return null;
        return gappedRangeToAnchor(anchorCols, restoredRegion.start, restoredRegion.end);
    }, [restoredRegion, anchorCols]);

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
    const cellW = anchorLen > 0 ? totalVirtualW / anchorLen : 1;
    const visibleBases = anchorLen * viewFraction;
    const totalH = MAIN_GC_TRACK_H + MAIN_MSA_TRACK_H + RULER_HEIGHT + sequences.length * ROW_HEIGHT + 4;

    // Keep live refs up-to-date for use inside setInterval (avoids stale closures)
    viewFractionRef.current = viewFraction;
    seqAreaWRef.current = seqAreaW;
    totalVirtualWRef.current = totalVirtualW;

    /* ── viewport fractions ────────────────────────────── */
    const startFrac = totalVirtualW > 0 ? scrollLeft / totalVirtualW : 0;
    const endFrac = Math.min(1, startFrac + viewFraction);
    const startCol = Math.max(0, Math.floor(startFrac * anchorLen));
    const endCol = Math.min(anchorLen - 1, Math.ceil(endFrac * anchorLen) - 1);

    /* ── broadcast visible query range ─────────────────── */
    useEffect(() => {
        if (sequences.length > 0 && onVisibleQueryChange && anchorLen > 0) {
            // Provide the visible slice of the query (first sequence).
            // startCol/endCol are anchor indices; the consumer contract is gapped columns.
            const query = sequences[0];
            const start = Math.max(0, Math.min(anchorLen - 1, startCol));
            const end = Math.min(anchorLen - 1, endCol);
            const gappedStart = anchorCols[start];
            const gappedEnd = anchorCols[end];
            const slice = query.seq.slice(gappedStart, gappedEnd + 1);
            const fullSeq = query.seq.replace(/-/g, '');
            onVisibleQueryChange({
                id: query.id,
                seq: slice,
                start: gappedStart,
                end: gappedEnd,
                fullSeq,
                ungappedOffset: start,
            });
        }
    }, [sequences, startCol, endCol, onVisibleQueryChange, anchorLen, anchorCols]);

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

    /* ── zoom helpers ──────────────────────────────────── */
    const applyZoom = (factor: number, anchorPx: number = seqAreaW / 2) => {
        const newVF = Math.max(0.005, Math.min(1, viewFraction * factor));

        // Keep the anchor point (measured from the left edge of the sequence area)
        // at the same screen position after zooming.
        const currentTotalVirtualW = seqAreaW / viewFraction;
        const anchorFracGlobal = (scrollLeft + anchorPx) / currentTotalVirtualW;

        const newTotalVirtualW = seqAreaW / newVF;
        let newSL = anchorFracGlobal * newTotalVirtualW - anchorPx;

        // Clamp scroll
        newSL = Math.max(0, Math.min(newTotalVirtualW - seqAreaW, newSL));

        setViewFraction(newVF);
        setScrollLeft(newSL);
        // Sync with ref so it's immediate
        if (scrollRef.current) scrollRef.current.scrollLeft = newSL;
    };

    // The +/- buttons zoom from the left edge of the current viewport so the
    // user never gets teleported away from the region they are looking at.
    const zoomIn = () => applyZoom(0.75, 0);
    const zoomOut = () => applyZoom(1.33, 0);

    /* ── navigate to a specific column range ────────────── */
    useEffect(() => {
        if (!navigateTarget || anchorLen === 0) return;
        const { colStart, colEnd } = navigateTarget;
        // navigateTarget arrives as gapped columns; the viewport works in anchor space
        const a0 = firstAnchorAtOrAfter(anchorCols, colStart);
        const a1 = lastAnchorAtOrBefore(anchorCols, colEnd);
        const colStartA = Math.max(0, Math.min(anchorLen - 1, a0));
        const colEndA = a1 < a0 ? colStartA : Math.max(0, Math.min(anchorLen - 1, a1));
        // For small targets (primers ~20bp): use tiny padding so visibleBases < 85
        // and the viewer auto-switches to letter/sequence mode.
        // For large targets (regions): use generous padding for context.
        const span = colEndA - colStartA + 1;
        const PADDING = span < 100 ? 20 : 150;
        const visStart = Math.max(0, colStartA - PADDING);
        const visEnd = Math.min(anchorLen - 1, colEndA + PADDING);
        const spanCols = visEnd - visStart + 1;
        const newVF = Math.max(0.005, Math.min(1, spanCols / anchorLen));
        const centerFrac = (colStartA + colEndA) / (2 * anchorLen);
        const newTotalVW = seqAreaW / newVF;
        let newSL = centerFrac * newTotalVW - seqAreaW / 2;
        newSL = Math.max(0, Math.min(newTotalVW - seqAreaW, newSL));
        setViewFraction(newVF);
        setScrollLeft(newSL);
        // Use deferred scroll: the no-dep useEffect below applies this AFTER the render
        // has resized the scrollRef div to fit the new viewFraction.
        // Setting scrollRef.current.scrollLeft directly here would be clamped by the browser
        // because the div isn't wide enough yet at the old viewFraction.
        targetScrollRef.current = newSL;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigateTarget]); // intentionally only react to the navigate command

    /* ── copy helpers ─────────────────────────────────── */
    const showCopyFeedback = (msg: string) => {
        setCopyFeedback(msg);
        setTimeout(() => setCopyFeedback(''), 2000);
    };

    const isDark = isDarkMode ?? document.documentElement.classList.contains('dark');

    const copyAllFasta = () => {
        const fasta = sequences.map((s) => `>${s.id}\n${s.seq}`).join('\n');
        navigator.clipboard.writeText(fasta).then(() => {
            showCopyFeedback(`Copied ${sequences.length} sequences (FASTA)`);
        });
    };

    const copySelection = () => {
        if (sequences.length === 0 || anchorLen === 0) return;
        const query = sequences[0];
        const start = Math.max(0, Math.min(anchorLen - 1, startCol));
        const end = Math.min(anchorLen - 1, endCol);
        const sub = query.seq.slice(anchorCols[start], anchorCols[end] + 1).replace(/-/g, '');
        navigator.clipboard.writeText(sub).then(() => {
            showCopyFeedback(`Copied query pos ${start + 1}–${end + 1} (${sub.length} bp)`);
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
        return computeMismatchCols(sequences, selectedAccessions, autofindTreatIndelsAsMismatches);
    }, [sequences, selectedAccessions, autofindTreatIndelsAsMismatches]);

    const autofindBoundaryRow = useMemo(() => {
        if (!selectedAccessions) return sequences.length - 1;
        let boundary = 0;
        for (let row = 1; row < sequences.length; row++) {
            if (selectedAccessions.has(sequences[row].accession)) boundary = row;
        }
        return boundary;
    }, [sequences, selectedAccessions]);

    const setAutofindBoundaryRow = useCallback((row: number) => {
        const boundary = Math.max(0, Math.min(sequences.length - 1, row));
        const next = new Set<string>();
        for (let r = 1; r <= boundary; r++) {
            if (sequences[r].accession) next.add(sequences[r].accession);
        }
        onSelectionChange?.(next);
    }, [sequences, onSelectionChange]);

    /* ── propose contiguous zero-mismatch regions for autofind ── */
    const cleanRegions = useMemo<CleanRegion[]>(() => {
        return findCleanRegions(sequences, mismatchCols);
    }, [sequences, mismatchCols]);

    /* ── selection statistics (visible range) ─────── */
    const selectionStats = useMemo(() => {
        if (sequences.length === 0 || anchorLen === 0) return null;
        const query = sequences[0];
        const start = Math.max(0, Math.min(anchorLen - 1, startCol));
        const end = Math.min(anchorLen - 1, endCol);
        const sub = query.seq.slice(anchorCols[start], anchorCols[end] + 1).toUpperCase();
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
    }, [sequences, startCol, endCol, anchorLen, anchorCols]);

    // Bar-color toggle invalidates the cached static minimap layer
    useEffect(() => {
        staticMinimapDrawnRef.current = false;
    }, [lightMatchBars]);

    const drawMinimapBackground = useCallback(() => {
        if (!sequences.length) return;
        if (availableWidth <= 0 || MINIMAP_HEIGHT <= 0) return;
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

        for (let a = 0; a < anchorLen; a++) {
            const x = MINIMAP_LABEL_W + (a / anchorLen) * mmSeqW;
            const w = Math.max(1, mmSeqW / anchorLen);
            const gc = gcContent[anchorCols[a]] || 0;
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
        const tickInt = getPrettyStep(150, mmSeqW / anchorLen);
        for (let a = 0; a < anchorLen; a++) {
            if ((a + 1) % tickInt === 0) {
                const x = MINIMAP_LABEL_W + ((a + 0.5) / anchorLen) * mmSeqW;
                ctx.fillStyle = isDark ? '#334155' : '#cbd5e1';
                ctx.fillRect(x, MINIMAP_GC_H + MINIMAP_RULER_H - 4, 1, 4);
                ctx.fillStyle = '#94a3b8';
                ctx.fillText(String(a + 1), x, MINIMAP_GC_H + MINIMAP_RULER_H - 5);
            }
        }
        ctx.fillStyle = isDark ? '#334155' : '#e2e8f0';
        ctx.fillRect(MINIMAP_LABEL_W, rowsTop - 0.5, mmSeqW, 0.5);

        const sampleStep = Math.max(1, Math.floor(sequences.length / 200));
        const pxStep = Math.max(1, anchorLen / mmSeqW);

        const mmSampled = [];
        for (let row = 0; row < sequences.length; row += sampleStep) {
            const s = sequences[row];
            const sStart = seqStart(s.seq);
            const sEnd = seqEnd(s.seq);
            // aligned span converted to anchor space so bars are contiguous across insert columns
            const aS = firstAnchorAtOrAfter(anchorCols, sStart);
            const aE = lastAnchorAtOrBefore(anchorCols, sEnd);
            mmSampled.push({ s, isQuery: row === 0, sStart, sEnd, aS, aE, y: rowsTop + row * rowH });
        }

        for (const r of mmSampled) {
            if (r.aS <= r.aE) {
                const x1 = MINIMAP_LABEL_W + (r.aS / anchorLen) * mmSeqW;
                const x2 = MINIMAP_LABEL_W + ((r.aE + 1) / anchorLen) * mmSeqW;
                ctx.fillStyle = r.isQuery
                    ? (isDark ? '#1e3a8a' : '#bfdbfe')
                    : lightMatchBars
                        ? (isDark ? '#f8fafc' : '#ffffff')
                        : (isDark ? '#334155' : '#d1d5db');
                ctx.fillRect(x1, r.y, x2 - x1, rowDrawH);
            }
        }

        // Per-row mismatch markers (red) then deletion markers (purple, on top).
        // Per-row Y preserves which rows have variation; marker height is
        // capped at the row height so markers never bleed outside the bar.
        for (let pass = 1; pass <= 2; pass++) {
            const wantIndel = pass === 2;
            ctx.fillStyle = wantIndel ? '#9333ea' : '#dc2626';
            for (const r of mmSampled) {
                if (r.isQuery) continue;
                for (let x = 0; x < mmSeqW; x++) {
                    const aBase = Math.floor((x / mmSeqW) * anchorLen);
                    const sampleA = [aBase];
                    if (pxStep > 2) sampleA.push(aBase + Math.floor(pxStep / 2));

                    let found = false;
                    for (const a of sampleA) {
                        if (a >= anchorLen) continue;
                        const col = anchorCols[a];
                        const ch = (r.s.seq[col] || '-').toUpperCase();
                        const qch = (querySeq[col] || '-').toUpperCase();
                        const isInternalDeletion = ch === '-' && col >= r.sStart && col <= r.sEnd;

                        if (wantIndel) {
                            if (isInternalDeletion) { found = true; break; }
                        } else {
                            if (!isInternalDeletion && ch !== '-' && ch !== qch) { found = true; break; }
                        }
                    }

                    if (found) {
                        ctx.fillRect(MINIMAP_LABEL_W + x, r.y, 1.2, rowDrawH);
                    }
                }
            }
        }

        // Insertion markers (blue) come from the insert runs, not per-pixel sampling.
        ctx.fillStyle = '#3b82f6';
        for (const entry of insertEntries) {
            if (entry.row % sampleStep !== 0) continue;
            const x = MINIMAP_LABEL_W + (entry.boundary / anchorLen) * mmSeqW;
            ctx.fillRect(x, rowsTop + entry.row * rowH, 1.2, rowDrawH);
        }

        if (primersA) {
            const mmRulerY = MINIMAP_GC_H;
            const mmRulerH = MINIMAP_RULER_H;
            const p1x = MINIMAP_LABEL_W + (primersA.p1.start / anchorLen) * mmSeqW;
            const p1w = Math.max(1, ((primersA.p1.end - primersA.p1.start) / anchorLen) * mmSeqW);
            ctx.fillStyle = '#22c55e';
            ctx.fillRect(p1x, mmRulerY + mmRulerH - 4, p1w, 4);
            const p2x = MINIMAP_LABEL_W + (primersA.p2.start / anchorLen) * mmSeqW;
            const p2w = Math.max(1, ((primersA.p2.end - primersA.p2.start) / anchorLen) * mmSeqW);
            ctx.fillStyle = '#facc15';
            ctx.fillRect(p2x, mmRulerY + mmRulerH - 4, p2w, 4);
        }

        // Flanking primers (designed in lower panel) — drawn above the oligo bars
        if (flankingPrimersA) {
            const mmRulerY = MINIMAP_GC_H;
            if (flankingPrimersA.fwd) {
                const fx = MINIMAP_LABEL_W + (flankingPrimersA.fwd.start / anchorLen) * mmSeqW;
                const fw = Math.max(2, ((flankingPrimersA.fwd.end - flankingPrimersA.fwd.start) / anchorLen) * mmSeqW);
                ctx.fillStyle = '#10b981'; // emerald-500
                ctx.fillRect(fx, mmRulerY, fw, 3);
            }
            if (flankingPrimersA.rev) {
                const rx = MINIMAP_LABEL_W + (flankingPrimersA.rev.start / anchorLen) * mmSeqW;
                const rw = Math.max(2, ((flankingPrimersA.rev.end - flankingPrimersA.rev.start) / anchorLen) * mmSeqW);
                ctx.fillStyle = '#14b8a6'; // teal-500
                ctx.fillRect(rx, mmRulerY, rw, 3);
            }
        }

        if (restoredA && restoredA.start < restoredA.end) {
            const rx = MINIMAP_LABEL_W + Math.max(0, (restoredA.start / anchorLen) * mmSeqW);
            const rw = Math.max(2, ((restoredA.end - restoredA.start) / anchorLen) * mmSeqW);
            ctx.fillStyle = isDark ? 'rgba(99, 102, 241, 0.35)' : 'rgba(99, 102, 241, 0.25)';
            ctx.fillRect(rx, MINIMAP_GC_H + 4, rw, MINIMAP_RULER_H + 42);
            ctx.strokeStyle = isDark ? 'rgba(129, 140, 248, 0.7)' : 'rgba(67, 56, 202, 0.6)';
            ctx.lineWidth = 1;
            ctx.strokeRect(rx + 0.5, MINIMAP_GC_H + 4.5, rw - 1, MINIMAP_RULER_H + 41);
        }

        ctx.fillStyle = isDark ? '#334155' : '#cbd5e1';
        ctx.fillRect(MINIMAP_LABEL_W - 1, 0, 1, MINIMAP_HEIGHT);

        staticMinimapDrawnRef.current = true;
    }, [sequences, querySeq, anchorLen, anchorCols, insertEntries, availableWidth, gcContent, primersA, flankingPrimersA, isDark, restoredA, lightMatchBars]);

    const drawMinimap = useCallback(() => {
        const cvs = minimapRef.current;
        if (!cvs || sequences.length === 0) return;
        if (availableWidth <= 0 || MINIMAP_HEIGHT <= 0) return;
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

        if (offscreenMinimapRef.current && offscreenMinimapRef.current.width > 0 && offscreenMinimapRef.current.height > 0) {
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
        if (hoverCol !== null && hoverCol >= 0 && hoverCol < anchorLen) {
            const hx = MINIMAP_LABEL_W + (hoverCol / anchorLen) * mmSeqW;
            ctx.strokeStyle = mismatchCols.has(anchorCols[hoverCol]) ? '#ef4444' : '#3b82f6';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(Math.floor(hx) + 0.5, rowsTop);
            ctx.lineTo(Math.floor(hx) + 0.5, rowsTop + rowAreaH);
            ctx.stroke();
        }

        ctx.fillStyle = isDark ? '#334155' : '#cbd5e1';
        ctx.fillRect(MINIMAP_LABEL_W - 1, 0, 1, MINIMAP_HEIGHT);
    }, [sequences.length, availableWidth, startFrac, endFrac, viewFraction, selectionRange, isDark, drawMinimapBackground, anchorLen, anchorCols, mismatchCols]);

    useEffect(() => {
        staticMinimapDrawnRef.current = false;
        drawMinimapBackground();
    }, [drawMinimapBackground]);

    useEffect(() => { drawMinimap(); }, [drawMinimap]);

    /* ══════════════════════════════════════════════════════
       MINIMAP DRAG
       ══════════════════════════════════════════════════════ */
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

    // ── Minimap: original zoom-only behaviour — no changes here ──────────────
    const handleMinimapMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = minimapRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mmSeqW = rect.width - MINIMAP_LABEL_W - RIGHT_PADDING;
        const mouseXFrac = Math.max(0, Math.min(1, (e.clientX - rect.left - MINIMAP_LABEL_W) / mmSeqW));

        const curSeqAreaW = availableWidth - labelWidth - RIGHT_PADDING;
        const curStart = scrollLeft / (curSeqAreaW / viewFraction);
        const curEnd = curStart + viewFraction;
        const handleZone = 10 / mmSeqW;
        const blueBoxVisible = viewFraction < 0.99;

        let dragType: 'select' | 'left' | 'right';
        if (blueBoxVisible) {
            if (Math.abs(mouseXFrac - curStart) < handleZone && mouseXFrac < curEnd) dragType = 'left';
            else if (Math.abs(mouseXFrac - curEnd) < handleZone && mouseXFrac > curStart) dragType = 'right';
            else dragType = 'select';
        } else {
            dragType = 'select';
        }

        if (dragType === 'select') setSelectionRange({ start: mouseXFrac, end: mouseXFrac });

        const startClientX = e.clientX;
        const onMove = makeMoveHandler(dragType, startClientX, curStart, curEnd, curSeqAreaW, mmSeqW, mouseXFrac);

        const onUp = () => {
            isDragging.current = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (dragType === 'select') {
                setSelectionRange(prev => {
                    if (!prev) return null;
                    const s = Math.min(prev.start, prev.end);
                    const e = Math.max(prev.start, prev.end);
                    if (e - s < 0.005) return null;
                    const newVF = e - s;
                    const newTotalW = curSeqAreaW / newVF;
                    const newSL = s * newTotalW;
                    setViewFraction(newVF);
                    setScrollLeft(newSL);
                    targetScrollRef.current = newSL;
                    return null;
                });
            }
        };
        isDragging.current = true;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
    }, [availableWidth, viewFraction, scrollLeft, seqAreaW, labelWidth, makeMoveHandler]);

    /* ── minimap cursor style + hover column ───────────────── */
    const handleMinimapMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = minimapRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mmSeqW = rect.width - MINIMAP_LABEL_W - RIGHT_PADDING;
        const mouseXFrac = (e.clientX - rect.left - MINIMAP_LABEL_W) / mmSeqW;

        // Set hover column for cursor line
        const col = Math.floor(mouseXFrac * anchorLen);
        const newCol = col >= 0 && col < anchorLen ? col : null;
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
    }, [viewFraction, scrollLeft, availableWidth, anchorLen]);

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

        const canvasH = Math.min(totalH, maxHeight ?? MAX_VIEWER_HEIGHT);
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
        const lastCol = Math.min(anchorLen - 1, Math.ceil((scrollLeft + seqAreaW) / cellW));

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
            const isSelectedForAutofind = row > 0 && row <= autofindBoundaryRow;

            const sStart = seqStart(s.seq);
            const sEnd = seqEnd(s.seq);

            if (isSelectedForAutofind) {
                ctx.fillStyle = isDark ? 'rgba(34,197,94,0.12)' : 'rgba(34,197,94,0.10)';
                ctx.fillRect(labelWidth, y, seqAreaW, ROW_HEIGHT);
            }

            if (viewMode === 'letters') {
                for (let a = firstCol; a <= lastCol; a++) {
                    const col = anchorCols[a];
                    const ch = (s.seq[col] || '-').toUpperCase();
                    const qch = querySeq[col].toUpperCase(); // anchor columns always hold a query base

                    const x = labelWidth + a * cellW - scrollLeft;

                    let bg = '#f3f4f6'; // default/match gray
                    let fg = '#374151';

                    if (ch === '-') {
                        // deletion in the hit (within its aligned span), or structural gap outside it
                        if (!isQuery && col >= sStart && col <= sEnd) {
                            bg = isDark ? '#3b0764' : '#f3e8ff';
                            fg = isDark ? '#d8b4fe' : '#7e22ce';
                        } else {
                            bg = isDark ? '#0f172a' : '#f3f4f6';
                            fg = isDark ? '#475569' : '#9ca3af';
                        }
                    } else if (!isQuery && ch !== qch) {
                        bg = isDark ? '#7f1d1d' : '#fee2e2';
                        fg = isDark ? '#fecaca' : '#b91c1c';
                    } else {
                        bg = isDark ? '#1e293b' : '#f3f4f6';
                        fg = isDark ? '#cbd5e1' : '#374151';

                        if (isQuery) {
                            if (restoredA && a >= restoredA.start && a < restoredA.end) {
                                bg = isDark ? '#3730a3' : '#c7d2fe';
                                fg = isDark ? '#e0e7ff' : '#312e81';
                            } else if (primersA && a >= primersA.p1.start && a < primersA.p1.end) {
                                bg = isDark ? '#065f46' : '#86efac';
                                fg = isDark ? '#a7f3d0' : '#064e3b';
                            } else if (primersA && a >= primersA.p2.start && a < primersA.p2.end) {
                                bg = isDark ? '#92400e' : '#fde047';
                                fg = isDark ? '#fef3c7' : '#78350f';
                            } else if (flankingPrimersA?.fwd && a >= flankingPrimersA.fwd.start && a < flankingPrimersA.fwd.end) {
                                bg = isDark ? '#047857' : '#34d399';
                                fg = isDark ? '#d1fae5' : '#022c22';
                            } else if (flankingPrimersA?.rev && a >= flankingPrimersA.rev.start && a < flankingPrimersA.rev.end) {
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

                // Inserted hit bases don't occupy anchor columns — mark the insertion point
                // with a blue vertical bar; longer inserts get horizontal extent lines above
                // and below, extending only to the right of the bar (where the inserted
                // sequence would sit) so the rows are never prolonged.
                if (!isQuery) {
                    const rowInserts = insertsByRow.get(row);
                    if (rowInserts) {
                        for (const entry of rowInserts) {
                            if (entry.boundary < firstCol || entry.boundary > lastCol + 1) continue;
                            const bx = labelWidth + entry.boundary * cellW - scrollLeft;
                            if (bx < labelWidth || bx > labelWidth + seqAreaW) continue;
                            const n = entry.text.length;
                            ctx.fillStyle = '#3b82f6';
                            if (n > 1) {
                                const aS = firstAnchorAtOrAfter(anchorCols, sStart);
                                const aE = lastAnchorAtOrBefore(anchorCols, sEnd);
                                const leftX = Math.max(labelWidth, labelWidth + Math.max(aS, entry.boundary) * cellW - scrollLeft);
                                const rightX = Math.min(labelWidth + seqAreaW, labelWidth + Math.min(aE + 1, entry.boundary + n) * cellW - scrollLeft);
                                if (rightX > leftX) {
                                    ctx.fillRect(leftX, y + 1.5, rightX - leftX, 1.5);
                                    ctx.fillRect(leftX, y + ROW_HEIGHT - 3, rightX - leftX, 1.5);
                                }
                            }
                            ctx.fillRect(Math.floor(bx) - 1, y + 1, 2, ROW_HEIGHT - 2);
                        }
                    }
                }
            }
            else {
                // aligned span converted to anchor space so the bar is contiguous
                const aS = firstAnchorAtOrAfter(anchorCols, sStart);
                const aE = lastAnchorAtOrBefore(anchorCols, sEnd);
                if (aS <= aE) {
                    const barX1 = Math.floor(Math.max(labelWidth, labelWidth + aS * cellW - scrollLeft));
                    const barX2 = Math.ceil(Math.min(labelWidth + seqAreaW, labelWidth + (aE + 1) * cellW - scrollLeft));
                    if (barX2 > barX1) {
                        ctx.fillStyle = isQuery
                            ? (isDark ? '#1e3a8a' : '#bfdbfe')
                            : lightMatchBars
                                ? (isDark ? '#f8fafc' : '#ffffff')
                                : (isDark ? '#334155' : '#e2e8f0');
                        ctx.fillRect(barX1, y + 3, barX2 - barX1, ROW_HEIGHT - 6);
                    }
                }
                const barW = Math.max(1, Math.ceil(cellW));
                for (let a = firstCol; a <= lastCol; a++) {
                    const col = anchorCols[a];
                    const ch = (s.seq[col] || '-').toUpperCase();
                    const qch = querySeq[col].toUpperCase();

                    const isInternalDeletion = !isQuery && ch === '-' && col >= sStart && col <= sEnd;
                    if (ch === '-' && !isInternalDeletion) continue;

                    const x = Math.floor(labelWidth + a * cellW - scrollLeft);

                    if (isInternalDeletion) {
                        ctx.fillStyle = '#9333ea';
                        ctx.fillRect(x, y + 2, barW, ROW_HEIGHT - 4);
                    } else if (!isQuery && ch !== qch) {
                        ctx.fillStyle = '#dc2626';
                        ctx.fillRect(x, y + 2, barW, ROW_HEIGHT - 4);
                    } else if (isQuery) {
                        if (restoredA && a >= restoredA.start && a < restoredA.end) {
                            ctx.fillStyle = isDark ? '#6366f1' : '#818cf8';
                            ctx.fillRect(x, y + 2, barW, ROW_HEIGHT - 4);
                        } else if (primersA && a >= primersA.p1.start && a < primersA.p1.end) {
                            ctx.fillStyle = '#22c55e';
                            ctx.fillRect(x, y + 2, barW, ROW_HEIGHT - 4);
                        } else if (primersA && a >= primersA.p2.start && a < primersA.p2.end) {
                            ctx.fillStyle = '#facc15';
                            ctx.fillRect(x, y + 2, barW, ROW_HEIGHT - 4);
                        } else if (flankingPrimersA?.fwd && a >= flankingPrimersA.fwd.start && a < flankingPrimersA.fwd.end) {
                            ctx.fillStyle = '#10b981';
                            ctx.fillRect(x, y + 2, barW, ROW_HEIGHT - 4);
                        } else if (flankingPrimersA?.rev && a >= flankingPrimersA.rev.start && a < flankingPrimersA.rev.end) {
                            ctx.fillStyle = '#14b8a6';
                            ctx.fillRect(x, y + 2, barW, ROW_HEIGHT - 4);
                        }
                    }
                }

                // blue ticks mark hit insertions at their boundary between anchor columns
                if (!isQuery) {
                    const rowInserts = insertsByRow.get(row);
                    if (rowInserts) {
                        for (const entry of rowInserts) {
                            if (entry.boundary < firstCol || entry.boundary > lastCol + 1) continue;
                            const bx = Math.floor(labelWidth + entry.boundary * cellW - scrollLeft);
                            if (bx < labelWidth || bx > labelWidth + seqAreaW) continue;
                            ctx.fillStyle = '#3b82f6';
                            ctx.fillRect(bx - 1, y + 2, 2, ROW_HEIGHT - 4);
                        }
                    }
                }
            }

            ctx.fillStyle = isDark ? '#1e293b' : '#f1f5f9';
            ctx.fillRect(labelWidth, y + ROW_HEIGHT - 0.5, seqAreaW, 0.5);
        }

        if (autofindBoundaryRow > 0 && autofindBoundaryRow < sequences.length - 1) {
            const boundaryY = MAIN_GC_TRACK_H + MAIN_MSA_TRACK_H + RULER_HEIGHT + (autofindBoundaryRow + 1) * ROW_HEIGHT - 1;
            ctx.strokeStyle = isDark ? '#22c55e' : '#16a34a';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(labelWidth, boundaryY);
            ctx.lineTo(labelWidth + seqAreaW, boundaryY);
            ctx.stroke();
            ctx.setLineDash([]);
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
        for (let a = firstCol; a <= lastCol; a++) {
            const x = Math.floor(labelWidth + a * cellW - scrollLeft);
            const gc = gcContent[anchorCols[a]] || 0;
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
        const msaRowH = MAIN_MSA_TRACK_H / sequences.length;
        const msaDrawH = Math.max(1, msaRowH);
        ctx.fillStyle = isDark ? '#0f172a' : '#f1f5f9';
        ctx.fillRect(labelWidth, msaTop, availableWidth - labelWidth, MAIN_MSA_TRACK_H);

        const sampleStep = Math.max(1, Math.floor(sequences.length / 200));
        const seqW = availableWidth - labelWidth - RIGHT_PADDING;
        const pxStep = Math.max(1, anchorLen / seqW);

        const sampled = [];
        for (let row = 0; row < sequences.length; row += sampleStep) {
            const s = sequences[row];
            const sStart = seqStart(s.seq);
            const sEnd = seqEnd(s.seq);
            sampled.push({
                s,
                isQuery: row === 0,
                sStart,
                sEnd,
                aS: firstAnchorAtOrAfter(anchorCols, sStart),
                aE: lastAnchorAtOrBefore(anchorCols, sEnd),
                y: msaTop + row * msaRowH,
            });
        }

        for (const r of sampled) {
            if (r.aS <= r.aE) {
                const barX1 = Math.max(labelWidth, labelWidth + r.aS * cellW - scrollLeft);
                const barX2 = Math.min(labelWidth + seqAreaW, labelWidth + (r.aE + 1) * cellW - scrollLeft);
                if (barX2 > barX1) {
                    ctx.fillStyle = r.isQuery
                        ? (isDark ? '#1e3a8a' : '#bfdbfe')
                        : lightMatchBars
                            ? (isDark ? '#f8fafc' : '#ffffff')
                            : (isDark ? '#334155' : '#e2e8f0');
                    ctx.fillRect(barX1, r.y, barX2 - barX1, msaDrawH);
                }
            }
        }

        // Per-row mismatch markers (red) then deletion markers (purple, on top).
        // Per-row Y preserves which rows have variation; marker height is
        // capped at the row height so markers never bleed outside the bar.
        for (let pass = 1; pass <= 2; pass++) {
            const wantIndel = pass === 2;
            ctx.fillStyle = wantIndel ? '#9333ea' : '#dc2626';
            for (const r of sampled) {
                if (r.isQuery) continue;
                for (let x = 0; x < availableWidth - labelWidth; x++) {
                    const aBase = Math.floor(((x + scrollLeft) / seqW) * anchorLen * viewFraction);
                    if (aBase < 0 || aBase >= anchorLen) continue;
                    const sampleA = [aBase];
                    if (pxStep > 2) sampleA.push(aBase + Math.floor(pxStep / 2));

                    let found = false;
                    for (const a of sampleA) {
                        if (a >= anchorLen) continue;
                        const col = anchorCols[a];
                        const ch = (r.s.seq[col] || '-').toUpperCase();
                        const qch = querySeq[col].toUpperCase();
                        const isInternalDeletion = ch === '-' && col >= r.sStart && col <= r.sEnd;

                        if (wantIndel) {
                            if (isInternalDeletion) { found = true; break; }
                        } else {
                            if (!isInternalDeletion && ch !== '-' && ch !== qch) { found = true; break; }
                        }
                    }

                    if (found) {
                        ctx.fillRect(labelWidth + x, r.y, 1.2, msaDrawH);
                    }
                }
            }
        }

        // Insertion markers (blue) come from the insert runs, not per-pixel sampling.
        ctx.fillStyle = '#3b82f6';
        for (const entry of insertEntries) {
            if (entry.row % sampleStep !== 0) continue;
            const bx = labelWidth + entry.boundary * cellW - scrollLeft;
            if (bx < labelWidth || bx > availableWidth) continue;
            ctx.fillRect(bx, msaTop + entry.row * msaRowH, 1.2, msaDrawH);
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
        for (let a = firstCol; a <= lastCol; a++) {
            if ((a + 1) % tickInterval === 0) {
                const x = labelWidth + a * cellW - scrollLeft;
                ctx.fillStyle = isDark ? '#334155' : '#cbd5e1';
                ctx.fillRect(x, rulerY + RULER_HEIGHT - 6, 1, 6);
                ctx.fillStyle = '#94a3b8';
                ctx.fillText(String(a + 1), x, rulerY + RULER_HEIGHT - 7);
            }
        }

        /* ── Oligo markers in main ruler ── */
        if (primersA) {
            const p1x = labelWidth + primersA.p1.start * cellW - scrollLeft;
            const p1w = (primersA.p1.end - primersA.p1.start) * cellW;
            ctx.fillStyle = '#22c55e';
            ctx.fillRect(p1x, rulerY + RULER_HEIGHT - 4, p1w, 4);

            const p2x = labelWidth + primersA.p2.start * cellW - scrollLeft;
            const p2w = (primersA.p2.end - primersA.p2.start) * cellW;
            ctx.fillStyle = '#facc15';
            ctx.fillRect(p2x, rulerY + RULER_HEIGHT - 4, p2w, 4);
        }

        /* ── Flanking primer markers in main ruler ── */
        if (flankingPrimersA) {
            if (flankingPrimersA.fwd) {
                const fx = labelWidth + flankingPrimersA.fwd.start * cellW - scrollLeft;
                const fw = Math.max(3, (flankingPrimersA.fwd.end - flankingPrimersA.fwd.start) * cellW);
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
            if (flankingPrimersA.rev) {
                const rx = labelWidth + flankingPrimersA.rev.start * cellW - scrollLeft;
                const rw = Math.max(3, (flankingPrimersA.rev.end - flankingPrimersA.rev.start) * cellW);
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
            const isSelectedForAutofind = row > 0 && row <= autofindBoundaryRow;

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

            if (isSelectedForAutofind) {
                ctx.fillStyle = isDark ? '#22c55e' : '#16a34a';
                ctx.beginPath();
                ctx.arc(8, labelY, 3, 0, Math.PI * 2);
                ctx.fill();
            }
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
    }, [sequences, querySeq, scrollLeft, scrollTop, cellW, seqAreaW, availableWidth, totalH, anchorLen, anchorCols, insertEntries, insertsByRow, viewMode, primersA, flankingPrimersA, gcContent, isDarkMode, oligoSelection, autofindBoundaryRow, restoredA, lightMatchBars]);

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
        if (hoverCol === null || hoverCol < 0 || hoverCol >= anchorLen) return;

        const hx = labelWidth + hoverCol * cellW - scrollLeft + cellW / 2;
        if (hx < labelWidth || hx > labelWidth + seqAreaW) return;

        ctx.strokeStyle = mismatchCols.has(anchorCols[hoverCol]) ? '#ef4444' : '#3b82f6';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.floor(hx) + 0.5, 0);
        ctx.lineTo(Math.floor(hx) + 0.5, h);
        ctx.stroke();
    }, [cellW, scrollLeft, seqAreaW, anchorLen, anchorCols, mismatchCols]);

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
            setInsertHoverInfo(null);
            if (hoverColRef.current !== null) {
                hoverColRef.current = null;
                cancelAnimationFrame(hoverRafRef.current);
                hoverRafRef.current = requestAnimationFrame(() => redrawRef.current());
            }
            return;
        }

        setLabelHoverInfo(null);

        // Insertion hit detection for hover tooltips
        const rowsStartY = MAIN_GC_TRACK_H + MAIN_MSA_TRACK_H + RULER_HEIGHT;
        const virtualY = mouseYRaw + scrollTop;
        const hovRow = Math.floor((virtualY - rowsStartY) / ROW_HEIGHT);

        let insertHit: InsertEntry | null = null;
        if (hovRow >= 0 && hovRow < sequences.length && virtualY >= rowsStartY) {
            const rowInserts = insertsByRow.get(hovRow);
            if (rowInserts) {
                let minDist = Infinity;
                const tol = Math.max(4, Math.min(cellW, 10));

                for (const entry of rowInserts) {
                    const bx = labelWidth + entry.boundary * cellW - scrollLeft;
                    if (bx < labelWidth || bx > labelWidth + seqAreaW) continue;

                    const extent = entry.text.length > 1 ? entry.text.length * cellW : 0;
                    const leftBound = bx - extent - tol;
                    const rightBound = bx + extent + tol;

                    if (mouseXRaw >= leftBound && mouseXRaw <= rightBound) {
                        const dist = Math.abs(mouseXRaw - bx);
                        if (dist < minDist) {
                            minDist = dist;
                            insertHit = entry;
                        }
                    }
                }
            }
        }

        const insertEntry = insertHit;
        setInsertHoverInfo(prev => {
            if (!insertEntry) return prev === null ? prev : null;
            return {
                length: insertEntry.text.length,
                sequence: insertEntry.text,
                x: e.clientX,
                y: e.clientY
            };
        });

        // GC%/MSA track area gets a special crosshair for oligo selection
        if (insertEntry) {
            cvs.style.cursor = 'help';
        } else if (mouseYRaw < MAIN_GC_TRACK_H + MAIN_MSA_TRACK_H) {
            cvs.style.cursor = 'crosshair';
        } else {
            cvs.style.cursor = viewMode === 'letters' ? 'pointer' : 'crosshair';
        }

        const mouseX = mouseXRaw - labelWidth;
        const col = Math.floor((scrollLeft + mouseX) / cellW);
        const newCol = col >= 0 && col < anchorLen ? col : null;
        if (newCol === hoverColRef.current) return;
        hoverColRef.current = newCol;
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = requestAnimationFrame(() => redrawRef.current());
    }, [scrollLeft, cellW, anchorLen, sequences, scrollTop, viewMode, seqAreaW, insertsByRow, labelWidth]);

    const handleCanvasMouseLeave = useCallback(() => {
        setLabelHoverInfo(null);
        setInsertHoverInfo(null);
        if (hoverColRef.current === null) return;
        hoverColRef.current = null;
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = requestAnimationFrame(() => redrawRef.current());
    }, []);

    /* ── main canvas mouse down ─────────────────────────────────────────────
       Left-drag  → oligo region selection (+ primer click on tiny drag)
       Right-drag → zoom viewport to the dragged column range               */
    const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (e.button !== 0 && e.button !== 2) return;
        const cvs = canvasRef.current;
        if (!cvs) return;
        const rect = cvs.getBoundingClientRect();
        const mouseXCanvas = e.clientX - rect.left;
        if (mouseXCanvas < labelWidth) return;

        const startClientX = e.clientX;
        const mouseX = mouseXCanvas - labelWidth;
        const startC = Math.max(0, Math.min(anchorLen - 1, Math.floor((scrollLeft + mouseX) / cellW)));
        setOligoSelection({ startCol: startC, endCol: startC });

        const colAt = (clientX: number) =>
            Math.max(0, Math.min(anchorLen - 1, Math.floor((scrollLeft + clientX - rect.left - labelWidth) / cellW)));

        // ── RIGHT BUTTON: zoom to dragged column range ───────────────────
        if (e.button === 2) {
            const onMove = (ev: MouseEvent) => setOligoSelection({ startCol: startC, endCol: colAt(ev.clientX) });
            const onUp = (ev: MouseEvent) => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                setOligoSelection(null);
                const endC = colAt(ev.clientX);
                const s = Math.min(startC, endC);
                const e2 = Math.max(startC, endC);
                if (e2 - s >= 5) {
                    const seqAreaWLocal = availableWidth - labelWidth - RIGHT_PADDING;
                    const newVF = Math.max(0.005, (e2 - s + 1) / anchorLen);
                    const newTotalW = seqAreaWLocal / newVF;
                    const newSL = (s / anchorLen) * newTotalW;
                    setViewFraction(newVF);
                    setScrollLeft(newSL);
                    if (scrollRef.current) scrollRef.current.scrollLeft = newSL;
                }
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            e.preventDefault();
            return;
        }

        // ── LEFT BUTTON: primer click or oligo region selection ──────────
        const onMove = (ev: MouseEvent) => setOligoSelection({ startCol: startC, endCol: colAt(ev.clientX) });
        const onUp = (ev: MouseEvent) => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);

            const dragPx = Math.abs(ev.clientX - startClientX);

            // Tiny drag = click → check for flanking primer hit (ranges in anchor space)
            if (dragPx < 6 && onFlankingPrimerClick && flankingPrimers && flankingPrimersA) {
                if (flankingPrimers.fwd && flankingPrimersA.fwd && startC >= flankingPrimersA.fwd.start && startC < flankingPrimersA.fwd.end) {
                    setOligoSelection(null);
                    onFlankingPrimerClick(flankingPrimers.fwd.start, flankingPrimers.fwd.end);
                    return;
                }
                if (flankingPrimers.rev && flankingPrimersA.rev && startC >= flankingPrimersA.rev.start && startC < flankingPrimersA.rev.end) {
                    setOligoSelection(null);
                    onFlankingPrimerClick(flankingPrimers.rev.start, flankingPrimers.rev.end);
                    return;
                }
            }

            setOligoSelection(prev => {
                if (!prev) return null;
                const s = Math.min(prev.startCol, prev.endCol);
                const e2 = Math.max(prev.startCol, prev.endCol);
                // oligoSelection is tracked in anchor indices; consumers expect gapped columns
                if (e2 - s >= 5 && onOligoRegionSelect) onOligoRegionSelect(anchorCols[s], anchorCols[e2]);
                return null; // clear rectangle after committing
            });
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
    }, [labelWidth, anchorLen, anchorCols, scrollLeft, cellW, availableWidth, onOligoRegionSelect, flankingPrimers, flankingPrimersA, onFlankingPrimerClick]);

    const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const cvs = canvasRef.current;
        if (!cvs) return;
        const rect = cvs.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const rowsStartY = MAIN_GC_TRACK_H + MAIN_MSA_TRACK_H + RULER_HEIGHT;
        const virtualY = y + scrollTop;
        const row = Math.floor((virtualY - rowsStartY) / ROW_HEIGHT);

        if (row < 0 || row >= sequences.length || virtualY < rowsStartY) return;

        if (x < labelWidth && row > 0) {
            const accession = sequences[row].accession;
            if (accession) {
                setNcbiModalAccession(accession);
            }
            return;
        }

        setAutofindBoundaryRow(row);
    };

    if (!alignment || sequences.length === 0) return null;
    if (anchorLen === 0) return null;

    return (
        <div ref={containerRef} className="mt-6 card overflow-hidden">
            {/* ── header ── */}
            <div className="panel-header flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        Multiple sequence alignment <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">({sequences.length} seq, {anchorLen} bp)</span>
                    </h2>
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={copyAllFasta}
                            className="px-2 py-1 text-xs font-medium rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors flex items-center gap-1"
                            title="Copy full alignment as FASTA"
                        >
                            <ClipboardIcon /> FASTA
                        </button>
                        <button
                            onClick={copySelection}
                            className="btn-secondary font-mono tabular-nums"
                            title={`Copy visible selection (pos ${startCol + 1}–${endCol + 1})`}
                        >
                            <ClipboardIcon /> {startCol + 1}–{endCol + 1}
                        </button>
                    </div>
                    <button
                        onClick={() => setShowOverview((v) => !v)}
                        className={`btn-secondary ${showOverview ? 'icon-btn-active' : ''}`}
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
                    {showAutofindUI && (
                        <button
                            onClick={() => setAutofindActive((v) => !v)}
                            className={`btn-secondary ${autofindActive ? 'icon-btn-active' : ''}`}
                            title={autofindActive ? 'Hide autofind proposals' : 'Find zero-mismatch regions'}
                        >
                            autofind
                        </button>
                    )}
                    {copyFeedback && (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium animate-pulse">{copyFeedback}</span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex rounded-md overflow-hidden border border-zinc-300 dark:border-zinc-700">
                        <button
                            onClick={() => {
                                setViewMode('bars');
                                setViewFraction(1);
                                setScrollLeft(0);
                                targetScrollRef.current = 0;
                            }}
                            className={`px-3 py-1 text-xs font-medium transition-colors ${viewMode === 'bars'
                                ? 'bg-teal-700/10 dark:bg-teal-300/10 text-teal-800 dark:text-teal-200'
                                : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700'
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
                                const newVF = Math.min(1, 100 / anchorLen); // ~100 bp zoom
                                const newTotalW = seqAreaW / newVF;

                                // Recalculate scroll to keep same center
                                const newSL = centerFrac * newTotalW - seqAreaW / 2;
                                const clampedSL = Math.max(0, Math.min(newTotalW - seqAreaW, newSL));

                                setViewFraction(newVF);
                                setScrollLeft(clampedSL);
                                targetScrollRef.current = clampedSL;
                            }}
                            className={`px-3 py-1 text-xs font-medium transition-colors border-l border-zinc-300 dark:border-zinc-800 ${viewMode === 'letters'
                                ? 'bg-teal-700/10 dark:bg-teal-300/10 text-teal-800 dark:text-teal-200'
                                : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                                }`}
                        >
                            Sequence
                        </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={zoomOut}
                            className="w-6 h-6 flex items-center justify-center rounded border border-zinc-300 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 transition-colors text-sm font-bold"
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
                                // Anchor to the left edge so the slider does not teleport the view.
                                applyZoom(factor, 0);
                            }}
                            className="w-24 h-1.5 accent-teal-700 dark:accent-teal-300"
                            style={{ direction: 'rtl' }}
                        />
                        <button
                            onClick={zoomIn}
                            className="w-6 h-6 flex items-center justify-center rounded border border-zinc-300 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 transition-colors text-sm font-bold"
                            title="Zoom in"
                        >+</button>
                    </div>
                    <span className="text-xs text-zinc-400 font-mono w-20 text-right">{Math.round(visibleBases)} bp</span>
                </div>
            </div>

            {/* ── autofind proposals ── */}
            {showAutofindUI && autofindActive && (
                <div className="px-5 py-3 bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wide">
                            Clean Regions
                        </span>
                        <span className="text-xs text-zinc-400 dark:text-zinc-500">
                            {cleanRegions.length} region{cleanRegions.length !== 1 ? 's' : ''}
                        </span>
                    </div>
                    <label className="flex items-center gap-2 mb-2 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={autofindTreatIndelsAsMismatches}
                            onChange={(e) => onAutofindTreatIndelsAsMismatchesChange?.(e.target.checked)}
                            className="rounded border-zinc-300 dark:border-zinc-700 text-teal-700 focus:ring-teal-700"
                        />
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">
                            Count insertions/deletions as mismatches
                        </span>
                    </label>
                    {cleanRegions.length === 0 ? (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            No clean regions found.
                        </p>
                    ) : (
                        <div className="flex flex-wrap gap-1.5">
                            {cleanRegions.map((region) => (
                                <button
                                    key={`${region.start}-${region.end}`}
                                    data-testid="clean-region-pill"
                                    onClick={() => onAutofindRegionSelect?.(region.start, region.end)}
                                    className="px-2.5 py-1 text-xs font-mono tabular-nums rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:border-teal-700/50 dark:hover:border-teal-300/50 hover:text-teal-800 dark:hover:text-teal-200 transition-colors"
                                    title={`Jump to columns ${region.start + 1}–${region.end + 1}`}
                                >
                                    {region.start + 1}–{region.end + 1}
                                    <span className="ml-1.5 text-zinc-400 dark:text-zinc-500">
                                        ({region.length} bp)
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ── minimap navigator ── */}
            {showOverview && (
                <div className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
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
            <div className="px-5 py-1.5 border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setLightMatchBars(v => !v)}
                        title={lightMatchBars ? 'Switch sequence/match bars back to grey' : 'Switch sequence/match bars to white'}
                        className="inline-block w-3 h-3 rounded-sm border border-zinc-200 dark:border-zinc-800 cursor-pointer p-0 hover:ring-1 hover:ring-zinc-400"
                        style={{ background: lightMatchBars ? (isDark ? '#f8fafc' : '#ffffff') : (isDark ? '#1e293b' : '#f3f4f6') }}
                    />
                    Sequence / Match
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#dc2626' }} />
                    Mismatch
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-1 h-3" style={{ background: '#3b82f6' }} />
                    Insertion
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#9333ea' }} />
                    Deletion
                </span>
                <span className="ml-auto italic text-zinc-400">
                    {viewMode === 'letters' ? 'Click a row to copy' : 'Drag overview to zoom · Ctrl/⌘ + scroll to zoom'}
                </span>
            </div>

            {/* ── scroll arrow bar ── */}
            <div className="py-1 border-b border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center" style={{ paddingRight: `${RIGHT_PADDING}px` }}>
                {/* Arrows live in the label column so the track aligns with the sequence bars */}
                <div style={{ width: `${labelWidth}px`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', paddingRight: '4px' }}>
                    <button
                        onMouseDown={() => startPan(-1)}
                        onMouseUp={stopPan}
                        onMouseLeave={stopPan}
                        className="icon-btn w-7 h-7 font-bold select-none"
                        title="Scroll left"
                    >
                        ←
                    </button>
                    <button
                        onMouseDown={() => startPan(1)}
                        onMouseUp={stopPan}
                        onMouseLeave={stopPan}
                        className="icon-btn w-7 h-7 font-bold select-none"
                        title="Scroll right"
                    >
                        →
                    </button>
                </div>
                <div
                    ref={scrollTrackRef}
                    onMouseDown={handleBarMouseDown}
                    className="flex-1 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden cursor-pointer relative"
                >
                    <div
                        className={`h-full bg-teal-600/60 dark:bg-teal-300/50 rounded-full transition-all ${isBarDragging ? 'duration-0' : 'duration-75'}`}
                        style={{ marginLeft: `${startFrac * 100}%`, width: `${viewFraction * 100}%` }}
                    />
                </div>
            </div>

            {/* ── scrollable canvas area ── */}
            <div
                ref={scrollRef}
                className={`overflow-y-auto overscroll-contain relative ${viewFraction >= 0.99 ? 'overflow-x-hidden' : 'overflow-x-auto'}`}
                style={{ height: `${Math.min(totalH, maxHeight ?? MAX_VIEWER_HEIGHT)}px` }}
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
                        onContextMenu={e => e.preventDefault()}
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
                        className={`absolute top-0 bottom-0 z-[30] w-1.5 cursor-col-resize hover:bg-teal-600/30 transition-colors ${isResizingLabel ? 'bg-teal-600/50' : 'bg-transparent'}`}
                        style={{ left: `${labelWidth - 3}px` }}
                    />
                </div>
            </div>

            {/* ── selection stats footer ── */}
            {
                selectionStats && (
                    <div className="bg-zinc-50 dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 px-5 py-2 text-xs text-zinc-600 dark:text-zinc-400 font-mono flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <span className="font-semibold text-zinc-700 dark:text-zinc-300">Visible Range: {startCol + 1}–{endCol + 1}</span>
                            <span>Length: {selectionStats.total} bp</span>
                            <span className="text-emerald-700 dark:text-emerald-400 font-medium">GC: {selectionStats.gcPct.toFixed(1)}%</span>
                        </div>
                        <div className="flex items-center gap-3 text-zinc-500 dark:text-zinc-500">
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
                    className="fixed z-[9999] px-2 py-1 bg-zinc-800 text-white text-xs rounded shadow-lg pointer-events-none whitespace-nowrap border border-zinc-600"
                    style={{
                        left: `${labelHoverInfo.x + 12}px`,
                        top: `${labelHoverInfo.y + 12}px`
                    }}
                >
                    {labelHoverInfo.text}
                </div>
            )}
            {/* ── insertion tooltip ── */}
            {insertHoverInfo && (
                <div
                    className="fixed z-[9999] pointer-events-none px-2 py-1 bg-zinc-800 text-white text-xs rounded shadow-lg border border-zinc-600"
                    style={{
                        left: `${insertHoverInfo.x + 12}px`,
                        top: `${insertHoverInfo.y + 12}px`
                    }}
                >
                    <div>Length: {insertHoverInfo.length} bp</div>
                    <div className="font-mono">Sequence: {insertHoverInfo.sequence.toUpperCase().length > 60 ? insertHoverInfo.sequence.toUpperCase().substring(0, 60) + '…' : insertHoverInfo.sequence.toUpperCase()}</div>
                </div>
            )}
            {/* ── NCBI link choice modal ── */}
            {ncbiModalAccession && (
                <div
                    className="modal-overlay"
                    onClick={() => setNcbiModalAccession(null)}
                >
                    <div
                        className="card shadow-xl max-w-sm w-full p-6"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-200">
                                Open NCBI record
                            </h3>
                            <button
                                onClick={() => setNcbiModalAccession(null)}
                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xl leading-none"
                            >
                                &times;
                            </button>
                        </div>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-5 font-mono break-all">
                            {ncbiModalAccession}
                        </p>
                        <div className="space-y-3">
                            <button
                                onClick={() => {
                                    const range = hitRanges[ncbiModalAccession];
                                    const parts = ['report=genbank', 'log$=nuclalign'];
                                    if (range?.rank !== undefined) parts.push(`blast_rank=${range.rank}`);
                                    if (blastRid) parts.push(`RID=${blastRid}`);
                                    const url = `https://www.ncbi.nlm.nih.gov/nucleotide/${ncbiModalAccession}?${parts.join('&')}`;
                                    window.open(url, '_blank', 'noopener,noreferrer');
                                    setNcbiModalAccession(null);
                                }}
                                className="btn-primary w-full justify-center px-4 py-2.5 text-sm"
                            >
                                Whole genome
                            </button>
                            {hitRanges[ncbiModalAccession] && (
                                <button
                                    onClick={() => {
                                        const range = hitRanges[ncbiModalAccession];
                                        if (!range) return;
                                        const parts = ['report=genbank', 'log$=nuclalign', `blast_rank=${range.rank}`];
                                        if (blastRid) parts.push(`RID=${blastRid}`);
                                        parts.push(`from=${range.sstart}`, `to=${range.send}`);
                                        const url = `https://www.ncbi.nlm.nih.gov/nucleotide/${ncbiModalAccession}?${parts.join('&')}`;
                                        window.open(url, '_blank', 'noopener,noreferrer');
                                        setNcbiModalAccession(null);
                                    }}
                                    className="btn-secondary w-full justify-center px-4 py-2.5 text-sm"
                                >
                                    Coding region
                                </button>
                            )}
                        </div>
                        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
                            Choose whether to view the complete genome record or just the BLAST-aligned coding region.
                        </p>
                    </div>
                </div>
            )}
        </div >
    );
});

/* ── small clipboard icon component ── */
const ClipboardIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
        <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
    </svg>
);

/* ── helpers ── */
export default MSAViewer;
