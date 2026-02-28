import { useState, useEffect } from 'react';
import MOLigoPanel from './MOLigoPanel';
import HairpinSVG from './HairpinSVG';

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
    len: number;
    gc: number;
    start: number; // relative to the UNGAPPED raw sequence of the slice
    end: number;
}

interface OligizeResponse {
    p1: Primer;
    p2: Primer;
    split_idx: number;
    params_not_met?: boolean;
    param_warnings?: string[];
}

export default function QueryViewer({ data, jobName, onPrimersUpdate, idtCredentials }: QueryViewerProps) {
    const [copyFeedback, setCopyFeedback] = useState('');
    const [showOligizer, setShowOligizer] = useState(() => localStorage.getItem('show_oligizer') === 'true');

    // IDT Analysis State
    const [isIdtLoading, setIsIdtLoading] = useState(false);
    const [idtResults, setIdtResults] = useState<IdtData | null>(null);
    const [idtError, setIdtError] = useState<string | null>(null);

    // Controls - Shift Logic
    const [moligoShift, setMoligoShift] = useState(() => Number(localStorage.getItem('moligo_shift')) || 0);
    const [moligo1Len, setMoligo1Len] = useState(() => Number(localStorage.getItem('moligo_1_len')) || 20);
    const [moligo2Len, setMoligo2Len] = useState(() => Number(localStorage.getItem('moligo_2_len')) || 20);

    const [primers, setPrimers] = useState<OligizeResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [showParams, setShowParams] = useState(() => localStorage.getItem('show_search_params') === 'true');
    const [searchParams, setSearchParams] = useState(() => {
        const saved = localStorage.getItem('oligo_search_params');
        if (saved) return JSON.parse(saved);
        return {
            min_len: 15,
            max_l: 35,
            tm_min: 60.0,
            tm_max: 63.0,
            tm_diff: 1.5
        };
    });
    const [paramsNotMet, setParamsNotMet] = useState(false);

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
            // Keep lengths and shift persistent if the user wants them to stay
            setIdtResults(null);
            setIdtError(null);
            onPrimersUpdate(null);
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
        if (!data || !showOligizer) {
            onPrimersUpdate(null);
            return;
        }

        const raw = data.seq.replace(/-/g, '');
        if (raw.length < 2) return;

        const fetchPrimers = async () => {
            setLoading(true);
            setError('');

            try {
                const res = await fetch(((import.meta.env.VITE_API_BASE as string) || "") + '/moligize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sequence: raw,
                        moligo1_shift: moligoShift,
                        moligo2_shift: moligoShift,
                        moligo1_len: moligo1Len,
                        moligo2_len: moligo2Len,
                        search_params: showParams ? {
                            min_len: Number(searchParams.min_len),
                            max_len: Number(searchParams.max_l),
                            tm_min: Number(searchParams.tm_min),
                            tm_max: Number(searchParams.tm_max),
                            tm_diff: Number(searchParams.tm_diff),
                            moligoShift: moligoShift
                        } : null
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
    }, [data, showOligizer, moligoShift, showParams, searchParams, moligo1Len, moligo2Len]);

    // Persistence
    useEffect(() => { localStorage.setItem('moligo_shift', String(moligoShift)); }, [moligoShift]);
    useEffect(() => { localStorage.setItem('moligo_1_len', String(moligo1Len)); }, [moligo1Len]);
    useEffect(() => { localStorage.setItem('moligo_2_len', String(moligo2Len)); }, [moligo2Len]);
    useEffect(() => { localStorage.setItem('show_oligizer', String(showOligizer)); }, [showOligizer]);

    useEffect(() => { localStorage.setItem('show_search_params', String(showParams)); }, [showParams]);
    useEffect(() => { localStorage.setItem('oligo_search_params', JSON.stringify(searchParams)); }, [searchParams]);
    useEffect(() => { localStorage.setItem('show_moligo_prov', String(showMOLigo)); }, [showMOLigo]);
    useEffect(() => { localStorage.setItem('tag_seq', tagSeq); }, [tagSeq]);
    useEffect(() => { localStorage.setItem('fwd_primer', fwdPrimer); }, [fwdPrimer]);
    useEffect(() => { localStorage.setItem('rev_primer', revPrimer); }, [revPrimer]);

    if (!data) return null;
    const rawSeq = data.seq.replace(/-/g, '');

    const renderSequence = () => {
        if (!primers) return rawSeq;
        const chars = rawSeq.split('');
        return chars.map((char, i) => {
            let className = '';
            if (i >= primers.p1.start && i < primers.p1.end) {
                className = 'bg-green-200 dark:bg-green-900/40 text-green-900 dark:text-green-300 font-bold';
            }
            else if (i >= primers.p2.start && i < primers.p2.end) {
                className = 'bg-amber-200 dark:bg-amber-900/40 text-amber-900 dark:text-amber-300 font-bold';
            }
            return <span key={i} className={className}>{char}</span>;
        });
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
                    mg_conc: idtCredentials.mgConc ?? 0
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

        // Extract DG and Visual from the structure { DeltaG, raw }
        let dg = data.DeltaG;
        let raw = data.raw;
        let asciiStructure: string | undefined = undefined;
        let hairpinDotBracket: string | undefined = undefined;
        let hairpinSeq: string | undefined = undefined;

        if (raw) {
            asciiStructure = raw.AsciiStructure || raw.VisualPrint || raw.asciiStructure || raw.visualPrint || raw.Ascii || raw.ascii;
        } else if (data.AsciiStructure || data.VisualPrint) {
            asciiStructure = data.AsciiStructure || data.VisualPrint;
        }

        // Handle case where data is an array
        if (Array.isArray(raw) && raw.length > 0) {
            const first = raw[0];
            asciiStructure = first.AsciiStructure || first.VisualPrint || first.asciiStructure || first.visualPrint;

            // If still no ASCII but we have Dimer Bonds
            if (!asciiStructure && first.Bonds && seq1) {
                asciiStructure = buildDimerAscii(first, seq1, seq2);
            } else if (!asciiStructure && first.DotBracket && seq1) {
                // Use SVG hairpin instead of ASCII
                hairpinDotBracket = first.DotBracket;
                hairpinSeq = seq1;
            }
        } else if (raw && raw.Bonds && seq1) {
            // If it's a single dict and has Bonds
            if (!asciiStructure) asciiStructure = buildDimerAscii(raw, seq1, seq2);
        } else if (raw && raw.DotBracket && seq1) {
            if (!asciiStructure) {
                hairpinDotBracket = raw.DotBracket;
                hairpinSeq = seq1;
            }
        }

        return (
            <div className="flex flex-col gap-1 mb-2">
                <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">{title}:</span>
                    <span className={getIdtStatusColor(dg)}>{dg !== undefined && dg !== null ? `${dg.toFixed(2)}` : 'N/A'}</span>
                </div>
                {hairpinDotBracket && hairpinSeq && (
                    <div className="mt-1 w-full overflow-x-auto bg-slate-100 dark:bg-slate-800 rounded p-2">
                        <HairpinSVG seq={hairpinSeq} dotBracket={hairpinDotBracket} />
                    </div>
                )}
                {asciiStructure && !hairpinDotBracket && (
                    <div className="mt-1 w-full overflow-x-auto bg-slate-100 dark:bg-slate-800 rounded p-2 text-[10px] sm:text-xs">
                        <pre className="font-mono text-slate-700 dark:text-slate-300 whitespace-pre leading-[1.15] tracking-tighter">
                            {asciiStructure}
                        </pre>
                    </div>
                )}
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
                    <button
                        onClick={() => setShowOligizer(!showOligizer)}
                        className={`ml-2 px-3 py-1 text-xs font-bold rounded-full border transition-all ${showOligizer
                            ? 'bg-purple-600 text-white border-purple-600 shadow-md ring-2 ring-purple-100 dark:ring-purple-900/40'
                            : 'bg-white dark:bg-slate-700 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800 hover:border-purple-400 dark:hover:border-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20'
                            }`}
                    >
                        ⚡ Oligize!
                    </button>

                    {showOligizer && (
                        <div className="flex items-center gap-1 ml-4 bg-white dark:bg-slate-700 border border-purple-200 dark:border-purple-800 rounded-lg px-2 py-0.5 shadow-sm">
                            <span className="text-[10px] uppercase text-slate-400 font-bold mr-1">Shift Both</span>
                            <button
                                onClick={() => setMoligoShift(prev => prev - 1)}
                                className={`w-7 h-7 flex items-center justify-center bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 rounded text-slate-600 dark:text-slate-400 font-bold text-sm transition-colors ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                title="Move All Left"
                                disabled={loading}
                            >&lt;</button>
                            <button
                                onClick={() => setMoligoShift(prev => prev + 1)}
                                className={`w-7 h-7 flex items-center justify-center bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 rounded text-slate-600 dark:text-slate-400 font-bold text-sm transition-colors ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                title="Move All Right"
                                disabled={loading}
                            >&gt;</button>
                        </div>
                    )}

                    <button
                        onClick={() => setShowParams(!showParams)}
                        className={`ml-2 px-3 py-1 text-[10px] font-bold rounded border transition-all uppercase tracking-tight ${showParams
                            ? 'bg-amber-100 text-amber-700 border-amber-300'
                            : 'bg-white dark:bg-slate-700 text-slate-500 border-slate-200 dark:border-slate-600 hover:border-amber-300 hover:text-amber-600'
                            }`}
                    >
                        ⚙️ Search by params
                    </button>

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
                {showOligizer && (
                    <div className="bg-purple-50/50 dark:bg-purple-900/5 border-b border-purple-100 dark:border-purple-900/20 p-4 font-sans relative">
                        {showParams && (
                            <div className="mb-4 p-3 bg-white dark:bg-slate-800 rounded-lg border border-amber-200 dark:border-amber-900/30 shadow-sm grid grid-cols-2 md:grid-cols-5 gap-3">
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Min Len</label>
                                    <input
                                        type="number"
                                        value={searchParams.min_len}
                                        onChange={e => setSearchParams({ ...searchParams, min_len: parseInt(e.target.value) })}
                                        className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-900"
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Max Len</label>
                                    <input
                                        type="number"
                                        value={searchParams.max_l}
                                        onChange={e => setSearchParams({ ...searchParams, max_l: parseInt(e.target.value) })}
                                        className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-900"
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Tm Min</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={searchParams.tm_min}
                                        onChange={e => setSearchParams({ ...searchParams, tm_min: parseFloat(e.target.value) })}
                                        className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-900"
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Tm Max</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={searchParams.tm_max}
                                        onChange={e => setSearchParams({ ...searchParams, tm_max: parseFloat(e.target.value) })}
                                        className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-900"
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Tm Diff</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        value={searchParams.tm_diff}
                                        onChange={e => setSearchParams({ ...searchParams, tm_diff: parseFloat(e.target.value) })}
                                        className="px-2 py-1 text-xs border border-slate-200 dark:border-slate-700 rounded bg-slate-50 dark:bg-slate-900"
                                    />
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
                            <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity duration-200 ${loading ? 'opacity-60' : 'opacity-100'}`}>
                                <div className="bg-white dark:bg-slate-800 rounded-lg border border-amber-200 dark:border-amber-900/30 p-3 shadow-sm relative group flex flex-col justify-between">
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
                                            <span>Len: <b className="text-slate-700 dark:text-slate-200">{primers.p2.len}</b></span>
                                            {idtResults?.m2?.analyze ? (
                                                <span title="IDT Tm" className="bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                                                    IDT Tm: <b className="font-bold">{extractTm(idtResults.m2.analyze)?.toFixed(1) || 'N/A'}°C</b>
                                                </span>
                                            ) : (
                                                <span title="Primer3 Tm">Tm: <b className="text-slate-700 dark:text-slate-200">{primers.p2.tm}°C</b></span>
                                            )}
                                        </div>
                                        <div className="flex bg-slate-100 dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600 overflow-hidden shadow-sm">
                                            <button onClick={() => setMoligo2Len(prev => Math.max(10, prev - 1))} className="w-8 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors font-bold border-r border-slate-200 dark:border-slate-600">-</button>
                                            <button onClick={() => setMoligo2Len(prev => Math.min(60, prev + 1))} className="w-8 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors font-bold">+</button>
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
                                            <span>Len: <b className="text-slate-700 dark:text-slate-200">{primers.p1.len}</b></span>
                                            {idtResults?.m1?.analyze ? (
                                                <span title="IDT Tm" className="bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-200 dark:border-indigo-800">
                                                    IDT Tm: <b className="font-bold">{extractTm(idtResults.m1.analyze)?.toFixed(1) || 'N/A'}°C</b>
                                                </span>
                                            ) : (
                                                <span title="Primer3 Tm">Tm: <b className="text-slate-700 dark:text-slate-200">{primers.p1.tm}°C</b></span>
                                            )}
                                        </div>
                                        <div className="flex bg-slate-100 dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600 overflow-hidden shadow-sm">
                                            <button onClick={() => setMoligo1Len(prev => Math.max(10, prev - 1))} className="w-8 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors font-bold border-r border-slate-200 dark:border-slate-600">-</button>
                                            <button onClick={() => setMoligo1Len(prev => Math.min(60, prev + 1))} className="w-8 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors font-bold">+</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            loading && <div className="flex items-center justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div></div>
                        )}



                        {/* ── MOLigo Provenance Panel ────────────────────── */}
                        {primers && showMOLigo && (
                            <MOLigoPanel
                                templateSeq={rawSeq}
                                moligo1Seq={primers.p1.seq}
                                moligo2Seq={primers.p2.seq}
                                tagSeq={tagSeq}
                                fwdPrimer={fwdPrimer}
                                revPrimer={revPrimer}
                                onTagChange={setTagSeq}
                                onFwdChange={setFwdPrimer}
                                onRevChange={setRevPrimer}
                            />
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
                                                value={idtCredentials.mgConc ?? 0}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    localStorage.setItem('idt_mg_conc', val);
                                                    // Trigger re-render via the parent state
                                                    window.dispatchEvent(new CustomEvent('idt-mg-change', { detail: val }));
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
                )}

                <div className="p-5 bg-slate-50/50 dark:bg-slate-900/50">
                    <div className="font-mono text-xs text-slate-600 dark:text-slate-400 break-all leading-relaxed max-h-60 overflow-y-auto p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-inner">
                        {showOligizer ? renderSequence() : rawSeq}
                    </div>
                </div>
            </div>
        </div >
    );
}
