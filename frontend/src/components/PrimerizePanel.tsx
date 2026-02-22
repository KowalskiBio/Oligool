import { useState, useEffect } from 'react';

export interface PrimerizeProps {
    templateSeq: string;
    moligo1Seq: string;
    moligo2Seq: string;
    tagSeq?: string;
    fwdPrimer?: string;
    revPrimer?: string;
    onTagChange?: (val: string) => void;
    onFwdChange?: (val: string) => void;
    onRevChange?: (val: string) => void;
    onCreatePrimersClick?: (fwdPcr: string, revPcr: string) => void;
    isPrimerIdtLoading?: boolean;
    primerIdtResults?: any;
    primerIdtError?: string | null;
}

const C = {
    m2: '#f59e0b',     // amber   – Oligo 2 (flat)
    m1: '#10b981',     // emerald – Oligo 1 (flat)
    tag: '#ef4444',    // red     – TAG
    revBs: '#c084fc',  // purple  – Rev BS
    fwdBs: '#f472b6',  // pink    – Forward BS
    tmpl: '#94a3b8',   // slate   – template strands
    tmplFill: '#e2e8f0',
};

export default function PrimerizePanel({
    templateSeq,
    moligo1Seq, moligo2Seq,
    tagSeq, fwdPrimer, revPrimer,
    onTagChange, onFwdChange, onRevChange,
    onCreatePrimersClick, isPrimerIdtLoading, primerIdtResults, primerIdtError
}: PrimerizeProps) {

    const [isSeqMode, setIsSeqMode] = useState(() => localStorage.getItem('primerize_seq_mode') === 'true');

    useEffect(() => {
        localStorage.setItem('primerize_seq_mode', String(isSeqMode));
    }, [isSeqMode]);

    // ── Lengths ──────────────────────────────────────────────────────────
    const m2Len = moligo2Seq.length || 0;
    const m1Len = moligo1Seq.length || 0;
    const tagLen = tagSeq?.length || 0;
    const revLen = revPrimer?.length || 0;
    const fwdLen = fwdPrimer?.length || 0;

    // ── Proportional Math & Layout ───────────────────────────────────────
    const VW = 800; // Fixed viewbox width

    const leftArmLen = revLen + tagLen;
    const rightArmLen = fwdLen;
    const combinedFlatLen = (m1Len + m2Len) || 1;

    // The arms extend outward at a 45-degree angle. Their horizontal footprint (dx)
    // is their sequence length * cos(45deg).
    const leftArmProj = leftArmLen * Math.SQRT1_2;

    const rightArmProj = rightArmLen * Math.SQRT1_2;

    const totalHorizontalNt = leftArmProj + combinedFlatLen + rightArmProj || 1;

    const pad = 12; // minimal horizontal margin to fill edges
    const effectiveW = VW - 2 * pad;

    const pxPerNt = effectiveW / totalHorizontalNt;

    const leftArmDx = leftArmProj * pxPerNt;
    const tagDx = tagLen * Math.SQRT1_2 * pxPerNt;

    const rightArmDx = rightArmProj * pxPerNt;

    // Template & flat probe geometry
    const m2W = m2Len * pxPerNt;
    const m1W = m1Len * pxPerNt;
    const tmplW = m2W + m1W;

    const tmplX0 = pad + leftArmDx;
    const tmplX1 = tmplX0 + tmplW;
    const splitX = tmplX0 + m2W;

    // Y-Axis Positioning
    const maxArmDx = Math.max(leftArmDx, rightArmDx);
    const tmplY = Math.max(50, maxArmDx + 20); // Tightened vertical space
    const stH = 12;
    const gap = 6;

    const VH = tmplY + stH * 2 + gap + 15; // Tightened bottom margin

    // ── Polygon Math for Perfect Miter & Perpendicular Joints ──
    const hw = 7; // half-width (stroke thickness 14)
    const nx = hw * Math.SQRT1_2;
    const ny = -hw * Math.SQRT1_2;
    const dw = hw * (Math.SQRT2 - 1);

    // Centers
    const L = { x: tmplX0 - leftArmDx, y: tmplY - 9 - leftArmDx };
    const S = { x: tmplX0 - tagDx, y: tmplY - 9 - tagDx };
    const C_left = { x: tmplX0, y: tmplY - 9 };
    const R = { x: splitX, y: tmplY - 9 };
    const C_right = { x: tmplX1, y: tmplY - 9 };
    const F = { x: tmplX1 + rightArmDx, y: tmplY - 9 - rightArmDx };

    // Left Arm segments
    const p_start = { top: { x: L.x + nx, y: L.y + ny }, bot: { x: L.x - nx, y: L.y - ny } };
    const p_split = { top: { x: S.x + nx, y: S.y + ny }, bot: { x: S.x - nx, y: S.y - ny } };
    const p_miterL = {
        top: { x: C_left.x + (leftArmLen > 0 ? dw : 0), y: C_left.y - hw },
        bot: { x: C_left.x - (leftArmLen > 0 ? dw : 0), y: C_left.y + hw }
    };

    let polyRevBS = "";
    let polyTAG = "";

    if (revLen > 0 && tagLen > 0) {
        polyRevBS = `${p_start.top.x},${p_start.top.y} ${p_split.top.x},${p_split.top.y} ${p_split.bot.x},${p_split.bot.y} ${p_start.bot.x},${p_start.bot.y}`;
        polyTAG = `${p_split.top.x},${p_split.top.y} ${p_miterL.top.x},${p_miterL.top.y} ${p_miterL.bot.x},${p_miterL.bot.y} ${p_split.bot.x},${p_split.bot.y}`;
    } else if (revLen > 0 && tagLen === 0) {
        polyRevBS = `${p_start.top.x},${p_start.top.y} ${p_miterL.top.x},${p_miterL.top.y} ${p_miterL.bot.x},${p_miterL.bot.y} ${p_start.bot.x},${p_start.bot.y}`;
    } else if (revLen === 0 && tagLen > 0) {
        polyTAG = `${p_start.top.x},${p_start.top.y} ${p_miterL.top.x},${p_miterL.top.y} ${p_miterL.bot.x},${p_miterL.bot.y} ${p_start.bot.x},${p_start.bot.y}`;
    }

    // Horizontal Flat segments
    const p_splitFlat = { top: { x: R.x, y: R.y - hw }, bot: { x: R.x, y: R.y + hw } };

    const polyM2 = `${p_miterL.top.x},${p_miterL.top.y} ${p_splitFlat.top.x},${p_splitFlat.top.y} ${p_splitFlat.bot.x},${p_splitFlat.bot.y} ${p_miterL.bot.x},${p_miterL.bot.y}`;

    const p_miterR = {
        top: { x: C_right.x - (rightArmLen > 0 ? dw : 0), y: C_right.y - hw },
        bot: { x: C_right.x + (rightArmLen > 0 ? dw : 0), y: C_right.y + hw }
    };

    const polyM1 = `${p_splitFlat.top.x},${p_splitFlat.top.y} ${p_miterR.top.x},${p_miterR.top.y} ${p_miterR.bot.x},${p_miterR.bot.y} ${p_splitFlat.bot.x},${p_splitFlat.bot.y}`;

    // Right Arm segments
    const nx2 = -hw * Math.SQRT1_2;
    const ny2 = -hw * Math.SQRT1_2;
    const p_end = { top: { x: F.x + nx2, y: F.y + ny2 }, bot: { x: F.x - nx2, y: F.y - ny2 } };

    let polyFwdBS = "";
    if (fwdLen > 0) {
        polyFwdBS = `${p_miterR.top.x},${p_miterR.top.y} ${p_end.top.x},${p_end.top.y} ${p_end.bot.x},${p_end.bot.y} ${p_miterR.bot.x},${p_miterR.bot.y}`;
    }

    // ── Seq Mode Helper ──────────────────────────────────────────────────
    const reverseComplement = (s: string) => {
        const dict: { [key: string]: string } = { 'A': 'T', 'T': 'A', 'C': 'G', 'G': 'C', 'N': 'N', 'U': 'A', 'a': 't', 't': 'a', 'c': 'g', 'g': 'c', 'n': 'n', 'u': 'a' };
        return s.split('').reverse().map(c => dict[c] || c).join('');
    };

    const tmplTop = reverseComplement(moligo2Seq + moligo1Seq);
    const tmplBot = (moligo2Seq + moligo1Seq);

    const renderSeqChars = (seq: string, p0: { x: number, y: number }, p1: { x: number, y: number }, color: string) => {
        if (!seq || seq.length === 0) return null;
        const fontSize = Math.min(13, pxPerNt * 1.1);
        return seq.split('').map((char, i) => {
            const ratio = (i + 0.5) / seq.length;
            const x = p0.x + (p1.x - p0.x) * ratio;
            const y = p0.y + (p1.y - p0.y) * ratio;
            // For tilted arms, calculate rotation
            let angle = 0;
            if (p1.x !== p0.x || p1.y !== p0.y) {
                angle = Math.atan2(p1.y - p0.y, p1.x - p0.x) * (180 / Math.PI);
            }

            return (
                <text
                    key={i}
                    x={x}
                    y={y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={fontSize}
                    fontWeight="bold"
                    fill={color}
                    transform={`rotate(${angle}, ${x}, ${y})`}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                    {char}
                </text>
            );
        });
    };

    return (
        <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-500 uppercase tracking-widest">🧬 Primerize Schematic</span>
                </div>
                <button
                    onClick={() => setIsSeqMode(!isSeqMode)}
                    className={`px-4 py-1.5 text-xs font-bold rounded-full border transition-all uppercase tracking-tight ${isSeqMode
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-200 dark:shadow-indigo-900/20'
                        : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-indigo-400 hover:text-indigo-600'
                        }`}
                >
                    {isSeqMode ? '🔡 Shape Mode' : '🔡 Seq Mode'}
                </button>
            </div>

            {/* ── SVG Schematic ── */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-inner overflow-hidden">
                <svg viewBox={`0 0 ${VW} ${VH}`} width="100%"
                    style={{ display: 'block', fontFamily: 'inherit' }}
                    aria-label="Oligo primerize schematic">

                    {/* ═══ TEMPLATE STRANDS (+ / −) ═══ */}
                    <rect x={tmplX0} y={tmplY} width={tmplW} height={stH}
                        rx="3" fill={C.tmplFill} stroke={C.tmpl} strokeWidth="1.5"
                        opacity={isSeqMode ? 0.3 : 1} />
                    <rect x={tmplX0} y={tmplY + stH + gap} width={tmplW} height={stH}
                        rx="3" fill={C.tmplFill} stroke={C.tmpl} strokeWidth="1.5"
                        opacity={isSeqMode ? 0.3 : 1} />

                    {/* + / − labels */}
                    <text x={tmplX0 - 6} y={tmplY + stH / 2 + 3} textAnchor="end"
                        fontSize="9" fontWeight="bold" fill={C.tmpl}>5'</text>
                    <text x={tmplX1 + 6} y={tmplY + stH / 2 + 3} textAnchor="start"
                        fontSize="9" fontWeight="bold" fill={C.tmpl}>3'</text>

                    <text x={tmplX0 - 6} y={tmplY + stH + gap + stH / 2 + 3} textAnchor="end"
                        fontSize="9" fontWeight="bold" fill={C.tmpl}>3'</text>
                    <text x={tmplX1 + 6} y={tmplY + stH + gap + stH / 2 + 3} textAnchor="start"
                        fontSize="9" fontWeight="bold" fill={C.tmpl}>5'</text>

                    {/* + / − labels */}

                    {/* ═══ Left Side: Rev BS + TAG + Oligo 2 ═══ */}
                    <g opacity={isSeqMode ? 0.15 : 0.85}>
                        {revLen > 0 && <polygon points={polyRevBS} fill={C.revBs} />}
                        {tagLen > 0 && <polygon points={polyTAG} fill={C.tag} />}
                        <polygon points={polyM2} fill={C.m2} />
                    </g>

                    {/* ═══ Right Side: Oligo 1 + Forward BS ═══ */}
                    <g opacity={isSeqMode ? 0.15 : 0.85}>
                        <polygon points={polyM1} fill={C.m1} />
                        {fwdLen > 0 && <polygon points={polyFwdBS} fill={C.fwdBs} />}
                    </g>

                    {/* ═══ Seq Mode Letters ═══ */}
                    {isSeqMode && (
                        <g>
                            {/* Template Sequences */}
                            {renderSeqChars(tmplTop, { x: tmplX0, y: tmplY + stH / 2 }, { x: tmplX1, y: tmplY + stH / 2 }, C.tmpl)}
                            {renderSeqChars(tmplBot, { x: tmplX0, y: tmplY + stH + gap + stH / 2 }, { x: tmplX1, y: tmplY + stH + gap + stH / 2 }, C.tmpl)}

                            {/* Probes/Primers */}
                            {renderSeqChars(revPrimer || "", L, S, C.revBs)}
                            {renderSeqChars(tagSeq || "", S, C_left, C.tag)}
                            {renderSeqChars(moligo2Seq, C_left, R, C.m2)}
                            {renderSeqChars(moligo1Seq, R, C_right, C.m1)}
                            {renderSeqChars(fwdPrimer || "", C_right, F, C.fwdBs)}
                        </g>
                    )}


                    {/* Annealing ticks */}
                    {Array.from({ length: 20 }).map((_, i) => {
                        const tickX = tmplX0 + (i + 0.5) * (tmplW / 20);
                        return <line key={i} x1={tickX} y1={tmplY - 2} x2={tickX} y2={tmplY - 0.5}
                            stroke={tickX < splitX ? C.m2 : C.m1} strokeWidth="1.5" opacity="0.5" />;
                    })}

                </svg>
            </div>

            {/* ── Legend ── */}
            <div className="mt-5 px-3 mb-2 flex flex-col gap-y-4 text-sm text-slate-600 dark:text-slate-300">
                <div className="flex flex-wrap gap-x-6 gap-y-3 justify-center">
                    {revLen > 0 && (
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: C.revBs }} />
                            <span className="font-semibold text-slate-700 dark:text-slate-200">Reverse PBS</span>
                            <span className="text-slate-400 font-mono text-xs">({revLen}nt)</span>
                        </div>
                    )}
                    {tagLen > 0 && (
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: C.tag }} />
                            <span className="font-semibold text-slate-700 dark:text-slate-200">TAG</span>
                            <span className="text-slate-400 font-mono text-xs">({tagLen}nt)</span>
                        </div>
                    )}
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: C.m2 }} />
                        <span className="font-semibold text-slate-700 dark:text-slate-200">Oligo 2</span>
                        <span className="text-slate-400 font-mono text-xs">({m2Len}nt)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: C.m1 }} />
                        <span className="font-semibold text-slate-700 dark:text-slate-200">Oligo 1</span>
                        <span className="text-slate-400 font-mono text-xs">({m1Len}nt)</span>
                    </div>
                    {fwdLen > 0 && (
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: C.fwdBs }} />
                            <span className="font-semibold text-slate-700 dark:text-slate-200">Forward PBS</span>
                            <span className="text-slate-400 font-mono text-xs">({fwdLen}nt)</span>
                        </div>
                    )}
                </div>

                <div className="w-full h-px bg-slate-200 dark:bg-slate-700/50 hidden md:block"></div>

                <div className="flex items-center justify-center gap-2">
                    <div className="flex flex-col gap-[2px]">
                        <div className="w-4 h-[3px] rounded-full" style={{ backgroundColor: C.tmpl }} />
                        <div className="w-4 h-[3px] rounded-full" style={{ backgroundColor: C.tmpl }} />
                    </div>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">Target Template</span>
                    <span className="text-slate-400 font-mono text-xs">({templateSeq?.length || 0}nt)</span>
                </div>
            </div>

            {/* ── Sequence Inputs ── */}
            <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-slate-100 dark:border-slate-800">

                {/* Reverse PBS Input */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold uppercase flex justify-between" style={{ color: C.revBs }}>
                        <span>Reverse PBS</span>
                        <span className="text-slate-400 font-mono">{revLen}nt</span>
                    </label>
                    <textarea
                        className="w-full h-20 p-2.5 text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 outline-none resize-none text-slate-700 dark:text-slate-300 shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-all"
                        value={revPrimer || ""}
                        onChange={(e) => onRevChange?.(e.target.value.toUpperCase().replace(/[^ATCGUatcgu]/g, ''))}
                        placeholder="Enter sequence..."
                        spellCheck={false}
                    />
                </div>

                {/* TAG Input */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold uppercase flex justify-between" style={{ color: C.tag }}>
                        <span>TAG Sequence</span>
                        <span className="text-slate-400 font-mono">{tagLen}nt</span>
                    </label>
                    <textarea
                        className="w-full h-20 p-2.5 text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-red-500/50 focus:border-red-500 outline-none resize-none text-slate-700 dark:text-slate-300 shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-all"
                        value={tagSeq || ""}
                        onChange={(e) => onTagChange?.(e.target.value.toUpperCase().replace(/[^ATCGUatcgu]/g, ''))}
                        placeholder="Enter sequence..."
                        spellCheck={false}
                    />
                </div>

                {/* Forward PBS Input */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold uppercase flex justify-between" style={{ color: C.fwdBs }}>
                        <span>Forward PBS</span>
                        <span className="text-slate-400 font-mono">{fwdLen}nt</span>
                    </label>
                    <textarea
                        className="w-full h-20 p-2.5 text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500 outline-none resize-none text-slate-700 dark:text-slate-300 shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-all"
                        value={fwdPrimer || ""}
                        onChange={(e) => onFwdChange?.(e.target.value.toUpperCase().replace(/[^ATCGUatcgu]/g, ''))}
                        placeholder="Enter sequence..."
                        spellCheck={false}
                    />
                </div>

            </div>

            {/* ── Generated PCR Primers ── */}
            <div className="mt-6 p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">PCR Amplification Primers</h3>
                    <button
                        onClick={() => {
                            if (fwdPrimer && revPrimer) {
                                onCreatePrimersClick?.(reverseComplement(fwdPrimer), reverseComplement(revPrimer));
                            }
                        }}
                        disabled={isPrimerIdtLoading || !fwdPrimer || !revPrimer}
                        className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-md transition-colors disabled:opacity-50"
                    >
                        {isPrimerIdtLoading ? 'Analyzing...' : 'Analyze primers'}
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Forward Primer */}
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold uppercase text-slate-500">
                            <span>Forward Primer</span>
                        </label>
                        <div className="w-full h-12 p-3 text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 shadow-inner flex items-center overflow-x-auto">
                            {reverseComplement(fwdPrimer || "")}
                        </div>
                    </div>

                    {/* Reverse Primer */}
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold uppercase text-slate-500">
                            <span>Reverse Primer</span>
                        </label>
                        <div className="w-full h-12 p-3 text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 shadow-inner flex items-center overflow-x-auto">
                            {reverseComplement(revPrimer || "")}
                        </div>
                    </div>
                </div>

                {primerIdtError && <div className="mt-4 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded border border-red-100 dark:border-red-900/30">Error: {primerIdtError}</div>}
                {primerIdtResults && (
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="bg-white dark:bg-slate-900/40 p-3 rounded border border-slate-200 dark:border-slate-700 shadow-sm">
                            <div className="text-xs font-bold text-slate-500 uppercase mb-1">Forward Primer</div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-500">Hairpin ΔG:</span>
                                <span className={primerIdtResults.m1.hairpin?.DeltaG < -9 ? 'text-red-500 font-bold' : primerIdtResults.m1.hairpin?.DeltaG < -6 ? 'text-amber-500 font-bold' : 'text-emerald-500 font-bold'}>
                                    {primerIdtResults.m1.hairpin?.DeltaG !== undefined ? primerIdtResults.m1.hairpin.DeltaG.toFixed(2) : 'N/A'}
                                </span>
                            </div>
                            <div className="flex justify-between items-center text-sm mt-1">
                                <span className="text-slate-500">Self-Dimer ΔG:</span>
                                <span className={primerIdtResults.m1.self_dimer?.DeltaG < -9 ? 'text-red-500 font-bold' : primerIdtResults.m1.self_dimer?.DeltaG < -6 ? 'text-amber-500 font-bold' : 'text-emerald-500 font-bold'}>
                                    {primerIdtResults.m1.self_dimer?.DeltaG !== undefined ? primerIdtResults.m1.self_dimer.DeltaG.toFixed(2) : 'N/A'}
                                </span>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-slate-900/40 p-3 rounded border border-slate-200 dark:border-slate-700 shadow-sm">
                            <div className="text-xs font-bold text-slate-500 uppercase mb-1">Reverse Primer</div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-500">Hairpin ΔG:</span>
                                <span className={primerIdtResults.m2.hairpin?.DeltaG < -9 ? 'text-red-500 font-bold' : primerIdtResults.m2.hairpin?.DeltaG < -6 ? 'text-amber-500 font-bold' : 'text-emerald-500 font-bold'}>
                                    {primerIdtResults.m2.hairpin?.DeltaG !== undefined ? primerIdtResults.m2.hairpin.DeltaG.toFixed(2) : 'N/A'}
                                </span>
                            </div>
                            <div className="flex justify-between items-center text-sm mt-1">
                                <span className="text-slate-500">Self-Dimer ΔG:</span>
                                <span className={primerIdtResults.m2.self_dimer?.DeltaG < -9 ? 'text-red-500 font-bold' : primerIdtResults.m2.self_dimer?.DeltaG < -6 ? 'text-amber-500 font-bold' : 'text-emerald-500 font-bold'}>
                                    {primerIdtResults.m2.self_dimer?.DeltaG !== undefined ? primerIdtResults.m2.self_dimer.DeltaG.toFixed(2) : 'N/A'}
                                </span>
                            </div>
                        </div>
                        <div className="bg-indigo-50/50 dark:bg-indigo-900/20 p-3 rounded border border-indigo-100 dark:border-indigo-900/30">
                            <div className="text-xs font-bold text-indigo-500 uppercase mb-1">Cross-Dimer Pairwise</div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-500">Hetero-Dimer ΔG:</span>
                                <span className={primerIdtResults.pairwise?.DeltaG < -9 ? 'text-red-500 font-bold' : primerIdtResults.pairwise?.DeltaG < -6 ? 'text-amber-500 font-bold' : 'text-emerald-500 font-bold'}>
                                    {primerIdtResults.pairwise?.DeltaG !== undefined ? primerIdtResults.pairwise.DeltaG.toFixed(2) : 'N/A'}
                                </span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

        </div>
    );
}
