import { useState } from 'react';
import MSAViewer from './MSAViewer';

interface DesignedPrimer {
    sequence: string;
    length: number;
    gc_percent: number;
    tm: number;
    hairpin: { structure_found: boolean; tm: number | null; dg: number | null };
    homodimer: { structure_found: boolean; tm: number | null; dg: number | null };
    primer3: { tm: number | null; gc_percent: number | null; self_any: number | null; self_end: number | null; hairpin_th: number | null };
    interval?: [number, number];
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
    onVisibleQueryChange?: (data: { id: string; seq: string; start: number; end: number }) => void;
    navigateTarget?: { colStart: number; colEnd: number; ts: number } | null;
    isDarkMode?: boolean;
    onOligoRegionSelect?: (startCol: number, endCol: number) => void;
}

const API = ((import.meta.env.VITE_API_BASE as string) || '');

export default function FlankingPrimersPanel({
    rawSeq, oligoStart, oligoEnd,
    p1Start, p1End, p2Start, p2End,
    alignment, oligoPrimers, onVisibleQueryChange, navigateTarget, isDarkMode, onOligoRegionSelect,
}: Props) {
    // Primer3 params
    const [flankWindow, setFlankWindow] = useState(200);
    const [optSize, setOptSize]   = useState(20);
    const [minSize, setMinSize]   = useState(18);
    const [maxSize, setMaxSize]   = useState(25);
    const [optTm, setOptTm]       = useState(62.0);
    const [minTm, setMinTm]       = useState(57.0);
    const [maxTm, setMaxTm]       = useState(67.0);
    const [minGc, setMinGc]       = useState(20.0);
    const [maxGc, setMaxGc]       = useState(80.0);
    const [numReturn, setNumReturn] = useState(5);
    const [showAdv, setShowAdv]   = useState(false);
    const [mvConc,  setMvConc]    = useState(50.0);
    const [dvConc,  setDvConc]    = useState(1.5);
    const [dntpConc, setDntpConc] = useState(0.2);
    const [dnaConc,  setDnaConc]  = useState(50.0);

    const [loading, setLoading] = useState(false);
    const [error,   setError]   = useState('');
    const [result,  setResult]  = useState<DesignResult | null>(null);

    // selected primer to "use"
    const [selFwd, setSelFwd] = useState<DesignedPrimer | null>(null);
    const [selRev, setSelRev] = useState<DesignedPrimer | null>(null);

    const [copyFb, setCopyFb] = useState('');
    const doCopy = (text: string, key: string) => {
        const fb = () => { const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); setCopyFb(key); setTimeout(() => setCopyFb(''), 2000); } catch {} document.body.removeChild(t); };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => { setCopyFb(key); setTimeout(() => setCopyFb(''), 2000); }).catch(fb);
        else fb();
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
                }),
            });
            if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Design failed'); }
            setResult(await res.json());
        } catch (e: any) { setError(e.message); }
        finally { setLoading(false); }
    };

    // ── Static sequence view ─────────────────────────────────────────────────
    const viewStart = Math.max(0, Math.min(p1Start, p2Start) - flankWindow);
    const viewEnd   = Math.min(rawSeq.length, Math.max(p1End, p2End) + flankWindow);
    const fwdInterval = selFwd?.interval;
    const revInterval = selRev?.interval;

    // flankingPrimers for MSAViewer — show "Used" primer if selected, otherwise show top candidate
    const activeFwd = selFwd ?? result?.forward.primers[0] ?? null;
    const activeRev = selRev ?? result?.reverse.primers[0] ?? null;
    const flankingPrimersForMSA = (activeFwd?.interval || activeRev?.interval) ? {
        fwd: activeFwd?.interval ? { start: activeFwd.interval[0], end: activeFwd.interval[1] } : null,
        rev: activeRev?.interval ? { start: activeRev.interval[0], end: activeRev.interval[1] } : null,
    } : null;

    const renderStaticSeq = () => {
        const chars = rawSeq.substring(viewStart, viewEnd).split('');
        const lineLength = 150;
        const lines = [];
        for (let i = 0; i < chars.length; i += lineLength) {
            lines.push(chars.slice(i, i + lineLength));
        }

        return (
            <div className="font-mono text-xs leading-relaxed select-text space-y-1">
                {lines.map((lineChars, lineIdx) => {
                    const lineStartPos = viewStart + lineIdx * lineLength + 1; // 1-indexed
                    const posStr = String(lineStartPos).padStart(6, ' ');
                    return (
                        <div key={lineIdx} className="flex">
                            <span className="text-slate-400 mr-4 select-none whitespace-pre">{posStr}</span>
                            <span className="break-all whitespace-pre-wrap">
                                {lineChars.map((char, charIdx) => {
                                    const i = viewStart + lineIdx * lineLength + charIdx;
                                    const isP1  = i >= p1Start && i < p1End;
                                    const isP2  = i >= p2Start && i < p2End;
                                    const isFwd = fwdInterval && i >= fwdInterval[0] && i < fwdInterval[1];
                                    const isRev = revInterval && i >= revInterval[0] && i < revInterval[1];
                                    let cn = 'text-slate-500 dark:text-slate-400';
                                    if (isP1)  cn = 'bg-green-200 dark:bg-green-900/40 text-green-900 dark:text-green-300 font-bold';
                                    if (isP2)  cn = 'bg-amber-200 dark:bg-amber-900/40 text-amber-900 dark:text-amber-300 font-bold';
                                    if (isFwd) cn = 'bg-emerald-300 dark:bg-emerald-700/60 text-emerald-900 dark:text-emerald-200 font-bold underline';
                                    if (isRev) cn = 'bg-teal-300 dark:bg-teal-700/60 text-teal-900 dark:text-teal-200 font-bold underline';
                                    return <span key={i} className={cn}>{char}</span>;
                                })}
                            </span>
                        </div>
                    );
                })}
            </div>
        );
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
        return (
            <div key={idx} className={`rounded-xl border p-3 text-xs transition-all ${isSelected ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 shadow-md' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider">#{idx + 1}</span>
                        <span className="font-mono text-slate-700 dark:text-slate-200 break-all">{p.sequence}</span>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => doCopy(p.sequence, copyKey)}
                            className="text-[10px] px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors font-bold">
                            {copyFb === copyKey ? '✓' : 'Copy'}
                        </button>
                        <button onClick={() => side === 'fwd' ? setSelFwd(isSelected ? null : p) : setSelRev(isSelected ? null : p)}
                            className={`text-[10px] px-2 py-0.5 rounded border font-bold transition-all ${isSelected ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-emerald-300 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'}`}>
                            {isSelected ? '✓ Used' : 'Use'}
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-4 gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                    <div><span className="font-bold text-slate-600 dark:text-slate-300">Tm</span><br />{p.tm ?? p.primer3?.tm ?? '—'}°C</div>
                    <div><span className="font-bold text-slate-600 dark:text-slate-300">GC</span><br />{p.gc_percent ?? p.primer3?.gc_percent ?? '—'}%</div>
                    <div><span className="font-bold text-slate-600 dark:text-slate-300">Hairpin Tm</span><br /><span className={p.hairpin.structure_found ? 'text-amber-500' : 'text-emerald-500'}>{p.hairpin.structure_found ? `${p.primer3.hairpin_th ?? '—'}°C` : 'None'}</span></div>
                    <div><span className="font-bold text-slate-600 dark:text-slate-300">Self-dimer</span><br /><span className={statusDg(p.homodimer.dg)}>{p.homodimer.dg !== null ? `${p.homodimer.dg} kcal` : 'OK'}</span></div>
                </div>
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
                    onVisibleQueryChange={onVisibleQueryChange}
                    primers={oligoPrimers}
                    flankingPrimers={flankingPrimersForMSA}
                    isDarkMode={isDarkMode}
                    navigateTarget={navigateTarget}
                    onOligoRegionSelect={onOligoRegionSelect}
                />
            )}

            <div className="p-5 space-y-5">
                {/* ── Static sequence view ── */}
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-700 flex gap-4 flex-wrap items-center text-[10px] text-slate-400 font-medium">
                        <span><span className="inline-block w-2.5 h-2.5 bg-amber-400 rounded-sm mr-1 align-middle" />Oligo 2</span>
                        <span><span className="inline-block w-2.5 h-2.5 bg-green-400 rounded-sm mr-1 align-middle" />Oligo 1</span>
                        {selFwd && <span><span className="inline-block w-2.5 h-2.5 bg-emerald-400 rounded-sm mr-1 align-middle" />Left Flanking</span>}
                        {selRev && <span><span className="inline-block w-2.5 h-2.5 bg-teal-400 rounded-sm mr-1 align-middle" />Right Flanking</span>}
                    </div>
                    <div className="p-4 max-h-52 overflow-y-auto bg-white dark:bg-slate-800">
                        {renderStaticSeq()}
                    </div>
                </div>

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
                            {numInput('Flank Window (bp)', flankWindow, setFlankWindow, 50, 50, 1000)}
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
                                    {numInput('Mono [mM]',  mvConc,   setMvConc,   5,    0)}
                                    {numInput('Dival [mM]', dvConc,   setDvConc,   0.5,  0)}
                                    {numInput('dNTP [mM]',  dntpConc, setDntpConc, 0.05, 0)}
                                    {numInput('DNA [nM]',   dnaConc,  setDnaConc,  10,   0)}
                                </div>
                            </div>
                        )}
                        <button onClick={design} disabled={loading}
                            className={`w-full py-2.5 rounded-lg font-bold text-sm transition-all ${loading ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-md active:scale-95'}`}>
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                                    Designing with Primer3…
                                </span>
                            ) : '⚡ Design Flanking Primers'}
                        </button>
                        {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
                    </div>
                </div>

                {/* ── Results ── */}
                {result && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div>
                            <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2 px-1">
                                Left (Forward) Primers — {result.forward.num_returned} found
                            </div>
                            {result.forward.primers.length === 0
                                ? <p className="text-xs text-slate-400 px-1">{result.forward.explain || 'No primers found in upstream region.'}</p>
                                : <div className="space-y-2">{result.forward.primers.map((p, i) => renderCard(p, 'fwd', i))}</div>}
                        </div>
                        <div>
                            <div className="text-xs font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wider mb-2 px-1">
                                Right (Reverse) Primers — {result.reverse.num_returned} found
                            </div>
                            {result.reverse.primers.length === 0
                                ? <p className="text-xs text-slate-400 px-1">{result.reverse.explain || 'No primers found in downstream region.'}</p>
                                : <div className="space-y-2">{result.reverse.primers.map((p, i) => renderCard(p, 'rev', i))}</div>}
                        </div>
                        {result.pair_metrics && selFwd && selRev && (
                            <div className="col-span-full rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-900/50">
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Best Pair — HeteroDimer QC</div>
                                <div className="flex gap-6 text-xs text-slate-600 dark:text-slate-300">
                                    <span>Structure: <b className={result.pair_metrics.heterodimer.structure_found ? 'text-amber-500' : 'text-emerald-500'}>{result.pair_metrics.heterodimer.structure_found ? 'Found' : 'None'}</b></span>
                                    <span>Tm: <b>{result.pair_metrics.heterodimer.tm ?? '—'}°C</b></span>
                                    <span>ΔG: <b className={result.pair_metrics.heterodimer.dg !== null && result.pair_metrics.heterodimer.dg < -6 ? 'text-red-500' : 'text-emerald-500'}>{result.pair_metrics.heterodimer.dg ?? '—'} kcal/mol</b></span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
