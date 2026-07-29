import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import MSAViewer from './MSAViewer';
import DimerAscii from './DimerAscii';
import HairpinSVG from './HairpinSVG';

interface DesignedPrimer {
    sequence: string;
    length: number;
    gc_percent: number;
    tm: number | null;
    tm_strider: number | null;
    hairpin: { structure_found: boolean; tm: number | null; dg: number | null };
    homodimer: { structure_found: boolean; tm: number | null; dg: number | null };
    primer3: { tm: number | null; gc_percent: number | null; self_any: number | null; self_end: number | null; hairpin_th: number | null };
    interval?: [number, number];
    name?: string;
}

interface DesignResult {
    forward: { num_returned: number; primers: DesignedPrimer[]; explain: string };
    reverse: { num_returned: number; primers: DesignedPrimer[]; explain: string };
    pair_metrics: { heterodimer: { structure_found: boolean; tm: number | null; dg: number | null } } | null;
}

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
}

const API = ((import.meta.env.VITE_API_BASE as string) || '');

type PreviewMSAProps = React.ComponentProps<typeof MSAViewer>;

// Hands the one-shot zoom to the embedded viewer only after it has measured its
// real width and label column (~200ms). Delivered at mount it would compute the
// centering with default metrics and, being deliberately one-shot, never retry —
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
    idtCredentials, idtAdvancedParams, gappedData, onFlankingPrimersUpdate
}: Props) {
    // Primer3 params
    const [flankWindow, setFlankWindow] = useState(200);
    const [optSize, setOptSize] = useState(20);
    const [minSize, setMinSize] = useState(16);
    const [maxSize, setMaxSize] = useState(27);
    const [optTm, setOptTm] = useState(62.0);
    const [minTm, setMinTm] = useState(57.0);
    const [maxTm, setMaxTm] = useState(67.0);
    const [minGc, setMinGc] = useState(20.0);
    const [maxGc, setMaxGc] = useState(80.0);
    const [numReturn, setNumReturn] = useState(5);
    const [showAdv, setShowAdv] = useState(false);
    const [mvConc, setMvConc] = useState(50.0);
    const [dvConc, setDvConc] = useState(3);
    const [dntpConc, setDntpConc] = useState(0.8);
    const [dnaConc, setDnaConc] = useState(200.0);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState<DesignResult | null>(null);

    // selected primer to "use"
    const [selFwd, setSelFwd] = useState<DesignedPrimer | null>(null);
    const [selRev, setSelRev] = useState<DesignedPrimer | null>(null);
    // Debounce refs for IDT analysis after drag
    const idtDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const idtPairDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const skipNextPairEffectRef = useRef(false);

    const [fwdName, setFwdName] = useState('');
    const [revName, setRevName] = useState('');

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

    const [manualLeftStart, setManualLeftStart] = useState<number | null>(null);
    const [manualLeftEnd, setManualLeftEnd] = useState<number | null>(null);
    const [manualRightStart, setManualRightStart] = useState<number | null>(null);
    const [manualRightEnd, setManualRightEnd] = useState<number | null>(null);

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

    const design = async () => {
        setLoading(true); setError(''); setResult(null); setSelFwd(null); setSelRev(null);
        try {
            const res = await fetch(API + '/flanking_primers/design', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    full_seq: rawSeq, oligo_start: oligoStart, oligo_end: oligoEnd,
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
        } catch (e: any) { setError(e.message); }
        finally { setLoading(false); }
    };

    // Auto-design when the MOLigo bounds change from user dragging it in the upper viewer
    const prevOligoRef = useRef({ start: oligoStart, end: oligoEnd });
    useEffect(() => {
        if (prevOligoRef.current.start !== oligoStart || prevOligoRef.current.end !== oligoEnd) {
            prevOligoRef.current = { start: oligoStart, end: oligoEnd };
            // Automatically redesign if the user hasn't set manual flanking region overrides
            if (manualLeftStart === null && manualRightStart === null) {
                design();
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [oligoStart, oligoEnd]);

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
            fwdSeq = rawSeq.substring(manualLeftStart, manualLeftEnd);
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
            const fwdStrandSeq = rawSeq.substring(manualRightStart, manualRightEnd);
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
            analyzeIndividual(fwdPrimerObj.sequence);
        } else {
            setSelFwd(null);
        }

        if (revPrimerObj) {
            setSelRev(revPrimerObj);
            analyzeIndividual(revPrimerObj.sequence);
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
    const [idtResults, setIdtResults] = useState<any>(null);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const [isAnalysisExpanded, setIsAnalysisExpanded] = useState(true);

    const runProductAnalysis = useCallback(async (p1Seq: string, p2Seq: string) => {
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
                    mg_conc: idtAdvancedParams?.mg_conc ?? 10.0,
                    mv_conc: idtAdvancedParams?.mv_conc ?? 50.0,
                    dntp_conc: idtAdvancedParams?.dntp_conc ?? 0.8,
                    oligo_conc: idtAdvancedParams?.oligo_conc ?? 0.25,
                    idt_region: idtCredentials.region || 'eu'
                })
            });
            if (!aRes.ok) throw new Error("Product Analysis Failed");
            const results = await aRes.json();
            setIdtResults(results);
            setIsAnalysisExpanded(true); // auto-expand when new results arrive
        } catch (err: any) {
            setAnalysisError(err.message);
        } finally {
            setIsAnalyzing(false);
        }
    }, [idtCredentials, idtAdvancedParams]);

    const [idtResultsIndiv, setIdtResultsIndiv] = useState<Record<string, any>>({});
    const [analyzingIndiv, setAnalyzingIndiv] = useState<Record<string, boolean>>({});

    const analyzeIndividual = async (seq: string) => {
        if (!idtCredentials || idtResultsIndiv[seq]) return;
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
                    mg_conc: idtAdvancedParams?.mg_conc ?? 10.0,
                    mv_conc: idtAdvancedParams?.mv_conc ?? 50.0,
                    dntp_conc: idtAdvancedParams?.dntp_conc ?? 0.8,
                    oligo_conc: idtAdvancedParams?.oligo_conc ?? 0.25,
                    idt_region: idtCredentials.region || 'eu'
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
    const latestRef = useRef({ idtCredentials, selFwd, selRev, analyzeIndividual, runProductAnalysis, analyzePrimerP3 });
    useEffect(() => {
        latestRef.current = { idtCredentials, selFwd, selRev, analyzeIndividual, runProductAnalysis, analyzePrimerP3 };
    });

    useEffect(() => {
        if (skipNextPairEffectRef.current) {
            // Reset flag and skip this invocation (debounced handler will run analysis)
            skipNextPairEffectRef.current = false;
            return;
        }
        if (selFwd && selRev && idtCredentials) {
            runProductAnalysis(selFwd.sequence, selRev.sequence);
        } else {
            setIdtResults(null);
            setAnalysisError(null);
        }
    }, [selFwd, selRev, idtCredentials, idtAdvancedParams, runProductAnalysis]);

    // Cleanup debounced timers on component unmount
    useEffect(() => {
        return () => {
            if (idtDebounceRef.current) clearTimeout(idtDebounceRef.current);
            if (idtPairDebounceRef.current) clearTimeout(idtPairDebounceRef.current);
        };
    }, []);

    const getIdtStatusColor = (dg: number | undefined) => {
        if (dg === undefined || dg === null) return 'text-slate-400';
        if (dg < -9) return 'text-red-500 font-bold';
        if (dg < -6) return 'text-amber-500 font-medium';
        return 'text-emerald-500';
    };

    const extractTm = (analyzeData: any) => {
        if (!analyzeData || analyzeData.error) return null;
        if (Array.isArray(analyzeData) && analyzeData.length > 0) return analyzeData[0].Tm;
        return analyzeData.Tm;
    };

    const renderResultCard = (title: string, data: any) => {
        if (!data || data.error) return null;
        const items = Array.isArray(data.raw) ? data.raw : [data.raw];
        const topDg = data.DeltaG;

        return (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3 shadow-sm flex flex-col gap-2">
                <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-2">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-ellipsis overflow-hidden whitespace-nowrap">{title}</span>
                    <span className={`text-xs flex-shrink-0 ${getIdtStatusColor(topDg)}`}>{topDg != null ? `${topDg.toFixed(2)} kcal/mol` : 'N/A'}</span>
                </div>
                <div className="flex flex-col gap-3 mt-1">
                    {items.slice(0, 1).map((item: any, i: number) => (
                        <div key={i} className="flex flex-col gap-2">
                            {item.DotBracket && (
                                <div className="bg-slate-50 dark:bg-slate-800/50 rounded p-2">
                                    {item.Sequence && item.Sequence.includes('&') ? (
                                        <DimerAscii seq={item.Sequence} dotBracket={item.DotBracket} raw={item} />
                                    ) : (
                                        <HairpinSVG seq={item.Sequence || item.dot_bracket || ''} dotBracket={item.DotBracket} />
                                    )}
                                </div>
                            )}
                            {/* Provenance: IDT vs Strider, ΔG + Tm (mirrors the oligo card). */}
                            {(!item.DotBracket && topDg == null && item.Local_DeltaG == null) ? (
                                <div className="text-[9px] text-slate-400 italic text-center px-1 py-0.5">No stable structure found</div>
                            ) : (
                                <div className="flex flex-col gap-0.5 text-[9px] text-slate-400 font-medium px-1">
                                    <div className="flex justify-between items-center">
                                        <span>IDT ΔG: <b className={getIdtStatusColor(topDg)}>{topDg != null ? `${topDg > 0 ? '+' : ''}${topDg.toFixed(2)}` : 'N/A'}</b></span>
                                        <span>Strider ΔG: <b className={item.Local_DeltaG != null ? (item.Local_DeltaG <= 0 ? "text-amber-500" : "text-slate-400") : "text-slate-500"}>{item.Local_DeltaG != null ? `${item.Local_DeltaG > 0 ? '+' : ''}${item.Local_DeltaG.toFixed(2)}` : 'N/A'}</b></span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span>IDT Tm: <b className="text-slate-500">{item.IDT_Tm != null ? `${Number(item.IDT_Tm).toFixed(1)}°C` : 'N/A'}</b></span>
                                        <span>Strider Tm: <b className="text-slate-500">{item.Local_Tm != null ? `${item.Local_Tm.toFixed(1)}°C` : 'N/A'}</b></span>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
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
                const fwdStrandSeq = rawSeq.substring(newStart, newEnd);
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
                const { idtCredentials: creds, selFwd: sf, selRev: sr, analyzeIndividual: analyzeInd, runProductAnalysis: runProd, analyzePrimerP3: p3Analyze } = latestRef.current;

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

                if (creds && updated.sequence) {
                    // Prevent immediate pair-effect from running
                    skipNextPairEffectRef.current = true;

                    // Debounced individual analysis
                    if (idtDebounceRef.current) clearTimeout(idtDebounceRef.current);
                    setAnalyzingIndiv(prev => ({ ...prev, [updated.sequence]: true }));
                    idtDebounceRef.current = setTimeout(() => {
                        analyzeInd(updated.sequence);
                    }, 1500);

                    // Determine other primer sequence for pair analysis
                    const otherSeq = id === 'fwd' ? (sr?.sequence || '') : (sf?.sequence || '');
                    const p1Seq = id === 'fwd' ? updated.sequence : otherSeq;
                    const p2Seq = id === 'rev' ? updated.sequence : otherSeq;
                    if (p1Seq && p2Seq) {
                        if (idtPairDebounceRef.current) clearTimeout(idtPairDebounceRef.current);
                        setIsAnalyzing(true);
                        idtPairDebounceRef.current = setTimeout(() => {
                            runProd(p1Seq, p2Seq);
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

    // flankingPrimers for MSAViewer — only show primers the user explicitly selected with "Use".
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
        // and both MOLigos — everything the user needs in view at once. MOLigo
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
                            <span className="text-slate-400 mr-4 select-none whitespace-pre">{posStr}</span>
                            <span className="whitespace-pre">
                                {lineChars.map((char, charIdx) => {
                                    const i = viewStart + lineIdx * lineLength + charIdx;
                                    const isP1 = i >= p1Start && i < p1End;
                                    const isP2 = i >= p2Start && i < p2End;
                                    const isFwd = liveFwdInterval && i >= liveFwdInterval[0] && i < liveFwdInterval[1];
                                    const isRev = liveRevInterval && i >= liveRevInterval[0] && i < liveRevInterval[1];

                                    let cn = 'text-slate-500 dark:text-slate-400';
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
                    <span className="text-slate-400 mr-4 select-none whitespace-pre">{String(rowStart + 1).padStart(6, ' ')}</span>
                    <span className="whitespace-pre">
                        {row.split('').map((char, j) => {
                            const i = rowStart + j;
                            const isP1 = i >= p1Start && i < p1End;
                            const isP2 = i >= p2Start && i < p2End;
                            const isPrimer = i >= iv[0] && i < iv[1];
                            const isPartner = partnerIv && i >= partnerIv[0] && i < partnerIv[1];
                            let cn = 'text-slate-500 dark:text-slate-400';
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
            if (dg === null) return 'text-slate-400';
            if (dg < -6) return 'text-red-500 font-bold';
            if (dg < -3) return 'text-amber-500 font-bold';
            return 'text-emerald-500 font-bold';
        };
        const copyKey = `${side}-${idx}`;
        const relPos = relativeMOLigoPos(p, side);

        const indivResult = idtResultsIndiv[p.sequence];
        const isAnal = analyzingIndiv[p.sequence];

        return (
            <div key={idx} className={`rounded-xl border p-3 text-xs transition-all ${isSelected ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 shadow-md' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider">#{idx + 1}</span>
                        {p.name && <span className="font-bold text-amber-600 dark:text-amber-400 text-[10px] uppercase tracking-wider">{p.name}</span>}
                        <span className="font-mono text-slate-700 dark:text-slate-200 break-all">{p.sequence}</span>
                        {relPos && (
                            <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap" title="Distance from the MOLigo region (bp)">
                                {relPos}
                            </span>
                        )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => doCopy(p.sequence, copyKey)}
                            className="text-[10px] px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors font-bold">
                            {copyFb === copyKey ? 'Copied' : 'Copy'}
                        </button>
                        <button onClick={() => openPreview(p, side)}
                            className="text-[10px] px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors font-bold">
                            Preview
                        </button>
                        <button onClick={() => {
                            if (!isSelected) {
                                if (side === 'fwd') { setSelFwd(p); setFwdName(p.name || ''); }
                                else { setSelRev(p); setRevName(p.name || ''); }
                                if (!idtResultsIndiv[p.sequence]) {
                                    setAnalyzingIndiv(prev => ({ ...prev, [p.sequence]: true }));
                                }
                                analyzeIndividual(p.sequence);
                            } else {
                                if (side === 'fwd') { setSelFwd(null); setFwdName(''); }
                                else { setSelRev(null); setRevName(''); }
                            }
                        }}
                            className={`text-[10px] px-2 py-0.5 rounded border font-bold transition-all ${isSelected ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-emerald-300 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'}`}>
                            {isSelected ? 'Used' : 'Use'}
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-6 gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                    <div><span className="font-bold text-slate-600 dark:text-slate-300">Len</span><br />{p.length} bp</div>
                    <div className="flex gap-2 items-center">
                        <div><span className="font-bold text-slate-600 dark:text-slate-300">P3 Tm</span><br />{p.tm ?? p.primer3?.tm ?? '—'}°C</div>
                        {indivResult?.stats && (
                            <div title="IDT Tm" className="bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded border border-purple-200 dark:border-purple-800 self-end mb-0.5">
                                <b className="font-bold">IDT: {extractTm(indivResult.stats)?.toFixed(1) || 'N/A'}°C</b>
                            </div>
                        )}
                    </div>
                    <div><span className="font-bold text-slate-600 dark:text-slate-300" title="Strider duplex Tm">Strider Tm</span><br />{p.tm_strider != null ? `${p.tm_strider.toFixed(1)}°C` : '—'}</div>
                    <div><span className="font-bold text-slate-600 dark:text-slate-300">GC</span><br />{p.gc_percent ?? p.primer3?.gc_percent ?? '—'}%</div>
                    <div><span className="font-bold text-slate-600 dark:text-slate-300">Hairpin Tm</span><br /><span className={p.hairpin.structure_found ? 'text-amber-500' : 'text-emerald-500'}>{p.hairpin.structure_found ? `${p.primer3?.hairpin_th ?? '—'}°C` : 'None'}</span></div>
                    <div><span className="font-bold text-slate-600 dark:text-slate-300">Self-dimer</span><br /><span className={statusDg(p.homodimer?.dg)}>{p.homodimer?.dg !== null ? `${p.homodimer.dg} kcal` : 'OK'}</span></div>
                </div>

                {isSelected && (
                    <div className="mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-800/30">
                        <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                            <span>Structural Analysis (IDT + Strider)</span>
                            {isAnal && <div className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />}
                        </div>
                        {!idtCredentials ? (
                            <div className="text-[10px] text-slate-400 italic">Configure IDT credentials in settings to view detailed structures.</div>
                        ) : indivResult ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                {renderResultCard("Hairpin", indivResult.hairpin)}
                                {renderResultCard("Self-Dimer", indivResult.selfdimer)}
                            </div>
                        ) : isAnal ? (
                            <div className="text-[10px] text-emerald-500/70">Analyzing via IDT...</div>
                        ) : (
                            <div className="text-[10px] text-red-400">Analysis failed.</div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const numInput = (label: string, val: number, set: (v: number) => void, step = 1, min?: number, max?: number) => (
        <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</label>
            <input type="number" value={val} step={step} min={min} max={max}
                onChange={e => set(parseFloat(e.target.value) || 0)}
                className="w-full text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
        </div>
    );

    return (
        <div className="bg-white dark:bg-slate-800 space-y-0">

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
                {/* ── Static sequence view ── */}
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden relative">
                    <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-700 flex flex-wrap items-center justify-between text-[10px] font-medium gap-2">
                        <div className="flex gap-4 flex-wrap text-slate-400">
                            <span><span className="inline-block w-2.5 h-2.5 bg-amber-400 rounded-sm mr-1 align-middle" />Oligo 2</span>
                            <span><span className="inline-block w-2.5 h-2.5 bg-green-400 rounded-sm mr-1 align-middle" />Oligo 1</span>
                            {selFwd && <span><span className="inline-block w-2.5 h-2.5 bg-emerald-400 rounded-sm mr-1 align-middle" />Left Flanking</span>}
                            {selRev && <span><span className="inline-block w-2.5 h-2.5 bg-teal-400 rounded-sm mr-1 align-middle" />Right Flanking</span>}
                        </div>
                        
                        {/* Manual Region Indicators in the legend bar */}
                        {(manualLeftStart !== null || manualRightStart !== null) && (
                            <div className="flex gap-1 items-center">
                                {manualLeftStart !== null && (
                                    <div className="bg-emerald-100 dark:bg-emerald-900/90 text-emerald-800 dark:text-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded shadow-sm border border-emerald-300 dark:border-emerald-700 flex items-center gap-2">
                                        <span>Left Target: {manualLeftStart}-{manualLeftEnd}</span>
                                        <button onClick={() => { setManualLeftStart(null); setManualLeftEnd(null); }} className="hover:text-red-500">Clear</button>
                                    </div>
                                )}
                                {manualRightStart !== null && (
                                    <div className="bg-teal-100 dark:bg-teal-900/90 text-teal-800 dark:text-teal-200 text-[10px] font-bold px-2 py-0.5 rounded shadow-sm border border-teal-300 dark:border-teal-700 flex items-center gap-2">
                                        <span>Right Target: {manualRightStart}-{manualRightEnd}</span>
                                        <button onClick={() => { setManualRightStart(null); setManualRightEnd(null); }} className="hover:text-red-500">Clear</button>
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">Flank (bp)</label>
                            <input
                                type="number"
                                value={flankWindow}
                                min={0}
                                step={50}
                                onChange={e => setFlankWindow(Math.max(0, parseInt(e.target.value) || 0))}
                                className="w-20 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                            />
                        </div>
                    </div>
                    
                    <div
                        ref={containerRef}
                        onMouseUp={handleMouseUp}
                        className="p-4 overflow-y-auto overflow-x-hidden bg-white dark:bg-slate-800 relative"
                    >
                        {renderStaticSeq()}
                    </div>
                </div>

                {/* ── Amplicon Length ── */}
                {ampliconBp != null && (
                    <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/60 dark:bg-emerald-900/10 px-4 py-3 flex items-center justify-between shadow-sm">
                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                            Amplicon Length
                        </span>
                        <span
                            className="text-base font-bold font-mono text-emerald-700 dark:text-emerald-300"
                            title="Amplicon size: forward primer + template between primers + reverse primer"
                        >
                            {ampliconBp.toLocaleString()} bp
                        </span>
                    </div>
                )}

                {/* ── Primer3 Parameters ── */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Primer3 Parameters</span>
                        <button onClick={() => setShowAdv(v => !v)}
                            className="text-[10px] font-bold px-2 py-1 rounded border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-slate-500">
                            {showAdv ? '▲ Hide Advanced' : '▼ Advanced'}
                        </button>
                    </div>
                    <div className="p-4 space-y-4 bg-white dark:bg-slate-800">
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
                            <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
                                <p className="text-[10px] text-slate-400 mb-3 uppercase tracking-wider font-bold">Thermodynamic Parameters</p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    {numInput('Mono [mM]', mvConc, setMvConc, 5, 0)}
                                    {numInput('Dival [mM]', dvConc, setDvConc, 0.5, 0)}
                                    {numInput('dNTP [mM]', dntpConc, setDntpConc, 0.05, 0)}
                                    {numInput('DNA [nM]', dnaConc, setDnaConc, 10, 0)}
                                </div>
                            </div>
                        )}
                        <div className="flex gap-2">
                            <button onClick={design} disabled={loading}
                                className={`flex-1 py-2.5 rounded-lg font-bold text-sm transition-all ${loading ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-md active:scale-95'}`}>
                                {loading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                        Designing with Primer3…
                                    </span>
                                ) : 'Design Flanking Primers'}
                            </button>
                            <button onClick={designManual} disabled={loading || (manualLeftStart === null && manualRightStart === null)}
                                className="px-4 py-2.5 rounded-lg font-bold text-sm bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-all border border-slate-200 dark:border-slate-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
                                Manual
                            </button>
                        </div>
                        {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
                    </div>
                </div>

                {/* ── Results ── */}
                {(result || selFwd || selRev) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div>
                            <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2 px-1">
                                Left (Forward) Primers{result ? ` — ${result.forward.num_returned} found` : ''}
                            </div>
                            {/* Custom dragged primer card shown above results when it no longer matches any candidate */}
                            {selFwd && !result?.forward.primers.some(p => p.sequence === selFwd.sequence) && (
                                <div className="mb-2">
                                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-widest px-1 mb-1">Custom (edited)</div>
                                    {renderCard(selFwd, 'fwd', -1)}
                                </div>
                            )}
                            {result && (result.forward.primers.length === 0
                                ? <p className="text-xs text-slate-400 px-1">{result.forward.explain || 'No primers found in upstream region.'}</p>
                                : <div className="space-y-2">{result.forward.primers.map((p, i) => renderCard(p, 'fwd', i))}</div>)}
                        </div>
                        <div>
                            <div className="text-xs font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wider mb-2 px-1">
                                Right (Reverse) Primers{result ? ` — ${result.reverse.num_returned} found` : ''}
                            </div>
                            {/* Custom dragged primer card shown above results when it no longer matches any candidate */}
                            {selRev && !result?.reverse.primers.some(p => p.sequence === selRev.sequence) && (
                                <div className="mb-2">
                                    <div className="text-[10px] text-teal-600 dark:text-teal-400 font-bold uppercase tracking-widest px-1 mb-1">Custom (edited)</div>
                                    {renderCard(selRev, 'rev', -1)}
                                </div>
                            )}
                            {result && (result.reverse.primers.length === 0
                                ? <p className="text-xs text-slate-400 px-1">{result.reverse.explain || 'No primers found in downstream region.'}</p>
                                : <div className="space-y-2">{result.reverse.primers.map((p, i) => renderCard(p, 'rev', i))}</div>)}
                        </div>
                        {selFwd && selRev && (
                            <div className="col-span-full rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-50 dark:bg-slate-900/50 shadow-sm mt-4 transition-all">
                                <button
                                    onClick={() => setIsAnalysisExpanded(!isAnalysisExpanded)}
                                    className="w-full flex justify-between items-center px-5 py-3 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                        </svg>
                                        <span className="text-sm font-bold text-slate-700 dark:text-slate-200 uppercase tracking-widest">
                                            Primer Pair Advanced QC
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-slate-400">
                                        {isAnalyzing && <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />}
                                        <svg className={`w-4 h-4 transform transition-transform ${isAnalysisExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </div>
                                </button>

                                {isAnalysisExpanded && (
                                    <div className="p-5 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                                        {!idtCredentials ? (
                                            <div className="text-sm text-slate-500 italic">IDT Credentials required for advanced secondary structure analysis. Configure them in settings.</div>
                                        ) : analysisError ? (
                                            <div className="text-sm text-red-500 font-bold">Analysis Error: {analysisError}</div>
                                        ) : idtResults ? (
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                                {renderResultCard("Left Primer Stability (Hairpin/Self)", idtResults.m1.hairpin)}
                                                {renderResultCard("Right Primer Stability (Hairpin/Self)", idtResults.m2.hairpin)}
                                                {renderResultCard("HeteroDimer Pairwise", idtResults.pairwise)}
                                            </div>
                                        ) : (
                                            <div className="text-sm text-slate-400">Waiting for analysis...</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Rename Primers Panel ─────────────────────────── */}
                        {selFwd && selRev && (
                            <div className="col-span-full mt-4 border-t border-slate-100 dark:border-slate-700 pt-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-1.5 h-4 bg-slate-400 rounded-full"></div>
                                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Rename Primers</h4>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">Forward Primer Label</label>
                                        <input
                                            type="text"
                                            value={fwdName}
                                            onChange={e => { setFwdName(e.target.value); setSelFwd(prev => prev ? { ...prev, name: e.target.value } : prev); }}
                                            placeholder="Forward Primer"
                                            className="px-2.5 py-1.5 text-xs border border-emerald-200 dark:border-emerald-800/50 rounded-md bg-emerald-50/30 dark:bg-emerald-900/10 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] font-bold text-teal-500 uppercase tracking-wider">Reverse Primer Label</label>
                                        <input
                                            type="text"
                                            value={revName}
                                            onChange={e => { setRevName(e.target.value); setSelRev(prev => prev ? { ...prev, name: e.target.value } : prev); }}
                                            placeholder="Reverse Primer"
                                            className="px-2.5 py-1.5 text-xs border border-teal-200 dark:border-teal-800/50 rounded-md bg-teal-50/30 dark:bg-teal-900/10 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-teal-400"
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
                // The already-selected opposite-side primer, if any — shown in the
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
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm animate-in fade-in duration-150"
                        onClick={(e) => { if (e.target === e.currentTarget) setPreviewPrimer(null); }}
                        role="dialog"
                        aria-modal="true"
                        aria-label={`${sideLabel} primer binding site preview`}
                    >
                        <div
                            className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-4xl w-full mx-4 border border-slate-200 dark:border-slate-700 overflow-hidden h-[92vh] flex flex-col"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between gap-3 px-5 py-3 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className={`text-sm font-bold uppercase tracking-widest flex-shrink-0 ${previewPrimer.side === 'fwd' ? 'text-emerald-600 dark:text-emerald-400' : 'text-teal-600 dark:text-teal-400'}`}>
                                        {sideLabel} primer preview
                                    </span>
                                    <span className="font-mono text-xs text-slate-600 dark:text-slate-300 truncate">{previewPrimer.primer.sequence}</span>
                                    {relPos && (
                                        <span className="font-mono text-xs text-slate-400 flex-shrink-0" title="Distance from the MOLigo region (bp)">{relPos}</span>
                                    )}
                                    {previewAmplicon != null && (
                                        <span
                                            className="px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 text-xs font-bold font-mono flex-shrink-0"
                                            title="Amplicon size for the previewed pair: forward primer + template between primers + reverse primer"
                                        >
                                            Amplicon: {previewAmplicon.toLocaleString()} bp
                                        </span>
                                    )}
                                </div>
                                <button
                                    onClick={() => setPreviewPrimer(null)}
                                    className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
                                >
                                    ✕ Close
                                </button>
                            </div>
                            {previewPrimer.msaAlignment && previewPrimer.msaFlanking && (
                                <div className="flex-shrink-0 border-b border-slate-200 dark:border-slate-700">
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
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 border-t border-slate-100 dark:border-slate-700 text-[10px] font-bold text-slate-500 dark:text-slate-400">
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
