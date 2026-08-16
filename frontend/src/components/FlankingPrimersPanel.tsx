import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import MSAViewer from './MSAViewer';
import DimerAscii from './DimerAscii';
import HairpinSVG from './HairpinSVG';
import { FLANKING_PANEL_DEFAULTS, type FlankingPanelState, type FlankingDesignedPrimer, type FlankingDesignResult } from '../utils/session';

type DesignedPrimer = FlankingDesignedPrimer;
type DesignResult = FlankingDesignResult;

interface OligoPrimers {
    p1: { start: number; end: number };
    p2: { start: number; end: number };
}

interface Props {
    rawSeq: string;
    oligoStart: number;
    oligoEnd: number;
    p1Start: number; p1End: number;
    p2Start: number; p2End: number;
    // MSA Viewer
    alignment?: string;
    oligoPrimers?: OligoPrimers | null;
    navigateTarget?: { colStart: number; colEnd: number; ts: number } | null;
    isDarkMode?: boolean;
    idtCredentials?: any;
    idtAdvancedParams?: any;
    gappedData?: { seq: string; start: number; ungappedOffset?: number };
    onFlankingPrimersUpdate?: (primers: {
        fwd: { start: number, end: number } | null,
        rev: { start: number, end: number } | null,
        fwdName?: string,
        revName?: string,
        fwdSeq?: string,
        revSeq?: string,
        amplicon?: number
    } | null) => void;
    /** Panel state from a loaded session, applied once at mount (panel remounts per import). */
    restoredState?: FlankingPanelState | null;
    /** Publishes durable panel state upward so session saves capture the user's primer work. */
    onPanelStateChange?: (state: FlankingPanelState) => void;
    searchEngine?: 'primer3' | 'strider';
    onParameterSetChange?: (value: string) => void;
}

const API = ((import.meta.env.VITE_API_BASE as string) || '');

type PreviewMSAProps = React.ComponentProps<typeof MSAViewer>;

