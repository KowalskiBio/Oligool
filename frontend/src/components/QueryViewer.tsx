import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback, useMemo } from 'react';
import MOLigoPanel from './MOLigoPanel';
import FlankingPrimersPanel from './FlankingPrimersPanel';
import HairpinSVG from './HairpinSVG';
import DimerSVG from './DimerSVG';
import QueryReport from './QueryReport';
import { dimerAsciiFromItem } from './DimerAscii';
import { PIN_COLORS, exportPositionsCSV, exportPositionsTSV } from '../utils/session';
import type { OligoSnapshot, SavedPosition, FixedAbsCoords, FlankingPanelState } from '../utils/session';
import { buildCompleteReportTxt, downloadTxt, type CompleteReportData } from '../utils/report';
import { reverseComplement } from '../utils/dna';
import { TAG_DATABASE } from '../constants/tags';

/** Imperative handle App uses to pull QueryViewer's state when saving a session. */
export interface QueryViewerHandle {
    getSnapshot: () => OligoSnapshot;
}

/** A pending session import, tagged with a nonce so it is applied exactly once. */
export interface ImportedSession {
    nonce: number;
    oligo: OligoSnapshot;
}

interface QueryViewerProps {
    data: { id: string; seq: string; start: number; end: number; fullSeq?: string; ungappedOffset?: number };
    jobName: string;
    /** FASTA/GenBank header the user pasted with the query sequence, if any. */
    queryHeader?: string;
    /** Full GenBank flat-file header pasted on the input page, rendered verbatim on the PDF report. */
    genbankHeader?: string;
    /** Updates the shared GenBank header (the report dialog edits the same field as the input page). */
    onGenbankHeaderChange?: (value: string) => void;
    onPrimersUpdate: (primers: { p1: { start: number, end: number }, p2: { start: number, end: number } } | null) => void;
    onFlankingPrimersUpdate?: (primers: {
        fwd: { start: number, end: number } | null,
        rev: { start: number, end: number } | null,
        fwdName?: string,
        revName?: string,
        fwdSeq?: string,
        revSeq?: string,
        amplicon?: number
    } | null) => void;
    /** FlankingPrimersPanel state restored from a loaded session, forwarded to the panel. */
    flankingPanelState?: FlankingPanelState | null;
    /** Relays durable FlankingPrimersPanel state up to App for session saves. */
    onFlankingPanelStateChange?: (state: FlankingPanelState) => void;
    onNavigateTo?: (colStart: number, colEnd: number) => void;
    /** Gapped column range selected by the user in MSAViewer for constrained oligo search */
    oligoRegion?: { startCol: number; endCol: number } | null;
    autofindRegion?: { startCol: number; endCol: number } | null;
    idtCredentials?: {
        clientId: string;
        clientSecret: string;
        username?: string;
        password?: string;
        mgConc?: number;
        region?: 'us' | 'eu';
    };
    // MSA Viewer props — forwarded to FlankingPrimersPanel
    alignment?: string;
    navigateTarget?: { colStart: number; colEnd: number; ts: number } | null;
    isDarkMode?: boolean;
    /** A session to restore into this viewer; applied once per nonce. */
    importedSession?: ImportedSession | null;
    /** Saves the current working session to a downloadable file. */
    onSaveSession?: () => void;
}

interface IdtData {
    m1: { hairpin: { DeltaG?: number, raw?: any }; self_dimer: { DeltaG?: number, raw?: any }; analyze: any };
    m2: { hairpin: { DeltaG?: number, raw?: any }; self_dimer: { DeltaG?: number, raw?: any }; analyze: any };
    pairwise: { DeltaG?: number, raw?: any };
}

interface Primer {
    seq: string;
    tm: number;
    tm_strider?: number | null;
    tm_ok?: boolean;
    len: number;
    len_ok?: boolean;
    gc: number;
    gc_ok?: boolean;
    start: number; // relative to the UNGAPPED raw sequence of the slice
    end: number;
}

interface OligizeResponse {
    p1: Primer;
    p2: Primer;
    tm_diff_ok?: boolean;
    split_idx: number;
    params_not_met?: boolean;
    param_warnings?: string[];
}

