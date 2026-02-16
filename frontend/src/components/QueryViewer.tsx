import React, { useState, useEffect } from 'react';

interface QueryViewerProps {
    data: { id: string; seq: string; start: number; end: number } | null;
    jobName: string;
    onPrimersUpdate: (primers: { p1: { start: number, end: number }, p2: { start: number, end: number } } | null) => void;
}

interface Primer {
    seq: string;
    tm: number;
    len: number;
    gc: number;
    start: number; // relative to the UNGAPPED raw sequence of the slice
    end: number;
}

interface MoligizeResponse {
    p1: Primer;
    p2: Primer;
    split_idx: number;
    params_not_met?: boolean;
}

const QueryViewer: React.FC<QueryViewerProps> = ({ data, jobName, onPrimersUpdate }) => {
    const [copyFeedback, setCopyFeedback] = useState('');
    const [showMoligizer, setShowMoligizer] = useState(false);

    // Controls - Shift Logic
    const [moligoShift, setMoligoShift] = useState(0);
    const [moligo1Len, setMoligo1Len] = useState(50);
    const [moligo2Len, setMoligo2Len] = useState(50);

    // Derived split for visualization only (backend calculates actual split)
    const [splitIdx, setSplitIdx] = useState<number | null>(null);

    const [primers, setPrimers] = useState<MoligizeResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [showParams, setShowParams] = useState(false);
    const [searchParams, setSearchParams] = useState({
        min_len: 40,
        max_l: 60,
        tm_min: 47.0,
        tm_max: 58.0,
        tm_diff: 1.5
    });
    const [paramsNotMet, setParamsNotMet] = useState(false);

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopyFeedback('Copied!');
            setTimeout(() => setCopyFeedback(''), 2000);
        });
    };

    // Initialize/Reset state when data changes
    useEffect(() => {
        if (data) {
            const raw = data.seq.replace(/-/g, '');
            // When data changes, reset state
            setSplitIdx(Math.floor(raw.length / 2));
            setMoligoShift(0);
            setMoligo1Len(50);
            setMoligo2Len(50);
            setPrimers(null);
            onPrimersUpdate(null);
        }
    }, [data?.id, data?.seq]);

    // Start with splitIdx centered if null (initial load)
    useEffect(() => {
        if (data && splitIdx === null) {
            const raw = data.seq.replace(/-/g, '');
            setSplitIdx(Math.floor(raw.length / 2));
        }
    }, [data, splitIdx]);

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
        if (!data || !showMoligizer) {
            onPrimersUpdate(null);
            return;
        }

        const raw = data.seq.replace(/-/g, '');
        if (raw.length < 2) return;

        const fetchPrimers = async () => {
            setLoading(true);
            setError('');

            try {
                const res = await fetch('http://localhost:8000/moligize', {
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
                const json: MoligizeResponse = await res.json();
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
                setError(err.message || 'Failed to generate moligos');
                // Don't clear primers on error to prevent layout jump, 
                // but we should probably clear on initial data change reset.
            } finally {
                setLoading(false);
            }
        };

        const debounce = setTimeout(fetchPrimers, 200); // Faster debounce as calculation is cheap
        return () => clearTimeout(debounce);
    }, [data, showMoligizer, moligoShift, showParams, searchParams, moligo1Len, moligo2Len]);

    if (!data) return null;
    const rawSeq = data.seq.replace(/-/g, '');

    // Visualization
    const renderSequence = () => {
        if (!primers) return rawSeq;
        const chars = rawSeq.split('');
        return chars.map((char, i) => {
            let className = '';
            // P1 (Right/3' - Green): [p1.start, p1.end)
            if (i >= primers.p1.start && i < primers.p1.end) {
                className = 'bg-green-200 dark:bg-green-900/40 text-green-900 dark:text-green-300 font-bold';
            }
            // P2 (Left/5' - Yellow): [p2.start, p2.end)
            else if (i >= primers.p2.start && i < primers.p2.end) {
                className = 'bg-amber-200 dark:bg-amber-900/40 text-amber-900 dark:text-amber-300 font-bold';
            }
            return <span key={i} className={className}>{char}</span>;
        });
    };

    return (
        <div className="mt-6 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden bg-white dark:bg-slate-800 transition-all">
            <div className="px-5 py-3 bg-gradient-to-r from-slate-50 to-indigo-50/50 dark:from-slate-800 dark:to-indigo-900/20 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                        Moligo provenance: <span className="font-mono text-indigo-600 dark:text-indigo-400">{jobName}</span>
                    </h2>
                    <span className="text-sm text-slate-500 dark:text-slate-400">
                        (bp {data.start + 1}–{data.end + 1}, len {rawSeq.length})
                    </span>
                    <button
                        onClick={() => setShowMoligizer(!showMoligizer)}
                        className={`ml-2 px-3 py-1 text-xs font-bold rounded-full border transition-all ${showMoligizer
                            ? 'bg-purple-600 text-white border-purple-600 shadow-md ring-2 ring-purple-100 dark:ring-purple-900/40'
                            : 'bg-white dark:bg-slate-700 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800 hover:border-purple-400 dark:hover:border-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20'
                            }`}
                    >
                        ⚡ Moligize!
                    </button>

                    {showMoligizer && (
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

            {/* Moligizer Panel */}
            {showMoligizer && (
                <div className="bg-purple-50/50 dark:bg-purple-900/5 border-b border-purple-100 dark:border-purple-900/20 p-4 font-sans min-h-[140px] relative">
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

                    {paramsNotMet && (
                        <div className="mb-4 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-md text-amber-700 dark:text-amber-400 text-xs flex items-center gap-2">
                            <span className="text-sm">⚠️</span>
                            <b>Params too strict, no moligos found.</b> Showing default center-split oligos instead.
                        </div>
                    )}

                    {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-4 border border-red-100 dark:border-red-900/30">{error}</div>}

                    {
                        primers ? (
                            <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity duration-200 ${loading ? 'opacity-60 pointer-events-none' : 'opacity-100'}`}>
                                {/* MOLigo 2 (Left - Yellow/Peachy) */}
                                <div className="bg-white dark:bg-slate-800 rounded-lg border-amber-200 dark:border-amber-900/30 p-3 shadow-sm relative group flex flex-col justify-between border">
                                    <div>
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">MOLigo 2 (Left / 5')</div>
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
                                        <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400">
                                            <span>Len: <b className="text-slate-700 dark:text-slate-200">{primers.p2.len}</b></span>
                                            <span>Tm: <b className="text-slate-700 dark:text-slate-200">{primers.p2.tm}°C</b></span>
                                        </div>
                                        <div className="flex bg-slate-100 dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600 overflow-hidden shadow-sm">
                                            <button
                                                onClick={() => setMoligo2Len(prev => Math.max(10, prev - 1))}
                                                className="w-8 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors font-bold border-r border-slate-200 dark:border-slate-600"
                                                title="Decrease length"
                                            >-</button>
                                            <button
                                                onClick={() => setMoligo2Len(prev => Math.min(60, prev + 1))}
                                                className="w-8 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors font-bold"
                                                title="Increase length to left"
                                            >+</button>
                                        </div>
                                    </div>
                                </div>

                                {/* MOLigo 1 (Right - Green) */}
                                <div className="bg-white dark:bg-slate-800 rounded-lg border border-green-200 dark:border-green-900/30 p-3 shadow-sm relative group flex flex-col justify-between">
                                    <div>
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="text-xs font-bold text-green-600 dark:text-green-400 uppercase tracking-wider">MOLigo 1 (Right / 3')</div>
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
                                        <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400">
                                            <span>Len: <b className="text-slate-700 dark:text-slate-200">{primers.p1.len}</b></span>
                                            <span>Tm: <b className="text-slate-700 dark:text-slate-200">{primers.p1.tm}°C</b></span>
                                        </div>
                                        <div className="flex bg-slate-100 dark:bg-slate-700 rounded border border-slate-200 dark:border-slate-600 overflow-hidden shadow-sm">
                                            <button
                                                onClick={() => setMoligo1Len(prev => Math.max(10, prev - 1))}
                                                className="w-8 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors font-bold border-r border-slate-200 dark:border-slate-600"
                                                title="Decrease length"
                                            >-</button>
                                            <button
                                                onClick={() => setMoligo1Len(prev => Math.min(60, prev + 1))}
                                                className="w-8 h-7 flex items-center justify-center hover:bg-white dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors font-bold"
                                                title="Increase length to right"
                                            >+</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            showMoligizer && !error && (
                                <div className="flex items-center justify-center p-8">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                                </div>
                            )
                        )
                    }
                </div >
            )
            }

            <div className="p-5 bg-slate-50/50 dark:bg-slate-900/50">
                <div className="font-mono text-xs text-slate-600 dark:text-slate-400 break-all leading-relaxed max-h-60 overflow-y-auto p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-inner">
                    {showMoligizer ? renderSequence() : rawSeq}
                </div>
            </div>
        </div >
    );
};

export default QueryViewer;
