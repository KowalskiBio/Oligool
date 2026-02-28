import { useState, useEffect } from 'react';

export interface MOLigoProps {
    templateSeq: string;
    moligo1Seq: string;
    moligo2Seq: string;
    tagSeq?: string;
    fwdPrimer?: string;
    revPrimer?: string;
    onTagChange?: (val: string) => void;
    onFwdChange?: (val: string) => void;
    onRevChange?: (val: string) => void;
}

const C = {
    m2: '#f59e0b',     // amber   – Oligo 2 (flat)
    m1: '#10b981',     // emerald – Oligo 1 (flat)
    tag: '#ef4444',    // red     – TAG
    revP: '#c084fc',   // purple  – Universal Reverse Primer
    fwdRC: '#f472b6',  // pink    – RevComp(Forward Primer)
    tmpl: '#94a3b8',   // slate   – template strands
    tmplFill: '#e2e8f0',
};

const reverseComplement = (s: string) => {
    const dict: { [key: string]: string } = {
        'A': 'T', 'T': 'A', 'C': 'G', 'G': 'C', 'N': 'N', 'U': 'A',
        'a': 't', 't': 'a', 'c': 'g', 'g': 'c', 'n': 'n', 'u': 'a'
    };
    return s.split('').reverse().map(c => dict[c] || c).join('');
};

