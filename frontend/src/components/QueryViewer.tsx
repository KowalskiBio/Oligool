import { useState, useEffect, useRef } from 'react';
import MOLigoPanel from './MOLigoPanel';
import HairpinSVG from './HairpinSVG';
import DimerSVG from './DimerSVG';

interface QueryViewerProps {
    data: { id: string; seq: string; start: number; end: number };
    jobName: string;
    onPrimersUpdate: (primers: { p1: { start: number, end: number }, p2: { start: number, end: number } } | null) => void;
    onNavigateTo?: (colStart: number, colEnd: number) => void;
    /** Gapped column range selected by the user in MSAViewer for constrained oligo search */
    oligoRegion?: { startCol: number; endCol: number } | null;
    idtCredentials?: {
        clientId: string;
        clientSecret: string;
        username?: string;
        password?: string;
        mgConc?: number;
    };
}

interface IdtData {
    m1: { hairpin: { DeltaG?: number, raw?: any }; self_dimer: { DeltaG?: number, raw?: any }; analyze: any };
    m2: { hairpin: { DeltaG?: number, raw?: any }; self_dimer: { DeltaG?: number, raw?: any }; analyze: any };
    pairwise: { DeltaG?: number, raw?: any };
}

interface Primer {
    seq: string;
    tm: number;
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

interface SavedPosition {
    id: string;
    label: string;
    createdAt: number;
    p1: { start: number; end: number; seq: string; gc: number; tm: number };
    p2: { start: number; end: number; seq: string; gc: number; tm: number };
    // 1-indexed absolute genomic coords (bare numeric range, no chr prefix)
    p1AbsStart: number; p1AbsEnd: number;
    p2AbsStart: number; p2AbsEnd: number;
    // Shift / length state so restoring snaps sliders back exactly
    moligo1Shift: number; moligo2Shift: number;
    moligo1Len: number; moligo2Len: number;
}

export default function QueryViewer({ data, jobName, onPrimersUpdate, onNavigateTo, oligoRegion, idtCredentials }: QueryViewerProps) {
    const [copyFeedback, setCopyFeedback] = useState('');

    // IDT Analysis State
    const [isIdtLoading, setIsIdtLoading] = useState(false);
    const [idtResults, setIdtResults] = useState<IdtData | null>(null);
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
    // When region analysis is active, fetchPrimers uses this subsequence so sliders stay within the region
    const regionSeqContextRef = useRef<{ rawSub: string; ungappedOffset: number } | null>(null);
    const [regionAnalysisActive, setRegionAnalysisActive] = useState(false);
    // Reset toggle whenever a new region is drawn
    useEffect(() => {
        if (!regionAnalysisActive) return;
        regionSeqContextRef.current = null;
        setRegionAnalysisActive(false);
        setIsAutoSearchNeeded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [oligoRegion]);

    // MOLigo state
    const [showMOLigo, setShowMOLigo] = useState(() => localStorage.getItem('show_moligo_prov') === 'true');
    const [tagSeq, setTagSeq] = useState(() => localStorage.getItem('tag_seq') || 'taattgaattgaaagataagtgt');
    const [fwdPrimer, setFwdPrimer] = useState(() => localStorage.getItem('fwd_primer') || 'CGCGGTAGTAAGAAGTGAGA');
    const [revPrimer, setRevPrimer] = useState(() => localStorage.getItem('rev_primer') || 'ACTCGTAGGGAATAAACCGT');

    // Saved Positions state (cleared on new BLAST / data change)
    const [savedPositions, setSavedPositions] = useState<SavedPosition[]>([]);
    const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
    const [editingLabelText, setEditingLabelText] = useState('');
    const [pinPulse, setPinPulse] = useState(false);
    const [isSavedPosOpen, setIsSavedPosOpen] = useState(true);

    // Fix Position toggle — when set, fetchPrimers is bypassed and oligos stick to global absolute coordinates
    const [fixedAbsCoords, setFixedAbsCoords] = useState<{
        p1AbsStart: number; p1AbsEnd: number; p2AbsStart: number; p2AbsEnd: number;
        p1Seq: string; p2Seq: string; p1Tm: number; p2Tm: number; p1Gc: number; p2Gc: number;
    } | null>(null);

    const toggleFixPosition = () => {
        setFixedAbsCoords(prev => {
            if (prev) {
                // Unfixing → trigger a fresh auto-search
                setIsAutoSearchNeeded(true);
                return null;
            }
            // Fixing current primers
            if (!primers) return null;
            const p1AbsStart = data.start + mapUngappedToGapped(primers.p1.start, data.seq) + 1;
            const p1AbsEnd   = data.start + mapUngappedToGapped(primers.p1.end,   data.seq) + 1;
            const p2AbsStart = data.start + mapUngappedToGapped(primers.p2.start, data.seq) + 1;
            const p2AbsEnd   = data.start + mapUngappedToGapped(primers.p2.end,   data.seq) + 1;
            return {
                p1AbsStart, p1AbsEnd, p2AbsStart, p2AbsEnd,
                p1Seq: primers.p1.seq, p2Seq: primers.p2.seq,
                p1Tm: primers.p1.tm, p2Tm: primers.p2.tm,
                p1Gc: primers.p1.gc, p2Gc: primers.p2.gc
            };
        });
    };

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopyFeedback('Copied!');
            setTimeout(() => setCopyFeedback(''), 2000);
        });
    };

    // ── Saved Positions helpers ───────────────────────────────────────────
    const calcGc = (seq: string) => {
        if (!seq) return 0;
        return ((seq.match(/[GCgc]/g) || []).length / seq.length) * 100;
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
            p1: { start: primers.p1.start, end: primers.p1.end, seq: primers.p1.seq, gc: calcGc(primers.p1.seq), tm: primers.p1.tm },
            p2: { start: primers.p2.start, end: primers.p2.end, seq: primers.p2.seq, gc: calcGc(primers.p2.seq), tm: primers.p2.tm },
            p1AbsStart, p1AbsEnd, p2AbsStart, p2AbsEnd,
            moligo1Shift, moligo2Shift, moligo1Len, moligo2Len,
        };
        setSavedPositions(prev => [...prev, pos]);
        setPinPulse(true);
        setTimeout(() => setPinPulse(false), 1000);
    };

    const restorePosition = (pos: SavedPosition) => {
        // Lock instantly to the exact absolute genomic sequence, bypassing backend searches completely.
        setFixedAbsCoords({
            p1AbsStart: pos.p1AbsStart, p1AbsEnd: pos.p1AbsEnd,
            p2AbsStart: pos.p2AbsStart, p2AbsEnd: pos.p2AbsEnd,
            p1Seq: pos.p1.seq, p2Seq: pos.p2.seq,
            p1Tm: pos.p1.tm, p2Tm: pos.p2.tm,
            p1Gc: pos.p1.gc, p2Gc: pos.p2.gc
        });
        // Restore slider state so the UI inputs reflect reality
        setMoligo1Shift(pos.moligo1Shift);
        setMoligo2Shift(pos.moligo2Shift);
        setMoligo1Len(pos.moligo1Len);
        setMoligo2Len(pos.moligo2Len);
        // Teleport MSA to the position (using exact=false so we get comfortable context padding)
        if (onNavigateTo) {
            onNavigateTo(pos.p2AbsStart - 1, pos.p1AbsEnd - 1);
        }
    };

    const deletePosition = (id: string) => {
        setSavedPositions(prev => prev.filter(p => p.id !== id));
        if (editingLabelId === id) setEditingLabelId(null);
    };

    const commitLabelEdit = (id: string) => {
        if (editingLabelText.trim()) {
            setSavedPositions(prev => prev.map(p => p.id === id ? { ...p, label: editingLabelText.trim() } : p));
        }
        setEditingLabelId(null);
    };

    // 1. Clear saved positions only when a totally new BLAST search comes in
    useEffect(() => {
        if (data?.id) {
            setSavedPositions([]);
            setEditingLabelId(null);
            setFixedAbsCoords(null);
        }
    }, [data?.id]);

    // 2. Restart search when the active window changes (pan/zoom), UNLESS we are locked.
    // This allows the engine to find the 'best' oligo anywhere in the new frame instead of sitting in the center.
    useEffect(() => {
        if (data && !fixedAbsCoords) {
            setIdtResults(null);
            setIdtError(null);
            onPrimersUpdate(null);
            regionSeqContextRef.current = null;
            setRegionAnalysisActive(false);
            setMoligo1Shift(0);
            setMoligo2Shift(0);
            lastShiftsApplied.current = { s1: 0, s2: 0 };
            setIsAutoSearchNeeded(true);
        }
    }, [data?.id, data?.seq]); // intentionally NOT fixedAbsCoords to prevent recursion when locking

    // Coordinate Mapping Helper: Ungapped Index -> Gapped Index (Relative to slice)
    const mapUngappedToGapped = (ungappedIdx: number, gappedSeq: string): number => {
        let u = 0;
        for (let i = 0; i < gappedSeq.length; i++) {
            if (gappedSeq[i] !== '-') {
                if (u === ungappedIdx) return i;
                u++;
            }
        }
        return gappedSeq.length;
    };

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
        if (!data) {
            onPrimersUpdate(null);
            return;
        }

        const raw = data.seq.replace(/-/g, '');
        if (raw.length < 2) return;

        const fetchPrimers = async () => {
            if (fixedAbsCoords) {
                // 🔒 Position is fixed to absolute coordinates! (e.g. from Restore or Fix click)
                // We do NOT hit the backend. We recalculate relative ungapped coordinates 
                // so the visual sequences are perfectly aligned on the *current* window slice.
                const mapGappedToUngapped = (gappedIdx: number, gappedSeq: string): number => {
                    if (gappedIdx <= 0) return 0;
                    let u = 0;
                    const limit = Math.min(gappedIdx, gappedSeq.length);
                    for (let i = 0; i < limit; i++) {
                        if (gappedSeq[i] !== '-') u++;
                    }
                    return u;
                };

                // Determine coordinates relative to the START of the current viewport slice
                const p1RelGappedStart = fixedAbsCoords.p1AbsStart - 1 - data.start;
                const p1RelGappedEnd = fixedAbsCoords.p1AbsEnd - 1 - data.start;
                const p2RelGappedStart = fixedAbsCoords.p2AbsStart - 1 - data.start;
                const p2RelGappedEnd = fixedAbsCoords.p2AbsEnd - 1 - data.start;
                
                // Map gapped slice coords back to ungapped string length for `renderSequence` DimerSVG injection
                const p1UngappedStart = mapGappedToUngapped(p1RelGappedStart, data.seq);
                const p1UngappedEnd = mapGappedToUngapped(p1RelGappedEnd, data.seq);
                const p2UngappedStart = mapGappedToUngapped(p2RelGappedStart, data.seq);
                const p2UngappedEnd = mapGappedToUngapped(p2RelGappedEnd, data.seq);

                const fauxResponse: OligizeResponse = {
                    p1: { start: p1UngappedStart, end: p1UngappedEnd, seq: fixedAbsCoords.p1Seq, len: fixedAbsCoords.p1Seq.length, tm: fixedAbsCoords.p1Tm, gc: fixedAbsCoords.p1Gc },
                    p2: { start: p2UngappedStart, end: p2UngappedEnd, seq: fixedAbsCoords.p2Seq, len: fixedAbsCoords.p2Seq.length, tm: fixedAbsCoords.p2Tm, gc: fixedAbsCoords.p2Gc },
                    split_idx: 0,
                    tm_diff_ok: Math.abs(fixedAbsCoords.p1Tm - fixedAbsCoords.p2Tm) <= Number(searchParams.tm_diff),
                    params_not_met: false,
                };

                setPrimers(fauxResponse);
                setParamsNotMet(false);
                setLoading(false);

                // Broadcast back up to MSAViewer so the global minimap track remains totally accurate
                onPrimersUpdate({
                    p1: { start: data.start + p1RelGappedStart, end: data.start + p1RelGappedEnd },
                    p2: { start: data.start + p2RelGappedStart, end: data.start + p2RelGappedEnd }
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
    useEffect(() => { localStorage.setItem('show_moligo_prov', String(showMOLigo)); }, [showMOLigo]);
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
            const span = containerRef.current.querySelector('span');
            if (span) {
                charWidthRef.current = span.getBoundingClientRect().width;
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
                    const id = dragState.id;
                    const type = dragState.type;

                    if (type === 'move') {
                        setMoligo1Shift(dragState.initShift1 + D);
                        setMoligo2Shift(dragState.initShift2 + D);
                    } else {
                        let newLen = dragState.initLen;
                        if (id === 'p1') {
                            let newShift = dragState.initShift1;
                            if (type === 'left') { newShift += D; newLen -= D; }
                            else if (type === 'right') { newLen += D; }

                            if (newLen < 10) { const diff = 10 - newLen; newLen = 10; if (type === 'left') newShift -= diff; }
                            if (newLen > 60) { const diff = newLen - 60; newLen = 60; if (type === 'left') newShift += diff; }

                            setMoligo1Shift(newShift);
                            setMoligo1Len(newLen);
                        } else {
                            let newShift = dragState.initShift2;
                            if (type === 'left') { newLen -= D; }
                            else if (type === 'right') { newShift += D; newLen += D; }

                            if (newLen < 10) { const diff = 10 - newLen; newLen = 10; if (type === 'right') newShift -= diff; }
                            if (newLen > 60) { const diff = newLen - 60; newLen = 60; if (type === 'right') newShift += diff; }

                            setMoligo2Shift(newShift);
                            setMoligo2Len(newLen);
                        }
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

    const renderSequence = () => {
        if (!primers) return rawSeq;

        let p1Start = primers.p1.start;
        let p1End = primers.p1.end;
        let p2Start = primers.p2.start;
        let p2End = primers.p2.end;

        if (dragState) {
            const D = dragState.deltaChars;
            if (dragState.type === 'move') {
                p1Start += D; p1End += D;
                p2Start += D; p2End += D;
            } else if (dragState.id === 'p1') {
                if (dragState.type === 'left') { p1Start += D; }
                else if (dragState.type === 'right') { p1End += D; }

                if (p1End - p1Start < 10) {
                    if (dragState.type === 'left') p1Start = p1End - 10;
                    else p1End = p1Start + 10;
                }
                if (p1End - p1Start > 60) {
                    if (dragState.type === 'left') p1Start = p1End - 60;
                    else p1End = p1Start + 60;
                }
            } else {
                if (dragState.type === 'left') { p2Start += D; }
                else if (dragState.type === 'right') { p2End += D; }

                if (p2End - p2Start < 10) {
                    if (dragState.type === 'left') p2Start = p2End - 10;
                    else p2End = p2Start + 10;
                }
                if (p2End - p2Start > 60) {
                    if (dragState.type === 'left') p2Start = p2End - 60;
                    else p2End = p2Start + 60;
                }
            }
        }

        // Find the bounding box of both oligos + 50bp padding
        const minStart = Math.min(p1Start, p2Start);
        const maxEnd = Math.max(p1End, p2End);

        let viewStart = Math.max(0, minStart - 50);
        let viewEnd = Math.min(rawSeq.length, maxEnd + 50);

        const chars = rawSeq.substring(viewStart, viewEnd).split('');

        return (
            <div ref={containerRef} className="break-all whitespace-pre-wrap select-none relative" style={{ cursor: dragState ? 'grabbing' : 'auto' }}>
                {chars.map((char, indexWithinSlice) => {
                    const i = viewStart + indexWithinSlice; // The absolute index in rawSeq
                    let className = '';
                    let handlers = {};

                    const isP1 = i >= p1Start && i < p1End;
                    const isP2 = i >= p2Start && i < p2End;
                    const isP1Start = i === p1Start;
                    const isP1End = i === p1End - 1;
                    const isP2Start = i === p2Start;
                    const isP2End = i === p2End - 1;

                    if (isP1) {
                        className = `bg-green-200 dark:bg-green-900/40 text-green-900 dark:text-green-300 font-bold hover:bg-green-300 dark:hover:bg-green-800/60 ${isP1Start || isP1End ? 'cursor-ew-resize' : 'cursor-grab active:cursor-grabbing'}`;
                        if (isP1Start) {
                            handlers = { onMouseDown: (e: React.MouseEvent) => handleSeqMouseDown(e, 'p1', 'left') };
                        } else if (isP1End) {
                            handlers = { onMouseDown: (e: React.MouseEvent) => handleSeqMouseDown(e, 'p1', 'right') };
                        } else {
                            handlers = { onMouseDown: (e: React.MouseEvent) => handleSeqMouseDown(e, 'p1', 'move') };
                        }
                    }
                    else if (isP2) {
                        className = `bg-amber-200 dark:bg-amber-900/40 text-amber-900 dark:text-amber-300 font-bold hover:bg-amber-300 dark:hover:bg-amber-800/60 ${isP2Start || isP2End ? 'cursor-ew-resize' : 'cursor-grab active:cursor-grabbing'}`;
                        if (isP2Start) {
                            handlers = { onMouseDown: (e: React.MouseEvent) => handleSeqMouseDown(e, 'p2', 'left') };
                        } else if (isP2End) {
                            handlers = { onMouseDown: (e: React.MouseEvent) => handleSeqMouseDown(e, 'p2', 'right') };
                        } else {
                            handlers = { onMouseDown: (e: React.MouseEvent) => handleSeqMouseDown(e, 'p2', 'move') };
                        }
                    }
                    return <span key={i} className={className + " transition-colors duration-75"} {...handlers}>{char}</span>;
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
                    password: idtCredentials.password
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
                oligo_conc: Number(idtAdvancedParams.oligo_conc)
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
        const renderItem = (item: any, seq: string | undefined, idx: number, itemDg?: number, itemViennaDg?: number, itemIdtTmVal?: number, itemLocalTmVal?: number) => {
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

                if (item.DotBracket) {
                    hairpinDotBracket = item.DotBracket;
                    hairpinSeq = fullSeq;
                } else if (!isDimer && item.Bonds && seq) {
                    // Dimers use ASCII rendering via Bonds only if not a Vienna-dot-bracket dimer
                    asciiStructure = buildDimerAscii(item, seq, seq2);
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
                                {itemViennaDg !== undefined && itemViennaDg !== null && (
                                    <span>Vienna ΔG: <span className="text-slate-500 dark:text-slate-400 font-medium">{itemViennaDg.toFixed(2)}</span></span>
                                )}
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 text-[9px] opacity-80">
                            {itemIdtTmVal !== undefined && itemIdtTmVal !== null && (
                                <span>IDT Tm: <span className="text-slate-500 dark:text-slate-400 font-medium">{Number(itemIdtTmVal).toFixed(1)}°C</span></span>
                            )}
                            {itemLocalTmVal !== undefined && itemLocalTmVal !== null && (
                                <span>Vienna Tm: <span className="text-slate-500 dark:text-slate-400 font-medium">{Number(itemLocalTmVal).toFixed(1)}°C</span></span>
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
            const allViennaDgs = data.all_ViennaRNA_DeltaG || [];
            const allIdtTms = data.all_IDT_Tm || [];
            const allLocalTms = data.all_Local_Tm || [];
            raw.forEach((item: any, idx: number) => {
                items.push(renderItem(item, seq1, idx, allDgs[idx], allViennaDgs[idx], allIdtTms[idx], allLocalTms[idx]));
            });
        } else if (raw) {
            items.push(renderItem(raw, seq1, 0));
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
                                        {idtResults?.m2?.analyze && (
                                            <span title="IDT Tm" className="bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800">
                                                IDT Tm: <b className="font-bold">{extractTm(idtResults.m2.analyze)?.toFixed(1) || 'N/A'}°C</b>
                                            </span>
                                        )}
                                        <span title="Tm Difference" className="text-[10px] opacity-80 flex items-center gap-1">
                                            ΔTm: <b className={primers.tm_diff_ok === false ? "text-red-500 font-bold" : "text-emerald-500 font-bold"}>{Math.abs(primers.p1.tm - primers.p2.tm).toFixed(1)}°C</b>
                                        </span>
                                    </div>
                                    <div className="flex bg-slate-100 dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600 overflow-hidden shadow-sm">
                                        <button onClick={() => { setMoligo2Len(prev => Math.max(10, prev - 1)); }} className="w-8 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors font-bold border-r border-slate-200 dark:border-slate-600">-</button>
                                        <button onClick={() => { setMoligo2Len(prev => Math.min(60, prev + 1)); }} className="w-8 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors font-bold">+</button>
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
                                        {idtResults?.m1?.analyze && (
                                            <span title="IDT Tm" className="bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800">
                                                IDT Tm: <b className="font-bold">{extractTm(idtResults.m1.analyze)?.toFixed(1) || 'N/A'}°C</b>
                                            </span>
                                        )}
                                        <span title="Tm Difference" className="text-[10px] opacity-80 flex items-center gap-1">
                                            ΔTm: <b className={primers.tm_diff_ok === false ? "text-red-500 font-bold" : "text-emerald-500 font-bold"}>{Math.abs(primers.p1.tm - primers.p2.tm).toFixed(1)}°C</b>
                                        </span>
                                    </div>
                                    <div className="flex bg-slate-100 dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600 overflow-hidden shadow-sm">
                                        <button onClick={() => { setMoligo1Len(prev => Math.max(10, prev - 1)); }} className="w-8 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors font-bold border-r border-slate-200 dark:border-slate-600">-</button>
                                        <button onClick={() => { setMoligo1Len(prev => Math.min(60, prev + 1)); }} className="w-8 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors font-bold">+</button>
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
                        <div
                            ref={containerRef}
                            className="font-mono text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-h-60 overflow-y-auto p-4 bg-white dark:bg-slate-800 rounded-lg shadow-inner"
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
                                        📍 Saved Positions
                                    </span>
                                    <span className="text-[10px] font-bold bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-full px-2 py-0.5">
                                        {savedPositions.length}
                                    </span>
                                </div>
                                <button
                                    onClick={e => { e.stopPropagation(); setSavedPositions([]); setEditingLabelId(null); }}
                                    className="text-[10px] font-bold text-slate-400 hover:text-red-500 transition-colors uppercase tracking-wider px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                                    title="Clear all saved positions"
                                >
                                    Clear all
                                </button>
                            </div>

                            {/* Cards grid */}
                            {isSavedPosOpen && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
                                    {savedPositions.map((pos) => (
                                        <div
                                            key={pos.id}
                                            className="bg-white dark:bg-slate-800 rounded-xl border border-indigo-100 dark:border-indigo-900/40 shadow-sm hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-700 transition-all duration-200 flex flex-col overflow-hidden"
                                        >
                                            {/* Card top bar */}
                                            <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5 border-b border-slate-100 dark:border-slate-700">
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
                                                        className="flex-1 text-xs font-bold bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-indigo-400 mr-1"
                                                    />
                                                ) : (
                                                    <button
                                                        onClick={() => { setEditingLabelId(pos.id); setEditingLabelText(pos.label); }}
                                                        className="flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200 transition-colors group/label"
                                                        title="Click to rename"
                                                    >
                                                        <span>{pos.label}</span>
                                                        <svg className="w-3 h-3 opacity-0 group-hover/label:opacity-60 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2.414a2 2 0 01.586-1.414z" />
                                                        </svg>
                                                    </button>
                                                )}
                                                <span className="text-[9px] text-slate-400 font-medium ml-auto shrink-0">{relativeTime(pos.createdAt)}</span>
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

                    {primers && idtCredentials && (
                        <div className="mt-4 border-t border-slate-100 dark:border-slate-700 pt-4">
                            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest">IDT OligoAnalyzer Results</h4>
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
                                        <button onClick={() => { setIdtResults(null); setIdtError(null); setTimeout(runIdtAnalysis, 0); }} className={`text-xs font-bold px-3 py-1.5 rounded transition-colors border ${idtResults ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800 hover:bg-amber-100' : 'bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100'}`}>
                                            {idtResults ? '↻ Re-run IDT Analysis' : 'Run Full IDT Analysis'}
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
                                        {renderIdtCard("Hairpin ΔG", idtResults.m2.hairpin, primers.p2.seq)}
                                        {renderIdtCard("Self-Dimer ΔG", idtResults.m2.self_dimer, primers.p2.seq)}
                                        <div className="text-[10px] text-slate-400 mt-1 italic">kcal/mol</div>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-900/40 p-3 rounded border border-slate-100 dark:border-slate-800">
                                        <div className="text-xs font-bold text-slate-500 uppercase mb-1">Oligo 1 Stability</div>
                                        {renderIdtCard("Hairpin ΔG", idtResults.m1.hairpin, primers.p1.seq)}
                                        {renderIdtCard("Self-Dimer ΔG", idtResults.m1.self_dimer, primers.p1.seq)}
                                        <div className="text-[10px] text-slate-400 mt-1 italic">kcal/mol</div>
                                    </div>
                                    <div className="bg-indigo-50/30 dark:bg-indigo-900/20 p-3 rounded border border-indigo-100/50 dark:border-indigo-900/30">
                                        <div className="text-xs font-bold text-indigo-500 uppercase mb-1">Cross-Dimer Pairwise</div>
                                        {renderIdtCard("Hetero-Dimer ΔG", idtResults.pairwise, primers.p1.seq, primers.p2.seq)}
                                        <div className="text-[10px] text-slate-400 mt-1 italic">kcal/mol</div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Rename Oligos Panel ─────────────────────────── */}
                {primers && (
                    <div className="mt-4 border-t border-slate-100 dark:border-slate-700 pt-4">
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
                {primers && showMOLigo && (
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
                            idtCredentials={idtCredentials}
                            idtAdvancedParams={idtAdvancedParams}
                        />
                    </div>
                )}
            </div>
        </div >
    );
}
