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

    // Controls - Shift Logic
    const [moligo1Shift, setMoligo1Shift] = useState(0); // Right/3'
    const [moligo2Shift, setMoligo2Shift] = useState(0); // Left/5'

    // Derived split for visualization only (backend calculates actual split)
    const [splitIdx, setSplitIdx] = useState<number | null>(null);

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
            // When data changes, reset state
            setSplitIdx(Math.floor(raw.length / 2));
            setMoligo1Shift(0);
            setMoligo2Shift(0);
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
                        moligo1_shift: moligo1Shift,
                        moligo2_shift: moligo2Shift,
                        // split_idx is optional, let backend default to center
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
                setError(err.message || 'Failed to generate moligos');
                setPrimers(null);
                onPrimersUpdate(null);
            } finally {
                setLoading(false);
            }
        };

        const debounce = setTimeout(fetchPrimers, 200); // Faster debounce as calculation is cheap
        return () => clearTimeout(debounce);
    }, [data, showMoligizer, moligo1Shift, moligo2Shift]);

    if (!data) return null;
    const rawSeq = data.seq.replace(/-/g, '');

    // Helper to adjust shift
    const adjustShift = (moligo: 'm1' | 'm2', delta: number) => {
        if (moligo === 'm1') {
            setMoligo1Shift(prev => prev + delta);
        } else {
            setMoligo2Shift(prev => prev + delta);
        }
    };

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
            // P2 (Left/5' - Blue): [p2.start, p2.end)
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

                    {loading && <div className="text-sm text-purple-600 dark:text-purple-400 animate-pulse mb-2">Generating MOLigos...</div>}
                    {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded mb-2 border border-red-100 dark:border-red-900/30">{error}</div>}

                    {
                        primers && !loading && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                                        <div className="font-mono text-sm text-slate-700 dark:text-slate-300 break-all bg-amber-50/50 dark:bg-amber-900/10 p-2 rounded">{primers.p2.seq}</div>
                                    </div>

                                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700 pt-2">
                                        <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400">
                                            <span>Len: <b className="text-slate-700 dark:text-slate-200">{primers.p2.len}</b></span>
                                            <span>Tm: <b className="text-slate-700 dark:text-slate-200">{primers.p2.tm}°C</b></span>
                                        </div>
                                        {/* Shift Component */}
                                        <div className="flex items-center gap-1">
                                            <span className="text-[10px] uppercase text-slate-400 font-bold mr-1">Shift</span>
                                            <button onClick={() => adjustShift('m2', -1)} className="w-6 h-6 flex items-center justify-center bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded text-slate-600 dark:text-slate-400 font-bold text-xs" title="Move Left">&lt;</button>
                                            <button onClick={() => adjustShift('m2', 1)} className="w-6 h-6 flex items-center justify-center bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded text-slate-600 dark:text-slate-400 font-bold text-xs" title="Move Right">&gt;</button>
                                        </div>
                                    </div>
                                </div>

                                {/* MOLigo 1 (Right - Green - Was Primer 1 color logic) 
                                    Backend: "p1": get_stats(moligo1_final), # Right side (MOLigo 1)
                                */}
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
                                        <div className="font-mono text-sm text-slate-700 dark:text-slate-300 break-all bg-green-50/50 dark:bg-green-900/10 p-2 rounded">{primers.p1.seq}</div>
                                    </div>

                                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-700 pt-2">
                                        <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400">
                                            <span>Len: <b className="text-slate-700 dark:text-slate-200">{primers.p1.len}</b></span>
                                            <span>Tm: <b className="text-slate-700 dark:text-slate-200">{primers.p1.tm}°C</b></span>
                                        </div>
                                        {/* Shift Component */}
                                        <div className="flex items-center gap-1">
                                            <span className="text-[10px] uppercase text-slate-400 font-bold mr-1">Shift</span>
                                            <button onClick={() => adjustShift('m1', -1)} className="w-6 h-6 flex items-center justify-center bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded text-slate-600 dark:text-slate-400 font-bold text-xs" title="Move Left">&lt;</button>
                                            <button onClick={() => adjustShift('m1', 1)} className="w-6 h-6 flex items-center justify-center bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded text-slate-600 dark:text-slate-400 font-bold text-xs" title="Move Right">&gt;</button>
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