export default function MOLigoPanel({
    templateSeq,
    moligo1Seq, moligo2Seq,
    tagSeq, fwdPrimer, revPrimer,
    onTagChange, onFwdChange, onRevChange
}: MOLigoProps) {

    const [isSeqMode, setIsSeqMode] = useState(() => localStorage.getItem('moligo_prov_seq_mode') === 'true');

    useEffect(() => {
        localStorage.setItem('moligo_prov_seq_mode', String(isSeqMode));
    }, [isSeqMode]);

    // ── Lengths ──────────────────────────────────────────────────────────
    const m2Len = moligo2Seq.length || 0;
    const m1Len = moligo1Seq.length || 0;
    const tagLen = tagSeq?.length || 0;
    const revLen = revPrimer?.length || 0;
    const fwdLen = fwdPrimer?.length || 0;
    const fwdRCSeq = reverseComplement(fwdPrimer || "");

    // ── MOLigo layout: RevPrimer (left arm) | Oligo2 Oligo1 (flat) | TAG + RC(Fwd) (right arm) ──
    const VW = 800;

    const leftArmLen = revLen;                     // Only rev primer on left
    const rightArmLen = tagLen + fwdLen;            // TAG + RevComp(Fwd) on right
    const combinedFlatLen = (m1Len + m2Len) || 1;

    const leftArmProj = leftArmLen * Math.SQRT1_2;
    const rightArmProj = rightArmLen * Math.SQRT1_2;

    const totalHorizontalNt = leftArmProj + combinedFlatLen + rightArmProj || 1;

    const pad = 12;
    const effectiveW = VW - 2 * pad;
    const pxPerNt = effectiveW / totalHorizontalNt;

    const leftArmDx = leftArmProj * pxPerNt;

    const rightArmDx = rightArmProj * pxPerNt;
    const tagDx = tagLen * Math.SQRT1_2 * pxPerNt;

    // Template & flat probe geometry
    const m2W = m2Len * pxPerNt;
    const m1W = m1Len * pxPerNt;
    const tmplW = m2W + m1W;

    const tmplX0 = pad + leftArmDx;
    const tmplX1 = tmplX0 + tmplW;
    const splitX = tmplX0 + m2W;

    // Y-Axis Positioning
    const maxArmDx = Math.max(leftArmDx, rightArmDx);
    const tmplY = Math.max(50, maxArmDx + 20);
    const stH = 12;
    const VH = tmplY + stH + 15;

    // ── Polygon Math for Perfect Miter & Perpendicular Joints ──
    const hw = 7;
    const nx = hw * Math.SQRT1_2;
    const ny = -hw * Math.SQRT1_2;
    const dw = hw * (Math.SQRT2 - 1);

    // Centers – LEFT ARM: only RevPrimer
    const L = { x: tmplX0 - leftArmDx, y: tmplY - 9 - leftArmDx };
    const C_left = { x: tmplX0, y: tmplY - 9 };

    // Centers – FLAT
    const R = { x: splitX, y: tmplY - 9 };
    const C_right = { x: tmplX1, y: tmplY - 9 };

    // Centers – RIGHT ARM: TAG then RC(Fwd)
    const S_right = { x: tmplX1 + tagDx, y: tmplY - 9 - tagDx };     // TAG/RC(Fwd) split
    const F = { x: tmplX1 + rightArmDx, y: tmplY - 9 - rightArmDx }; // top-right end

    // Left Arm: single segment (RevPrimer)
    const p_start = { top: { x: L.x + nx, y: L.y + ny }, bot: { x: L.x - nx, y: L.y - ny } };
    const p_miterL = {
        top: { x: C_left.x + (leftArmLen > 0 ? dw : 0), y: C_left.y - hw },
        bot: { x: C_left.x - (leftArmLen > 0 ? dw : 0), y: C_left.y + hw }
    };

    let polyRevP = "";
    if (revLen > 0) {
        polyRevP = `${p_start.top.x},${p_start.top.y} ${p_miterL.top.x},${p_miterL.top.y} ${p_miterL.bot.x},${p_miterL.bot.y} ${p_start.bot.x},${p_start.bot.y}`;
    }

    // Horizontal Flat segments
    const p_splitFlat = { top: { x: R.x, y: R.y - hw }, bot: { x: R.x, y: R.y + hw } };
    const polyM2 = `${p_miterL.top.x},${p_miterL.top.y} ${p_splitFlat.top.x},${p_splitFlat.top.y} ${p_splitFlat.bot.x},${p_splitFlat.bot.y} ${p_miterL.bot.x},${p_miterL.bot.y}`;

    const p_miterR = {
        top: { x: C_right.x - (rightArmLen > 0 ? dw : 0), y: C_right.y - hw },
        bot: { x: C_right.x + (rightArmLen > 0 ? dw : 0), y: C_right.y + hw }
    };
    const polyM1 = `${p_splitFlat.top.x},${p_splitFlat.top.y} ${p_miterR.top.x},${p_miterR.top.y} ${p_miterR.bot.x},${p_miterR.bot.y} ${p_splitFlat.bot.x},${p_splitFlat.bot.y}`;

    // Right Arm: TAG then RC(Fwd)
    const nx2 = -hw * Math.SQRT1_2;
    const ny2 = -hw * Math.SQRT1_2;
    const p_end = { top: { x: F.x + nx2, y: F.y + ny2 }, bot: { x: F.x - nx2, y: F.y - ny2 } };
    const p_splitR = { top: { x: S_right.x + nx2, y: S_right.y + ny2 }, bot: { x: S_right.x - nx2, y: S_right.y - ny2 } };

    let polyTAG = "";
    let polyFwdRC = "";

    if (tagLen > 0 && fwdLen > 0) {
        polyTAG = `${p_miterR.top.x},${p_miterR.top.y} ${p_splitR.top.x},${p_splitR.top.y} ${p_splitR.bot.x},${p_splitR.bot.y} ${p_miterR.bot.x},${p_miterR.bot.y}`;
        polyFwdRC = `${p_splitR.top.x},${p_splitR.top.y} ${p_end.top.x},${p_end.top.y} ${p_end.bot.x},${p_end.bot.y} ${p_splitR.bot.x},${p_splitR.bot.y}`;
    } else if (tagLen > 0 && fwdLen === 0) {
        polyTAG = `${p_miterR.top.x},${p_miterR.top.y} ${p_end.top.x},${p_end.top.y} ${p_end.bot.x},${p_end.bot.y} ${p_miterR.bot.x},${p_miterR.bot.y}`;
    } else if (tagLen === 0 && fwdLen > 0) {
        polyFwdRC = `${p_miterR.top.x},${p_miterR.top.y} ${p_end.top.x},${p_end.top.y} ${p_end.bot.x},${p_end.bot.y} ${p_miterR.bot.x},${p_miterR.bot.y}`;
    }

    // ── Seq Mode Helper ──────────────────────────────────────────────────
    const tmplFwd = moligo2Seq + moligo1Seq;

    const renderSeqChars = (seq: string, p0: { x: number, y: number }, p1: { x: number, y: number }, color: string) => {
        if (!seq || seq.length === 0) return null;
        const fontSize = Math.min(13, pxPerNt * 1.1);
        return seq.split('').map((char, i) => {
            const ratio = (i + 0.5) / seq.length;
            const x = p0.x + (p1.x - p0.x) * ratio;
            const y = p0.y + (p1.y - p0.y) * ratio;
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
                    <span className="text-sm font-bold text-slate-500 uppercase tracking-widest">🔬 MOLigo Provenance Schematic</span>
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
                    aria-label="MOLigo provenance schematic">

                    {/* ═══ TEMPLATE STRAND (5' → 3') ═══ */}
                    <rect x={tmplX0} y={tmplY} width={tmplW} height={stH}
                        rx="3" fill={C.tmplFill} stroke={C.tmpl} strokeWidth="1.5"
                        opacity={isSeqMode ? 0.3 : 1} />

                    {/* 5' / 3' labels */}
                    <text x={tmplX0 - 6} y={tmplY + stH / 2 + 3} textAnchor="end"
                        fontSize="9" fontWeight="bold" fill={C.tmpl}>5'</text>
                    <text x={tmplX1 + 6} y={tmplY + stH / 2 + 3} textAnchor="start"
                        fontSize="9" fontWeight="bold" fill={C.tmpl}>3'</text>

                    {/* ═══ Left Side: Universal Reverse Primer only ═══ */}
                    <g opacity={isSeqMode ? 0.15 : 0.85}>
                        {revLen > 0 && <polygon points={polyRevP} fill={C.revP} />}
                        <polygon points={polyM2} fill={C.m2} />
                    </g>

                    {/* ═══ Right Side: Oligo 1 + TAG + RC(Fwd) ═══ */}
                    <g opacity={isSeqMode ? 0.15 : 0.85}>
                        <polygon points={polyM1} fill={C.m1} />
                        {tagLen > 0 && <polygon points={polyTAG} fill={C.tag} />}
                        {fwdLen > 0 && <polygon points={polyFwdRC} fill={C.fwdRC} />}
                    </g>

                    {/* ═══ Seq Mode Letters ═══ */}
                    {isSeqMode && (
                        <g>
                            {/* Template Sequence (5'→3') */}
                            {renderSeqChars(tmplFwd, { x: tmplX0, y: tmplY + stH / 2 }, { x: tmplX1, y: tmplY + stH / 2 }, C.tmpl)}

                            {/* Left arm: RevPrimer */}
                            {renderSeqChars(revPrimer || "", L, C_left, C.revP)}
                            {/* Flat: Oligo2 → Oligo1 */}
                            {renderSeqChars(moligo2Seq, C_left, R, C.m2)}
                            {renderSeqChars(moligo1Seq, R, C_right, C.m1)}
                            {/* Right arm: TAG → RC(Fwd) */}
                            {renderSeqChars(tagSeq || "", C_right, S_right, C.tag)}
                            {renderSeqChars(fwdRCSeq, S_right, F, C.fwdRC)}
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
                            <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: C.revP }} />
                            <span className="font-semibold text-slate-700 dark:text-slate-200">Reverse Primer</span>
                            <span className="text-slate-400 font-mono text-xs">({revLen}nt)</span>
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
                    {tagLen > 0 && (
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: C.tag }} />
                            <span className="font-semibold text-slate-700 dark:text-slate-200">TAG</span>
                            <span className="text-slate-400 font-mono text-xs">({tagLen}nt)</span>
                        </div>
                    )}
                    {fwdLen > 0 && (
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: C.fwdRC }} />
                            <span className="font-semibold text-slate-700 dark:text-slate-200">RC(Fwd Primer)</span>
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

                {/* Reverse Primer Input */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold uppercase flex justify-between" style={{ color: C.revP }}>
                        <span>Reverse Primer</span>
                        <span className="text-slate-400 font-mono">{revLen}nt</span>
                    </label>
                    <textarea
                        className="w-full h-20 p-2.5 text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500 outline-none resize-none text-slate-700 dark:text-slate-300 shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-all"
                        value={revPrimer || ""}
                        onChange={(e) => onRevChange?.(e.target.value.toUpperCase().replace(/[^ATCGUatcgu]/g, ''))}
                        placeholder="Enter reverse primer sequence..."
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
                        placeholder="Enter TAG sequence..."
                        spellCheck={false}
                    />
                </div>

                {/* Forward Primer Input */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold uppercase flex justify-between" style={{ color: C.fwdRC }}>
                        <span>Forward Primer → RC({fwdLen}nt)</span>
                        <span className="text-slate-400 font-mono">{fwdLen}nt</span>
                    </label>
                    <textarea
                        className="w-full h-20 p-2.5 text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500 outline-none resize-none text-slate-700 dark:text-slate-300 shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-all"
                        value={fwdPrimer || ""}
                        onChange={(e) => onFwdChange?.(e.target.value.toUpperCase().replace(/[^ATCGUatcgu]/g, ''))}
                        placeholder="Enter forward primer (will be reverse-complemented)..."
                        spellCheck={false}
                    />
                    {fwdLen > 0 && (
                        <div className="text-[10px] font-mono text-slate-400 bg-slate-50 dark:bg-slate-800 p-1.5 rounded border border-slate-100 dark:border-slate-700 break-all">
                            RC: {fwdRCSeq}
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}
