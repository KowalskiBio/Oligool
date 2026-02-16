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
}

const QueryViewer: React.FC<QueryViewerProps> = ({ data, jobName, onPrimersUpdate }) => {
    const [copyFeedback, setCopyFeedback] = useState('');
    const [showMoligizer, setShowMoligizer] = useState(false);

    // Controls
    const [targetTm, setTargetTm] = useState(60);
    const [tmTolerance, setTmTolerance] = useState(0.5); // Default 0.5 as requested
    const [minLen, setMinLen] = useState(18);
    const [maxLen, setMaxLen] = useState(30); // Default 30
    const [desiredLen, setDesiredLen] = useState<number | ''>(''); // Optional fixed length
    const [splitIdx, setSplitIdx] = useState<number | null>(null); // Absolute index

    // Per-primer manual length overrides (if user clicks + / -)
    const [p1Len, setP1Len] = useState<number | null>(null);
    const [p2Len, setP2Len] = useState<number | null>(null);

    const [primers, setPrimers] = useState<MoligizeResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

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
            // When data changes, reset split to middle (if not set appropriately)
            setSplitIdx(Math.floor(raw.length / 2));
            setP1Len(null);
            setP2Len(null);
            setPrimers(null);
            onPrimersUpdate(null);
        }
    }, [data?.id, data?.seq]); // Only rely on ID/Seq change, not full object ref

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
        return gappedSeq.length; // Should not happen if index valid
    };

    useEffect(() => {
        if (!data || !showMoligizer || splitIdx === null) {
            onPrimersUpdate(null);
            return;
        }

        const raw = data.seq.replace(/-/g, '');
        if (raw.length < 2) return;

        const fetchPrimers = async () => {
            setLoading(true);
            setError('');
            // Don't clear primers immediately to avoid flickering, but maybe we should?
            // setPrimers(null);

            try {
                const res = await fetch('http://localhost:8000/moligize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sequence: raw,
                        target_tm: targetTm,
                        tm_tolerance: tmTolerance,
                        min_len: minLen,
                        max_len: maxLen,
                        desired_len: desiredLen === '' ? null : Number(desiredLen),
                        p1_len: p1Len,
                        p2_len: p2Len,
                        split_idx: splitIdx
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
                setError(err.message || 'Failed to generate primers');
                setPrimers(null);
                onPrimersUpdate(null);
            } finally {
                setLoading(false);
            }
        };

        const debounce = setTimeout(fetchPrimers, 400);
        return () => clearTimeout(debounce);
    }, [data, showMoligizer, targetTm, tmTolerance, minLen, maxLen, desiredLen, p1Len, p2Len, splitIdx]);

    if (!data) return null;
    const rawSeq = data.seq.replace(/-/g, '');

    // Helper to adjust manual length
    const adjustLength = (primer: 'p1' | 'p2', delta: number) => {
        if (!primers) return;
        if (primer === 'p1') {
            const current = p1Len ?? primers.p1.len;
            setP1Len(Math.max(10, current + delta)); // limit min 10
        } else {
            const current = p2Len ?? primers.p2.len;
            setP2Len(Math.max(10, current + delta));
        }
    };

    // Visualization
    const renderSequence = () => {
        if (!primers) return rawSeq;
        const chars = rawSeq.split('');
        return chars.map((char, i) => {
            let className = '';
            // P1 (Green): [p1.start, p1.end)
            if (i >= primers.p1.start && i < primers.p1.end) {
                className = 'bg-green-200 dark:bg-green-900/40 text-green-900 dark:text-green-300 font-bold';
            }
            // P2 (Blue): [p2.start, p2.end)
            else if (i >= primers.p2.start && i < primers.p2.end) {
                className = 'bg-blue-200 dark:bg-blue-900/40 text-blue-900 dark:text-blue-300 font-bold';
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
                <div className="bg-purple-50/50 dark:bg-purple-900/10 border-b border-purple-100 dark:border-purple-900/30 p-4 font-sans">
                    {/* Controls Row 1: Global Settings */}
                    <div className="flex items-end gap-x-6 gap-y-4 mb-4 flex-wrap">
                        <div className="flex items-center gap-2">
                            <label className="text-xs font-semibold text-purple-800 dark:text-purple-300">Target Tm</label>
                            <input
                                type="number"
                                value={targetTm}
                                onChange={e => {
                                    setTargetTm(Number(e.target.value));
                                    setP1Len(null);
                                    setP2Len(null);
                                }}
                                className="w-14 rounded-md border-purple-200 dark:border-purple-800 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm py-1 px-2 focus:ring-purple-500 focus:border-purple-500 border"
                            />
                            <span className="text-purple-800 dark:text-purple-300 font-bold">±</span>
                            <input
                                type="number"
                                step="0.1"
                                value={tmTolerance}
                                onChange={e => {
                                    setTmTolerance(Number(e.target.value));
                                    setP1Len(null);
                                    setP2Len(null);
                                }}
                                className="w-14 rounded-md border-purple-200 dark:border-purple-800 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm py-1 px-2 focus:ring-purple-500 focus:border-purple-500 border"
                                title="Deviation (°C)"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-purple-800 dark:text-purple-300 mb-1">Min Len</label>
                            <input
                                type="number"
                                value={minLen}
                                onChange={e => {
                                    setMinLen(Number(e.target.value));
                                    setP1Len(null);
                                    setP2Len(null);
                                }}
                                className="w-14 rounded-md border-purple-200 dark:border-purple-800 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm py-1 px-2 focus:ring-purple-500 focus:border-purple-500 border"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-purple-800 dark:text-purple-300 mb-1">Max Len</label>
                            <input
                                type="number"
                                value={maxLen}
                                onChange={e => {
                                    setMaxLen(Number(e.target.value));
                                    setP1Len(null);
                                    setP2Len(null);
                                }}
                                className="w-14 rounded-md border-purple-200 dark:border-purple-800 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm py-1 px-2 focus:ring-purple-500 focus:border-purple-500 border"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-purple-800 dark:text-purple-300 mb-1">Desired Len</label>
                            <input
                                type="number"
                                value={desiredLen}
                                onChange={e => {
                                    setDesiredLen(e.target.value === '' ? '' : Number(e.target.value));
                                    setP1Len(null);
                                    setP2Len(null);
                                }}
                                placeholder="Opt"
                                className="w-16 rounded-md border-purple-200 dark:border-purple-800 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm py-1 px-2 focus:ring-purple-500 focus:border-purple-500 placeholder-slate-400 dark:placeholder-slate-500 border"
                            />
                        </div>
                    </div >

                    {loading && <div className="text-sm text-purple-600 dark:text-purple-400 animate-pulse mb-2">Designing primers...</div>}
                    {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-2 border border-red-100 dark:border-red-900/30">{error}</div>}

                    {
                        primers && !loading && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Primer 1 (Left - Green) */}
                                <div className="bg-white dark:bg-slate-800 rounded-lg border border-green-200 dark:border-green-900/30 p-3 shadow-sm relative group flex flex-col justify-between">
                                    <div>
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="text-xs font-bold text-green-600 dark:text-green-400 uppercase tracking-wider">Primer 1 (Forward / Left)</div>
                                            <button
                                                onClick={() => handleCopy(primers.p1.seq)}
                                                className="text-xs bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-2 py-1 rounded hover:bg-green-100 dark:hover:bg-green-900/40 border border-green-200 dark:border-green-800/50"
                                            >
                                                Copy
                                            </button>
                                        </div>
                                        <div className="font-mono text-sm text-slate-700 dark:text-slate-300 break-all bg-green-50/50 dark:bg-green-900/10 p-2 rounded">{primers.p1.seq}</div>
                                    </div>

                                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700 pt-2">
                                        <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400">
                                            <span>Len: <b className="text-slate-700 dark:text-slate-200">{primers.p1.len}</b></span>
                                            <span>Tm: <b className="text-slate-700 dark:text-slate-200">{primers.p1.tm}°C</b></span>
                                        </div>
                                        {/* Length Controls */}
                                        <div className="flex items-center gap-1">
                                            <button onClick={() => adjustLength('p1', -1)} className="w-6 h-6 flex items-center justify-center bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded text-slate-600 dark:text-slate-400 font-bold text-xs" title="Remove 1bp">-</button>
                                            <button onClick={() => adjustLength('p1', 1)} className="w-6 h-6 flex items-center justify-center bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded text-slate-600 dark:text-slate-400 font-bold text-xs" title="Add 1bp">+</button>
                                        </div>
                                    </div>
                                </div>

                                {/* Primer 2 (Right - Blue) */}
                                <div className="bg-white dark:bg-slate-800 rounded-lg border border-blue-200 dark:border-blue-900/30 p-3 shadow-sm relative group flex flex-col justify-between">
                                    <div>
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">Primer 2 (Reverse / Right)</div>
                                            <button
                                                onClick={() => handleCopy(primers.p2.seq)}
                                                className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 px-2 py-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 border border-blue-200 dark:border-blue-800/50"
                                            >
                                                Copy
                                            </button>
                                        </div>
                                        <div className="font-mono text-sm text-slate-700 dark:text-slate-300 break-all bg-blue-50/50 dark:bg-blue-900/10 p-2 rounded">{primers.p2.seq}</div>
                                    </div>

                                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700 pt-2">
                                        <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400">
                                            <span>Len: <b className="text-slate-700 dark:text-slate-200">{primers.p2.len}</b></span>
                                            <span>Tm: <b className="text-slate-700 dark:text-slate-200">{primers.p2.tm}°C</b></span>
                                        </div>
                                        {/* Length Controls */}
                                        <div className="flex items-center gap-1">
                                            <button onClick={() => adjustLength('p2', -1)} className="w-6 h-6 flex items-center justify-center bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded text-slate-600 dark:text-slate-400 font-bold text-xs" title="Remove 1bp">-</button>
                                            <button onClick={() => adjustLength('p2', 1)} className="w-6 h-6 flex items-center justify-center bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded text-slate-600 dark:text-slate-400 font-bold text-xs" title="Add 1bp">+</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
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
