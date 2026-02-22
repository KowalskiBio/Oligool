import React from 'react';

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
}

const C = {
    m2: '#f59e0b',     // amber   – oligo probe 2 (flat)
    m1: '#10b981',     // emerald – oligo probe 1 (flat)
    tag: '#ef4444',    // red     – TAG
    revBs: '#3b82f6',  // blue    – Rev BS
    fwdBs: '#6366f1',  // indigo  – Forward BS
    tmpl: '#94a3b8',   // slate   – template strands
    tmplFill: '#e2e8f0',
};

export default function PrimerizePanel({
    templateSeq,
    moligo1Seq, moligo2Seq,
    tagSeq, fwdPrimer, revPrimer
}: PrimerizeProps) {

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
    const revProj = revLen * Math.SQRT1_2;
    const tagProj = tagLen * Math.SQRT1_2;

    const rightArmProj = rightArmLen * Math.SQRT1_2;
    const fwdProj = fwdLen * Math.SQRT1_2;

    const totalHorizontalNt = leftArmProj + combinedFlatLen + rightArmProj || 1;

    const pad = 40; // minimal horizontal margin on both extremities
    const effectiveW = VW - 2 * pad;

    const pxPerNt = effectiveW / totalHorizontalNt;

    const leftArmDx = leftArmProj * pxPerNt;
    const revDx = revProj * pxPerNt;
    const tagDx = tagProj * pxPerNt;

    const rightArmDx = rightArmProj * pxPerNt;
    const fwdDx = fwdProj * pxPerNt;

    // Template & flat probe geometry
    const m2W = m2Len * pxPerNt;
    const m1W = m1Len * pxPerNt;
    const tmplW = m2W + m1W;

    const tmplX0 = pad + leftArmDx;
    const tmplX1 = tmplX0 + tmplW;
    const splitX = tmplX0 + m2W;

    // Y-Axis Positioning
    const maxArmDx = Math.max(leftArmDx, rightArmDx);
    const tmplY = Math.max(60, maxArmDx + 30);
    const stH = 12;
    const gap = 6;

    const VH = tmplY + stH * 2 + gap + 40; // dynamic SVG height

    // Gradient calculations
    const gradM2_w = leftArmDx + m2W;
    const stop1 = (revDx / gradM2_w) * 100;
    const stop2 = ((revDx + tagDx) / gradM2_w) * 100;

    const gradM1_w = m1W + rightArmDx;
    const stop3 = (m1W / gradM1_w) * 100;

    return (
        <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-4">
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-bold text-slate-500 uppercase tracking-widest">🧬 Primerize Schematic</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">— Final: Single Contiguous Path Graphic</span>
            </div>

            {/* ── SVG Schematic ── */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-inner overflow-hidden">
                <svg viewBox={`0 0 ${VW} ${VH}`} width="100%"
                    style={{ display: 'block', fontFamily: 'inherit' }}
                    aria-label="MOLigo primerize schematic">

                    <defs>
                        {/* Gradient for Left Side (Rev BS -> TAG -> oligo probe 2) */}
                        <linearGradient id="gradM2" gradientUnits="userSpaceOnUse"
                            x1={tmplX0 - leftArmDx} y1={0}
                            x2={splitX} y2={0}>
                            <stop offset={`${stop1}%`} stopColor={C.revBs} />
                            <stop offset={`${stop1}%`} stopColor={C.tag} />

                            <stop offset={`${stop2}%`} stopColor={C.tag} />
                            <stop offset={`${stop2}%`} stopColor={C.m2} />
                        </linearGradient>

                        {/* Gradient for Right Side (oligo probe 1 -> Forward BS) */}
                        <linearGradient id="gradM1" gradientUnits="userSpaceOnUse"
                            x1={splitX} y1={0}
                            x2={tmplX1 + rightArmDx} y2={0}>
                            <stop offset={`${stop3}%`} stopColor={C.m1} />
                            <stop offset={`${stop3}%`} stopColor={C.fwdBs} />
                        </linearGradient>
                    </defs>

                    {/* ═══ TEMPLATE STRANDS (+ / −) ═══ */}
                    <rect x={tmplX0} y={tmplY} width={tmplW} height={stH}
                        rx="3" fill={C.tmplFill} stroke={C.tmpl} strokeWidth="1.5" />
                    <rect x={tmplX0} y={tmplY + stH + gap} width={tmplW} height={stH}
                        rx="3" fill={C.tmplFill} stroke={C.tmpl} strokeWidth="1.5" />

                    {/* + / − labels */}
                    <text x={tmplX0 - 8} y={tmplY + stH / 2 + 4} textAnchor="end"
                        fontSize="11" fontWeight="bold" fill={C.tmpl}>5'</text>
                    <text x={tmplX1 + 8} y={tmplY + stH / 2 + 4} textAnchor="start"
                        fontSize="11" fontWeight="bold" fill={C.tmpl}>3'</text>

                    <text x={tmplX0 - 8} y={tmplY + stH + gap + stH / 2 + 4} textAnchor="end"
                        fontSize="11" fontWeight="bold" fill={C.tmpl}>3'</text>
                    <text x={tmplX1 + 8} y={tmplY + stH + gap + stH / 2 + 4} textAnchor="start"
                        fontSize="11" fontWeight="bold" fill={C.tmpl}>5'</text>

                    {/* Target DNA sequence label */}
                    <text x={(tmplX0 + tmplX1) / 2} y={tmplY + stH * 2 + gap + 20}
                        textAnchor="middle" fontSize="11" fill={C.tmpl} fontStyle="italic">
                        Target DNA sequence (template)
                    </text>

                    {/* ═══ Left path: Rev BS + TAG + oligo probe 2 ═══ */}
                    <g opacity="0.85">
                        <path d={`M ${tmplX0 - leftArmDx} ${tmplY - 9 - leftArmDx} L ${tmplX0} ${tmplY - 9} L ${splitX} ${tmplY - 9}`}
                            fill="none" stroke="url(#gradM2)" strokeWidth="14" strokeLinejoin="round" strokeLinecap="butt" />
                    </g>

                    {/* ═══ Right path: oligo probe 1 + Fwd BS ═══ */}
                    <g opacity="0.85">
                        <path d={`M ${splitX} ${tmplY - 9} L ${tmplX1} ${tmplY - 9} L ${tmplX1 + rightArmDx} ${tmplY - 9 - rightArmDx}`}
                            fill="none" stroke="url(#gradM1)" strokeWidth="14" strokeLinejoin="round" strokeLinecap="butt" />
                    </g>

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
                            <span className="font-semibold text-slate-700 dark:text-slate-200">Rev BS</span>
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
                        <span className="font-semibold text-slate-700 dark:text-slate-200">oligo probe 2</span>
                        <span className="text-slate-400 font-mono text-xs">({m2Len}nt)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: C.m1 }} />
                        <span className="font-semibold text-slate-700 dark:text-slate-200">oligo probe 1</span>
                        <span className="text-slate-400 font-mono text-xs">({m1Len}nt)</span>
                    </div>
                    {fwdLen > 0 && (
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: C.fwdBs }} />
                            <span className="font-semibold text-slate-700 dark:text-slate-200">Forward BS</span>
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
        </div>
    );
}