// Hands the one-shot zoom to the embedded viewer only after it has measured its
// real width and label column (~200ms). Delivered at mount it would compute the
// centering with default metrics and, being deliberately one-shot, never retry;
// which is why the preview used to open on the wrong spot. The wrapper remounts
// with every preview open, so the delivery re-arms each time.
function DelayedNavMSA(props: PreviewMSAProps) {
    const [nav, setNav] = useState<PreviewMSAProps['navigateTarget']>(null);
    useEffect(() => {
        const t: ReturnType<typeof setTimeout> = setTimeout(() => setNav(props.navigateTarget ?? null), 200);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <MSAViewer {...props} navigateTarget={nav} />;
}

export default function FlankingPrimersPanel({
    rawSeq, oligoStart, oligoEnd,
    p1Start, p1End, p2Start, p2End,
    alignment, oligoPrimers, navigateTarget, isDarkMode,
    idtCredentials, gappedData, onFlankingPrimersUpdate,
    restoredState, onPanelStateChange, searchEngine, onParameterSetChange
}: Props) {
    // Primer3 params : initialized from a restored session when present
    const rp = restoredState?.params ?? FLANKING_PANEL_DEFAULTS.params;
    const [flankWindow, setFlankWindow] = useState(rp.flankWindow);
    const [optSize, setOptSize] = useState(rp.optSize);
    const [minSize, setMinSize] = useState(rp.minSize);
    const [maxSize, setMaxSize] = useState(rp.maxSize);
    const [optTm, setOptTm] = useState(rp.optTm);
    const [minTm, setMinTm] = useState(rp.minTm);
    const [maxTm, setMaxTm] = useState(rp.maxTm);
    const [minGc, setMinGc] = useState(rp.minGc);
    const [maxGc, setMaxGc] = useState(rp.maxGc);
    const [numReturn, setNumReturn] = useState(rp.numReturn);
    const [showAdv, setShowAdv] = useState(restoredState?.showAdv ?? false);
    const [mvConc, setMvConc] = useState(rp.mvConc);
    const [dvConc, setDvConc] = useState(rp.dvConc);
    const [dntpConc, setDntpConc] = useState(rp.dntpConc);
    const [dnaConc, setDnaConc] = useState(rp.dnaConc);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState<DesignResult | null>(restoredState?.result ?? null);

    // selected primer to "use"
    const [selFwd, setSelFwd] = useState<DesignedPrimer | null>(restoredState?.selFwd ?? null);
    const [selRev, setSelRev] = useState<DesignedPrimer | null>(restoredState?.selRev ?? null);
    // Debounce refs for IDT analysis after drag
    const idtDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const idtPairDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const skipNextPairEffectRef = useRef(false);

    const [fwdName, setFwdName] = useState(restoredState?.fwdName ?? '');
    const [revName, setRevName] = useState(restoredState?.revName ?? '');

    // Preview modal: shows a candidate's binding site without selecting it, so
    // no IDT analysis runs until the user explicitly clicks "Use". The MSA
    // payload is frozen at open time (see openPreview).
    const [previewPrimer, setPreviewPrimer] = useState<{
        primer: DesignedPrimer;
        side: 'fwd' | 'rev';
        ts: number;
        msaFlanking: { fwd: { start: number; end: number } | null; rev: { start: number; end: number } | null } | null;
        msaNav: { colStart: number; colEnd: number; ts: number } | null;
        msaAlignment: string | null;
    } | null>(null);

    const [copyFb, setCopyFb] = useState('');
    const doCopy = (text: string, key: string) => {
        const fb = () => { const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); setCopyFb(key); setTimeout(() => setCopyFb(''), 2000); } catch { } document.body.removeChild(t); };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => { setCopyFb(key); setTimeout(() => setCopyFb(''), 2000); }).catch(fb);
        else fb();
    };

    const [manualLeftStart, setManualLeftStart] = useState<number | null>(restoredState?.manual.leftStart ?? null);
    const [manualLeftEnd, setManualLeftEnd] = useState<number | null>(restoredState?.manual.leftEnd ?? null);
    const [manualRightStart, setManualRightStart] = useState<number | null>(restoredState?.manual.rightStart ?? null);
    const [manualRightEnd, setManualRightEnd] = useState<number | null>(restoredState?.manual.rightEnd ?? null);

    const handleRegionSelect = (startCol: number, endCol: number) => {
        const mStart = Math.min(p1Start, p2Start);
        const mEnd = Math.max(p1End, p2End);
        
        if (endCol <= mStart) {
            setManualLeftStart(startCol);
            setManualLeftEnd(endCol);
        } else if (startCol >= mEnd) {
            setManualRightStart(startCol);
            setManualRightEnd(endCol);
        }
    };

    const handleMouseUp = () => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;
        
        const getIdx = (node: Node | null) => {
            if (!node) return null;
            const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement;
            const idxStr = element?.getAttribute('data-idx');
            return idxStr ? parseInt(idxStr, 10) : null;
        };

        const anchorIdx = getIdx(sel.anchorNode);
        const focusIdx = getIdx(sel.focusNode);

        if (anchorIdx !== null && focusIdx !== null) {
            const startCol = Math.min(anchorIdx, focusIdx);
            const endCol = Math.max(anchorIdx, focusIdx) + 1; // inclusive
            handleRegionSelect(startCol, endCol);
            sel.removeAllRanges();
        }
    };

    const design = async (signal?: AbortSignal) => {
        setLoading(true); setError(''); setResult(null); setSelFwd(null); setSelRev(null);
        try {
            const res = await fetch(API + '/flanking_primers/design', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal,
                body: JSON.stringify({
                    full_seq: rawSeq, oligo_start: oligoStart, oligo_end: oligoEnd,
                    engine: searchEngine,
                    flank_window: flankWindow,
                    opt_size: optSize, min_size: minSize, max_size: maxSize,
                    opt_tm: optTm, min_tm: minTm, max_tm: maxTm,
                    min_gc: minGc, max_gc: maxGc, num_return: numReturn,
                    mv_conc: mvConc, dv_conc: dvConc, dntp_conc: dntpConc, dna_conc: dnaConc,
                    manual_left_start: manualLeftStart, manual_left_end: manualLeftEnd,
                    manual_right_start: manualRightStart, manual_right_end: manualRightEnd,
                }),
            });
            if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Design failed'); }
            setResult(await res.json());
        } catch (e: any) {
            if (e?.name === 'AbortError') return;
            setError(e.message);
        } finally { if (!signal?.aborted) setLoading(false); }
    };

    // Auto-design when the MOLigo bounds change from user dragging it in the upper viewer.
    // A drag fires one effect run per intermediate position, so debounce until the
    // pointer settles and abort any in-flight request before issuing a new one.
    const prevOligoRef = useRef({ start: oligoStart, end: oligoEnd });
    const prevEngineRef = useRef(searchEngine);
    const designAbortRef = useRef<AbortController | null>(null);
    const designDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        const oligoChanged = prevOligoRef.current.start !== oligoStart || prevOligoRef.current.end !== oligoEnd;
        const engineChanged = prevEngineRef.current !== searchEngine;
        if (!oligoChanged && !engineChanged) return;
        prevOligoRef.current = { start: oligoStart, end: oligoEnd };
        prevEngineRef.current = searchEngine;
        if (manualLeftStart !== null || manualRightStart !== null) return;
        if (designDebounceRef.current !== null) clearTimeout(designDebounceRef.current);
        designDebounceRef.current = setTimeout(() => {
            designDebounceRef.current = null;
            designAbortRef.current?.abort();
            const ac = new AbortController();
            designAbortRef.current = ac;
            design(ac.signal);
        }, 300);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [oligoStart, oligoEnd, searchEngine]);

    // Tear down pending auto-design work on unmount
    useEffect(() => () => {
        if (designDebounceRef.current !== null) clearTimeout(designDebounceRef.current);
        designAbortRef.current?.abort();
    }, []);

    const designManual = async () => {
        if (manualLeftStart === null && manualRightStart === null) {
            setError("Select a manual region in the sequence below first.");
            return;
        }

        setError('');
        setLoading(true);

        const revComp = (s: string) => {
            const map: any = { A: 'T', T: 'A', C: 'G', G: 'C', a: 't', t: 'a', c: 'g', g: 'c' };
            return s.split('').reverse().map(c => map[c] || c).join('');
        };

        const calcGC = (seq: string) => {
            if (!seq) return 0;
            const gc = seq.match(/[GCgc]/g)?.length || 0;
            return Number(((gc / seq.length) * 100).toFixed(1));
        };

        const newResult: DesignResult = {
            forward: { num_returned: 0, explain: "", primers: [] },
            reverse: { num_returned: 0, explain: "", primers: [] },
            pair_metrics: null
        };

        let fwdSeq: string | null = null;
        let revSeq: string | null = null;
        let fwdPrimerObj: DesignedPrimer | null = null;
        let revPrimerObj: DesignedPrimer | null = null;

        if (manualLeftStart !== null && manualLeftEnd !== null) {
            fwdSeq = rawSeq.substring(manualLeftStart, manualLeftEnd).toUpperCase();
            const gc = calcGC(fwdSeq);
            fwdPrimerObj = {
                sequence: fwdSeq,
                length: fwdSeq.length,
                interval: [manualLeftStart, manualLeftEnd] as [number, number],
                tm: null, tm_strider: null, gc_percent: gc,
                primer3: { tm: null, gc_percent: gc, self_any: null, self_end: null, hairpin_th: null },
                hairpin: { structure_found: false, tm: null, dg: null },
                homodimer: { structure_found: false, tm: null, dg: null }
            };
            newResult.forward.primers.push(fwdPrimerObj);
            newResult.forward.num_returned = 1;
        }

        if (manualRightStart !== null && manualRightEnd !== null) {
            const fwdStrandSeq = rawSeq.substring(manualRightStart, manualRightEnd).toUpperCase();
            revSeq = revComp(fwdStrandSeq);
            const gc = calcGC(revSeq);
            revPrimerObj = {
                sequence: revSeq,
                length: revSeq.length,
                interval: [manualRightStart, manualRightEnd] as [number, number],
                tm: null, tm_strider: null, gc_percent: gc,
                primer3: { tm: null, gc_percent: gc, self_any: null, self_end: null, hairpin_th: null },
                hairpin: { structure_found: false, tm: null, dg: null },
                homodimer: { structure_found: false, tm: null, dg: null }
            };
            newResult.reverse.primers.push(revPrimerObj);
            newResult.reverse.num_returned = 1;
        }

        setResult(newResult);

        if (fwdPrimerObj) {
            setSelFwd(fwdPrimerObj);
            setAnalyzingStriderIndiv(prev => ({ ...prev, [fwdPrimerObj.sequence]: true }));
            analyzeStriderIndividual(fwdPrimerObj.sequence);
        } else {
            setSelFwd(null);
        }

        if (revPrimerObj) {
            setSelRev(revPrimerObj);
            setAnalyzingStriderIndiv(prev => ({ ...prev, [revPrimerObj.sequence]: true }));
            analyzeStriderIndividual(revPrimerObj.sequence);
        } else {
            setSelRev(null);
        }

        try {
            const analyses: Promise<void>[] = [];
            if (fwdPrimerObj) {
                analyses.push((async () => {
                    const data = await analyzePrimerP3(fwdPrimerObj!.sequence);
                    fwdPrimerObj!.tm = data.tm;
                    fwdPrimerObj!.tm_strider = data.tm_strider ?? null;
                    fwdPrimerObj!.gc_percent = data.gc_percent;
                    fwdPrimerObj!.primer3 = {
                        tm: data.tm,
                        gc_percent: data.gc_percent,
                        self_any: null,
                        self_end: null,
                        hairpin_th: data.hairpin.tm
                    };
                    fwdPrimerObj!.hairpin = data.hairpin;
                    fwdPrimerObj!.homodimer = data.homodimer;
                })());
            }
            if (revPrimerObj) {
                analyses.push((async () => {
                    const data = await analyzePrimerP3(revPrimerObj!.sequence);
                    revPrimerObj!.tm = data.tm;
                    revPrimerObj!.tm_strider = data.tm_strider ?? null;
                    revPrimerObj!.gc_percent = data.gc_percent;
                    revPrimerObj!.primer3 = {
                        tm: data.tm,
                        gc_percent: data.gc_percent,
                        self_any: null,
                        self_end: null,
                        hairpin_th: data.hairpin.tm
                    };
                    revPrimerObj!.hairpin = data.hairpin;
                    revPrimerObj!.homodimer = data.homodimer;
                })());
            }
            await Promise.all(analyses);
            setResult({ ...newResult });
        } catch (e: any) {
            setError(e.message || 'Primer3 Tm analysis failed');
        } finally {
            setLoading(false);
        }
    };

    // Nav target set when user clicks a flanking primer bar in the minimap
    const [primerNavTarget, setPrimerNavTarget] = useState<{ colStart: number; colEnd: number; ts: number } | null>(null);
    const handleFlankingPrimerClick = useCallback((colStart: number, colEnd: number) => {
        setPrimerNavTarget({ colStart, colEnd, ts: Date.now() });
    }, []);

    // Parse the full gapped query sequence from the alignment string once.
    // This is always correct regardless of the current viewport/zoom level.
    const fullQueryGapped = useMemo((): string => {
        if (!alignment) return '';
        const lines = alignment.split('\n');
        let seq = '';
        let recording = false;
        for (const line of lines) {
            if (line.startsWith('>')) {
                if (recording) break; // stop after first sequence
                recording = true;
            } else if (recording) {
                seq += line.trim();
            }
        }
        return seq;
    }, [alignment]);

    // ungapped rawSeq position → absolute gapped alignment column (using full alignment)
    const mapRawToFullGapped = useCallback((ungapped: number): number => {
        if (!fullQueryGapped) return ungapped;
        let count = 0;
        for (let i = 0; i < fullQueryGapped.length; i++) {
            if (fullQueryGapped[i] !== '-') {
                if (count === ungapped) return i;
                count++;
            }
        }
        return fullQueryGapped.length;
    }, [fullQueryGapped]);

    // absolute gapped alignment column → ungapped rawSeq position (using full alignment)
    const mapFullGappedToRaw = useCallback((col: number): number => {
        if (!fullQueryGapped) return col;
        let count = 0;
        for (let i = 0; i < Math.min(col, fullQueryGapped.length); i++) {
            if (fullQueryGapped[i] !== '-') count++;
        }
        return count;
    }, [fullQueryGapped]);

    // Called when user drags a region in the lower bar of the main canvas.
    // Inlines the left/right oligo boundary check directly so p1Start/p2Start etc.
    // are always current (avoids stale-closure bug from calling handleRegionSelect).
    const handleMSARegionSelect = useCallback((startCol: number, endCol: number) => {
        const startRaw = mapFullGappedToRaw(startCol);
        const endRaw   = mapFullGappedToRaw(endCol);
        const mStart = Math.min(p1Start, p2Start);
        const mEnd   = Math.max(p1End,   p2End);
        if (endRaw <= mStart) {
            setManualLeftStart(startRaw);
            setManualLeftEnd(endRaw);
        } else if (startRaw >= mEnd) {
            setManualRightStart(startRaw);
            setManualRightEnd(endRaw);
        }
    }, [mapFullGappedToRaw, p1Start, p1End, p2Start, p2End]);

    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [idtResults, setIdtResults] = useState<any>(restoredState?.pairIdtResults ?? null);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const [isAnalysisExpanded, setIsAnalysisExpanded] = useState(true);

    // Strider pair results (local-only, no IDT API call). Auto-fires on selection.
    const [striderPairResults, setStriderPairResults] = useState<any>(restoredState?.pairStriderResults ?? null);
    const [isAnalyzingStriderPair, setIsAnalyzingStriderPair] = useState(false);

    // Stale-run guard: only the latest invocation may mutate analysis state.
    const pairRunRef = useRef(0);
    const striderPairRunRef = useRef(0);
    const runProductAnalysis = useCallback(async (p1Seq: string, p2Seq: string) => {
        const runId = ++pairRunRef.current;
        setIsAnalyzing(true);
        setAnalysisError(null);
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
            if (!tRes.ok) throw new Error("IDT Auth Failed");
            const { access_token } = await tRes.json();

            const aRes = await fetch(((import.meta.env.VITE_API_BASE as string) || "") + '/idt/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    p1_seq: p1Seq,
                    p2_seq: p2Seq,
                    token: access_token,
                    mg_conc: dvConc,
                    mv_conc: mvConc,
                    dntp_conc: dntpConc,
                    oligo_conc: dnaConc / 1000,
                    idt_region: idtCredentials.region || 'eu',
                    parameter_set: idtCredentials.parameterSet || 'mathews2004-dna',
                })
            });
            if (!aRes.ok) throw new Error("Product Analysis Failed");
            const results = await aRes.json();
            if (runId === pairRunRef.current) {
                setIdtResults(results);
                setIsAnalysisExpanded(true); // auto-expand when new results arrive
            }
        } catch (err: any) {
            if (runId === pairRunRef.current) setAnalysisError(err.message);
        } finally {
            if (runId === pairRunRef.current) setIsAnalyzing(false);
        }
    }, [idtCredentials, dvConc, mvConc, dntpConc, dnaConc]);

    const runStriderPairAnalysis = useCallback(async (p1Seq: string, p2Seq: string) => {
        const runId = ++striderPairRunRef.current;
        setIsAnalyzingStriderPair(true);
        try {
            const aRes = await fetch(((import.meta.env.VITE_API_BASE as string) || "") + '/strider/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    p1_seq: p1Seq,
                    p2_seq: p2Seq,
                    mg_conc: dvConc,
                    mv_conc: mvConc,
                    dntp_conc: dntpConc,
                    oligo_conc: dnaConc / 1000,
                    parameter_set: idtCredentials?.parameterSet || 'mathews2004-dna',
                })
            });
            if (!aRes.ok) throw new Error("Strider Analysis Failed");
            const results = await aRes.json();
            if (runId === striderPairRunRef.current) {
                setStriderPairResults(results);
                setIsAnalysisExpanded(true);
            }
        } catch (err: any) {
            if (runId === striderPairRunRef.current) console.error(err);
        } finally {
            if (runId === striderPairRunRef.current) setIsAnalyzingStriderPair(false);
        }
    }, [dvConc, mvConc, dntpConc, dnaConc]);

    const [idtResultsIndiv, setIdtResultsIndiv] = useState<Record<string, any>>(restoredState?.idtResultsIndiv ?? {});
    const [analyzingIndiv, setAnalyzingIndiv] = useState<Record<string, boolean>>({});

    // Strider individual results (local-only, no IDT API call). Fires on "Use".
    const [striderResultsIndiv, setStriderResultsIndiv] = useState<Record<string, any>>(restoredState?.striderResultsIndiv ?? {});
    const [analyzingStriderIndiv, setAnalyzingStriderIndiv] = useState<Record<string, boolean>>({});

    const analyzeIndividual = async (seq: string) => {
        if (!idtCredentials) return;
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
            if (!tRes.ok) throw new Error("IDT Auth Failed");
            const { access_token } = await tRes.json();

            const aRes = await fetch(((import.meta.env.VITE_API_BASE as string) || "") + '/idt/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    p1_seq: seq,
                    p2_seq: "A", // dummy to satisfy backend
                    token: access_token,
                    mg_conc: dvConc,
                    mv_conc: mvConc,
                    dntp_conc: dntpConc,
                    oligo_conc: dnaConc / 1000,
                    idt_region: idtCredentials.region || 'eu',
                    parameter_set: idtCredentials.parameterSet || 'mathews2004-dna',
                })
            });
            if (!aRes.ok) throw new Error("Product Analysis Failed");
            const res = await aRes.json();
            setIdtResultsIndiv(prev => ({ ...prev, [seq]: res.m1 }));
        } catch (err) {
            console.error(err);
        } finally {
            setAnalyzingIndiv(prev => ({ ...prev, [seq]: false }));
        }
    };

    const analyzeStriderIndividual = async (seq: string) => {
        try {
            const aRes = await fetch(((import.meta.env.VITE_API_BASE as string) || "") + '/strider/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    p1_seq: seq,
                    mg_conc: dvConc,
                    mv_conc: mvConc,
                    dntp_conc: dntpConc,
                    oligo_conc: dnaConc / 1000,
                    parameter_set: idtCredentials?.parameterSet || 'mathews2004-dna',
                })
            });
            if (!aRes.ok) throw new Error("Strider Analysis Failed");
            const res = await aRes.json();
            setStriderResultsIndiv(prev => ({ ...prev, [seq]: res.m1 }));
        } catch (err) {
            console.error(err);
        } finally {
            setAnalyzingStriderIndiv(prev => ({ ...prev, [seq]: false }));
        }
    };

    const analyzePrimerP3 = useCallback(async (seq: string) => {
        const res = await fetch(API + '/primers/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sequence: seq,
                mv_conc: mvConc,
                dv_conc: dvConc,
                dntp_conc: dntpConc,
                dna_conc: dnaConc,
            }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || 'Primer3 analysis failed');
        }
        return await res.json();
    }, [mvConc, dvConc, dntpConc, dnaConc]);

    // Stable ref for values read inside the drag effect's mouseup closure.
    // The closure must not be recreated on every render while dragging.
    const latestRef = useRef({ idtCredentials, selFwd, selRev, analyzeIndividual, analyzeStriderIndividual, runProductAnalysis, runStriderPairAnalysis, analyzePrimerP3 });
    useEffect(() => {
        latestRef.current = { idtCredentials, selFwd, selRev, analyzeIndividual, analyzeStriderIndividual, runProductAnalysis, runStriderPairAnalysis, analyzePrimerP3 };
    });

    const prevParamSetRef = useRef(idtCredentials?.parameterSet);
    useEffect(() => {
        if (prevParamSetRef.current !== idtCredentials?.parameterSet) {
            prevParamSetRef.current = idtCredentials?.parameterSet;
            const seqs = Object.keys(striderResultsIndiv);
            seqs.forEach(seq => {
                setAnalyzingStriderIndiv(prev => ({ ...prev, [seq]: true }));
                analyzeStriderIndividual(seq);
            });
        }
    }, [idtCredentials?.parameterSet]);

    // Primitive keys: primer3 salt params (mvConc, dvConc, dntpConc, dnaConc)
    // are panel-local state : concKey re-fires the pair effect when they change.
    const selFwdSeq = selFwd?.sequence;
    const selRevSeq = selRev?.sequence;
    const concKey = [mvConc, dvConc, dntpConc, dnaConc].join(':');
    useEffect(() => {
        if (skipNextPairEffectRef.current) {
            // Reset flag and skip this invocation (debounced handler will run analysis)
            skipNextPairEffectRef.current = false;
            return;
        }
        if (selFwdSeq && selRevSeq) {
            // Strider pair analysis fires automatically (local, no credentials needed).
            runStriderPairAnalysis(selFwdSeq, selRevSeq);
        } else {
            setStriderPairResults(null);
            setIdtResults(null);
            setAnalysisError(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selFwdSeq, selRevSeq, concKey]);

    // Cleanup debounced timers on component unmount
    useEffect(() => {
        return () => {
            if (idtDebounceRef.current) clearTimeout(idtDebounceRef.current);
            if (idtPairDebounceRef.current) clearTimeout(idtPairDebounceRef.current);
        };
    }, []);

    const getIdtStatusColor = (dg: number | undefined) => {
        if (dg === undefined || dg === null) return 'text-zinc-400';
        if (dg < -9) return 'text-red-500 font-bold';
        if (dg < -6) return 'text-amber-500 font-medium';
        return 'text-emerald-500';
    };

    const extractTm = (analyzeData: any) => {
        if (!analyzeData || analyzeData.error) return null;

        const getTmFromObj = (obj: any) => {
            if (obj === null || typeof obj !== 'object') return null;
            return obj.IDT_Tm !== undefined ? obj.IDT_Tm
                : obj.Tm !== undefined ? obj.Tm
                    : obj.MeltingTemperature !== undefined ? obj.MeltingTemperature
                        : obj.MeltTemp !== undefined ? obj.MeltTemp
                            : obj.tm !== undefined ? obj.tm
                                : obj.meltingTemperature !== undefined ? obj.meltingTemperature
                                    : obj.meltTemp !== undefined ? obj.meltTemp
                                        : null;
        };

        if (Array.isArray(analyzeData) && analyzeData.length > 0) {
            return getTmFromObj(analyzeData[0]);
        }
        return getTmFromObj(analyzeData);
    };

    const renderResultCard = (title: string, data: any, maxItems = 1, itemOffset = 0) => {
        if (!data || data.error) return null;
        const items = (Array.isArray(data.raw) ? data.raw : [data.raw]).filter((item: unknown) => !!item && typeof item === 'object');
        const displayItems = items.slice(itemOffset, itemOffset + maxItems);
        if (displayItems.length === 0) return null;
        const topDg = displayItems[0]?.DeltaG ?? displayItems[0]?.Local_DeltaG ?? data.DeltaG;

        return (
            <div className="card p-3 flex flex-col gap-2">
                <div className="flex justify-between items-center border-b border-zinc-100 dark:border-zinc-800 pb-2">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider text-ellipsis overflow-hidden whitespace-nowrap">{title}</span>
                    <span className={`text-xs flex-shrink-0 font-mono tabular-nums ${getIdtStatusColor(topDg)}`}>{topDg != null ? `${topDg.toFixed(2)} kcal/mol` : 'N/A'}</span>
                </div>
                <div className="flex flex-col gap-3 mt-1">
                    {displayItems.map((item: any, i: number) => {
                        const itemDg = item.DeltaG ?? null;
                        const itemLocalDg = item.Local_DeltaG ?? null;
                        const itemIdtTm = item.IDT_Tm ?? null;
                        const itemLocalTm = item.Local_Tm ?? null;
                        const hasStructure = !!(item.DotBracket || item.Local_DotBracket || item.Bonds);
                        return (
                            <div key={i} className={`flex flex-col gap-2 ${maxItems > 1 && i > 0 ? 'border-t border-zinc-100 dark:border-zinc-800 pt-3' : ''}`}>
                                {/* Provenance block (dG + Tm together, above the structure : mirrors MOLigo). */}
                                {(!hasStructure && topDg == null && itemLocalDg == null) ? (
                                    <div className="text-[9px] text-zinc-400 italic text-center px-1 py-0.5">No stable structure found</div>
                                ) : (
                                    <div className="flex flex-col gap-0.5 text-[9px] text-zinc-400 font-medium px-1">
                                        <div className="flex justify-between items-center">
                                            {maxItems > 1 && <span className="font-semibold text-[10px]">{title} {i + 1}</span>}
                                            <div className="flex gap-3 ml-auto">
                                                <span>IDT ΔG: <b className={`font-mono tabular-nums ${getIdtStatusColor(itemDg ?? undefined)}`}>{itemDg != null ? `${itemDg > 0 ? '+' : ''}${itemDg.toFixed(2)}` : '–'}</b></span>
                                                <span>Strider ΔG: <b className={`font-mono tabular-nums ${itemLocalDg != null ? (itemLocalDg <= 0 ? "text-amber-500" : "text-zinc-400") : "text-zinc-400"}`}>{itemLocalDg != null ? `${itemLocalDg > 0 ? '+' : ''}${itemLocalDg.toFixed(2)}` : '–'}</b></span>
                                            </div>
                                        </div>
                                        <div className="flex gap-3 justify-end opacity-80">
                                            <span>IDT Tm: <b className="font-mono tabular-nums text-zinc-500">{itemIdtTm != null ? `${Number(itemIdtTm).toFixed(1)}°C` : '–'}</b></span>
                                            <span>Strider Tm: <b className="font-mono tabular-nums text-zinc-500">{itemLocalTm != null ? `${itemLocalTm.toFixed(1)}°C` : '–'}</b></span>
                                        </div>
                                    </div>
                                )}
                                {/* Structure below provenance. */}
                                {hasStructure && (
                                    <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded p-2 overflow-x-auto">
                                        {item.Sequence && item.Sequence.includes('&') ? (
                                            <DimerAscii seq={item.Sequence} dotBracket={item.DotBracket || item.Local_DotBracket} raw={item} />
                                        ) : (
                                            <HairpinSVG seq={item.Sequence || item.dot_bracket || ''} dotBracket={item.DotBracket || item.Local_DotBracket} />
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    // ── Static sequence view refs/state (hoisted so drag code can use them) ──
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [lineLength, setLineLength] = useState(150);

    React.useEffect(() => {
        if (!containerRef.current) return;
        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                const width = entry.contentRect.width;
                const chars = Math.floor((width - 80) / 7.2);
                setLineLength(Math.max(40, Math.min(200, chars)));
            }
        });
        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, []);

    // ── Drag state for interactive flanking primer editing ───────────────────
    const [flankDragState, setFlankDragState] = useState<{
        id: 'fwd' | 'rev';
        type: 'move' | 'left' | 'right';
        startX: number;
        deltaChars: number;
        initStart: number;
        initEnd: number;
    } | null>(null);
    const flankCharWidthRef = useRef<number>(7.2);

    const revComp = useCallback((s: string) => {
        const map: Record<string, string> = { A: 'T', T: 'A', C: 'G', G: 'C', a: 't', t: 'a', c: 'g', g: 'c' };
        return s.split('').reverse().map(c => map[c] || c).join('');
    }, []);

    const calcGCLocal = (seq: string) => {
        if (!seq) return 0;
        return Number(((seq.match(/[GCgc]/g)?.length || 0) / seq.length * 100).toFixed(1));
    };

    // These must be above liveFwdInterval/liveRevInterval which reference them
    const fwdInterval = selFwd?.interval as [number, number] | undefined;
    const revInterval = selRev?.interval as [number, number] | undefined;

    // Amplicon size: forward primer + template between the primers + reverse primer.
    // Intervals are rawSeq coordinates, [start, end) end-exclusive, so this span
    // equals len(fwd) + intervening bases + len(rev).
    const ampliconBp = (fwdInterval && revInterval && revInterval[1] > fwdInterval[0])
        ? revInterval[1] - fwdInterval[0]
        : null;

    const moligoStart = Math.min(p1Start, p2Start);
    const moligoEnd = Math.max(p1End, p2End);

    const getPrimerInterval = (p: DesignedPrimer, side: 'fwd' | 'rev'): [number, number] | null => {
        if (p.interval) return p.interval;
        const binding = side === 'fwd' ? p.sequence : revComp(p.sequence);
        const pos = rawSeq.toUpperCase().indexOf(binding.toUpperCase());
        return pos >= 0 ? [pos, pos + binding.length] : null;
    };

    // Bracket suffix per spec: forward "(80–60)" = the primer spans 60–80 bp
    // upstream of the MOLigo start; reverse "(50–70)" = 50–70 bp past its end.
    const relativeMOLigoPos = (p: DesignedPrimer, side: 'fwd' | 'rev'): string | null => {
        const iv = getPrimerInterval(p, side);
        if (!iv) return null;
        return side === 'fwd'
            ? `(${moligoStart - iv[0]}–${moligoStart - iv[1]})`
            : `(${iv[0] - moligoEnd}–${iv[1] - moligoEnd})`;
    };

    useEffect(() => {
        if (!previewPrimer) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreviewPrimer(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [previewPrimer]);

    const handleFlankMouseDown = (e: React.MouseEvent, id: 'fwd' | 'rev', type: 'move' | 'left' | 'right') => {
        e.preventDefault();
        e.stopPropagation();
        const interval = id === 'fwd' ? fwdInterval : revInterval;
        if (!interval) return;
        // Measure actual char width from a rendered span in the container
        if (containerRef.current) {
            const span = containerRef.current.querySelector('span[data-idx]');
            if (span) flankCharWidthRef.current = span.getBoundingClientRect().width || 7.2;
        }
        setFlankDragState({ id, type, startX: e.clientX, deltaChars: 0, initStart: interval[0], initEnd: interval[1] });
    };

    useEffect(() => {
        if (!flankDragState) return;

        const onMove = (e: MouseEvent) => {
            const delta = Math.round((e.clientX - flankDragState.startX) / flankCharWidthRef.current);
            setFlankDragState(prev => prev ? { ...prev, deltaChars: delta } : null);
        };

        const onUp = () => {
            if (!flankDragState) return;
            const D = flankDragState.deltaChars;
            if (D !== 0) {
                const { id, type, initStart, initEnd } = flankDragState;
                let newStart = initStart;
                let newEnd = initEnd;

                if (type === 'move') { newStart += D; newEnd += D; }
                else if (type === 'left') { newStart += D; }
                else if (type === 'right') { newEnd += D; }

                // Clamp to valid range
                const minLen = 10;
                if (newEnd - newStart < minLen) {
                    if (type === 'left') newStart = newEnd - minLen;
                    else newEnd = newStart + minLen;
                }
                newStart = Math.max(0, newStart);
                newEnd = Math.min(rawSeq.length, newEnd);

                const newInterval: [number, number] = [newStart, newEnd];
                const fwdStrandSeq = rawSeq.substring(newStart, newEnd).toUpperCase();
                const seq = id === 'fwd' ? fwdStrandSeq : revComp(fwdStrandSeq);
                const gc = calcGCLocal(seq);
                const existingName = id === 'fwd' ? latestRef.current.selFwd?.name : latestRef.current.selRev?.name;
                const updated: DesignedPrimer = {
                    sequence: seq, length: seq.length, interval: newInterval,
                    gc_percent: gc, tm: null, tm_strider: null,
                    primer3: { tm: null, gc_percent: gc, self_any: null, self_end: null, hairpin_th: null },
                    hairpin: { structure_found: false, tm: null, dg: null },
                    homodimer: { structure_found: false, tm: null, dg: null },
                    name: existingName,
                };

                // Set loading states immediately so the debounce window shows "Analyzing...".
                const { selFwd: sf, selRev: sr, analyzeStriderIndividual: analyzeStriderInd, runStriderPairAnalysis: runStriderPair, analyzePrimerP3: p3Analyze } = latestRef.current;

                (async () => {
                    try {
                        const data = await p3Analyze(seq);
                        updated.tm = data.tm;
                        updated.tm_strider = data.tm_strider ?? null;
                        updated.gc_percent = data.gc_percent;
                        updated.primer3 = {
                            tm: data.tm,
                            gc_percent: data.gc_percent,
                            self_any: null,
                            self_end: null,
                            hairpin_th: data.hairpin.tm
                        };
                        updated.hairpin = data.hairpin;
                        updated.homodimer = data.homodimer;
                        if (id === 'fwd') setSelFwd({ ...updated });
                        else setSelRev({ ...updated });
                    } catch (err) {
                        console.error('Primer3 drag analysis failed', err);
                    }
                })();

                if (updated.sequence) {
                    // Prevent immediate pair-effect from running
                    skipNextPairEffectRef.current = true;

                    // Debounced individual Strider analysis (local, no credentials needed)
                    if (idtDebounceRef.current) clearTimeout(idtDebounceRef.current);
                    setAnalyzingStriderIndiv(prev => ({ ...prev, [updated.sequence]: true }));
                    idtDebounceRef.current = setTimeout(() => {
                        analyzeStriderInd(updated.sequence);
                    }, 1500);

                    // Determine other primer sequence for pair analysis
                    const otherSeq = id === 'fwd' ? (sr?.sequence || '') : (sf?.sequence || '');
                    const p1Seq = id === 'fwd' ? updated.sequence : otherSeq;
                    const p2Seq = id === 'rev' ? updated.sequence : otherSeq;
                    if (p1Seq && p2Seq) {
                        if (idtPairDebounceRef.current) clearTimeout(idtPairDebounceRef.current);
                        setIsAnalyzingStriderPair(true);
                        idtPairDebounceRef.current = setTimeout(() => {
                            runStriderPair(p1Seq, p2Seq);
                        }, 1500);
                    }
                }

                if (id === 'fwd') {
                    setSelFwd(updated);
                    setManualLeftStart(newStart);
                    setManualLeftEnd(newEnd);
                } else {
                    setSelRev(updated);
                    setManualRightStart(newStart);
                    setManualRightEnd(newEnd);
                }
            }
            setFlankDragState(null);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    }, [flankDragState, rawSeq, revComp]);

    // Compute live intervals during drag
    const liveFwdInterval: [number, number] | undefined = (() => {
        if (!fwdInterval) return undefined;
        if (!flankDragState || flankDragState.id !== 'fwd') return fwdInterval;
        const D = flankDragState.deltaChars;
        const { type, initStart, initEnd } = flankDragState;
        let s = initStart, e = initEnd;
        if (type === 'move') { s += D; e += D; }
        else if (type === 'left') s += D;
        else if (type === 'right') e += D;
        return [Math.max(0, s), Math.min(rawSeq.length, e)];
    })();

    const liveRevInterval: [number, number] | undefined = (() => {
        if (!revInterval) return undefined;
        if (!flankDragState || flankDragState.id !== 'rev') return revInterval;
        const D = flankDragState.deltaChars;
        const { type, initStart, initEnd } = flankDragState;
        let s = initStart, e = initEnd;
        if (type === 'move') { s += D; e += D; }
        else if (type === 'left') s += D;
        else if (type === 'right') e += D;
        return [Math.max(0, s), Math.min(rawSeq.length, e)];
    })();

    // ── Static sequence view ─────────────────────────────────────────────────

    const actualOligoStart = Math.min(p1Start, p2Start);
    const actualOligoEnd = Math.max(p1End, p2End);

    let viewStart = Math.max(0, actualOligoStart - flankWindow);

    const viewEnd = Math.min(rawSeq.length, actualOligoEnd + flankWindow);

    const mapToGapped = (u: number) => {
        if (!gappedData) return u;
        const { seq, start, ungappedOffset } = gappedData;
        
        let targetRelative = u - (ungappedOffset || 0);

        if (targetRelative < 0) {
            // Outside view on left
            return Math.max(0, start + targetRelative);
        }

        let count = 0;
        for (let i = 0; i < seq.length; i++) {
            if (seq[i] !== '-') {
                if (count === targetRelative) return start + i;
                count++;
            }
        }
        // Outside view on right
        return start + seq.length + (targetRelative - count);
    };

    // flankingPrimers for MSAViewer : only show primers the user explicitly selected with "Use".
    // Use mapRawToFullGapped (derived from the full alignment) so coordinates are stable
    // regardless of the current viewport/zoom level. Never use the slice-based mapToGapped here.
    const activeFwd = selFwd;
    const activeRev = selRev;
    const flankingPrimersForMSA = useMemo(() => {
        if (!activeFwd?.interval && !activeRev?.interval) return null;
        return {
            fwd: activeFwd?.interval ? { start: mapRawToFullGapped(activeFwd.interval[0]), end: mapRawToFullGapped(activeFwd.interval[1]) } : null,
            rev: activeRev?.interval ? { start: mapRawToFullGapped(activeRev.interval[0]), end: mapRawToFullGapped(activeRev.interval[1]) } : null,
        };
    }, [activeFwd, activeRev, mapRawToFullGapped]);

    // Propagate the selection up to App (for the MSA highlight + session save).
    // Guard the FIRST emission: this panel remounts fresh on session load (its
    // parent QueryViewer is keyed by the import nonce), so without this guard the
    // initial empty render would fire `onFlankingPrimersUpdate(null)` and wipe the
    // primer selection App just restored from the session.
    const didEmitFlanking = useRef(false);
    useEffect(() => {
        if (!didEmitFlanking.current) {
            didEmitFlanking.current = true;
            if (!flankingPrimersForMSA) return; // don't clobber a restored selection
        }
        if (onFlankingPrimersUpdate) {
            onFlankingPrimersUpdate(flankingPrimersForMSA ? {
                ...flankingPrimersForMSA,
                fwdName: selFwd?.name || undefined,
                revName: selRev?.name || undefined,
                fwdSeq: selFwd?.sequence,
                revSeq: selRev?.sequence,
                amplicon: ampliconBp ?? undefined,
            } : null);
        }
    }, [flankingPrimersForMSA, onFlankingPrimersUpdate, selFwd?.name, selRev?.name, ampliconBp]);

    // Publish durable panel state for session saves. getPrimerInterval is resolved at
    // emit time so restored primers keep absolute positions even if the design
    // backend never returned coordinates for them.
    useEffect(() => {
        if (!onPanelStateChange) return;
        const withResolvedInterval = (p: DesignedPrimer | null, side: 'fwd' | 'rev'): FlankingDesignedPrimer | null =>
            p ? { ...p, interval: getPrimerInterval(p, side) ?? undefined } : null;
        onPanelStateChange({
            params: { flankWindow, optSize, minSize, maxSize, optTm, minTm, maxTm, minGc, maxGc, numReturn, mvConc, dvConc, dntpConc, dnaConc },
            showAdv,
            manual: { leftStart: manualLeftStart, leftEnd: manualLeftEnd, rightStart: manualRightStart, rightEnd: manualRightEnd },
            result,
            selFwd: withResolvedInterval(selFwd, 'fwd'),
            selRev: withResolvedInterval(selRev, 'rev'),
            fwdName,
            revName,
            idtResultsIndiv,
            pairIdtResults: idtResults,
            striderResultsIndiv,
            pairStriderResults: striderPairResults,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onPanelStateChange, rawSeq, flankWindow, optSize, minSize, maxSize, optTm, minTm, maxTm, minGc, maxGc, numReturn, showAdv, mvConc, dvConc, dntpConc, dnaConc, manualLeftStart, manualLeftEnd, manualRightStart, manualRightEnd, result, selFwd, selRev, fwdName, revName, idtResultsIndiv, idtResults, striderResultsIndiv, striderPairResults]);

    const gappedOligoPrimers = oligoPrimers ? {
        p1: { start: mapToGapped(oligoPrimers.p1.start), end: mapToGapped(oligoPrimers.p1.end) },
        p2: { start: mapToGapped(oligoPrimers.p2.start), end: mapToGapped(oligoPrimers.p2.end) }
    } : null;

    // Preview MSA shows the query record plus at most 14 hit records, so the
    // viewer stays compact no matter how many homologs were aligned.
    const sliceAlignmentForPreview = (fasta: string): string => {
        const records = fasta.split(/^>/m).filter(r => r.trim().length > 0);
        return records.slice(0, 15).map(r => `>${r}`).join('');
    };

    // Freezes the modal's MSA payload at open time: navigateTarget is a one-shot
    // zoom keyed on object identity, so anything recomputed per render would keep
    // yanking the scroll position back while the user pans the alignment. The
    // zoom-fit target spans everything relevant: previewed primer, the selected
    // partner (if any), and both MOLigos.
    const openPreview = (p: DesignedPrimer, side: 'fwd' | 'rev') => {
        const ts = Date.now();
        const iv = getPrimerInterval(p, side);
        if (!iv) {
            setPreviewPrimer({ primer: p, side, ts, msaFlanking: null, msaNav: null, msaAlignment: null });
            return;
        }
        const g: [number, number] = [mapRawToFullGapped(iv[0]), mapRawToFullGapped(iv[1])];
        const partnerSide = side === 'fwd' ? 'rev' : 'fwd';
        const partner = side === 'fwd' ? selRev : selFwd;
        const pIv = partner ? getPrimerInterval(partner, partnerSide) : null;
        const pg: [number, number] | null = pIv ? [mapRawToFullGapped(pIv[0]), mapRawToFullGapped(pIv[1])] : null;
        // Zoom-fit covers the previewed primer, the selected partner (if any),
        // and both MOLigos : everything the user needs in view at once. MOLigo
        // columns must come from mapRawToFullGapped (stable, full-alignment),
        // never the viewport-relative mapToGapped used by gappedOligoPrimers.
        const moligoG = oligoPrimers ? {
            p1: { start: mapRawToFullGapped(oligoPrimers.p1.start), end: mapRawToFullGapped(oligoPrimers.p1.end) },
            p2: { start: mapRawToFullGapped(oligoPrimers.p2.start), end: mapRawToFullGapped(oligoPrimers.p2.end) },
        } : null;
        const spanStarts = moligoG
            ? [g[0], pg?.[0], moligoG.p1.start, moligoG.p2.start].filter((v): v is number => v != null)
            : [g[0], ...(pg ? [pg[0]] : [])];
        const spanEnds = moligoG
            ? [g[1], pg?.[1], moligoG.p1.end, moligoG.p2.end].filter((v): v is number => v != null)
            : [g[1], ...(pg ? [pg[1]] : [])];
        setPreviewPrimer({
            primer: p, side, ts,
            msaFlanking: {
                fwd: side === 'fwd' ? { start: g[0], end: g[1] } : (pg ? { start: pg[0], end: pg[1] } : null),
                rev: side === 'rev' ? { start: g[0], end: g[1] } : (pg ? { start: pg[0], end: pg[1] } : null),
            },
            msaNav: { colStart: Math.max(0, Math.min(...spanStarts) - 30), colEnd: Math.max(...spanEnds) + 30, ts },
            msaAlignment: alignment ? sliceAlignmentForPreview(alignment) : null,
        });
    };

    const renderStaticSeq = () => {
        const chars = rawSeq.substring(viewStart, viewEnd).split('');
        const lines = [];
        for (let i = 0; i < chars.length; i += lineLength) {
            lines.push(chars.slice(i, i + lineLength));
        }

        const isDragging = !!flankDragState;

        return (
            <div className="font-mono text-xs leading-relaxed space-y-1" style={{ cursor: isDragging ? 'grabbing' : 'auto', userSelect: isDragging ? 'none' : 'text' }}>
                {lines.map((lineChars, lineIdx) => {
                    const lineStartPos = viewStart + lineIdx * lineLength + 1; // 1-indexed
                    const posStr = String(lineStartPos).padStart(6, ' ');
                    return (
                        <div key={lineIdx} className="flex">
                            <span className="text-zinc-400 mr-4 select-none whitespace-pre">{posStr}</span>
                            <span className="whitespace-pre">
                                {lineChars.map((char, charIdx) => {
                                    const i = viewStart + lineIdx * lineLength + charIdx;
                                    const isP1 = i >= p1Start && i < p1End;
                                    const isP2 = i >= p2Start && i < p2End;
                                    const isFwd = liveFwdInterval && i >= liveFwdInterval[0] && i < liveFwdInterval[1];
                                    const isRev = liveRevInterval && i >= liveRevInterval[0] && i < liveRevInterval[1];

                                    let cn = 'text-zinc-500 dark:text-zinc-400';
                                    let handlers: React.HTMLAttributes<HTMLSpanElement> = {};

                                    if (isP1) cn = 'bg-green-200 dark:bg-green-900/40 text-green-900 dark:text-green-300 font-bold';
                                    if (isP2) cn = 'bg-amber-200 dark:bg-amber-900/40 text-amber-900 dark:text-amber-300 font-bold';

                                    if (isFwd && liveFwdInterval) {
                                        const isEdge = i === liveFwdInterval[0] || i === liveFwdInterval[1] - 1;
                                        cn = `bg-emerald-300 dark:bg-emerald-700/60 text-emerald-900 dark:text-emerald-200 font-bold underline ${isEdge ? 'cursor-ew-resize' : 'cursor-grab active:cursor-grabbing'}`;
                                        if (i === liveFwdInterval[0]) handlers = { onMouseDown: (e) => handleFlankMouseDown(e, 'fwd', 'left') };
                                        else if (i === liveFwdInterval[1] - 1) handlers = { onMouseDown: (e) => handleFlankMouseDown(e, 'fwd', 'right') };
                                        else handlers = { onMouseDown: (e) => handleFlankMouseDown(e, 'fwd', 'move') };
                                    } else if (isRev && liveRevInterval) {
                                        const isEdge = i === liveRevInterval[0] || i === liveRevInterval[1] - 1;
                                        cn = `bg-teal-300 dark:bg-teal-700/60 text-teal-900 dark:text-teal-200 font-bold underline ${isEdge ? 'cursor-ew-resize' : 'cursor-grab active:cursor-grabbing'}`;
                                        if (i === liveRevInterval[0]) handlers = { onMouseDown: (e) => handleFlankMouseDown(e, 'rev', 'left') };
                                        else if (i === liveRevInterval[1] - 1) handlers = { onMouseDown: (e) => handleFlankMouseDown(e, 'rev', 'right') };
                                        else handlers = { onMouseDown: (e) => handleFlankMouseDown(e, 'rev', 'move') };
                                    }

                                    return <span key={i} data-idx={i} className={cn} {...handlers}>{char}</span>;
                                })}
                            </span>
                        </div>
                    );
                })}
            </div>
        );
    };

    // Read-only mirror of renderStaticSeq's highlight scheme, windowed to the
    // MOLigos plus the previewed primer with a small flank, without drag handlers.
    // An already-selected partner primer (opposite side) is rendered too, so the
    // user previews the candidate in its eventual pair context; the previewed
    // candidate is underlined to tell it apart from the selected partner.
    const renderPreviewSeq = (iv: [number, number], side: 'fwd' | 'rev', partnerIv: [number, number] | null, partnerSide: 'fwd' | 'rev' | null) => {
        const FLANK = 50;
        const LINE = 100;
        const winStart = Math.max(0, Math.min(moligoStart, iv[0], partnerIv?.[0] ?? Infinity) - FLANK);
        const winEnd = Math.min(rawSeq.length, Math.max(moligoEnd, iv[1], partnerIv?.[1] ?? -Infinity) + FLANK);
        const primerCn = side === 'fwd'
            ? 'bg-emerald-300 dark:bg-emerald-700/60 text-emerald-900 dark:text-emerald-200 font-bold underline'
            : 'bg-teal-300 dark:bg-teal-700/60 text-teal-900 dark:text-teal-200 font-bold underline';
        const partnerCn = partnerSide === 'fwd'
            ? 'bg-emerald-300 dark:bg-emerald-700/60 text-emerald-900 dark:text-emerald-200 font-bold'
            : 'bg-teal-300 dark:bg-teal-700/60 text-teal-900 dark:text-teal-200 font-bold';
        const rows = [];
        for (let rowStart = winStart; rowStart < winEnd; rowStart += LINE) {
            const row = rawSeq.slice(rowStart, Math.min(rowStart + LINE, winEnd));
            rows.push(
                <div key={rowStart} className="flex">
                    <span className="text-zinc-400 mr-4 select-none whitespace-pre">{String(rowStart + 1).padStart(6, ' ')}</span>
                    <span className="whitespace-pre">
                        {row.split('').map((char, j) => {
                            const i = rowStart + j;
                            const isP1 = i >= p1Start && i < p1End;
                            const isP2 = i >= p2Start && i < p2End;
                            const isPrimer = i >= iv[0] && i < iv[1];
                            const isPartner = partnerIv && i >= partnerIv[0] && i < partnerIv[1];
                            let cn = 'text-zinc-500 dark:text-zinc-400';
                            if (isP1) cn = 'bg-green-200 dark:bg-green-900/40 text-green-900 dark:text-green-300 font-bold';
                            if (isP2) cn = 'bg-amber-200 dark:bg-amber-900/40 text-amber-900 dark:text-amber-300 font-bold';
                            if (isPartner) cn = partnerCn;
                            if (isPrimer) cn = primerCn;
                            return <span key={i} className={cn}>{char}</span>;
                        })}
                    </span>
                </div>
            );
        }
        return <div className="font-mono text-xs leading-relaxed space-y-1 min-w-max">{rows}</div>;
    };

    // ── Primer result card ───────────────────────────────────────────────────
    const renderCard = (p: DesignedPrimer, side: 'fwd' | 'rev', idx: number) => {
        const isSelected = side === 'fwd' ? selFwd?.sequence === p.sequence : selRev?.sequence === p.sequence;
        const statusDg = (dg: number | null) => {
            if (dg === null) return 'text-zinc-400';
            if (dg < -6) return 'text-red-500 font-bold';
            if (dg < -3) return 'text-amber-500 font-bold';
            return 'text-emerald-500 font-bold';
        };
        const copyKey = `${side}-${idx}`;
        const relPos = relativeMOLigoPos(p, side);

        const striderResult = striderResultsIndiv[p.sequence];
        const idtResult = idtResultsIndiv[p.sequence];
        const indivResult = idtResult || striderResult;
        const isAnalStrider = analyzingStriderIndiv[p.sequence];
        const isAnalIdt = analyzingIndiv[p.sequence];

        return (
            <div key={idx} className={`rounded-lg border p-3 text-xs transition-all ${isSelected ? 'border-teal-600/60 dark:border-teal-300/40 bg-teal-700/5 dark:bg-teal-300/10' : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-zinc-500 dark:text-zinc-400 text-[10px] uppercase tracking-wider">#{idx + 1}</span>
                        {p.name && <span className="font-bold text-amber-600 dark:text-amber-400 text-[10px] uppercase tracking-wider">{p.name}</span>}
                        <span className="font-mono text-zinc-700 dark:text-zinc-200 break-all">{p.sequence}</span>
                        {relPos && (
                            <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500 whitespace-nowrap" title="Distance from the MOLigo region (bp)">
                                {relPos}
                            </span>
                        )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => {
                            if (!idtCredentials || isAnalIdt) return;
                            setAnalyzingIndiv(prev => ({ ...prev, [p.sequence]: true }));
                            analyzeIndividual(p.sequence);
                        }}
                            disabled={!idtCredentials || isAnalIdt}
                            title={!idtCredentials ? 'Configure IDT credentials in settings' : 'Run IDT OligoAnalyzer (re-calculates with current params)'}
                            className={`text-[10px] px-2 py-0.5 rounded-md border font-bold transition-all ${idtResult ? 'bg-blue-600 border-blue-600 text-white' : 'border-blue-600/40 text-blue-700 dark:text-blue-300 hover:bg-blue-700/10 dark:hover:bg-blue-300/10 disabled:opacity-40 disabled:cursor-not-allowed'}`}>
                            {isAnalIdt ? '...' : idtResult ? 'IDT ↻' : 'IDT'}
                        </button>
                        <button onClick={() => doCopy(p.sequence, copyKey)}
                            className="btn-secondary text-[10px] px-2 py-0.5">
                            {copyFb === copyKey ? 'Copied' : 'Copy'}
                        </button>
                        <button onClick={() => openPreview(p, side)}
                            className="btn-secondary text-[10px] px-2 py-0.5 text-teal-700 dark:text-teal-300">
                            Preview
                        </button>
                        <button onClick={() => {
                            if (!isSelected) {
                                if (side === 'fwd') { setSelFwd(p); setFwdName(p.name || ''); }
                                else { setSelRev(p); setRevName(p.name || ''); }
                                if (!striderResultsIndiv[p.sequence]) {
                                    setAnalyzingStriderIndiv(prev => ({ ...prev, [p.sequence]: true }));
                                }
                                analyzeStriderIndividual(p.sequence);
                            } else {
                                if (side === 'fwd') { setSelFwd(null); setFwdName(''); }
                                else { setSelRev(null); setRevName(''); }
                            }
                        }}
                            className={`text-[10px] px-2 py-0.5 rounded-md border font-bold transition-all ${isSelected ? 'bg-teal-600 border-teal-600 text-white' : 'border-teal-600/40 text-teal-700 dark:text-teal-300 hover:bg-teal-700/10 dark:hover:bg-teal-300/10'}`}>
                            {isSelected ? 'Used' : 'Use'}
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-7 gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                    <div><span className="font-bold text-zinc-600 dark:text-zinc-300">Len</span><br /><span className="font-mono tabular-nums">{p.length} bp</span></div>
                    <div><span className="font-bold text-zinc-600 dark:text-zinc-300">P3 Tm</span><br /><span className="font-mono tabular-nums">{p.tm ?? p.primer3?.tm ?? '–'}°C</span></div>
                    <div><span className="font-bold text-zinc-600 dark:text-zinc-300" title="IDT Tm">IDT Tm</span><br /><span className="font-mono tabular-nums">{idtResult?.analyze ? (extractTm(idtResult.analyze)?.toFixed(1) || 'N/A') + '°C' : '–'}</span></div>
                    <div><span className="font-bold text-zinc-600 dark:text-zinc-300" title="Strider duplex Tm">Strider Tm</span><br /><span className="font-mono tabular-nums">{p.tm_strider != null ? `${p.tm_strider.toFixed(1)}°C` : '–'}</span></div>
                    <div><span className="font-bold text-zinc-600 dark:text-zinc-300">GC</span><br /><span className="font-mono tabular-nums">{p.gc_percent ?? p.primer3?.gc_percent ?? '–'}%</span></div>
                    <div><span className="font-bold text-zinc-600 dark:text-zinc-300">Hairpin Tm</span><br /><span className={`font-mono tabular-nums ${p.hairpin.structure_found ? 'text-amber-500' : 'text-emerald-500'}`}>{p.hairpin.structure_found ? `${p.primer3?.hairpin_th ?? '–'}°C` : 'None'}</span></div>
                    <div><span className="font-bold text-zinc-600 dark:text-zinc-300">Self-dimer</span><br /><span className={`font-mono tabular-nums ${statusDg(p.homodimer?.dg)}`}>{p.homodimer?.dg !== null ? `${p.homodimer.dg} kcal` : 'OK'}</span></div>
                </div>

                {isSelected && (
                    <div className="mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-800/30">
                        <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <span>Structural Analysis (IDT + Strider)</span>
                            {(isAnalStrider || isAnalIdt) && <div className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />}
                        </div>
                        {indivResult ? (
                            <div className="flex flex-col gap-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {renderResultCard("Hairpin 1", indivResult.hairpin, 1, 0)}
                                    {renderResultCard("Hairpin 2", indivResult.hairpin, 1, 1)}
                                </div>
                                {renderResultCard("Self-Dimer", indivResult.self_dimer, 5)}
                            </div>
                        ) : isAnalStrider ? (
                            <div className="text-[10px] text-emerald-500/70">Analyzing via Strider...</div>
                        ) : isAnalIdt ? (
                            <div className="text-[10px] text-blue-500/70">Analyzing via IDT...</div>
                        ) : (
                            <div className="text-[10px] text-zinc-400 italic">Click "Use" to run structural analysis.</div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const numInput = (label: string, val: number, set: (v: number) => void, step = 1, min?: number, max?: number) => (
        <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{label}</label>
            <input type="number" value={val} step={step} min={min} max={max}
                onChange={e => set(parseFloat(e.target.value) || 0)}
                className="input px-2 py-1 text-xs font-mono tabular-nums" />
        </div>
    );

    return (
        <div className="bg-white dark:bg-zinc-900 space-y-0">

            {/* ── MSA Viewer (same as top, just relocated here) ── */}
            {alignment && (
                <MSAViewer
                    alignment={alignment}
                    primers={gappedOligoPrimers}
                    flankingPrimers={flankingPrimersForMSA}
                    isDarkMode={isDarkMode}
                    navigateTarget={primerNavTarget ?? navigateTarget}
                    onFlankingPrimerClick={handleFlankingPrimerClick}
                    onOligoRegionSelect={handleMSARegionSelect}
                    showAutofindUI={false}
                />
            )}

            <div className="p-5 space-y-5">
                {/* ── Context Viewer ── */}
                <div>
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Context Viewer</span>
                    <div className="flex items-center gap-2">
                        <label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider whitespace-nowrap">Flank Window (bp)</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            value={flankWindow}
                            onChange={e => {
                                const v = e.target.value.replace(/[^0-9]/g, '');
                                setFlankWindow(v === '' ? 0 : parseInt(v));
                            }}
                            className="input w-20 px-2 py-0.5 text-xs font-mono tabular-nums"
                        />
                    </div>
                </div>
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden relative">
                    <div className="px-4 py-2 border-b border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center justify-between text-[10px] font-medium gap-2">
                        <div className="flex gap-4 flex-wrap text-zinc-400">
                            <span><span className="inline-block w-2.5 h-2.5 bg-amber-400 rounded-sm mr-1 align-middle" />Oligo 2</span>
                            <span><span className="inline-block w-2.5 h-2.5 bg-green-400 rounded-sm mr-1 align-middle" />Oligo 1</span>
                            {selFwd && <span><span className="inline-block w-2.5 h-2.5 bg-emerald-400 rounded-sm mr-1 align-middle" />Left Flanking</span>}
                            {selRev && <span><span className="inline-block w-2.5 h-2.5 bg-teal-400 rounded-sm mr-1 align-middle" />Right Flanking</span>}
                        </div>
                        
                        {/* Manual Region Indicators in the legend bar */}
                        {(manualLeftStart !== null || manualRightStart !== null) && (
                            <div className="flex gap-1 items-center">
                                {manualLeftStart !== null && (
                                    <div className="bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 text-[10px] font-medium px-2 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-800 flex items-center gap-2 tabular-nums">
                                        <span className="status-dot bg-emerald-500" />
                                        <span>Left Target: {manualLeftStart}-{manualLeftEnd}</span>
                                        <button onClick={() => { setManualLeftStart(null); setManualLeftEnd(null); }} className="hover:text-red-500">Clear</button>
                                    </div>
                                )}
                                {manualRightStart !== null && (
                                    <div className="bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 text-[10px] font-medium px-2 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-800 flex items-center gap-2 tabular-nums">
                                        <span className="status-dot bg-teal-400" />
                                        <span>Right Target: {manualRightStart}-{manualRightEnd}</span>
                                        <button onClick={() => { setManualRightStart(null); setManualRightEnd(null); }} className="hover:text-red-500">Clear</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    
                    <div
                        ref={containerRef}
                        onMouseUp={handleMouseUp}
                        className="p-4 overflow-y-auto overflow-x-hidden bg-white dark:bg-zinc-900 relative"
                    >
                        {renderStaticSeq()}
                    </div>
                </div>
                </div>

                {/* ── Amplicon Length ── */}
                {ampliconBp != null && (
                    <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/60 dark:bg-emerald-900/10 px-4 py-3 flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                            Amplicon Length
                        </span>
                        <span
                            className="text-base font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-300"
                            title="Amplicon size: forward primer + template between primers + reverse primer"
                        >
                            {ampliconBp.toLocaleString()} bp
                        </span>
                    </div>
                )}

                {/* ── Primer3 Parameters ── */}
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                    <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Primer3 Parameters</span>
                            {searchEngine === 'strider' && (
                                <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Engine: Strider</span>
                            )}
                        </div>
                        <button onClick={() => setShowAdv(v => !v)}
                            className="text-[10px] font-bold px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors text-zinc-500">
                            {showAdv ? '▲ Hide Advanced' : '▼ Advanced'}
                        </button>
                    </div>
                    <div className="p-4 space-y-4 bg-white dark:bg-zinc-900">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {numInput('Opt Tm (°C)', optTm, setOptTm, 0.5)}
                            {numInput('Tm Min (°C)', minTm, setMinTm, 0.5)}
                            {numInput('Tm Max (°C)', maxTm, setMaxTm, 0.5)}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {numInput('Min Size (nt)', minSize, setMinSize, 1, 10, 40)}
                            {numInput('Opt Size (nt)', optSize, setOptSize, 1, 10, 40)}
                            {numInput('Max Size (nt)', maxSize, setMaxSize, 1, 10, 40)}
                            {numInput('Candidates', numReturn, setNumReturn, 1, 1, 10)}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            {numInput('Min GC (%)', minGc, setMinGc, 5, 0, 100)}
                            {numInput('Max GC (%)', maxGc, setMaxGc, 5, 0, 100)}
                        </div>
                        {showAdv && (
                            <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
                                <p className="text-[10px] text-zinc-400 mb-3 uppercase tracking-wider font-bold">Thermodynamic Parameters</p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    {numInput('Mono [mM]', mvConc, setMvConc, 5, 0)}
                                    {numInput('Dival [mM]', dvConc, setDvConc, 0.5, 0)}
                                    {numInput('dNTP [mM]', dntpConc, setDntpConc, 0.05, 0)}
                                    {numInput('DNA [nM]', dnaConc, setDnaConc, 10, 0)}
                                </div>
                            </div>
                        )}
                        <div className="flex gap-2 items-center">
                            <div
                                className="flex items-center rounded-md border border-zinc-300 dark:border-zinc-700 overflow-hidden"
                                title="NN parameter set for primer design (affects Tm and structure analysis globally)"
                            >
                                {([
                                    ['mathews2004-dna', 'Mathews'],
                                    ['native', 'SantaLucia'],
                                ] as const).map(([value, label], idx) => (
                                    <button
                                        key={value}
                                        onClick={() => onParameterSetChange?.(value)}
                                        className={`px-2.5 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-700 dark:focus-visible:outline-teal-300 ${idx > 0 ? 'border-l border-zinc-300 dark:border-zinc-700' : ''}${
                                            (idtCredentials?.parameterSet || 'mathews2004-dna') === value
                                                ? 'bg-teal-700/10 dark:bg-teal-300/10 text-teal-800 dark:text-teal-200'
                                                : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
                                        }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <button onClick={() => design()} disabled={loading}
                                className={`flex-1 rounded-md font-medium text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 dark:focus-visible:outline-teal-300 ${loading ? 'py-2.5 bg-zinc-100 dark:bg-zinc-900 text-zinc-400 cursor-not-allowed' : 'bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 justify-center py-2.5'}`}>
                                {loading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                        Designing with Primer3…
                                    </span>
                                ) : 'Design Flanking Primers'}
                            </button>
                            <button onClick={designManual} disabled={loading || (manualLeftStart === null && manualRightStart === null)}
                                className="btn-secondary font-medium text-sm px-4 py-2.5 whitespace-nowrap disabled:cursor-not-allowed">
                                Manual
                            </button>
                        </div>
                        {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
                    </div>
                </div>

                {/* ── Results ── */}
                {(result || selFwd || selRev) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 ">
                        <div>
                            <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2 px-1">
                                Left (Forward) Primers{result ? `: ${result.forward.num_returned} found` : ''}
                            </div>
                            {/* Custom dragged primer card shown above results when it no longer matches any candidate */}
                            {selFwd && !result?.forward.primers.some(p => p.sequence === selFwd.sequence) && (
                                <div className="mb-2">
                                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-widest px-1 mb-1">Custom (edited)</div>
                                    {renderCard(selFwd, 'fwd', -1)}
                                </div>
                            )}
                            {result && (result.forward.primers.length === 0
                                ? <p className="text-xs text-zinc-400 px-1">{result.forward.explain || 'No primers found in upstream region.'}</p>
                                : <div className="space-y-2">{result.forward.primers.map((p, i) => renderCard(p, 'fwd', i))}</div>)}
                        </div>
                        <div>
                            <div className="text-xs font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wider mb-2 px-1">
                                Right (Reverse) Primers{result ? `: ${result.reverse.num_returned} found` : ''}
                            </div>
                            {/* Custom dragged primer card shown above results when it no longer matches any candidate */}
                            {selRev && !result?.reverse.primers.some(p => p.sequence === selRev.sequence) && (
                                <div className="mb-2">
                                    <div className="text-[10px] text-teal-600 dark:text-teal-400 font-bold uppercase tracking-widest px-1 mb-1">Custom (edited)</div>
                                    {renderCard(selRev, 'rev', -1)}
                                </div>
                            )}
                            {result && (result.reverse.primers.length === 0
                                ? <p className="text-xs text-zinc-400 px-1">{result.reverse.explain || 'No primers found in downstream region.'}</p>
                                : <div className="space-y-2">{result.reverse.primers.map((p, i) => renderCard(p, 'rev', i))}</div>)}
                        </div>
                        {selFwd && selRev && (
                            <div className="col-span-full rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-zinc-50 dark:bg-zinc-950 mt-4 transition-all">
                                <button
                                    onClick={() => setIsAnalysisExpanded(!isAnalysisExpanded)}
                                    className="w-full flex justify-between items-center px-5 py-3 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <svg className="w-5 h-5 text-teal-700 dark:text-teal-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                        </svg>
                                        <span className="text-sm font-bold text-zinc-700 dark:text-zinc-200 uppercase tracking-widest">
                                            Primer Pair Advanced QC
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-zinc-400">
                                        {(isAnalyzing || isAnalyzingStriderPair) && <div className="w-4 h-4 border-2 border-zinc-300 dark:border-zinc-700 border-t-zinc-700 dark:border-t-zinc-300 rounded-full animate-spin" />}
                                        <svg className={`w-4 h-4 transform transition-transform ${isAnalysisExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </div>
                                </button>

                                {isAnalysisExpanded && (
                                    <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                                        {analysisError ? (
                                            <div className="text-sm text-red-500 font-bold">Analysis Error: {analysisError}</div>
                                        ) : (idtResults || striderPairResults) ? (
                                            <div>
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                                    {renderResultCard("Left Primer Stability (Hairpin/Self)", (idtResults || striderPairResults).m1.hairpin)}
                                                    {renderResultCard("Right Primer Stability (Hairpin/Self)", (idtResults || striderPairResults).m2.hairpin)}
                                                    {renderResultCard("HeteroDimer Pairwise", (idtResults || striderPairResults).pairwise)}
                                                </div>
                                                {idtCredentials && !idtResults && !isAnalyzing && (
                                                    <div className="mt-4 flex justify-center">
                                                        <button onClick={() => runProductAnalysis(selFwdSeq!, selRevSeq!)}
                                                            className="text-xs px-3 py-1.5 rounded-md border border-blue-600/40 text-blue-700 dark:text-blue-300 hover:bg-blue-700/10 dark:hover:bg-blue-300/10 font-bold transition-all">
                                                            Run IDT Pair Analysis
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        ) : isAnalyzingStriderPair ? (
                                            <div className="text-sm text-zinc-400">Analyzing via Strider...</div>
                                        ) : (
                                            <div className="text-sm text-zinc-400">Waiting for analysis...</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Rename Primers Panel ─────────────────────────── */}
                        {selFwd && selRev && (
                            <div className="col-span-full mt-4 border-t border-zinc-100 dark:border-zinc-800 pt-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-1.5 h-4 bg-zinc-400 rounded-full"></div>
                                    <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Rename Primers</h4>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">Forward Primer Label</label>
                                        <input
                                            type="text"
                                            value={fwdName}
                                            onChange={e => { setFwdName(e.target.value); setSelFwd(prev => prev ? { ...prev, name: e.target.value } : prev); }}
                                            placeholder="Forward Primer"
                                            className="input text-xs"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] font-bold text-teal-500 uppercase tracking-wider">Reverse Primer Label</label>
                                        <input
                                            type="text"
                                            value={revName}
                                            onChange={e => { setRevName(e.target.value); setSelRev(prev => prev ? { ...prev, name: e.target.value } : prev); }}
                                            placeholder="Reverse Primer"
                                            className="input text-xs"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ── Primer Binding Preview Modal ── */}
            {previewPrimer && (() => {
                const iv = getPrimerInterval(previewPrimer.primer, previewPrimer.side);
                const relPos = relativeMOLigoPos(previewPrimer.primer, previewPrimer.side);
                const sideLabel = previewPrimer.side === 'fwd' ? 'Forward' : 'Reverse';
                // The already-selected opposite-side primer, if any : shown in the
                // context view and used for the live preview amplicon size.
                const partnerSide = previewPrimer.side === 'fwd' ? 'rev' : 'fwd';
                const partner = previewPrimer.side === 'fwd' ? selRev : selFwd;
                const partnerIv = partner ? getPrimerInterval(partner, partnerSide) : null;
                const previewAmplicon = iv && partnerIv
                    ? (previewPrimer.side === 'fwd'
                        ? (partnerIv[1] > iv[0] ? partnerIv[1] - iv[0] : null)
                        : (iv[1] > partnerIv[0] ? iv[1] - partnerIv[0] : null))
                    : null;
                // Enforce the ~2/3 MSA vs ~1/3 context split: the MSA block is this
                // cap plus its 116px minimap; 96px accounts for header and legend.
                const msaMaxHeight = Math.max(120, Math.floor((window.innerHeight * 0.92 - 96) * (2 / 3)) - 116);
                return (
                    <div
                        className="modal-overlay"
                        onClick={(e) => { if (e.target === e.currentTarget) setPreviewPrimer(null); }}
                        role="dialog"
                        aria-modal="true"
                        aria-label={`${sideLabel} primer binding site preview`}
                    >
                        <div
                            className="card shadow-xl max-w-4xl w-full mx-4 overflow-hidden h-[92vh] flex flex-col"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="panel-header flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className={`text-sm font-bold uppercase tracking-widest flex-shrink-0 ${previewPrimer.side === 'fwd' ? 'text-emerald-600 dark:text-emerald-400' : 'text-teal-600 dark:text-teal-400'}`}>
                                        {sideLabel} primer preview
                                    </span>
                                    <span className="font-mono text-xs text-zinc-600 dark:text-zinc-300 truncate">{previewPrimer.primer.sequence}</span>
                                    {relPos && (
                                        <span className="font-mono text-xs text-zinc-400 flex-shrink-0" title="Distance from the MOLigo region (bp)">{relPos}</span>
                                    )}
                                    {previewAmplicon != null && (
                                        <span
                                            className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-semibold font-mono tabular-nums flex-shrink-0"
                                            title="Amplicon size for the previewed pair: forward primer + template between primers + reverse primer"
                                        >
                                            Amplicon: {previewAmplicon.toLocaleString()} bp
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={() => setPreviewPrimer(null)}
                                    className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors flex-shrink-0"
                                >
                                    ✕ Close
                                </button>
                            </div>
                            {previewPrimer.msaAlignment && previewPrimer.msaFlanking && (
                                <div className="flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800">
                                    <DelayedNavMSA
                                        alignment={previewPrimer.msaAlignment}
                                        primers={gappedOligoPrimers}
                                        flankingPrimers={previewPrimer.msaFlanking}
                                        isDarkMode={isDarkMode}
                                        navigateTarget={previewPrimer.msaNav}
                                        showAutofindUI={false}
                                        maxHeight={msaMaxHeight}
                                    />
                                </div>
                            )}
                            <div className="flex-1 min-h-0 p-4 overflow-auto">
                                {iv
                                    ? renderPreviewSeq(iv, previewPrimer.side, partnerIv, partnerSide)
                                    : <p className="text-xs text-red-500 font-medium">This primer could not be located on the template sequence.</p>}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 border-t border-zinc-100 dark:border-zinc-800 text-[10px] font-bold text-zinc-500 dark:text-zinc-400">
                                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-green-300 dark:bg-green-700" /> MOLigo 1</span>
                                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-300 dark:bg-amber-700" /> MOLigo 2</span>
                                <span className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${previewPrimer.side === 'fwd' ? 'bg-emerald-400 dark:bg-emerald-600' : 'bg-teal-400 dark:bg-teal-600'}`} /> Previewed {sideLabel.toLowerCase()} primer (underlined)</span>
                                {partnerIv && (
                                    <span className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${partnerSide === 'fwd' ? 'bg-emerald-400 dark:bg-emerald-600' : 'bg-teal-400 dark:bg-teal-600'}`} /> Selected {partnerSide === 'fwd' ? 'forward' : 'reverse'} primer</span>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