const QueryViewer = forwardRef<QueryViewerHandle, QueryViewerProps>(function QueryViewer({ data, jobName, genbankHeader, onGenbankHeaderChange, onPrimersUpdate, onFlankingPrimersUpdate, flankingPanelState, onFlankingPanelStateChange, onNavigateTo, oligoRegion, autofindRegion, idtCredentials, alignment, navigateTarget, isDarkMode, importedSession, onSaveSession }, ref) {
    const API_BASE = ((import.meta.env.VITE_API_BASE as string) || '');
    const [copyFeedback, setCopyFeedback] = useState('');

    // IDT Analysis State
    const [isIdtLoading, setIsIdtLoading] = useState(false);
    const [idtResults, setIdtResults] = useState<IdtData | null>(null);
    const [idtAnalyzedSeqs, setIdtAnalyzedSeqs] = useState<{ p1: string; p2: string } | null>(null);
    const [idtError, setIdtError] = useState<string | null>(null);

    // Controls - Shift Logic
    const [moligo1Shift, setMoligo1Shift] = useState(() => Number(localStorage.getItem('moligo1_shift')) || 0);
    const [moligo2Shift, setMoligo2Shift] = useState(() => Number(localStorage.getItem('moligo2_shift')) || 0);
    const [moligo1Len, setMoligo1Len] = useState(() => Number(localStorage.getItem('moligo_1_len')) || 20);
    const [moligo2Len, setMoligo2Len] = useState(() => Number(localStorage.getItem('moligo_2_len')) || 20);

    // Oligo name state
    const [oligo1Name, setOligo1Name] = useState(() => localStorage.getItem('oligo1_name') || 'Oligo 1 (Right / 3\')');
    const [oligo2Name, setOligo2Name] = useState(() => localStorage.getItem('oligo2_name') || 'Oligo 2 (Left / 5\')');

    // Interactive Sequence Table Drag State
    const [dragState, setDragState] = useState<{ id: 'p1' | 'p2', type: 'move' | 'left' | 'right', startX: number, deltaChars: number, initShift1: number, initShift2: number, initLen: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const charWidthRef = useRef<number>(7); // Approximation of monospace char width in px
    const [seqLineLength, setSeqLineLength] = useState(120);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                // ~72px for the position column + padding; ~7.2px per char for text-xs mono
                const chars = Math.floor((entry.contentRect.width - 72) / 7.2);
                setSeqLineLength(Math.max(40, Math.min(300, chars)));
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const [primers, setPrimers] = useState<OligizeResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [searchParams, setSearchParams] = useState(() => {
        const saved = localStorage.getItem('oligo_search_params');
        if (saved) return JSON.parse(saved);
        return {
            min_len: 15,
            max_l: 35,
            tm_min: 60.0,
            tm_max: 63.0,
            tm_diff: 1.5,
            gc_min: 30,
            gc_max: 80
        };
    });
    const [advancedParams, setAdvancedParams] = useState(() => {
        const saved = localStorage.getItem('oligo_advanced_params');
        if (saved) return JSON.parse(saved);
        return {
            salt_mono: 50.0,
            salt_div: 10.0,
            dntp_conc: 0.8,
            dna_conc: 500.0
        };
    });
    const advancedParamsRef = useRef(advancedParams);
    useEffect(() => { advancedParamsRef.current = advancedParams; }, [advancedParams]);
    const [idtAdvancedParams, setIdtAdvancedParams] = useState(() => {
        const saved = localStorage.getItem('idt_advanced_params');
        if (saved) return JSON.parse(saved);
        return {
            mv_conc: 50.0,
            mg_conc: 10.0,
            dntp_conc: 0.8,
            oligo_conc: 0.25
        };
    });
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [_paramsNotMet, setParamsNotMet] = useState(false); // kept for future warning UI
    const [isAutoSearchNeeded, setIsAutoSearchNeeded] = useState(true);
    const lastShiftsApplied = useRef({ s1: 0, s2: 0 });
    const prevDataRef = useRef(data);
    const fixedContextRef = useRef<{ fullSeq: string; gappedSeq: string; start: number; end: number; offset: number } | null>(null);
    const fixedRebuildRef = useRef<{ data?: typeof data; fixed?: FixedAbsCoords | null; searchParams?: typeof searchParams }>({});
    // When region analysis is active, fetchPrimers uses this subsequence so sliders stay within the region
    const regionSeqContextRef = useRef<{ rawSub: string; ungappedOffset: number } | null>(null);
    const handleRegionAnalysisRef = useRef<() => Promise<void>>(async () => {});
    const [regionAnalysisActive, setRegionAnalysisActive] = useState(false);
    // Reset toggle whenever a new region is drawn
    useEffect(() => {
        setFixedAbsCoords(null);
        if (!regionAnalysisActive) return;
        regionSeqContextRef.current = null;
        setRegionAnalysisActive(false);
        setIsAutoSearchNeeded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [oligoRegion]);

    // MOLigo state
    const [tagSeq, setTagSeq] = useState(() => localStorage.getItem('tag_seq') || 'taattgaattgaaagataagtgt');
    const [fwdPrimer, setFwdPrimer] = useState(() => localStorage.getItem('fwd_primer') || 'TATCCGTCCATCCAAGTCCG');
    const [revPrimer, setRevPrimer] = useState(() => localStorage.getItem('rev_primer') || 'TGCGTACTACCATACCTGCC');

    // Saved Positions state (cleared on new BLAST / data change)
    const [savedPositions, setSavedPositions] = useState<SavedPosition[]>([]);
    const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
    const [editingLabelText, setEditingLabelText] = useState('');
    const [pinPulse, setPinPulse] = useState(false);
    const [isSavedPosOpen, setIsSavedPosOpen] = useState(true);
    const [lastDeleted, setLastDeleted] = useState<{ position: SavedPosition; index: number; timeoutId: ReturnType<typeof setTimeout> } | null>(null);
    const [positionSearch, setPositionSearch] = useState('');
    const [compareBaseId, setCompareBaseId] = useState<string | null>(null);
    const [compareTarget, setCompareTarget] = useState<{ base: SavedPosition; target: SavedPosition } | null>(null);
    const [searchOligo1Seq, setSearchOligo1Seq] = useState('');
    const [searchOligo2Seq, setSearchOligo2Seq] = useState('');
    const [searchOligoError, setSearchOligoError] = useState<string | null>(null);
    const [showFlankingPrimers, setShowFlankingPrimers] = useState(false);
    const [flankingPrimersData, setFlankingPrimersData] = useState<{
        fwd: { start: number; end: number } | null;
        rev: { start: number; end: number } | null;
        fwdName?: string;
        revName?: string;
        fwdSeq?: string;
        revSeq?: string;
        amplicon?: number;
    } | null>(null);
    const [showReportDialog, setShowReportDialog] = useState(false);
    const [headerError, setHeaderError] = useState<string | null>(null);
    const [interactiveFlankWindow, setInteractiveFlankWindow] = useState(200);


    // Fix Position toggle — when set, fetchPrimers is bypassed and oligos stick to global absolute coordinates
    const [fixedAbsCoords, setFixedAbsCoords] = useState<FixedAbsCoords | null>(null);

    const captureFixedContext = useCallback(() => {
        const gappedSeq = data.seq;
        const ungapped = gappedSeq.replace(/-/g, '');
        fixedContextRef.current = {
            fullSeq: data.fullSeq ?? ungapped,
            gappedSeq,
            start: data.start,
            end: data.end,
            offset: data.ungappedOffset ?? 0,
        };
    }, [data]);

    const toggleFixPosition = () => {
        setFixedAbsCoords(prev => {
            if (prev) {
                fixedContextRef.current = null;
                // Unfixing → trigger a fresh auto-search
                setIsAutoSearchNeeded(true);
                return null;
            }
            // Fixing current primers
            if (!primers) return null;
            captureFixedContext();
            const p1AbsStart = data.start + mapUngappedToGapped(primers.p1.start, data.seq) + 1;
            const p1AbsEnd   = data.start + mapUngappedToGapped(primers.p1.end,   data.seq) + 1;
            const p2AbsStart = data.start + mapUngappedToGapped(primers.p2.start, data.seq) + 1;
            const p2AbsEnd   = data.start + mapUngappedToGapped(primers.p2.end,   data.seq) + 1;
            return {
                p1AbsStart, p1AbsEnd, p2AbsStart, p2AbsEnd,
                p1Seq: primers.p1.seq, p2Seq: primers.p2.seq,
                p1Tm: primers.p1.tm, p2Tm: primers.p2.tm,
                p1TmStrider: primers.p1.tm_strider ?? null, p2TmStrider: primers.p2.tm_strider ?? null,
                p1Gc: primers.p1.gc, p2Gc: primers.p2.gc
            };
        });
    };

    const handleSearchOligos = () => {
        setSearchOligoError(null);
        const o1 = searchOligo1Seq.trim().toUpperCase().replace(/[^ATGC]/g, '');
        const o2 = searchOligo2Seq.trim().toUpperCase().replace(/[^ATGC]/g, '');

        if (!o1 && !o2) return;
        if ((o1 && o1.length < 5) || (o2 && o2.length < 5)) {
            setSearchOligoError('Each oligo must be at least 5 nt');
            return;
        }

        const target = fullSeq.toUpperCase();
        let foundP1 = -1, foundP2 = -1;
        if (o1) {
            foundP1 = target.indexOf(o1);
            if (foundP1 === -1) { setSearchOligoError('Oligo 1 not found in context'); return; }
        }
        if (o2) {
            foundP2 = target.indexOf(o2);
            if (foundP2 === -1) { setSearchOligoError('Oligo 2 not found in context'); return; }
        }

        const buildPrimer = (foundPos: number, seq: string, ungappedOff: number): Primer => {
            const s = foundPos - ungappedOff;
            const gcCount = (seq.match(/[GC]/g) || []).length;
            const gcPct = (gcCount / seq.length) * 100;
            const tm = estimateTm(seq);
            return { start: s, end: s + seq.length, seq, len: seq.length, tm, gc: gcPct };
        };

        const ungappedOff = data.ungappedOffset ?? 0;
        const p1 = o1 ? buildPrimer(foundP1, o1, ungappedOff) : { start: 0, end: 0, seq: '', len: 0, tm: 0, gc: 0 };
        const p2 = o2 ? buildPrimer(foundP2, o2, ungappedOff) : { start: 0, end: 0, seq: '', len: 0, tm: 0, gc: 0 };
        const splitIdx = o1 ? p1.start : p2.start;

        const fauxResponse: OligizeResponse = {
            p1, p2, split_idx: splitIdx,
            tm_diff_ok: Math.abs(p1.tm - p2.tm) <= Number(searchParams.tm_diff || 5),
            params_not_met: false,
        };
        setPrimers(fauxResponse);
        setParamsNotMet(false);
        setIsAutoSearchNeeded(false);

        const toGappedAbs = (u: number) => data.start + mapUngappedToGapped(u - ungappedOff, data.seq) + 1;
        const next: FixedAbsCoords = {
            p1AbsStart: o1 ? toGappedAbs(foundP1) : 1,
            p1AbsEnd: o1 ? toGappedAbs(foundP1 + o1.length) : 1,
            p2AbsStart: o2 ? toGappedAbs(foundP2) : 1,
            p2AbsEnd: o2 ? toGappedAbs(foundP2 + o2.length) : 1,
            p1Seq: o1 || '', p2Seq: o2 || '',
            p1Tm: p1.tm, p2Tm: p2.tm,
            p1TmStrider: null, p2TmStrider: null,
            p1Gc: p1.gc, p2Gc: p2.gc,
        };
        setFixedAbsCoords(next);
        refreshFixedPrimer3Tms(next);

        const p1GStart = mapUngappedToGapped(p1.start, data.seq);
        const p1GEnd = mapUngappedToGapped(p1.end, data.seq);
        const p2GStart = mapUngappedToGapped(p2.start, data.seq);
        const p2GEnd = mapUngappedToGapped(p2.end, data.seq);
        captureFixedContext();
        onPrimersUpdate({
            p1: { start: data.start + p1GStart, end: data.start + p1GEnd },
            p2: { start: data.start + p2GStart, end: data.start + p2GEnd },
        });
    };

    const handleCopy = (text: string) => {
        const doFallback = () => {
            const el = document.createElement('textarea');
            el.value = text;
            el.style.position = 'fixed';
            el.style.left = '-9999px';
            el.style.top = '-9999px';
            document.body.appendChild(el);
            el.focus();
            el.select();
            try {
                document.execCommand('copy');
                setCopyFeedback('Copied!');
            } catch {
                setCopyFeedback('Copy failed');
            }
            document.body.removeChild(el);
            setTimeout(() => setCopyFeedback(''), 2000);
        };

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => {
                setCopyFeedback('Copied!');
                setTimeout(() => setCopyFeedback(''), 2000);
            }).catch(() => doFallback());
        } else {
            doFallback();
        }
    };

    // ── Saved Positions helpers ───────────────────────────────────────────
    const calcGc = (seq: string) => {
        if (!seq) return 0;
        return ((seq.match(/[GCgc]/g) || []).length / seq.length) * 100;
    };

    const resizeFixedOligo = (id: 'p1' | 'p2', delta: number): number | null => {
        if (!fixedAbsCoords) return null;
        const fc = fixedContextRef.current;
        const absStart = id === 'p1' ? fixedAbsCoords.p1AbsStart : fixedAbsCoords.p2AbsStart;
        const absEnd = id === 'p1' ? fixedAbsCoords.p1AbsEnd : fixedAbsCoords.p2AbsEnd;
        if (!fc) {
            const overlaps = absEnd - 1 >= data.start && absStart - 1 <= data.end;
            if (!overlaps) {
                setFixedAbsCoords(null);
                setIsAutoSearchNeeded(true);
            }
            return null;
        }
        const relStart = mapGappedToUngapped(absStart - 1 - fc.start, fc.gappedSeq);
        const relEnd = mapGappedToUngapped(absEnd - 1 - fc.start, fc.gappedSeq);
        let ungappedStart = relStart + fc.offset;
        let ungappedEnd = relEnd + fc.offset;
        const currentLen = ungappedEnd - ungappedStart;
        const targetLen = Math.max(10, Math.min(60, currentLen + delta));
        if (id === 'p1') {
            ungappedEnd = Math.min(fc.fullSeq.length, ungappedStart + targetLen);
        } else {
            ungappedStart = Math.max(0, ungappedEnd - targetLen);
        }
        const newSeq = fc.fullSeq.substring(ungappedStart, ungappedEnd).toUpperCase();
        const newRelStart = mapUngappedToGapped(ungappedStart - fc.offset, fc.gappedSeq);
        const newRelEnd = mapUngappedToGapped(ungappedEnd - fc.offset, fc.gappedSeq);
        const newAbsStart = fc.start + newRelStart + 1;
        const newAbsEnd = fc.start + newRelEnd + 1;
        const gc = calcGc(newSeq);
        const tm = estimateTm(newSeq);
        const next = id === 'p1'
            ? { ...fixedAbsCoords, p1AbsStart: newAbsStart, p1AbsEnd: newAbsEnd, p1Seq: newSeq, p1Tm: tm, p1Gc: gc }
            : { ...fixedAbsCoords, p2AbsStart: newAbsStart, p2AbsEnd: newAbsEnd, p2Seq: newSeq, p2Tm: tm, p2Gc: gc };
        setFixedAbsCoords(next);
        refreshFixedPrimer3Tms(next as FixedAbsCoords);
        return newSeq.length;
    };

    const relativeTime = (ts: number) => {
        const diff = Math.floor((Date.now() - ts) / 1000);
        if (diff < 5) return 'just now';
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        return `${Math.floor(diff / 3600)}h ago`;
    };

    const pinPosition = () => {
        if (!primers) return;
        const p1AbsStart = data.start + mapUngappedToGapped(primers.p1.start, data.seq) + 1;
        const p1AbsEnd = data.start + mapUngappedToGapped(primers.p1.end, data.seq) + 1;
        const p2AbsStart = data.start + mapUngappedToGapped(primers.p2.start, data.seq) + 1;
        const p2AbsEnd = data.start + mapUngappedToGapped(primers.p2.end, data.seq) + 1;

        const pos: SavedPosition = {
            id: `pos_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            label: `Position ${savedPositions.length + 1}`,
            createdAt: Date.now(),
            p1: { start: primers.p1.start, end: primers.p1.end, seq: primers.p1.seq, gc: calcGc(primers.p1.seq), tm: primers.p1.tm, tm_strider: primers.p1.tm_strider ?? null },
            p2: { start: primers.p2.start, end: primers.p2.end, seq: primers.p2.seq, gc: calcGc(primers.p2.seq), tm: primers.p2.tm, tm_strider: primers.p2.tm_strider ?? null },
            p1AbsStart, p1AbsEnd, p2AbsStart, p2AbsEnd,
            moligo1Shift, moligo2Shift, moligo1Len, moligo2Len,
            notes: '',
            color: 'slate',
        };
        setSavedPositions(prev => [...prev, pos]);
        setPinPulse(true);
        setTimeout(() => setPinPulse(false), 1000);
    };

    const restorePosition = (pos: SavedPosition) => {
        // Lock instantly to the exact absolute genomic sequence, bypassing backend searches completely.
        captureFixedContext();
        const restored: FixedAbsCoords = {
            p1AbsStart: pos.p1AbsStart, p1AbsEnd: pos.p1AbsEnd,
            p2AbsStart: pos.p2AbsStart, p2AbsEnd: pos.p2AbsEnd,
            p1Seq: pos.p1.seq, p2Seq: pos.p2.seq,
            p1Tm: pos.p1.tm, p2Tm: pos.p2.tm,
            p1TmStrider: pos.p1.tm_strider ?? null, p2TmStrider: pos.p2.tm_strider ?? null,
            p1Gc: pos.p1.gc, p2Gc: pos.p2.gc
        };
        setFixedAbsCoords(restored);
        refreshFixedPrimer3Tms(restored);
        // Restore slider state so the UI inputs reflect reality
        setMoligo1Shift(pos.moligo1Shift);
        setMoligo2Shift(pos.moligo2Shift);
        setMoligo1Len(pos.moligo1Len);
        setMoligo2Len(pos.moligo2Len);
        if (onNavigateTo) {
            onNavigateTo(pos.p1AbsStart - 1, pos.p2AbsEnd - 1);
        }
    };

    const deletePosition = (id: string) => {
        if (lastDeleted) {
            clearTimeout(lastDeleted.timeoutId);
        }
        let removed: SavedPosition | null = null;
        let removedIndex = -1;
        setSavedPositions(prev => {
            removedIndex = prev.findIndex(p => p.id === id);
            removed = removedIndex >= 0 ? prev[removedIndex] : null;
            return prev.filter(p => p.id !== id);
        });
        if (removed) {
            const timeoutId = setTimeout(() => setLastDeleted(null), 5000);
            setLastDeleted({ position: removed, index: removedIndex, timeoutId });
        }
        if (editingLabelId === id) setEditingLabelId(null);
        if (compareBaseId === id) setCompareBaseId(null);
    };



    const undoDelete = () => {
        if (!lastDeleted) return;
        clearTimeout(lastDeleted.timeoutId);
        setSavedPositions(prev => {
            const next = [...prev];
            next.splice(lastDeleted.index, 0, lastDeleted.position);
            return next;
        });
        setLastDeleted(null);
    };

    const clearAllPositions = () => {
        if (lastDeleted) {
            clearTimeout(lastDeleted.timeoutId);
        }
        setLastDeleted(null);
        setSavedPositions([]);
        setEditingLabelId(null);
        setCompareBaseId(null);
        setCompareTarget(null);
    };

    const updatePositionNotes = (id: string, notes: string) => {
        setSavedPositions(prev => prev.map(p => p.id === id ? { ...p, notes } : p));
    };

    const updatePositionColor = (id: string, color: string) => {
        setSavedPositions(prev => prev.map(p => p.id === id ? { ...p, color } : p));
    };

    const filteredPositions = useMemo(() => {
        const term = positionSearch.trim().toLowerCase();
        if (!term) return savedPositions;
        const rangeMatch = term.match(/^(\d+)\s*-\s*(\d+)$/);
        if (rangeMatch) {
            const start = parseInt(rangeMatch[1], 10);
            const end = parseInt(rangeMatch[2], 10);
            return savedPositions.filter(p =>
                (p.p1AbsStart >= start && p.p1AbsStart <= end) ||
                (p.p1AbsEnd >= start && p.p1AbsEnd <= end) ||
                (p.p2AbsStart >= start && p.p2AbsStart <= end) ||
                (p.p2AbsEnd >= start && p.p2AbsEnd <= end)
            );
        }
        return savedPositions.filter(p =>
            p.label.toLowerCase().includes(term) ||
            (p.notes || '').toLowerCase().includes(term) ||
            p.p1.seq.toLowerCase().includes(term) ||
            p.p2.seq.toLowerCase().includes(term)
        );
    }, [savedPositions, positionSearch]);

    const commitLabelEdit = (id: string) => {
        if (editingLabelText.trim()) {
            setSavedPositions(prev => prev.map(p => p.id === id ? { ...p, label: editingLabelText.trim() } : p));
        }
        setEditingLabelId(null);
    };

    // Tracks which session import we've already applied, so a pending import is
    // applied exactly once and the reset effects below don't wipe it.
    const appliedImportNonceRef = useRef<number | null>(null);
    const importPending = !!importedSession && importedSession.nonce !== appliedImportNonceRef.current;

    // 1. Clear saved positions only when a totally new BLAST search comes in
    useEffect(() => {
        if (importPending) return; // an incoming session is being restored — don't wipe it
        if (data?.id) {
            setSavedPositions([]);
            setEditingLabelId(null);
            setFixedAbsCoords(null);
        }
    }, [data?.id]);

    // 2. Restart search when the active window changes (pan/zoom), UNLESS we are locked.
    // This allows the engine to find the 'best' oligo anywhere in the new frame instead of sitting in the center.
    useEffect(() => {
        if (importPending) return; // an incoming session is being restored — don't reset shifts
        if (data && !fixedAbsCoords) {
            const prev = prevDataRef.current;
            if (prev && prev.id === data.id && prev.seq !== data.seq && primers) {
                fixedContextRef.current = {
                    fullSeq: prev.fullSeq ?? prev.seq.replace(/-/g, ''),
                    gappedSeq: prev.seq,
                    start: prev.start,
                    end: prev.end,
                    offset: prev.ungappedOffset ?? 0,
                };
                setFixedAbsCoords({
                    p1AbsStart: prev.start + mapUngappedToGapped(primers.p1.start, prev.seq) + 1,
                    p1AbsEnd:   prev.start + mapUngappedToGapped(primers.p1.end,   prev.seq) + 1,
                    p2AbsStart: prev.start + mapUngappedToGapped(primers.p2.start, prev.seq) + 1,
                    p2AbsEnd:   prev.start + mapUngappedToGapped(primers.p2.end,   prev.seq) + 1,
                    p1Seq: primers.p1.seq, p2Seq: primers.p2.seq,
                    p1Tm: primers.p1.tm, p2Tm: primers.p2.tm,
                    p1TmStrider: primers.p1.tm_strider ?? null, p2TmStrider: primers.p2.tm_strider ?? null,
                    p1Gc: primers.p1.gc, p2Gc: primers.p2.gc,
                });
            } else {
                setIdtResults(null);
                setIdtAnalyzedSeqs(null);
                setIdtError(null);
                onPrimersUpdate(null);
                regionSeqContextRef.current = null;
                setRegionAnalysisActive(false);
                setMoligo1Shift(0);
                setMoligo2Shift(0);
                lastShiftsApplied.current = { s1: 0, s2: 0 };
                setIsAutoSearchNeeded(true);
            }
        }
        prevDataRef.current = data;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data?.id, data?.seq]);

    // 3. Apply a pending session import once `data` (the visible window) is available.
    // Declared after the reset effects so, in the commit where both `data` and the
    // import arrive, this runs last and wins. Locking to absolute coords means the
    // restored oligos render without a backend round-trip.
    useEffect(() => {
        if (!importedSession || !data) return;
        if (appliedImportNonceRef.current === importedSession.nonce) return;
        const s = importedSession.oligo;
        if (!s) { appliedImportNonceRef.current = importedSession.nonce; return; }
        appliedImportNonceRef.current = importedSession.nonce;

        setMoligo1Shift(s.moligo1Shift);
        setMoligo2Shift(s.moligo2Shift);
        setMoligo1Len(s.moligo1Len);
        setMoligo2Len(s.moligo2Len);
        setOligo1Name(s.oligo1Name);
        setOligo2Name(s.oligo2Name);
        if (s.searchParams) setSearchParams(s.searchParams);
        if (s.advancedParams) setAdvancedParams(s.advancedParams);
        if (s.idtAdvancedParams) setIdtAdvancedParams(s.idtAdvancedParams);
        setTagSeq(s.tagSeq);
        setFwdPrimer(s.fwdPrimer);
        setRevPrimer(s.revPrimer);
        setSavedPositions(s.savedPositions || []);
        setInteractiveFlankWindow(s.interactiveFlankWindow);
        setShowFlankingPrimers(s.showFlankingPrimers);
        lastShiftsApplied.current = { s1: s.moligo1Shift, s2: s.moligo2Shift };
        if (s.currentOligo) {
            captureFixedContext();
            setFixedAbsCoords(s.currentOligo);
            // Recalculate P3 + Strider Tm for the restored sequences (saved files may
            // predate tm_strider or carry values from different chemistry params).
            refreshFixedPrimer3Tms(s.currentOligo);
            setIsAutoSearchNeeded(false);
        } else {
            fixedContextRef.current = null;
            setFixedAbsCoords(null);
            setIsAutoSearchNeeded(true);
        }
    }, [importedSession, data, captureFixedContext]);

    // Coordinate Mapping Helper: Ungapped Index -> Gapped Index (Relative to slice)
    const mapUngappedToGapped = (ungappedIdx: number, gappedSeq: string): number => {
        if (ungappedIdx <= 0) return 0;
        let u = 0;
        for (let i = 0; i < gappedSeq.length; i++) {
            if (gappedSeq[i] !== '-') {
                if (u === ungappedIdx) return i;
                u++;
            }
        }
        return gappedSeq.length;
    };

    const mapGappedToUngapped = (gappedIdx: number, gappedSeq: string): number => {
        if (gappedIdx <= 0) return 0;
        let u = 0;
        const limit = Math.min(gappedIdx, gappedSeq.length);
        for (let i = 0; i < limit; i++) {
            if (gappedSeq[i] !== '-') u++;
        }
        return u;
    };

    const estimateTm = (seq: string): number => {
        if (!seq) return 0;
        const gc = (seq.match(/[GCgc]/g) || []).length;
        const tm = seq.length < 14
            ? (seq.length - gc) * 2 + gc * 4
            : 64.9 + 41 * (gc - 16.4) / seq.length;
        return Math.round(tm * 10) / 10;
    };

    const refreshFixedPrimer3Tms = useCallback(async (fac: FixedAbsCoords) => {
        const params = advancedParamsRef.current;
        const p1Seq = fac.p1Seq;
        const p2Seq = fac.p2Seq;
        const analyze = async (seq: string) => {
            const res = await fetch(API_BASE + '/primers/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sequence: seq,
                    mv_conc: Number(params.salt_mono),
                    dv_conc: Number(params.salt_div),
                    dntp_conc: Number(params.dntp_conc),
                    dna_conc: Number(params.dna_conc),
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Primer3 analysis failed');
            }
            return await res.json();
        };
        const [p1Data, p2Data] = await Promise.all([
            p1Seq ? analyze(p1Seq) : null,
            p2Seq ? analyze(p2Seq) : null,
        ]);
        setFixedAbsCoords(prev => {
            if (!prev) return prev;
            if (prev.p1Seq !== p1Seq || prev.p2Seq !== p2Seq) return prev;
            return {
                ...prev,
                p1Tm: p1Data ? p1Data.tm : prev.p1Tm,
                p2Tm: p2Data ? p2Data.tm : prev.p2Tm,
                p1TmStrider: p1Data ? (p1Data.tm_strider ?? null) : (prev.p1TmStrider ?? null),
                p2TmStrider: p2Data ? (p2Data.tm_strider ?? null) : (prev.p2TmStrider ?? null),
            };
        });
    }, []);

    // Snapshot of the current absolute oligo pair (for save). Mirrors pinPosition's mapping.
    const computeCurrentOligo = (): FixedAbsCoords | null => {
        if (fixedAbsCoords) return fixedAbsCoords;
        if (!primers || !data) return null;
        return {
            p1AbsStart: data.start + mapUngappedToGapped(primers.p1.start, data.seq) + 1,
            p1AbsEnd: data.start + mapUngappedToGapped(primers.p1.end, data.seq) + 1,
            p2AbsStart: data.start + mapUngappedToGapped(primers.p2.start, data.seq) + 1,
            p2AbsEnd: data.start + mapUngappedToGapped(primers.p2.end, data.seq) + 1,
            p1Seq: primers.p1.seq, p2Seq: primers.p2.seq,
            p1Tm: primers.p1.tm, p2Tm: primers.p2.tm,
            p1Gc: primers.p1.gc, p2Gc: primers.p2.gc,
        };
    };

    // Expose a pull-based snapshot so App can serialize this viewer when saving a session.
    useImperativeHandle(ref, () => ({
        getSnapshot: (): OligoSnapshot => ({
            moligo1Shift, moligo2Shift, moligo1Len, moligo2Len,
            oligo1Name, oligo2Name,
            searchParams, advancedParams, idtAdvancedParams,
            tagSeq, fwdPrimer, revPrimer,
            savedPositions,
            interactiveFlankWindow,
            showFlankingPrimers,
            currentOligo: computeCurrentOligo(),
        }),
    }));

    /* ── Region-constrained oligo search ────────────────────────── */
    const handleRegionAnalysis = async () => {
        if (!oligoRegion || !data) return;

        const relStart = Math.max(0, oligoRegion.startCol - data.start);
        const relEnd = Math.min(data.seq.length - 1, oligoRegion.endCol - data.start);
        if (relStart >= relEnd) return;

        const rawSub = data.seq.slice(relStart, relEnd + 1).replace(/-/g, '');
        if (rawSub.length < 2) return;

        const ungappedOffset = data.seq.slice(0, relStart).replace(/-/g, '').length;

        setLoading(true);
        setError('');
        try {
            const res = await fetch(((import.meta.env.VITE_API_BASE as string) || '') + '/moligize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sequence: rawSub,
                    moligo1_shift: 0,
                    moligo2_shift: 0,
                    moligo1_len: moligo1Len,
                    moligo2_len: moligo2Len,
                    auto_search: true,
                    local_optimize: true,
                    scan_full_region: true,
                    salt_mono: Number(advancedParams.salt_mono),
                    salt_div: Number(advancedParams.salt_div),
                    dntp_conc: Number(advancedParams.dntp_conc),
                    dna_conc: Number(advancedParams.dna_conc),
                    search_params: {
                        min_len: Number(searchParams.min_len),
                        max_len: Number(searchParams.max_l),
                        tm_min: Number(searchParams.tm_min),
                        tm_max: Number(searchParams.tm_max),
                        tm_diff: Number(searchParams.tm_diff),
                        gc_min: Number(searchParams.gc_min),
                        gc_max: Number(searchParams.gc_max)
                    }
                })
            });
            if (!res.ok) throw new Error(await res.text());

            const json: OligizeResponse = await res.json();

            // Store the region context BEFORE updating shifts so fetchPrimers (debounced)
            // also uses the same subsequence and doesn't overwrite with full-sequence results.
            regionSeqContextRef.current = { rawSub, ungappedOffset };
            setRegionAnalysisActive(true);

            // Offset positions into the full window coordinate space
            const p1Start = json.p1.start + ungappedOffset;
            const p1End = json.p1.end + ungappedOffset;
            const p2Start = json.p2.start + ungappedOffset;
            const p2End = json.p2.end + ungappedOffset;
            const splitIdx = json.split_idx + ungappedOffset;

            const adjusted: OligizeResponse = {
                ...json,
                p1: { ...json.p1, start: p1Start, end: p1End },
                p2: { ...json.p2, start: p2Start, end: p2End },
                split_idx: splitIdx,
            };

            setPrimers(adjusted);
            setParamsNotMet(!!json.params_not_met);
            // Sync shifts relative to the region's split so subsequent slider moves stay within the region.
            // regionSeqContextRef ensures fetchPrimers sends rawSub, making these shifts compatible.
            setMoligo1Shift(json.p1.start - json.split_idx);
            setMoligo2Shift(json.p2.end - json.split_idx);
            lastShiftsApplied.current = { s1: json.p1.start - json.split_idx, s2: json.p2.end - json.split_idx };
            setIsAutoSearchNeeded(false);
            if (json.p1.len !== moligo1Len) setMoligo1Len(json.p1.len);
            if (json.p2.len !== moligo2Len) setMoligo2Len(json.p2.len);

            onPrimersUpdate({
                p1: { start: data.start + mapUngappedToGapped(p1Start, data.seq), end: data.start + mapUngappedToGapped(p1End, data.seq) },
                p2: { start: data.start + mapUngappedToGapped(p2Start, data.seq), end: data.start + mapUngappedToGapped(p2End, data.seq) }
            });
        } catch (err: any) {
            setError(err.message || 'Region analysis failed');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        handleRegionAnalysisRef.current = handleRegionAnalysis;
    });

    useEffect(() => {
        if (!autofindRegion || !oligoRegion || !data) return;
        if (autofindRegion.startCol !== oligoRegion.startCol || autofindRegion.endCol !== oligoRegion.endCol) return;
        setFixedAbsCoords(null);
        handleRegionAnalysisRef.current();
    }, [autofindRegion, oligoRegion, data]);

    useEffect(() => {
        if (!data) {
            onPrimersUpdate(null);
            return;
        }

        const raw = data.seq.replace(/-/g, '');
        if (raw.length < 2) return;

        const fetchPrimers = async () => {
            if (fixedAbsCoords) {
                const needsRebuild =
                    fixedRebuildRef.current.data !== data ||
                    fixedRebuildRef.current.fixed !== fixedAbsCoords ||
                    fixedRebuildRef.current.searchParams !== searchParams;
                fixedRebuildRef.current = { data, fixed: fixedAbsCoords, searchParams };
                if (!needsRebuild) return;

                const fc = fixedContextRef.current;
                if (fc) {
                    const toCtx = (abs: number) => mapGappedToUngapped(abs - 1 - fc.start, fc.gappedSeq);
                    const p1Start = toCtx(fixedAbsCoords.p1AbsStart);
                    const p1End = toCtx(fixedAbsCoords.p1AbsEnd);
                    const p2Start = toCtx(fixedAbsCoords.p2AbsStart);
                    const p2End = toCtx(fixedAbsCoords.p2AbsEnd);
                    const fauxResponse: OligizeResponse = {
                        p1: { start: p1Start, end: p1End, seq: fixedAbsCoords.p1Seq, len: fixedAbsCoords.p1Seq.length, tm: fixedAbsCoords.p1Tm, tm_strider: fixedAbsCoords.p1TmStrider ?? null, gc: fixedAbsCoords.p1Gc },
                        p2: { start: p2Start, end: p2End, seq: fixedAbsCoords.p2Seq, len: fixedAbsCoords.p2Seq.length, tm: fixedAbsCoords.p2Tm, tm_strider: fixedAbsCoords.p2TmStrider ?? null, gc: fixedAbsCoords.p2Gc },
                        split_idx: 0,
                        tm_diff_ok: Math.abs(fixedAbsCoords.p1Tm - fixedAbsCoords.p2Tm) <= Number(searchParams.tm_diff),
                        params_not_met: false,
                    };
                    setPrimers(fauxResponse);
                }
                setParamsNotMet(false);
                setLoading(false);

                onPrimersUpdate({
                    p1: { start: fixedAbsCoords.p1AbsStart - 1, end: fixedAbsCoords.p1AbsEnd - 1 },
                    p2: { start: fixedAbsCoords.p2AbsStart - 1, end: fixedAbsCoords.p2AbsEnd - 1 }
                });
                return;
            }
            
            setLoading(true);
            setError('');

            try {
                const isShiftChange = moligo1Shift !== lastShiftsApplied.current.s1 || moligo2Shift !== lastShiftsApplied.current.s2;
                const localOptimize = isShiftChange || isAutoSearchNeeded;

                // Use the region subsequence when region analysis is active; this keeps
                // slider adjustments within the selected region instead of jumping to the
                // best position in the full window sequence.
                const regionCtx = regionSeqContextRef.current;
                const seqToSend = regionCtx ? regionCtx.rawSub : raw;

                const res = await fetch(((import.meta.env.VITE_API_BASE as string) || "") + '/moligize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sequence: seqToSend,
                        moligo1_shift: moligo1Shift,
                        moligo2_shift: moligo2Shift,
                        moligo1_len: moligo1Len,
                        moligo2_len: moligo2Len,
                        auto_search: isAutoSearchNeeded,
                        local_optimize: localOptimize,
                        salt_mono: Number(advancedParams.salt_mono),
                        salt_div: Number(advancedParams.salt_div),
                        dntp_conc: Number(advancedParams.dntp_conc),
                        dna_conc: Number(advancedParams.dna_conc),
                        search_params: {
                            min_len: Number(searchParams.min_len),
                            max_len: Number(searchParams.max_l),
                            tm_min: Number(searchParams.tm_min),
                            tm_max: Number(searchParams.tm_max),
                            tm_diff: Number(searchParams.tm_diff),
                            gc_min: Number(searchParams.gc_min),
                            gc_max: Number(searchParams.gc_max)
                        }
                    })
                });

                if (!res.ok) {
                    const errorText = await res.text();
                    try {
                        const errorJson = JSON.parse(errorText);
                        throw new Error(errorJson.detail || errorText);
                    } catch {
                        throw new Error(errorText);
                    }
                }
                const json: OligizeResponse = await res.json();

                // When using a region subsequence, offset all positions back into full-window space
                const offset = regionCtx ? regionCtx.ungappedOffset : 0;
                const p1StartU = json.p1.start + offset;
                const p1EndU   = json.p1.end   + offset;
                const p2StartU = json.p2.start + offset;
                const p2EndU   = json.p2.end   + offset;

                setPrimers({
                    ...json,
                    p1: { ...json.p1, start: p1StartU, end: p1EndU },
                    p2: { ...json.p2, start: p2StartU, end: p2EndU },
                    split_idx: json.split_idx + offset,
                });
                setParamsNotMet(!!json.params_not_met);

                const localOptimizeUsed = localOptimize;

                if (isAutoSearchNeeded) {
                    // Sync shifts with the auto-found positions so manual tune (+/-) stays anchored there
                    setMoligo1Shift(json.p1.start - json.split_idx);
                    setMoligo2Shift(json.p2.end - json.split_idx);
                    lastShiftsApplied.current = {
                        s1: json.p1.start - json.split_idx,
                        s2: json.p2.end - json.split_idx
                    };
                    setIsAutoSearchNeeded(false);
                } else {
                    lastShiftsApplied.current = { s1: moligo1Shift, s2: moligo2Shift };
                }

                // Sync lengths back if they were optimized by backend
                if (localOptimizeUsed) {
                    if (json.p1.len !== moligo1Len) setMoligo1Len(json.p1.len);
                    if (json.p2.len !== moligo2Len) setMoligo2Len(json.p2.len);
                }

                const p1StartGapped = mapUngappedToGapped(p1StartU, data.seq);
                const p1EndGapped   = mapUngappedToGapped(p1EndU,   data.seq);
                const p2StartGapped = mapUngappedToGapped(p2StartU, data.seq);
                const p2EndGapped   = mapUngappedToGapped(p2EndU,   data.seq);

                onPrimersUpdate({
                    p1: {
                        start: data.start + p1StartGapped,
                        end: data.start + p1EndGapped
                    },
                    p2: {
                        start: data.start + p2StartGapped,
                        end: data.start + p2EndGapped
                    }
                });

            } catch (err: any) {
                setError(err.message || 'Failed to generate oligos');
            } finally {
                setLoading(false);
            }
        };

        const debounce = setTimeout(fetchPrimers, 200);
        return () => clearTimeout(debounce);
    }, [data, moligo1Shift, moligo2Shift, searchParams, moligo1Len, moligo2Len, fixedAbsCoords, isAutoSearchNeeded]);

    // Persistence
    useEffect(() => { localStorage.setItem('moligo1_shift', String(moligo1Shift)); }, [moligo1Shift]);
    useEffect(() => { localStorage.setItem('moligo2_shift', String(moligo2Shift)); }, [moligo2Shift]);
    useEffect(() => { localStorage.setItem('moligo_1_len', String(moligo1Len)); }, [moligo1Len]);
    useEffect(() => { localStorage.setItem('moligo_2_len', String(moligo2Len)); }, [moligo2Len]);
    useEffect(() => { localStorage.setItem('oligo_search_params', JSON.stringify(searchParams)); }, [searchParams]);
    useEffect(() => { localStorage.setItem('tag_seq', tagSeq); }, [tagSeq]);
    useEffect(() => { localStorage.setItem('fwd_primer', fwdPrimer); }, [fwdPrimer]);
    useEffect(() => { localStorage.setItem('rev_primer', revPrimer); }, [revPrimer]);
    useEffect(() => { localStorage.setItem('oligo1_name', oligo1Name); }, [oligo1Name]);
    useEffect(() => { localStorage.setItem('oligo2_name', oligo2Name); }, [oligo2Name]);

    if (!data) return null;
    const rawSeq = data.seq.replace(/-/g, '');

    const handleSeqMouseDown = (e: React.MouseEvent, id: 'p1' | 'p2', type: 'move' | 'left' | 'right') => {
        e.preventDefault();
        e.stopPropagation();

        if (containerRef.current) {
            // Use a single sequence character span for accurate per-char width.
            // querySelector('span') would grab the position-label span (~6 chars wide).
            const charSpan = containerRef.current.querySelector('span[data-seq]');
            if (charSpan) {
                charWidthRef.current = charSpan.getBoundingClientRect().width || 7.2;
            }
        }

        setDragState({
            id, type, startX: e.clientX, deltaChars: 0,
            initShift1: moligo1Shift,
            initShift2: moligo2Shift,
            initLen: id === 'p1' ? moligo1Len : moligo2Len
        });
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!dragState) return;
            const deltaX = e.clientX - dragState.startX;
            const deltaChars = Math.round(deltaX / charWidthRef.current);
            setDragState(prev => prev ? { ...prev, deltaChars } : null);
        };

        const handleMouseUp = () => {
            if (dragState) {
                const D = dragState.deltaChars;
                if (D !== 0) {
                    const fc = fixedContextRef.current;
                    const off = fc ? fc.offset : offsetRef.current;
                    const fs = fc ? fc.fullSeq : fullSeqRef.current;
                    const gappedSeq = fc ? fc.gappedSeq : data.seq;
                    const absStart = fc ? fc.start : data.start;
                    const p = primersRef.current;
                    const fac = fixedAbsCoords;
                    if (fs && (p || fac)) {
                        let p1S: number, p1E: number, p2S: number, p2E: number;
                        if (fac && fc) {
                            const toCtx = (abs: number) => mapGappedToUngapped(abs - 1 - fc.start, fc.gappedSeq) + fc.offset;
                            p1S = toCtx(fac.p1AbsStart); p1E = toCtx(fac.p1AbsEnd);
                            p2S = toCtx(fac.p2AbsStart); p2E = toCtx(fac.p2AbsEnd);
                        } else if (p) {
                            p1S = p.p1.start + off; p1E = p.p1.end + off;
                            p2S = p.p2.start + off; p2E = p.p2.end + off;
                        } else {
                            setDragState(null);
                            return;
                        }
                        const { id, type } = dragState;
                        if (type === 'move') { p1S += D; p1E += D; p2S += D; p2E += D; }
                        else if (id === 'p1') {
                            if (type === 'left') p1S += D; else p1E += D;
                            if (p1E - p1S < 10) { if (type === 'left') p1S = p1E - 10; else p1E = p1S + 10; }
                            if (p1E - p1S > 60) { if (type === 'left') p1S = p1E - 60; else p1E = p1S + 60; }
                        } else {
                            if (type === 'left') p2S += D; else p2E += D;
                            if (p2E - p2S < 10) { if (type === 'left') p2S = p2E - 10; else p2E = p2S + 10; }
                            if (p2E - p2S > 60) { if (type === 'left') p2S = p2E - 60; else p2E = p2S + 60; }
                        }
                        p1S = Math.max(0, p1S); p1E = Math.min(fs.length, p1E);
                        p2S = Math.max(0, p2S); p2E = Math.min(fs.length, p2E);

                        const p1Seq = fs.substring(p1S, p1E).toUpperCase();
                        const p2Seq = fs.substring(p2S, p2E).toUpperCase();
                        const calcGcF = (s: string) => ((s.match(/[GCgc]/g) || []).length / s.length) * 100;
                        const toGappedAbs = (u: number) => absStart + mapUngappedToGapped(u - off, gappedSeq) + 1;
                        if (!fixedContextRef.current) {
                            captureFixedContext();
                        }
                        const prevFac = fac || fixedAbsCoords;
                        const next: FixedAbsCoords = {
                            p1AbsStart: toGappedAbs(p1S), p1AbsEnd: toGappedAbs(p1E),
                            p2AbsStart: toGappedAbs(p2S), p2AbsEnd: toGappedAbs(p2E),
                            p1Seq, p2Seq,
                            p1Tm: p1Seq === prevFac?.p1Seq ? (prevFac?.p1Tm ?? estimateTm(p1Seq)) : estimateTm(p1Seq),
                            p2Tm: p2Seq === prevFac?.p2Seq ? (prevFac?.p2Tm ?? estimateTm(p2Seq)) : estimateTm(p2Seq),
                            p1TmStrider: p1Seq === prevFac?.p1Seq ? (prevFac?.p1TmStrider ?? null) : null,
                            p2TmStrider: p2Seq === prevFac?.p2Seq ? (prevFac?.p2TmStrider ?? null) : null,
                            p1Gc: calcGcF(p1Seq), p2Gc: calcGcF(p2Seq),
                        };
                        setFixedAbsCoords(next);
                        refreshFixedPrimer3Tms(next);
                    }
                }
            }
            setDragState(null);
        };

        if (dragState) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [dragState]);

    // Stable refs so drag-commit closure always sees current values
    const primersRef = useRef(primers);
    useEffect(() => { primersRef.current = primers; }, [primers]);
    const offsetRef = useRef(data.ungappedOffset ?? 0);
    const fullSeqRef = useRef(data.fullSeq ?? rawSeq);
    useEffect(() => {
        offsetRef.current = data.ungappedOffset ?? 0;
        fullSeqRef.current = data.fullSeq ?? rawSeq;
    }, [data]);

    // Compute live coordinates (including during drag)
    const offset = data.ungappedOffset ?? 0;
    const fullSeq = data.fullSeq ?? rawSeq;

    let liveP1Start = primers ? primers.p1.start + offset : -1;
    let liveP1End   = primers ? primers.p1.end   + offset : -1;
    let liveP2Start = primers ? primers.p2.start + offset : -1;
    let liveP2End   = primers ? primers.p2.end   + offset : -1;

    if (fixedAbsCoords && fixedContextRef.current) {
        const fc = fixedContextRef.current;
        const toCtxUngapped = (abs: number) => mapGappedToUngapped(abs - 1 - fc.start, fc.gappedSeq) + fc.offset;
        liveP1Start = toCtxUngapped(fixedAbsCoords.p1AbsStart);
        liveP1End   = toCtxUngapped(fixedAbsCoords.p1AbsEnd);
        liveP2Start = toCtxUngapped(fixedAbsCoords.p2AbsStart);
        liveP2End   = toCtxUngapped(fixedAbsCoords.p2AbsEnd);
    }

    if (primers && dragState) {
        const D = dragState.deltaChars;
        if (dragState.type === 'move') {
            liveP1Start += D; liveP1End += D;
            liveP2Start += D; liveP2End += D;
        } else if (dragState.id === 'p1') {
            if (dragState.type === 'left') { liveP1Start += D; }
            else if (dragState.type === 'right') { liveP1End += D; }
            if (liveP1End - liveP1Start < 10) { if (dragState.type === 'left') liveP1Start = liveP1End - 10; else liveP1End = liveP1Start + 10; }
            if (liveP1End - liveP1Start > 60) { if (dragState.type === 'left') liveP1Start = liveP1End - 60; else liveP1End = liveP1Start + 60; }
        } else {
            if (dragState.type === 'left') { liveP2Start += D; }
            else if (dragState.type === 'right') { liveP2End += D; }
            if (liveP2End - liveP2Start < 10) { if (dragState.type === 'left') liveP2Start = liveP2End - 10; else liveP2End = liveP2Start + 10; }
            if (liveP2End - liveP2Start > 60) { if (dragState.type === 'left') liveP2Start = liveP2End - 60; else liveP2End = liveP2Start + 60; }
        }
    }

    const handleFlankingPrimersUpdate = useCallback((data: {
        fwd: { start: number; end: number } | null;
        rev: { start: number; end: number } | null;
        fwdName?: string;
        revName?: string;
        fwdSeq?: string;
        revSeq?: string;
        amplicon?: number;
    } | null) => {
        setFlankingPrimersData(data);
        onFlankingPrimersUpdate?.(data);
    }, [onFlankingPrimersUpdate]);

    const buildCompleteReport = (): CompleteReportData => {
        const extractBestTm = (raw?: Record<string, unknown> | Record<string, unknown>[]): number | undefined => {
            if (!raw) return undefined;
            const keys = ['IDT_Tm', 'Tm', 'MeltingTemperature', 'MeltTemp', 'tm', 'meltingTemperature', 'meltTemp'];
            const fromObj = (obj: Record<string, unknown>): number | undefined => {
                for (const k of keys) {
                    if (obj[k] !== undefined && obj[k] !== null) return obj[k] as number;
                }
                return undefined;
            };
            if (Array.isArray(raw)) {
                for (const item of raw) {
                    if (item && typeof item === 'object') {
                        const tm = fromObj(item as Record<string, unknown>);
                        if (tm !== undefined) return tm;
                    }
                }
            } else if (typeof raw === 'object') {
                return fromObj(raw);
            }
            return undefined;
        };

        const buildContextMap = (): CompleteReportData['contextMap'] => {
            const regions: { start: number; end: number; label: string; color: string; textColor?: string }[] = [];

            if (liveP1Start >= 0 && liveP1End > liveP1Start) {
                regions.push({ start: liveP1Start, end: liveP1End, label: 'MOLigo 1', color: '#10b981', textColor: '#064e3b' });
            }
            if (liveP2Start >= 0 && liveP2End > liveP2Start) {
                regions.push({ start: liveP2Start, end: liveP2End, label: 'MOLigo 2', color: '#f59e0b', textColor: '#78350f' });
            }

            const findPos = (seq: string, subseq: string): number => {
                if (!seq || !subseq) return -1;
                return seq.toUpperCase().indexOf(subseq.toUpperCase());
            };

            if (flankingPrimersData?.fwdSeq) {
                const pos = findPos(fullSeq, flankingPrimersData.fwdSeq);
                if (pos >= 0) {
                    regions.push({ start: pos, end: pos + flankingPrimersData.fwdSeq.length, label: 'Flanking Fwd', color: '#3b82f6', textColor: '#1e3a8a' });
                }
            }
            if (flankingPrimersData?.revSeq) {
                const bindingSeq = reverseComplement(flankingPrimersData.revSeq);
                const pos = findPos(fullSeq, bindingSeq);
                if (pos >= 0) {
                    regions.push({ start: pos, end: pos + bindingSeq.length, label: 'Flanking Rev', color: '#c084fc', textColor: '#581c87' });
                }
            }

            if (fwdPrimer) {
                const bindingSeq = reverseComplement(fwdPrimer);
                const pos = findPos(fullSeq, bindingSeq);
                if (pos >= 0) {
                    regions.push({ start: pos, end: pos + bindingSeq.length, label: 'Fwd Primer Binding', color: '#f472b6', textColor: '#831843' });
                }
            }
            if (revPrimer) {
                const pos = findPos(fullSeq, revPrimer);
                if (pos >= 0) {
                    regions.push({ start: pos, end: pos + revPrimer.length, label: 'Rev Primer Binding', color: '#a855f7', textColor: '#581c87' });
                }
            }

            if (regions.length === 0) return undefined;

            const minStart = Math.min(...regions.map(r => r.start));
            const maxEnd = Math.max(...regions.map(r => r.end));
            const flank = Math.max(20, Math.min(interactiveFlankWindow, 200));
            const windowStart = Math.max(0, minStart - flank);
            const windowEnd = Math.min(fullSeq.length, maxEnd + flank);

            return {
                sequence: fullSeq.substring(windowStart, windowEnd),
                absStart: windowStart + 1,
                regions: regions.map(r => ({
                    start: r.start - windowStart,
                    end: r.end - windowStart,
                    label: r.label,
                    color: r.color,
                    textColor: r.textColor,
                })),
            };
        };

        const tagEntry = tagSeq ? TAG_DATABASE.find(t => t.antiTag.toUpperCase() === tagSeq.toUpperCase()) : undefined;

        const fps = flankingPanelState;
        const sf = fps?.selFwd;
        const sr = fps?.selRev;

        const indivAnalyzeOf = (seq: string | undefined): { IDT_Tm?: number; Tm?: number } | { IDT_Tm?: number; Tm?: number }[] | undefined => {
            const entry = seq ? fps?.idtResultsIndiv?.[seq] : undefined;
            if (!entry || typeof entry !== 'object') return undefined;
            const analyze = (entry as { analyze?: unknown }).analyze;
            if (!analyze || typeof analyze !== 'object') return undefined;
            return analyze as { IDT_Tm?: number; Tm?: number } | { IDT_Tm?: number; Tm?: number }[];
        };

        const flankingFwdSeq = flankingPrimersData?.fwdSeq ?? sf?.sequence;
        const flankingFwdName = flankingPrimersData?.fwdName ?? fps?.fwdName ?? sf?.name;
        const flankingRevSeq = flankingPrimersData?.revSeq ?? sr?.sequence;
        const flankingRevName = flankingPrimersData?.revName ?? fps?.revName ?? sr?.name;

        return {
            jobName,
            queryId: data.id,
            genbankHeader: genbankHeader && genbankHeader.trim() ? genbankHeader : undefined,
            targetSeq: fullSeq,
            targetStart: data.start,
            targetEnd: data.end,
            searchParams,
            advancedParams,
            idtAdvancedParams,
            moligo1Name: oligo1Name,
            moligo1Seq: primers?.p1.seq ?? '',
            moligo1Shift,
            moligo1Len,
            moligo2Name: oligo2Name,
            moligo2Seq: primers?.p2.seq ?? '',
            moligo2Shift,
            moligo2Len,
            tagSeq,
            tagReg: tagEntry?.reg,
            tagPartNumber: tagEntry?.partNumber,
            fwdPrimer,
            revPrimer,
            idtM1Hairpin: idtResults?.m1?.hairpin,
            idtM1SelfDimer: idtResults?.m1?.self_dimer,
            idtM1Analyze: idtResults?.m1?.analyze,
            moligo1TmP3: primers?.p1?.tm,
            moligo1TmStrider: primers?.p1?.tm_strider ?? null,
            idtM1Tm: extractBestTm(idtResults?.m1?.analyze),
            idtM2Hairpin: idtResults?.m2?.hairpin,
            idtM2SelfDimer: idtResults?.m2?.self_dimer,
            idtM2Analyze: idtResults?.m2?.analyze,
            moligo2TmP3: primers?.p2?.tm,
            moligo2TmStrider: primers?.p2?.tm_strider ?? null,
            idtM2Tm: extractBestTm(idtResults?.m2?.analyze),
            idtPairwise: idtResults?.pairwise,
            savedPositions,
            flankingFwdName,
            flankingFwdSeq,
            flankingFwdLen: flankingFwdSeq?.length,
            flankingFwdGc: flankingFwdSeq ? ((flankingFwdSeq.match(/[GCgc]/g) || []).length / flankingFwdSeq.length) * 100 : undefined,
            flankingRevName,
            flankingRevSeq,
            flankingRevLen: flankingRevSeq?.length,
            flankingRevGc: flankingRevSeq ? ((flankingRevSeq.match(/[GCgc]/g) || []).length / flankingRevSeq.length) * 100 : undefined,
            ampliconLength: flankingPrimersData?.amplicon ?? (sf?.interval && sr?.interval && sr.interval[1] > sf.interval[0] ? sr.interval[1] - sf.interval[0] : undefined),
            flankingFwdTmP3: sf?.tm,
            flankingFwdTmStrider: sf?.tm_strider,
            flankingFwdIDTTm: extractBestTm(indivAnalyzeOf(sf?.sequence)),
            flankingFwdHairpinDg: sf?.hairpin?.dg,
            flankingFwdHairpinTm: sf?.hairpin?.tm,
            flankingFwdHomodimerDg: sf?.homodimer?.dg,
            flankingFwdHomodimerTm: sf?.homodimer?.tm,
            flankingRevTmP3: sr?.tm,
            flankingRevTmStrider: sr?.tm_strider,
            flankingRevIDTTm: extractBestTm(indivAnalyzeOf(sr?.sequence)),
            flankingRevHairpinDg: sr?.hairpin?.dg,
            flankingRevHairpinTm: sr?.hairpin?.tm,
            flankingRevHomodimerDg: sr?.homodimer?.dg,
            flankingRevHomodimerTm: sr?.homodimer?.tm,
            flankingHetDg: fps?.result?.pair_metrics?.heterodimer?.dg,
            flankingHetTm: fps?.result?.pair_metrics?.heterodimer?.tm,
            contextMap: buildContextMap(),
        };
    };

    const validateHeader = (): boolean => {
        if (genbankHeader && genbankHeader.trim()) {
            setHeaderError(null);
            return true;
        }
        setHeaderError('Please enter a header (paste the GenBank header or a >FASTA header line).');
        return false;
    };

    const handleDownloadTxt = () => {
        if (!validateHeader()) return;
        const reportData = buildCompleteReport();
        const content = buildCompleteReportTxt(reportData);
        const filename = `Oligool_Report_${(jobName || 'design').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.txt`;
        downloadTxt(content, filename);
    };

    const handlePrintPdf = () => {
        if (!validateHeader()) return;
        buildCompleteReport();
        setTimeout(() => window.print(), 300);
    };

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && showReportDialog) {
                setShowReportDialog(false);
            }
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [showReportDialog]);

    const renderSequence = () => {
        const renderOffset = fixedAbsCoords && fixedContextRef.current ? fixedContextRef.current.offset : offset;
        const renderFullSeq = fixedAbsCoords && fixedContextRef.current ? fixedContextRef.current.fullSeq : fullSeq;
        const minStart = primers ? Math.min(liveP1Start, liveP2Start) : renderOffset;
        const maxEnd   = primers ? Math.max(liveP1End, liveP2End)     : renderOffset + rawSeq.length;

        const viewStart = Math.max(0, minStart - interactiveFlankWindow);
        const viewEnd   = Math.min(renderFullSeq.length, maxEnd + interactiveFlankWindow);

        const slice = renderFullSeq.substring(viewStart, viewEnd);
        const lines: string[] = [];
        for (let i = 0; i < slice.length; i += seqLineLength) {
            lines.push(slice.slice(i, i + seqLineLength));
        }

        return (
            <div ref={containerRef} className="font-mono text-xs leading-relaxed space-y-1" style={{ cursor: dragState ? 'grabbing' : 'auto' }}>
                {lines.map((lineStr, lineIdx) => {
                    const lineAbsStart = viewStart + lineIdx * seqLineLength;
                    const posStr = String(lineAbsStart + 1).padStart(6, ' '); // 1-indexed
                    return (
                        <div key={lineIdx} className="flex">
                            <span className="text-slate-400 dark:text-slate-500 mr-3 select-none whitespace-pre flex-shrink-0">{posStr}</span>
                            <span className="whitespace-pre">
                                {lineStr.split('').map((char, charIdx) => {
                                    const i = lineAbsStart + charIdx;
                                    let className = 'text-slate-600 dark:text-slate-400';
                                    let handlers: any = {};

                                    const isP1 = primers && i >= liveP1Start && i < liveP1End;
                                    const isP2 = primers && i >= liveP2Start && i < liveP2End;
                                    const isP1Start = i === liveP1Start;
                                    const isP1End   = i === liveP1End - 1;
                                    const isP2Start = i === liveP2Start;
                                    const isP2End   = i === liveP2End - 1;

                                    if (isP1) {
                                        className = `bg-green-200 dark:bg-green-900/40 text-green-900 dark:text-green-300 font-bold hover:bg-green-300 dark:hover:bg-green-800/60 select-none ${isP1Start || isP1End ? 'cursor-ew-resize' : 'cursor-grab active:cursor-grabbing'}`;
                                        if (isP1Start) handlers = { onMouseDown: (e: React.MouseEvent) => handleSeqMouseDown(e, 'p1', 'left') };
                                        else if (isP1End) handlers = { onMouseDown: (e: React.MouseEvent) => handleSeqMouseDown(e, 'p1', 'right') };
                                        else handlers = { onMouseDown: (e: React.MouseEvent) => handleSeqMouseDown(e, 'p1', 'move') };
                                    } else if (isP2) {
                                        className = `bg-amber-200 dark:bg-amber-900/40 text-amber-900 dark:text-amber-300 font-bold hover:bg-amber-300 dark:hover:bg-amber-800/60 select-none ${isP2Start || isP2End ? 'cursor-ew-resize' : 'cursor-grab active:cursor-grabbing'}`;
                                        if (isP2Start) handlers = { onMouseDown: (e: React.MouseEvent) => handleSeqMouseDown(e, 'p2', 'left') };
                                        else if (isP2End) handlers = { onMouseDown: (e: React.MouseEvent) => handleSeqMouseDown(e, 'p2', 'right') };
                                        else handlers = { onMouseDown: (e: React.MouseEvent) => handleSeqMouseDown(e, 'p2', 'move') };
                                    }

                                    return <span key={i} data-seq className={className} {...handlers}>{char}</span>;
                                })}
                            </span>
                        </div>
                    );
                })}
            </div>
        );
    };

    const runIdtAnalysis = async () => {
        if (!idtCredentials || !primers) return;

        const p1 = primers.p1.seq.trim();
        const p2 = primers.p2.seq.trim();

        if (!p1 || p1.length < 10) {
            setIdtError(`Oligo 1 sequence is too short or empty to analyze (sent: "${p1}"). Ensure the oligo is at least 10 nt.`);
            return;
        }
        if (!p2 || p2.length < 10) {
            setIdtError(`Oligo 2 sequence is too short or empty to analyze (sent: "${p2}"). Ensure the oligo is at least 10 nt.`);
            return;
        }

        setIsIdtLoading(true);
        setIdtError(null);
        try {
            const tRes = await fetch(((import.meta.env.VITE_API_BASE as string) || "") + '/idt/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: idtCredentials.clientId,
                    client_secret: idtCredentials.clientSecret,
                    username: idtCredentials.username,
                    password: idtCredentials.password,
                    idt_region: idtCredentials.region || 'eu'
                })
            });
            if (!tRes.ok) {
                const errorData = await tRes.json();
                throw new Error(errorData.detail || "IDT Auth Failed");
            }
            const { access_token } = await tRes.json();

            const payload = {
                p1_seq: p1,
                p2_seq: p2,
                token: access_token,
                mg_conc: Number(idtAdvancedParams.mg_conc),
                mv_conc: Number(idtAdvancedParams.mv_conc),
                dntp_conc: Number(idtAdvancedParams.dntp_conc),
                oligo_conc: Number(idtAdvancedParams.oligo_conc),
                idt_region: idtCredentials.region || 'eu'
            };

            const aRes = await fetch(((import.meta.env.VITE_API_BASE as string) || "") + '/idt/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!aRes.ok) {
                let detail = `IDT Analysis Failed (${aRes.status})`;
                try {
                    const errJson = await aRes.json();
                    // IDT returns { Message: "..." } on 400 errors
                    const msg: string = errJson.Message || errJson.detail || errJson.message || JSON.stringify(errJson);
                    // Strip the internal stack trace — only keep up to the first newline
                    detail = `IDT ${aRes.status}: ${msg.split('\r\n')[0].split('\n')[0]}`;
                } catch { /* response wasn't JSON */ }
                throw new Error(`${detail}\n\nSent — Oligo 1: ${p1}\nOligo 2: ${p2}`);
            }

            const results = await aRes.json();
            setIdtResults(results);
            setIdtAnalyzedSeqs({ p1, p2 });
        } catch (err: any) {
            setIdtError(err.message);
        } finally {
            setIsIdtLoading(false);
        }
    };


    const getIdtStatusColor = (dg: number | undefined) => {
        if (dg === undefined) return 'text-slate-400';
        if (dg < -9) return 'text-red-500 font-bold';
        if (dg < -6) return 'text-amber-500 font-bold';
        return 'text-emerald-500 font-bold';
    };



    const buildDimerAscii = (raw: any, seq1?: string, seq2?: string) => {
        if (!raw || !raw.Bonds || !seq1) return undefined;

        const topPad = raw.TopLinePadding || 0;
        const botPad = raw.BottomLinePadding || 0;
        const bondPad = raw.BondLinePadding || 0;
        const bonds = raw.Bonds || [];

        const topStr = "5' " + " ".repeat(topPad) + seq1 + " 3'";
        const isHetero = seq2 !== undefined;
        const botSeqObj = isHetero ? seq2! : seq1;
        const botSeq = botSeqObj.split('').reverse().join('');
        const botStr = "3' " + " ".repeat(botPad) + botSeq + " 5'";

        let bLine = "";
        for (const b of bonds) {
            if (b === 2) bLine += "|";
            else if (b === 1) bLine += ":";
            else bLine += " ";
        }
        const bondStr = "   " + " ".repeat(bondPad) + bLine;

        return [topStr, bondStr, botStr].join('\n');
    };

    const renderIdtCard = (title: string, data: any, seq1?: string, seq2?: string) => {
        if (!data || data.error) return <div className="text-sm text-red-400">{data?.error || 'N/A'}</div>;

        // Extract DG and Visual from the structure { DeltaG, all_DeltaG, raw }
        let dg = data.DeltaG;
        let raw = data.raw;

        // Render individual items (hairpins, dimers, etc.)
        const renderItem = (item: any, seq: string | undefined, idx: number, itemDg?: number, itemLocalDg?: number, itemIdtTmVal?: number, itemLocalTmVal?: number) => {
            let asciiStructure: string | undefined = undefined;
            let hairpinDotBracket: string | undefined = undefined;
            let hairpinSeq: string | undefined = undefined;
            let isDimer = false;

            if (item) {
                // If the sequence or dotbracket contains '&', it's a dimer
                const db = item.DotBracket || '';
                let fullSeq = item.Sequence;
                if (!fullSeq && db.includes('&')) {
                    // Construct dimer sequence if missing from IDT response
                    fullSeq = (seq1 || '') + '&' + (seq2 || seq1 || '');
                } else if (!fullSeq) {
                    fullSeq = seq || '';
                }
                
                isDimer = fullSeq.includes('&') || db.includes('&');

                if (item.DotBracket && !isDimer) {
                    hairpinDotBracket = item.DotBracket;
                    hairpinSeq = fullSeq;
                } else if (isDimer && seq) {
                    if (item.Bonds) {
                        asciiStructure = buildDimerAscii(item, seq, seq2);
                    } else if (item.DotBracket) {
                        const dimerSeq = seq2 ? `${seq}&${seq2}` : `${seq}&${seq}`;
                        asciiStructure = dimerAsciiFromItem(dimerSeq, item.DotBracket);
                    }
                }
            }

            return (
                <div key={idx} className="border-t border-slate-200 dark:border-slate-700 pt-2 mt-2 first:mt-0 first:border-0 first:pt-0">
                    <div className="flex flex-col gap-1 text-[10px] text-slate-400 mb-1">
                        <div className="flex justify-between items-center">
                            <span className="font-semibold">{title} {idx + 1}:</span>
                            <div className="flex gap-3">
                                {itemDg !== undefined && itemDg !== null && (
                                    <span>IDT ΔG: <span className={getIdtStatusColor(itemDg)}>{itemDg.toFixed(2)}</span></span>
                                )}
                                {itemLocalDg !== undefined && itemLocalDg !== null && (
                                    <span>Strider ΔG: <span className={itemLocalDg <= 0 ? "text-amber-500 dark:text-amber-400 font-medium" : "text-slate-400 dark:text-slate-500 font-medium"}>{itemLocalDg > 0 ? '+' : ''}{itemLocalDg.toFixed(2)}</span></span>
                                )}
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 text-[9px] opacity-80">
                            {itemIdtTmVal !== undefined && itemIdtTmVal !== null && (
                                <span>IDT Tm: <span className="text-slate-500 dark:text-slate-400 font-medium">{Number(itemIdtTmVal).toFixed(1)}°C</span></span>
                            )}
                            {itemLocalTmVal !== undefined && itemLocalTmVal !== null && (
                                <span>Local Tm: <span className="text-slate-500 dark:text-slate-400 font-medium">{Number(itemLocalTmVal).toFixed(1)}°C</span></span>
                            )}
                        </div>
                    </div>
                    {hairpinDotBracket && hairpinSeq && (
                        <div className="mt-1 w-full overflow-x-auto bg-slate-100 dark:bg-slate-800 rounded p-2">
                            {isDimer ? (
                                <DimerSVG seq={hairpinSeq} dotBracket={hairpinDotBracket} />
                            ) : (
                                <HairpinSVG seq={hairpinSeq} dotBracket={hairpinDotBracket} />
                            )}
                        </div>
                    )}
                    {hairpinDotBracket && (!hairpinSeq || hairpinSeq.length === 0) && (
                        <div className="mt-1 text-[10px] text-slate-400 italic">Structure found but sequence unavailable for SVG</div>
                    )}
                    {asciiStructure && !hairpinDotBracket && (
                        <div className="mt-1 w-full overflow-x-auto overflow-y-auto max-h-32 bg-slate-100 dark:bg-slate-800 rounded p-2 text-[10px] sm:text-xs">
                            <pre className="font-mono text-slate-700 dark:text-slate-300 whitespace-pre leading-[1.15] tracking-tighter">
                                {asciiStructure}
                            </pre>
                        </div>
                    )}
                    {!hairpinDotBracket && !asciiStructure && (
                        <div className="mt-1 text-[10px] text-slate-400 italic">No secondary structure predicted</div>
                    )}
                </div>
            );
        };

        // Check if raw is an array of multiple items
        const items: React.ReactNode[] = [];
        if (Array.isArray(raw) && raw.length > 0) {
            const allDgs = data.all_DeltaG || [];
            const allLocalDgs = data.all_Local_DeltaG || [];
            const allIdtTms = data.all_IDT_Tm || [];
            const allLocalTms = data.all_Local_Tm || [];
            raw.forEach((item: any, idx: number) => {
                items.push(renderItem(item, seq1, idx, allDgs[idx], allLocalDgs[idx], allIdtTms[idx], allLocalTms[idx]));
            });
        } else if (raw) {
            items.push(renderItem(raw, seq1, 0, data.DeltaG, raw.Local_DeltaG, raw.IDT_Tm, raw.Local_Tm));
        }

        return (
            <div className="flex flex-col gap-1 mb-2">
                <div className="flex justify-between items-center text-sm font-medium border-b border-slate-200 dark:border-slate-700 pb-1 mb-1">
                    <span className="text-slate-600 dark:text-slate-300">Summary {title}:</span>
                    <span className={getIdtStatusColor(dg)}>{dg !== undefined && dg !== null ? `${dg.toFixed(2)} kcal/mol` : 'N/A'}</span>
                </div>
                {items}
            </div>
        );
    };

    const extractTm = (analyzeData: any) => {
        if (!analyzeData || analyzeData.error) return null;

        const getTmFromObj = (obj: any) => {
            if (obj === null || typeof obj !== 'object') return null;
            return obj.Tm !== undefined ? obj.Tm
                : obj.MeltingTemperature !== undefined ? obj.MeltingTemperature
                    : obj.MeltTemp !== undefined ? obj.MeltTemp
                        : obj.tm !== undefined ? obj.tm
                            : obj.meltingTemperature !== undefined ? obj.meltingTemperature
                                : obj.meltTemp !== undefined ? obj.meltTemp
                                    : null;
        };

        // Analyze returns an array usually, or a dict. Try to find Tm
        if (Array.isArray(analyzeData) && analyzeData.length > 0) {
            return getTmFromObj(analyzeData[0]);
        }
        return getTmFromObj(analyzeData);
    };

    return (
        <>
        <div className="mt-6 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden bg-white dark:bg-slate-800 transition-all">
            <div className="px-5 py-3 bg-gradient-to-r from-slate-50 to-indigo-50/50 dark:from-slate-800 dark:to-indigo-900/20 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                        Oligo provenance: <span className="font-mono text-indigo-600 dark:text-indigo-400">{jobName}</span>
                    </h2>
                    <span className="text-sm text-slate-500 dark:text-slate-400">
                        (bp {data.start + 1}–{data.end + 1}, len {rawSeq.length})
                    </span>
                    {oligoRegion && (
                        <button
                            onClick={() => {
                                if (regionAnalysisActive) {
                                    regionSeqContextRef.current = null;
                                    setRegionAnalysisActive(false);
                                    setIsAutoSearchNeeded(true);
                                } else {
                                    handleRegionAnalysis();
                                }
                            }}
                            disabled={loading && !regionAnalysisActive}
                            className={`ml-2 px-3 py-1 text-xs font-bold rounded-full border transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm ${regionAnalysisActive
                                ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600 ring-2 ring-amber-200 dark:ring-amber-800'
                                : 'bg-white dark:bg-slate-700 text-amber-500 dark:text-amber-400 border-amber-300 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:border-amber-500'
                            }`}
                            title={regionAnalysisActive
                                ? `Region active (cols ${oligoRegion.startCol + 1}–${oligoRegion.endCol + 1}) — click to deactivate`
                                : `Search oligos only within MSA columns ${oligoRegion.startCol + 1}–${oligoRegion.endCol + 1}`}
                        >
                            🎯 Region analysis
                        </button>
                    )}
                    {primers && (
                        <>
                            <button
                                id="btn-pin-position"
                                onClick={pinPosition}
                                title="Save current oligo positions as a bookmark"
                                className={`ml-1 flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-full border transition-all duration-300 ${pinPulse
                                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-300/40 dark:shadow-indigo-900/40 scale-105'
                                        : 'bg-white dark:bg-slate-700 text-indigo-500 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'
                                    }`}
                            >
                                <svg className="w-3.5 h-3.5" fill={pinPulse ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                                </svg>
                                {pinPulse ? 'Saved!' : 'Pin Position'}
                            </button>
                            <button
                                id="btn-fix-position"
                                onClick={toggleFixPosition}
                                title={!!fixedAbsCoords ? 'Click to unlock oligo and run a new search' : 'Click to lock oligo in its current position'}
                                className={`ml-1 flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-full border transition-all duration-200 ${!!fixedAbsCoords
                                        ? 'bg-amber-500 border-amber-500 text-white shadow-md shadow-amber-200/50 dark:shadow-amber-900/30 ring-2 ring-amber-100 dark:ring-amber-900/30'
                                        : 'bg-white dark:bg-slate-700 text-amber-500 dark:text-amber-400 border-amber-200 dark:border-amber-800 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                                    }`}
                            >
                                {!!fixedAbsCoords ? (
                                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                                        <path fillRule="evenodd" d="M12 1a4 4 0 00-4 4v3H6a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2v-9a2 2 0 00-2-2h-2V5a4 4 0 00-4-4zm2 7V5a2 2 0 10-4 0v3h4z" clipRule="evenodd" />
                                    </svg>
                                ) : (
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                                    </svg>
                                )}
                                {!!fixedAbsCoords ? '🔒 Unfix' : 'Fix Position'}
                            </button>
                            <button
                                onClick={() => {
                                    setFixedAbsCoords(null);
                                    setIsAutoSearchNeeded(true);
                                }}
                                title="Recalculate best oligo with current parameters"
                                className="ml-1 flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-full border transition-all bg-white dark:bg-slate-700 text-sky-500 dark:text-sky-400 border-sky-200 dark:border-sky-800 hover:border-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20"
                            >
                                ↻ Recalculate
                            </button>
                        </>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    {copyFeedback && (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium animate-pulse">{copyFeedback}</span>
                    )}
                    <button
                        onClick={() => handleCopy(rawSeq)}
                        className="px-3 py-1.5 text-xs font-medium rounded-md border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 bg-white dark:bg-slate-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                    >
                        Copy DNA
                    </button>
                </div>
            </div>

            <div className="p-0">
                <div className="bg-purple-50/50 dark:bg-purple-900/5 border-b border-purple-100 dark:border-purple-900/20 p-4 font-sans relative">
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Oligo Selection Parameters</h3>
                        <button
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 uppercase tracking-wider flex items-center gap-1"
                        >
                            {showAdvanced ? 'Hide Advanced' : 'Show Advanced'}
                            <span>{showAdvanced ? '▴' : '▾'}</span>
                        </button>
                    </div>
                    <div className="mb-4 p-3 bg-white dark:bg-slate-800 rounded-lg border border-indigo-100 dark:border-indigo-900/30 shadow-sm grid grid-cols-2 lg:grid-cols-7 gap-3">
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Min Len</label>
                            <input
                                type="number"
                                value={searchParams.min_len || 15}
                                onChange={e => setSearchParams({ ...searchParams, min_len: parseInt(e.target.value) })}
                                className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-900"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Max Len</label>
                            <input
                                type="number"
                                value={searchParams.max_l || 35}
                                onChange={e => setSearchParams({ ...searchParams, max_l: parseInt(e.target.value) })}
                                className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-900"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Tm Min</label>
                            <input
                                type="number"
                                step="0.1"
                                value={searchParams.tm_min || 60.0}
                                onChange={e => setSearchParams({ ...searchParams, tm_min: parseFloat(e.target.value) })}
                                className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-900"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Tm Max</label>
                            <input
                                type="number"
                                step="0.1"
                                value={searchParams.tm_max || 63.0}
                                onChange={e => setSearchParams({ ...searchParams, tm_max: parseFloat(e.target.value) })}
                                className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-900"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Tm Diff</label>
                            <input
                                type="number"
                                step="0.1"
                                value={searchParams.tm_diff || 1.5}
                                onChange={e => setSearchParams({ ...searchParams, tm_diff: parseFloat(e.target.value) })}
                                className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-900"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">GC Min</label>
                            <input
                                type="number"
                                value={searchParams.gc_min || 30}
                                onChange={e => setSearchParams({ ...searchParams, gc_min: parseInt(e.target.value) })}
                                className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-900"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-slate-400 uppercase">GC Max</label>
                            <input
                                type="number"
                                value={searchParams.gc_max || 80}
                                onChange={e => setSearchParams({ ...searchParams, gc_max: parseInt(e.target.value) })}
                                className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-900"
                            />
                        </div>
                    </div>

                    {showAdvanced && (
                        <div className="mb-4 p-4 bg-indigo-50/10 dark:bg-indigo-900/10 rounded-xl border border-indigo-100 dark:border-indigo-900/20 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Section 1: Local / Primer3 */}
                                <div>
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="w-1.5 h-4 bg-indigo-500 rounded-full"></div>
                                        <h3 className="text-xs font-bold text-indigo-500 uppercase tracking-wider">Local (Primer3 / Thermo)</h3>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-3">
                                        <div className="flex flex-col gap-1">
                                            <label className="text-[10px] font-bold text-indigo-400/80 uppercase">Na+ (mM)</label>
                                            <input
                                                type="number" step="0.1"
                                                value={advancedParams.salt_mono}
                                                onChange={e => {
                                                    const next = { ...advancedParams, salt_mono: parseFloat(e.target.value) };
                                                    setAdvancedParams(next);
                                                    localStorage.setItem('oligo_advanced_params', JSON.stringify(next));
                                                }}
                                                className="px-2 py-1 text-xs border border-indigo-100/50 dark:border-indigo-900/50 rounded bg-white dark:bg-slate-900"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <label className="text-[10px] font-bold text-indigo-400/80 uppercase">Mg²⁺ (mM)</label>
                                            <input
                                                type="number" step="0.1"
                                                value={advancedParams.salt_div}
                                                onChange={e => {
                                                    const next = { ...advancedParams, salt_div: parseFloat(e.target.value) };
                                                    setAdvancedParams(next);
                                                    localStorage.setItem('oligo_advanced_params', JSON.stringify(next));
                                                }}
                                                className="px-2 py-1 text-xs border border-indigo-100/50 dark:border-indigo-900/50 rounded bg-white dark:bg-slate-900"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <label className="text-[10px] font-bold text-indigo-400/80 uppercase">dNTP (mM)</label>
                                            <input
                                                type="number" step="0.1"
                                                value={advancedParams.dntp_conc}
                                                onChange={e => {
                                                    const next = { ...advancedParams, dntp_conc: parseFloat(e.target.value) };
                                                    setAdvancedParams(next);
                                                    localStorage.setItem('oligo_advanced_params', JSON.stringify(next));
                                                }}
                                                className="px-2 py-1 text-xs border border-indigo-100/50 dark:border-indigo-900/50 rounded bg-white dark:bg-slate-900"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <label className="text-[10px] font-bold text-indigo-400/80 uppercase">DNA (nM)</label>
                                            <input
                                                type="number" step="10"
                                                value={advancedParams.dna_conc}
                                                onChange={e => {
                                                    const next = { ...advancedParams, dna_conc: parseFloat(e.target.value) };
                                                    setAdvancedParams(next);
                                                    localStorage.setItem('oligo_advanced_params', JSON.stringify(next));
                                                }}
                                                className="px-2 py-1 text-xs border border-indigo-100/50 dark:border-indigo-900/50 rounded bg-white dark:bg-slate-900"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Section 2: IDT */}
                                <div className="lg:border-l lg:border-indigo-100/50 dark:lg:border-indigo-900/30 lg:pl-6">
                                    <div className="flex items-center gap-2 mb-3">
                                        <div className="w-1.5 h-4 bg-purple-500 rounded-full"></div>
                                        <h3 className="text-xs font-bold text-purple-500 uppercase tracking-wider">IDT OligoAnalyzer</h3>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-3">
                                        <div className="flex flex-col gap-1">
                                            <label className="text-[10px] font-bold text-purple-400/80 uppercase">Na+ (mM)</label>
                                            <input
                                                type="number" step="0.1"
                                                value={idtAdvancedParams.mv_conc}
                                                onChange={e => {
                                                    const next = { ...idtAdvancedParams, mv_conc: parseFloat(e.target.value) };
                                                    setIdtAdvancedParams(next);
                                                    localStorage.setItem('idt_advanced_params', JSON.stringify(next));
                                                }}
                                                className="px-2 py-1 text-xs border border-purple-100/50 dark:border-purple-900/50 rounded bg-white dark:bg-slate-900"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <label className="text-[10px] font-bold text-purple-400/80 uppercase">Mg²⁺ (mM)</label>
                                            <input
                                                type="number" step="0.1"
                                                value={idtAdvancedParams.mg_conc}
                                                onChange={e => {
                                                    const next = { ...idtAdvancedParams, mg_conc: parseFloat(e.target.value) };
                                                    setIdtAdvancedParams(next);
                                                    localStorage.setItem('idt_advanced_params', JSON.stringify(next));
                                                }}
                                                className="px-2 py-1 text-xs border border-purple-100/50 dark:border-purple-900/50 rounded bg-white dark:bg-slate-900"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <label className="text-[10px] font-bold text-purple-400/80 uppercase">dNTP (mM)</label>
                                            <input
                                                type="number" step="0.05"
                                                value={idtAdvancedParams.dntp_conc}
                                                onChange={e => {
                                                    const next = { ...idtAdvancedParams, dntp_conc: parseFloat(e.target.value) };
                                                    setIdtAdvancedParams(next);
                                                    localStorage.setItem('idt_advanced_params', JSON.stringify(next));
                                                }}
                                                className="px-2 py-1 text-xs border border-purple-100/50 dark:border-purple-900/50 rounded bg-white dark:bg-slate-900"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <label className="text-[10px] font-bold text-purple-400/80 uppercase">Oligo (µM)</label>
                                            <input
                                                type="number" step="0.05"
                                                value={idtAdvancedParams.oligo_conc}
                                                onChange={e => {
                                                    const next = { ...idtAdvancedParams, oligo_conc: parseFloat(e.target.value) };
                                                    setIdtAdvancedParams(next);
                                                    localStorage.setItem('idt_advanced_params', JSON.stringify(next));
                                                }}
                                                className="px-2 py-1 text-xs border border-purple-100/50 dark:border-purple-900/50 rounded bg-white dark:bg-slate-900"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Primer3 parameter warning — kept for future use, hidden in UI.
                        To re-enable: replace this comment block with the JSX below.
                        {paramsNotMet && primers?.param_warnings && primers.param_warnings.length > 0 && (
                            <div className="mb-4 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-md text-amber-700 dark:text-amber-400 text-xs flex flex-col gap-1">
                                <div className="flex items-center gap-2 font-bold">
                                    <span className="text-sm">⚠️</span>
                                    Oligos outside search parameters:
                                </div>
                                <ul className="ml-5 list-disc text-[11px] space-y-0.5">
                                    {primers.param_warnings.map((w, i) => <li key={i}>{w}</li>)}
                                </ul>
                            </div>
                        )}
                    */}

                    {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-4 border border-red-100 dark:border-red-900/30">{error}</div>}

                    {primers ? (
                        <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity duration-200 ${loading ? 'opacity-50' : 'opacity-100'}`}>
                            <div className="bg-white dark:bg-slate-800 rounded-lg border border-indigo-100 dark:border-indigo-900/30 p-3 shadow-sm relative group flex flex-col justify-between">
                                <div>
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">{oligo2Name}</div>
                                        <button
                                            onClick={() => handleCopy(primers.p2.seq)}
                                            className="text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 px-2 py-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-amber-200 dark:border-amber-800/50"
                                        >
                                            Copy
                                        </button>
                                    </div>
                                    <div className="font-mono text-sm text-slate-700 dark:text-slate-300 break-all bg-amber-50/50 dark:bg-amber-900/10 p-2 rounded line-clamp-2 min-h-[3rem] flex items-center">{primers.p2.seq}</div>
                                </div>
                                <div className="mt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700 pt-2">
                                    <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400 items-center">
                                        <span>Len: <b className={primers.p2.len_ok === false ? "text-red-500 font-bold" : "text-emerald-500 font-bold"}>{primers.p2.len}</b></span>
                                        <span>GC: <b className={primers.p2.gc_ok === false ? "text-red-500 font-bold" : "text-emerald-500 font-bold"}>{primers.p2.gc != null ? primers.p2.gc.toFixed(1) : ((primers.p2.seq.match(/[GCgc]/g) || []).length / primers.p2.seq.length * 100).toFixed(1)}%</b></span>
                                        <span title="Primer3 Tm">P3 Tm: <b className={primers.p2.tm_ok === false ? "text-red-500 font-bold" : "text-emerald-500 font-bold"}>{primers.p2.tm}°C</b></span>
                                        {primers.p2.tm_strider != null && (
                                            <span title="Strider duplex Tm" className="bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 px-1.5 py-0.5 rounded border border-teal-200 dark:border-teal-800 inline-flex flex-col items-center leading-tight whitespace-nowrap">
                                                <span>Strider Tm</span><b className="font-bold">{primers.p2.tm_strider.toFixed(1)}°C</b>
                                            </span>
                                        )}
                                        {idtResults?.m2?.analyze && (
                                            <span title="IDT Tm" className="bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800 inline-flex flex-col items-center leading-tight whitespace-nowrap">
                                                <span>IDT Tm</span><b className="font-bold">{extractTm(idtResults.m2.analyze)?.toFixed(1) || 'N/A'}°C</b>
                                            </span>
                                        )}
                                        <span title="Tm Difference" className="text-[10px] opacity-80 flex items-center gap-1">
                                            ΔTm: <b className={primers.tm_diff_ok === false ? "text-red-500 font-bold" : "text-emerald-500 font-bold"}>{Math.abs(primers.p1.tm - primers.p2.tm).toFixed(1)}°C</b>
                                        </span>
                                    </div>
                                    <div className="flex bg-slate-100 dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600 overflow-hidden shadow-sm">
                                        <button
                                            onClick={() => { const actual = resizeFixedOligo('p2', -1); setMoligo2Len(prev => actual ?? Math.max(10, prev - 1)); }}
                                            title="Decrease length"
                                            className="w-8 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors font-bold border-r border-slate-200 dark:border-slate-600"
                                        >-</button>
                                        <button
                                            onClick={() => { const actual = resizeFixedOligo('p2', 1); setMoligo2Len(prev => actual ?? Math.min(60, prev + 1)); }}
                                            title="Increase length"
                                            className="w-8 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors font-bold"
                                        >+</button>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white dark:bg-slate-800 rounded-lg border border-green-200 dark:border-green-900/30 p-3 shadow-sm relative group flex flex-col justify-between">
                                <div>
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="text-xs font-bold text-green-600 dark:text-green-400 uppercase tracking-wider">{oligo1Name}</div>
                                        <button
                                            onClick={() => handleCopy(primers.p1.seq)}
                                            className="text-xs bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-2 py-1 rounded hover:bg-green-100 dark:hover:bg-green-900/40 border border-green-200 dark:border-green-800/50"
                                        >
                                            Copy
                                        </button>
                                    </div>
                                    <div className="font-mono text-sm text-slate-700 dark:text-slate-300 break-all bg-green-50/50 dark:bg-green-900/10 p-2 rounded line-clamp-2 min-h-[3rem] flex items-center">{primers.p1.seq}</div>
                                </div>
                                <div className="mt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700 pt-2">
                                    <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400 items-center">
                                        <span>Len: <b className={primers.p1.len_ok === false ? "text-red-500 font-bold" : "text-emerald-500 font-bold"}>{primers.p1.len}</b></span>
                                        <span>GC: <b className={primers.p1.gc_ok === false ? "text-red-500 font-bold" : "text-emerald-500 font-bold"}>{primers.p1.gc != null ? primers.p1.gc.toFixed(1) : ((primers.p1.seq.match(/[GCgc]/g) || []).length / primers.p1.seq.length * 100).toFixed(1)}%</b></span>
                                        <span title="Primer3 Tm">P3 Tm: <b className={primers.p1.tm_ok === false ? "text-red-500 font-bold" : "text-emerald-500 font-bold"}>{primers.p1.tm}°C</b></span>
                                        {primers.p1.tm_strider != null && (
                                            <span title="Strider duplex Tm" className="bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 px-1.5 py-0.5 rounded border border-teal-200 dark:border-teal-800 inline-flex flex-col items-center leading-tight whitespace-nowrap">
                                                <span>Strider Tm</span><b className="font-bold">{primers.p1.tm_strider.toFixed(1)}°C</b>
                                            </span>
                                        )}
                                        {idtResults?.m1?.analyze && (
                                            <span title="IDT Tm" className="bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800 inline-flex flex-col items-center leading-tight whitespace-nowrap">
                                                <span>IDT Tm</span><b className="font-bold">{extractTm(idtResults.m1.analyze)?.toFixed(1) || 'N/A'}°C</b>
                                            </span>
                                        )}
                                        <span title="Tm Difference" className="text-[10px] opacity-80 flex items-center gap-1">
                                            ΔTm: <b className={primers.tm_diff_ok === false ? "text-red-500 font-bold" : "text-emerald-500 font-bold"}>{Math.abs(primers.p1.tm - primers.p2.tm).toFixed(1)}°C</b>
                                        </span>
                                    </div>
                                    <div className="flex bg-slate-100 dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600 overflow-hidden shadow-sm">
                                        <button
                                            onClick={() => { const actual = resizeFixedOligo('p1', -1); setMoligo1Len(prev => actual ?? Math.max(10, prev - 1)); }}
                                            title="Decrease length"
                                            className="w-8 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors font-bold border-r border-slate-200 dark:border-slate-600"
                                        >-</button>
                                        <button
                                            onClick={() => { const actual = resizeFixedOligo('p1', 1); setMoligo1Len(prev => actual ?? Math.min(60, prev + 1)); }}
                                            title="Increase length"
                                            className="w-8 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors font-bold"
                                        >+</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center p-8 min-h-[140px] border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                        </div>
                    )}

                    <div className="mt-4 p-5 bg-slate-50/50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div className="flex justify-between items-center mb-2 gap-4">
                            <div className="flex items-center gap-3 flex-wrap">
                                <span className="text-xs font-bold text-slate-500 uppercase">Context Viewer</span>
                                <div className="flex items-center gap-1">
                                    <input
                                        type="text"
                                        value={searchOligo2Seq}
                                        onChange={e => { setSearchOligo2Seq(e.target.value); setSearchOligoError(null); }}
                                        onKeyDown={e => { if (e.key === 'Enter') handleSearchOligos(); }}
                                        placeholder="Oligo 2…"
                                        className="w-56 px-2 py-1 text-xs border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                    />
                                    <input
                                        type="text"
                                        value={searchOligo1Seq}
                                        onChange={e => { setSearchOligo1Seq(e.target.value); setSearchOligoError(null); }}
                                        onKeyDown={e => { if (e.key === 'Enter') handleSearchOligos(); }}
                                        placeholder="Oligo 1…"
                                        className="w-56 px-2 py-1 text-xs border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                    />
                                    <button
                                        onClick={handleSearchOligos}
                                        className="px-2 py-1 text-xs font-bold rounded border bg-white dark:bg-slate-700 text-indigo-500 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                                        title="Search and lock both oligos"
                                    >
                                        🔍
                                    </button>
                                </div>
                                {searchOligoError && (
                                    <span className="text-[10px] text-red-500 font-medium">{searchOligoError}</span>
                                )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Flank Window (bp)</label>
                                <input
                                    type="number"
                                    value={interactiveFlankWindow}
                                    onChange={e => setInteractiveFlankWindow(Math.max(0, parseInt(e.target.value) || 0))}
                                    className="w-20 px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800"
                                />
                            </div>
                        </div>
                        <div
                            ref={containerRef}
                            className="font-mono text-xs text-slate-600 dark:text-slate-400 leading-relaxed overflow-y-auto p-4 bg-white dark:bg-slate-800 rounded-lg shadow-inner"
                        >
                            {renderSequence()}
                        </div>
                        {primers && (
                            <div className="text-[10px] text-slate-400 text-center mt-2 font-medium flex justify-center gap-4">
                                <span><span className="inline-block w-2 h-2 bg-amber-400 rounded-sm mr-1"></span><span className="inline-block w-2 h-2 bg-green-400 rounded-sm mr-1"></span> Drag center string to shift</span>
                                <span> Drag edges to resize</span>
                            </div>
                        )}
                    </div>

                    {/* ── Saved Positions Panel ──────────────────────── */}
                    {savedPositions.length > 0 && (
                        <div className="mt-4 border-t border-indigo-100 dark:border-indigo-900/30 pt-4">
                            {/* Header */}
                            <div
                                className="flex items-center justify-between cursor-pointer group mb-2"
                                onClick={() => setIsSavedPosOpen(o => !o)}
                            >
                                <div className="flex items-center gap-2">
                                    <svg className={`w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-transform duration-200 ${isSavedPosOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors">
                                        Saved Positions
                                    </span>
                                    <span className="text-[10px] font-bold bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-full px-2 py-0.5">
                                        {savedPositions.length}
                                    </span>
                                </div>
                            </div>

                            {/* Toolbar */}
                            {isSavedPosOpen && (
                                <div className="flex flex-wrap items-center gap-2 mb-3 animate-in fade-in slide-in-from-top-2 duration-200">
                                    <div className="relative flex-1 min-w-[12rem]">
                                        <svg className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                        </svg>
                                        <input
                                            type="text"
                                            value={positionSearch}
                                            onChange={e => setPositionSearch(e.target.value)}
                                            placeholder="Search labels, notes, seq or range (e.g. 10-50)"
                                            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                        />
                                    </div>
                                    <button
                                        onClick={() => exportPositionsCSV(filteredPositions, jobName)}
                                        className="text-[10px] font-bold px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                                        title="Export as CSV"
                                    >
                                        CSV
                                    </button>
                                    <button
                                        onClick={() => exportPositionsTSV(filteredPositions, jobName)}
                                        className="text-[10px] font-bold px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                                        title="Export as TSV"
                                    >
                                        TSV
                                    </button>
                                    <button
                                        onClick={clearAllPositions}
                                        className="text-[10px] font-bold text-slate-400 hover:text-red-500 transition-colors uppercase tracking-wider px-2.5 py-1.5 rounded border border-transparent hover:border-red-100 dark:hover:border-red-900/30 hover:bg-red-50 dark:hover:bg-red-900/20"
                                        title="Clear all saved positions"
                                    >
                                        Clear all
                                    </button>
                                </div>
                            )}

                            {/* Undo toast */}
                            {lastDeleted && (
                                <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 animate-in fade-in slide-in-from-top-2 duration-200">
                                    <span className="text-xs text-slate-600 dark:text-slate-300">
                                        Deleted <b className="text-slate-800 dark:text-slate-100">{lastDeleted.position.label}</b>
                                    </span>
                                    <button
                                        onClick={undoDelete}
                                        className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200 px-2 py-1 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
                                    >
                                        Undo
                                    </button>
                                </div>
                            )}

                            {/* Cards grid */}
                            {isSavedPosOpen && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
                                    {filteredPositions.map((pos) => (
                                        <div
                                            key={pos.id}
                                            className="bg-white dark:bg-slate-800 rounded-xl border border-indigo-100 dark:border-indigo-900/40 shadow-sm hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-700 transition-all duration-200 flex flex-col overflow-hidden"
                                            style={{ borderLeftWidth: '4px', borderLeftColor: PIN_COLORS.find(c => c.name === pos.color)?.value || '#64748b' }}
                                        >
                                            {/* Card top bar */}
                                            <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5 border-b border-slate-100 dark:border-slate-700 gap-2">
                                                {editingLabelId === pos.id ? (
                                                    <input
                                                        autoFocus
                                                        value={editingLabelText}
                                                        onChange={e => setEditingLabelText(e.target.value)}
                                                        onBlur={() => commitLabelEdit(pos.id)}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') commitLabelEdit(pos.id);
                                                            if (e.key === 'Escape') setEditingLabelId(null);
                                                        }}
                                                        className="flex-1 text-xs font-bold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-indigo-400"
                                                    />
                                                ) : (
                                                    <button
                                                        onClick={() => { setEditingLabelId(pos.id); setEditingLabelText(pos.label); }}
                                                        className="flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200 transition-colors group/label min-w-0"
                                                        title="Click to rename"
                                                    >
                                                        <span className="truncate">{pos.label}</span>
                                                        <svg className="w-3 h-3 opacity-0 group-hover/label:opacity-60 transition-opacity shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z" />
                                                        </svg>
                                                    </button>
                                                )}
                                                <div className="flex items-center gap-1 ml-auto shrink-0">
                                                    {PIN_COLORS.map((c) => (
                                                        <button
                                                            key={c.name}
                                                            onClick={() => updatePositionColor(pos.id, c.name)}
                                                            title={c.name}
                                                            className={`w-3.5 h-3.5 rounded-full border transition-transform ${pos.color === c.name ? 'border-slate-400 dark:border-slate-300 scale-110 ring-1 ring-offset-1 ring-slate-300 dark:ring-offset-slate-800' : 'border-transparent hover:scale-105'}`}
                                                            style={{ backgroundColor: c.value }}
                                                        />
                                                    ))}
                                                    <span className="text-[9px] text-slate-400 font-medium ml-1">{relativeTime(pos.createdAt)}</span>
                                                </div>
                                            </div>

                                            {/* Coordinate rows */}
                                            <div className="px-3 py-2 flex flex-col gap-1.5 flex-1 w-full max-w-full">
                                                <div className="flex items-start gap-1.5 flex-1 w-full max-w-full min-w-0">
                                                    <span className="text-[9px] font-bold text-amber-500 uppercase tracking-wider w-12 shrink-0 pt-0.5">Oligo 2</span>
                                                    <div className="flex flex-col gap-1 w-full min-w-0">
                                                        <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded px-1.5 py-0.5 border border-slate-100 dark:border-slate-700 w-full">
                                                            <span className="font-mono text-[9px] text-slate-600 dark:text-slate-300 truncate font-semibold select-all" title={pos.p2.seq}>{pos.p2.seq}</span>
                                                            <button 
                                                                onClick={() => handleCopy(pos.p2.seq)}
                                                                title="Copy sequence"
                                                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-all shrink-0"
                                                            >
                                                                <svg className="w-2.5 h-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                                                            </button>
                                                        </div>
                                                        <div className="flex gap-2 text-[9px] text-slate-400">
                                                            <span className="font-mono text-[9px] text-slate-500 shrink-0">bp {pos.p2AbsStart}–{pos.p2AbsEnd}</span>
                                                            <span className="ml-auto">GC: <b className="text-slate-500">{pos.p2.gc.toFixed(1)}%</b></span>
                                                            <span>Tm: <b className="text-slate-500">{pos.p2.tm.toFixed(1)}°C</b></span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-start gap-1.5 flex-1 w-full max-w-full min-w-0">
                                                    <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider w-12 shrink-0 pt-0.5">Oligo 1</span>
                                                    <div className="flex flex-col gap-1 w-full min-w-0">
                                                        <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded px-1.5 py-0.5 border border-slate-100 dark:border-slate-700 w-full">
                                                            <span className="font-mono text-[9px] text-slate-600 dark:text-slate-300 truncate font-semibold select-all" title={pos.p1.seq}>{pos.p1.seq}</span>
                                                            <button 
                                                                onClick={() => handleCopy(pos.p1.seq)}
                                                                title="Copy sequence"
                                                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-all shrink-0"
                                                            >
                                                                <svg className="w-2.5 h-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                                                            </button>
                                                        </div>
                                                        <div className="flex gap-2 text-[9px] text-slate-400">
                                                            <span className="font-mono text-[9px] text-slate-500 shrink-0">bp {pos.p1AbsStart}–{pos.p1AbsEnd}</span>
                                                            <span className="ml-auto">GC: <b className="text-slate-500">{pos.p1.gc.toFixed(1)}%</b></span>
                                                            <span>Tm: <b className="text-slate-500">{pos.p1.tm.toFixed(1)}°C</b></span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Notes */}
                                            <div className="px-3 pb-2">
                                                <textarea
                                                    value={pos.notes || ''}
                                                    onChange={e => updatePositionNotes(pos.id, e.target.value)}
                                                    placeholder="Notes..."
                                                    rows={2}
                                                    className="w-full text-[10px] rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 text-slate-600 dark:text-slate-300 p-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                                />
                                            </div>

                                            {/* Actions */}
                                            <div className="flex border-t border-slate-100 dark:border-slate-700">
                                                <button
                                                    onClick={() => restorePosition(pos)}
                                                    className="flex-1 flex items-center justify-center gap-1 py-2 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors border-r border-slate-100 dark:border-slate-700"
                                                    title="Restore this position and navigate MSA"
                                                >
                                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                    </svg>
                                                    Restore
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        if (compareBaseId && compareBaseId !== pos.id) {
                                                            const base = savedPositions.find(p => p.id === compareBaseId);
                                                            if (base) setCompareTarget({ base, target: pos });
                                                            setCompareBaseId(null);
                                                        } else if (compareBaseId === pos.id) {
                                                            setCompareBaseId(null);
                                                        } else {
                                                            setCompareBaseId(pos.id);
                                                        }
                                                    }}
                                                    className={`flex-1 flex items-center justify-center gap-1 py-2 text-[10px] font-bold transition-colors border-r border-slate-100 dark:border-slate-700 ${compareBaseId === pos.id ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                                                    title={compareBaseId === pos.id ? 'Click another card to compare' : 'Select for comparison'}
                                                >
                                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                                    </svg>
                                                    {compareBaseId === pos.id ? 'Comparing...' : 'Compare'}
                                                </button>
                                                <button
                                                    onClick={() => deletePosition(pos.id)}
                                                    className="px-3 py-2 text-[10px] font-bold text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                                    title="Delete this saved position"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                     {/* Comparison modal */}
                     {compareTarget && compareBaseId && (
                         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => { setCompareTarget(null); setCompareBaseId(null); }}>
                             <div className="max-w-3xl w-full bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6" onClick={e => e.stopPropagation()}>
                                 <div className="flex items-center justify-between mb-4">
                                     <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Compare positions</h2>
                                     <button onClick={() => { setCompareTarget(null); setCompareBaseId(null); }} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl leading-none">&times;</button>
                                 </div>
                                  {(() => {
                                      const { base, target } = compareTarget;
                                      if (!base || !target) return null;

                                     const getColorDot = (color?: string) => {
                                         const colorObj = PIN_COLORS.find(c => c.name === color) || PIN_COLORS[0];
                                         return (<span className="inline-block w-2.5 h-2.5 rounded-full mr-1" style={{ backgroundColor: colorObj.value }} />);
                                     };

                                     // Character-level diff highlighting
                                     const renderDiffSequence = (seq1: string, seq2: string) => {
                                         const maxLen = Math.max(seq1.length, seq2.length);
                                         const result = [];
                                         for (let i = 0; i < maxLen; i++) {
                                             if (seq1[i] !== seq2[i]) {
                                                 result.push(<span key={i} className="text-red-500 dark:text-red-400 font-bold">{seq2[i] || '-'}</span>);
                                             } else {
                                                 result.push(<span key={i} className="text-slate-700 dark:text-slate-200">{seq2[i] || '-'}</span>);
                                             }
                                         }
                                         return <>{result}</>;
                                     };

                                      const renderOligoPair = (label: string, oligoKey: 'p1' | 'p2') => {
                                          const baseOligo = base[oligoKey];
                                          const targetOligo = target[oligoKey];
                                         return (
                                             <div className="mb-6">
                                                 <div className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-3">{label}</div>
                                                 <div className="grid grid-cols-2 gap-4">
                                                     {/* Base position */}
                                                     <div className="bg-slate-50 dark:bg-slate-900/20 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                                                         <div className="flex items-center gap-2 mb-3">
                                                             <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{base.label}</span>
                                                             {getColorDot(base.color)}
                                                         </div>
                                                         {base.notes && (
                                                             <div className="text-[10px] text-slate-500 dark:text-slate-400 italic mb-2 line-clamp-2">{base.notes}</div>
                                                         )}
                                                         <div className="flex items-center justify-between bg-white dark:bg-slate-800 rounded p-2 mb-2">
                                                             <code className="font-mono text-sm text-slate-700 dark:text-slate-200 break-all flex-1">{baseOligo.seq}</code>
                                                             <button
                                                                 onClick={() => handleCopy(baseOligo.seq)}
                                                                 title="Copy sequence"
                                                                 className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors shrink-0 ml-2"
                                                             >
                                                                 <svg className="w-3.5 h-3.5 text-slate-400 hover:text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                                                 </svg>
                                                             </button>
                                                         </div>
                                                         <div className="flex flex-wrap gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                                                             <span className="font-mono">bp {base[`${oligoKey}AbsStart`]}–{base[`${oligoKey}AbsEnd`]}</span>
                                                             <span>GC: <b className="text-slate-600 dark:text-slate-300">{baseOligo.gc.toFixed(1)}%</b></span>
                                                             <span>Tm: <b className="text-slate-600 dark:text-slate-300">{baseOligo.tm.toFixed(1)}°C</b></span>
                                                         </div>
                                                     </div>
                                                     
                                                     {/* Target position */}
                                                     <div className="bg-slate-50 dark:bg-slate-900/20 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                                                          <div className="flex items-center gap-2 mb-3">
                                                              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{target.label}</span>
                                                              {getColorDot(target.color)}
                                                          </div>
                                                          {target.notes && (
                                                              <div className="text-[10px] text-slate-500 dark:text-slate-400 italic mb-2 line-clamp-2">{target.notes}</div>
                                                          )}
                                                         <div className="flex items-center justify-between bg-white dark:bg-slate-800 rounded p-2 mb-2">
                                                             <code className="font-mono text-sm break-all flex-1">
                                                                 {renderDiffSequence(baseOligo.seq, targetOligo.seq)}
                                             </code>
                                                             <button
                                                                 onClick={() => handleCopy(targetOligo.seq)}
                                                                 title="Copy sequence"
                                                                 className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors shrink-0 ml-2"
                                                             >
                                                                 <svg className="w-3.5 h-3.5 text-slate-400 hover:text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                                                 </svg>
                                                             </button>
                                                         </div>
                                                         <div className="flex flex-wrap gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                                                              <span className="font-mono">bp {target[`${oligoKey}AbsStart`]}–{target[`${oligoKey}AbsEnd`]}</span>
                                                             <span>GC: <b className="text-slate-600 dark:text-slate-300">{targetOligo.gc.toFixed(1)}%</b></span>
                                                             <span>Tm: <b className="text-slate-600 dark:text-slate-300">{targetOligo.tm.toFixed(1)}°C</b></span>
                                                         </div>
                                                     </div>
                                                 </div>
                                             </div>
                                         );
                                     };

                                     return (
                                         <div>
                                             {renderOligoPair('Oligo 2 (Left / 5\')', 'p2')}
                                             {renderOligoPair('Oligo 1 (Right / 3\')', 'p1')}
                                         </div>
                                     );
                                 })()}
                                 <div className="mt-4 flex justify-end">
                                     <button
                                         onClick={() => { setCompareTarget(null); setCompareBaseId(null); }}
                                         className="px-4 py-2 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                                     >
                                         Close
                                     </button>
                                 </div>
                             </div>
                         </div>
                     )}

                    {primers && idtCredentials && (
                        <div className="mt-4 border-t border-slate-100 dark:border-slate-700 pt-4">
                            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Secondary structures</h4>
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-1.5">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Mg²⁺ (mM)</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            min="0"
                                            value={idtAdvancedParams.mg_conc}
                                            onChange={(e) => {
                                                const val = parseFloat(e.target.value) || 0;
                                                setIdtAdvancedParams((prev: typeof idtAdvancedParams) => {
                                                    const next = { ...prev, mg_conc: val };
                                                    localStorage.setItem('idt_advanced_params', JSON.stringify(next));
                                                    return next;
                                                });
                                            }}
                                            className="w-16 rounded border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-xs p-1 border font-mono text-center"
                                        />
                                    </div>
                                    {!isIdtLoading && (
                                        <button onClick={() => { setIdtResults(null); setIdtAnalyzedSeqs(null); setIdtError(null); setTimeout(runIdtAnalysis, 0); }} className={`text-xs font-bold px-3 py-1.5 rounded transition-colors border ${idtResults ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800 hover:bg-amber-100' : 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100'}`}>
                                            {idtResults ? '↻ Re-run Structural analysis' : 'Run Structural analysis'}
                                        </button>
                                    )}
                                    {isIdtLoading && <div className="animate-pulse text-xs text-indigo-500 font-medium">Analyzing with IDT API...</div>}
                                </div>
                            </div>
                            {idtError && <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-3 border border-red-100 dark:border-red-900/30">Error: {idtError}</div>}
                            {idtResults && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded border border-slate-100 dark:border-slate-800">
                                        <div className="text-xs font-bold text-slate-500 uppercase mb-1">Oligo 2 Stability</div>
                                        {renderIdtCard("Hairpin ΔG", idtResults.m2.hairpin, idtAnalyzedSeqs?.p2 ?? primers.p2.seq)}
                                        {renderIdtCard("Self-Dimer ΔG", idtResults.m2.self_dimer, idtAnalyzedSeqs?.p2 ?? primers.p2.seq)}
                                        <div className="text-[10px] text-slate-400 mt-1 italic">kcal/mol</div>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded border border-slate-100 dark:border-slate-800">
                                        <div className="text-xs font-bold text-slate-500 uppercase mb-1">Oligo 1 Stability</div>
                                        {renderIdtCard("Hairpin ΔG", idtResults.m1.hairpin, idtAnalyzedSeqs?.p1 ?? primers.p1.seq)}
                                        {renderIdtCard("Self-Dimer ΔG", idtResults.m1.self_dimer, idtAnalyzedSeqs?.p1 ?? primers.p1.seq)}
                                        <div className="text-[10px] text-slate-400 mt-1 italic">kcal/mol</div>
                                    </div>
                                    <div className="bg-indigo-50/30 dark:bg-indigo-900/20 p-3 rounded border border-indigo-100/50 dark:border-indigo-900/30">
                                        <div className="text-xs font-bold text-indigo-500 uppercase mb-1">Cross-Dimer Pairwise</div>
                                        {renderIdtCard("Hetero-Dimer ΔG", idtResults.pairwise, idtAnalyzedSeqs?.p1 ?? primers.p1.seq, idtAnalyzedSeqs?.p2 ?? primers.p2.seq)}
                                        <div className="text-[10px] text-slate-400 mt-1 italic">kcal/mol</div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Rename Oligos Panel ─────────────────────────── */}
                {primers && (
                    <div className="mt-4 border-t border-slate-100 dark:border-slate-700 pt-4 px-5">
                        <div className="flex items-center gap-2 mb-3">
                            <div className="w-1.5 h-4 bg-slate-400 rounded-full"></div>
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Rename Oligos</h4>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Oligo 2 (Left / 5') Label</label>
                                <input
                                    type="text"
                                    value={oligo2Name}
                                    onChange={e => setOligo2Name(e.target.value)}
                                    placeholder="Oligo 2 (Left / 5')"
                                    className="px-2.5 py-1.5 text-xs border border-amber-200 dark:border-amber-800/50 rounded-md bg-amber-50/30 dark:bg-amber-900/10 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-amber-400"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">Oligo 1 (Right / 3') Label</label>
                                <input
                                    type="text"
                                    value={oligo1Name}
                                    onChange={e => setOligo1Name(e.target.value)}
                                    placeholder="Oligo 1 (Right / 3')"
                                    className="px-2.5 py-1.5 text-xs border border-green-200 dark:border-green-800/50 rounded-md bg-green-50/30 dark:bg-green-900/10 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-green-400"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* ── MOLigo Provenance Panel ────────────────────── */}
                {primers && (
                    <div className="border-t border-slate-200 dark:border-slate-700">
                        <MOLigoPanel
                            templateSeq={rawSeq}
                            moligo1Seq={primers.p1.seq}
                            moligo2Seq={primers.p2.seq}
                            tagSeq={tagSeq}
                            fwdPrimer={fwdPrimer}
                            revPrimer={revPrimer}
                            queryId={data.id}
                            jobName={jobName}
                            onTagChange={setTagSeq}
                            onFwdChange={setFwdPrimer}
                            onRevChange={setRevPrimer}
                            onProceed={() => {
                                if (!fixedAbsCoords) {
                                    toggleFixPosition();
                                }
                                setShowFlankingPrimers(true);
                                setTimeout(() => {
                                    document.getElementById('flanking-primers-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }, 100);
                            }}
                            moligoIdtResults={idtResults ? { m1: idtResults.m1, m2: idtResults.m2, pairwise: idtResults.pairwise } : undefined}
                            idtCredentials={idtCredentials}
                            idtAdvancedParams={idtAdvancedParams}
                        />
                    </div>
                )}
            </div>
        </div>

        {/* ── Flanking Primers Provenance (shown on Proceed) — separate top-level card ── */}
        {showFlankingPrimers && primers && (
            <div
                id="flanking-primers-section"
                className="mt-8 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                        </svg>
                        <span className="text-sm font-bold text-slate-500 uppercase tracking-widest">Flanking Primers Provenance</span>
                        {flankingPrimersData?.amplicon != null && (
                            <span
                                className="px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 text-sm font-bold font-mono normal-case tracking-normal"
                                title="Amplicon size: forward primer + template between primers + reverse primer"
                            >
                                Amplicon: {flankingPrimersData.amplicon.toLocaleString()} bp
                            </span>
                        )}
                    </div>
                    <button onClick={() => setShowFlankingPrimers(false)}
                        className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                        ✕ Close
                    </button>
                </div>

                <FlankingPrimersPanel
                    rawSeq={data.fullSeq ?? rawSeq}
                    oligoStart={Math.min(liveP1Start, liveP2Start)}
                    oligoEnd={Math.max(liveP1End, liveP2End)}
                    p1Start={liveP1Start}
                    p1End={liveP1End}
                    p2Start={liveP2Start}
                    p2End={liveP2End}
                    alignment={alignment}
                    oligoPrimers={primers ? {
                        p1: { start: liveP1Start, end: liveP1End },
                        p2: { start: liveP2Start, end: liveP2End }
                    } : null}
                    gappedData={data}
                    navigateTarget={navigateTarget}
                    isDarkMode={isDarkMode}
                    idtCredentials={idtCredentials}
                    idtAdvancedParams={idtAdvancedParams}
                    onFlankingPrimersUpdate={handleFlankingPrimersUpdate}
                    restoredState={flankingPanelState ?? null}
                    onPanelStateChange={onFlankingPanelStateChange}
                />
            </div>
        )}

        {primers && (
            <div className="mt-8 px-5 py-4 flex justify-end gap-3">
                {onSaveSession && (
                    <button
                        onClick={onSaveSession}
                        title="Save this session (oligos, pinned positions, primers & alignment) to a file"
                        className="flex items-center gap-2 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 px-6 py-2.5 rounded-lg font-bold transition-all shadow-sm active:scale-95"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 16v1a3 3 0 01-3 3H7a3 3 0 01-3-3v-1m4-4l4 4m0 0l4-4m-4 4V4" />
                        </svg>
                        Save
                    </button>
                )}
                <button
                    onClick={() => {
                        setHeaderError(null);
                        setShowReportDialog(true);
                    }}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg font-bold transition-all shadow-md active:scale-95 border border-indigo-500"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    Create a report
                </button>
            </div>
        )}

        {showReportDialog && (
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm animate-in fade-in duration-150"
                onClick={(e) => { if (e.target === e.currentTarget) setShowReportDialog(false); }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="query-report-dialog-title"
            >
                <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4 border border-slate-200 dark:border-slate-700" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-between items-start mb-4">
                        <h3 id="query-report-dialog-title" className="text-lg font-bold text-slate-800 dark:text-slate-100">Create a report</h3>
                        <button
                            onClick={() => setShowReportDialog(false)}
                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-1 -mr-2 -mt-1"
                            aria-label="Close"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                        Export the complete design report with all procedure information.
                    </p>

                    <div className="mb-4">
                        <label htmlFor="report-header" className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                            Header
                            <span className="ml-2 font-normal text-slate-400 dark:text-slate-500">(GenBank header or &gt;FASTA line)</span>
                        </label>
                        <textarea
                            id="report-header"
                            rows={4}
                            value={genbankHeader ?? ''}
                            onChange={(e) => { onGenbankHeaderChange?.(e.target.value); if (e.target.value.trim()) setHeaderError(null); }}
                            placeholder={"LOCUS       PD166130                 981 bp    DNA     linear   PAT 29-JAN-2025\nDEFINITION  ...\nVERSION     ..."}
                            className="w-full rounded-lg border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 font-mono text-xs px-3 py-2 border resize-y"
                        />
                        {headerError && (
                            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{headerError}</p>
                        )}
                    </div>

                    <div className="flex flex-col gap-3">
                        <button
                            onClick={handleDownloadTxt}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-all text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600"
                        >
                            <span>📝</span>
                            Generate .txt
                        </button>

                        <button
                            onClick={handlePrintPdf}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-all text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600"
                        >
                            <span>📄</span>
                            Generate .pdf
                        </button>
                    </div>
                </div>
            </div>
        )}

        {primers && (
            <div className="query-report-mount">
                <QueryReport data={buildCompleteReport()} />
            </div>
        )}
        </>
    );
});

export default QueryViewer;

