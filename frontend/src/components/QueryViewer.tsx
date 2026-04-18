import { useState, useEffect, useRef } from 'react';
import MOLigoPanel from './MOLigoPanel';
import HairpinSVG from './HairpinSVG';
import DimerSVG from './DimerSVG';

interface QueryViewerProps {
    data: { id: string; seq: string; start: number; end: number };
    jobName: string;
    onPrimersUpdate: (primers: { p1: { start: number, end: number }, p2: { start: number, end: number } } | null) => void;
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

export default function QueryViewer({ data, jobName, onPrimersUpdate, idtCredentials }: QueryViewerProps) {
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

    // Interactive Sequence Table Drag State
    const [dragState, setDragState] = useState<{ id: 'p1' | 'p2', type: 'move' | 'left' | 'right', startX: number, deltaChars: number, initShift: number, initLen: number } | null>(null);
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
    const [paramsNotMet, setParamsNotMet] = useState(false);
    const [isAutoSearchNeeded, setIsAutoSearchNeeded] = useState(true);
    const lastShiftsApplied = useRef({ s1: 0, s2: 0 });

    // MOLigo state
    const [showMOLigo, setShowMOLigo] = useState(() => localStorage.getItem('show_moligo_prov') === 'true');
    const [tagSeq, setTagSeq] = useState(() => localStorage.getItem('tag_seq') || 'taattgaattgaaagataagtgt');
    const [fwdPrimer, setFwdPrimer] = useState(() => localStorage.getItem('fwd_primer') || 'CGCGGTAGTAAGAAGTGAGA');
    const [revPrimer, setRevPrimer] = useState(() => localStorage.getItem('rev_primer') || 'ACTCGTAGGGAATAAACCGT');

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopyFeedback('Copied!');
            setTimeout(() => setCopyFeedback(''), 2000);
        });
    };

    // Initialize/Reset state when data changes
    useEffect(() => {
        if (data) {
            setIdtResults(null);
            setIdtError(null);
            onPrimersUpdate(null);
            // Reset shifts for a NEW sequence to trigger initial best-place search
            setMoligo1Shift(0);
            setMoligo2Shift(0);
            lastShiftsApplied.current = { s1: 0, s2: 0 };
            setIsAutoSearchNeeded(true);
        }
    }, [data?.id, data?.seq]);

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

    useEffect(() => {
        if (!data) {
            onPrimersUpdate(null);
            return;
        }

        const raw = data.seq.replace(/-/g, '');
        if (raw.length < 2) return;

        const fetchPrimers = async () => {
            setLoading(true);
            setError('');

            try {
                const isShiftChange = moligo1Shift !== lastShiftsApplied.current.s1 || moligo2Shift !== lastShiftsApplied.current.s2;
                const localOptimize = isShiftChange || isAutoSearchNeeded;

                const res = await fetch(((import.meta.env.VITE_API_BASE as string) || "") + '/moligize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sequence: raw,
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
                setPrimers(json);
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

                const p1StartGapped = mapUngappedToGapped(json.p1.start, data.seq);
                const p1EndGapped = mapUngappedToGapped(json.p1.end, data.seq);

                const p2StartGapped = mapUngappedToGapped(json.p2.start, data.seq);
                const p2EndGapped = mapUngappedToGapped(json.p2.end, data.seq);

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
    }, [data, moligo1Shift, moligo2Shift, searchParams, moligo1Len, moligo2Len]);

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
            initShift: id === 'p1' ? moligo1Shift : moligo2Shift,
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
                    let newShift = dragState.initShift;
                    let newLen = dragState.initLen;
                    const id = dragState.id;
                    const type = dragState.type;

                    if (id === 'p1') {
                        // Backend M1 starts at split + shift.
                        if (type === 'move') { newShift += D; }
                        else if (type === 'left') { newShift += D; newLen -= D; }
                        else if (type === 'right') { newLen += D; }

                        if (newLen < 10) { const diff = 10 - newLen; newLen = 10; if (type === 'left') newShift -= diff; }
                        if (newLen > 60) { const diff = newLen - 60; newLen = 60; if (type === 'left') newShift += diff; }

                        setMoligo1Shift(newShift);
                        setMoligo1Len(newLen);
                    } else {
                        // Backend M2 ends at split + shift.
                        if (type === 'move') { newShift += D; }
                        else if (type === 'left') { newLen -= D; }
                        else if (type === 'right') { newShift += D; newLen += D; }

                        if (newLen < 10) { const diff = 10 - newLen; newLen = 10; if (type === 'right') newShift -= diff; }
                        if (newLen > 60) { const diff = newLen - 60; newLen = 60; if (type === 'right') newShift += diff; }

                        setMoligo2Shift(newShift);
                        setMoligo2Len(newLen);
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
            if (dragState.id === 'p1') {
                if (dragState.type === 'move') { p1Start += D; p1End += D; }
                else if (dragState.type === 'left') { p1Start += D; }
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
                if (dragState.type === 'move') { p2Start += D; p2End += D; }
                else if (dragState.type === 'left') { p2Start += D; }
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

            const aRes = await fetch(((import.meta.env.VITE_API_BASE as string) || "") + '/idt/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    p1_seq: primers.p1.seq,
                    p2_seq: primers.p2.seq,
                    token: access_token,
                    mg_conc: Number(idtAdvancedParams.mg_conc),
                    mv_conc: Number(idtAdvancedParams.mv_conc),
                    dntp_conc: Number(idtAdvancedParams.dntp_conc),
                    oligo_conc: Number(idtAdvancedParams.oligo_conc)
                })
            });
            if (!aRes.ok) throw new Error("IDT Analysis Failed");
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
                const fullSeq = item.Sequence || seq || '';
                const db = item.DotBracket || '';
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
                <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                        Oligo provenance: <span className="font-mono text-indigo-600 dark:text-indigo-400">{jobName}</span>
                    </h2>
                    <span className="text-sm text-slate-500 dark:text-slate-400">
                        (bp {data.start + 1}–{data.end + 1}, len {rawSeq.length})
                    </span>
                    {primers && (
                        <button
                            onClick={() => setShowMOLigo(!showMOLigo)}
                            className={`ml-2 px-3 py-1 text-xs font-bold rounded-full border transition-all ${showMOLigo
                                ? 'bg-teal-500 text-white border-teal-500 shadow-md ring-2 ring-teal-100 dark:ring-teal-900/40'
                                : 'bg-white dark:bg-slate-700 text-teal-500 dark:text-teal-400 border-teal-200 dark:border-teal-800 hover:border-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/20'
                                }`}
                        >
                            🔬 MOLigize!
                        </button>
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

                    {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-4 border border-red-100 dark:border-red-900/30">{error}</div>}

                    {primers ? (
                        <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity duration-200 ${loading ? 'opacity-50' : 'opacity-100'}`}>
                            <div className="bg-white dark:bg-slate-800 rounded-lg border border-indigo-100 dark:border-indigo-900/30 p-3 shadow-sm relative group flex flex-col justify-between">
                                <div>
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Oligo 2 (Left / 5')</div>
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
                                        <div className="text-xs font-bold text-green-600 dark:text-green-400 uppercase tracking-wider">Oligo 1 (Right / 3')</div>
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
