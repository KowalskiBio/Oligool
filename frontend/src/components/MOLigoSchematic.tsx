import { reverseComplement } from '../utils/dna';

interface MOLigoSchematicProps {
    templateSeq: string;
    moligo1Seq: string;
    moligo2Seq: string;
    tagSeq?: string;
    fwdPrimer?: string;
    revPrimer?: string;
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

export default function MOLigoSchematic({
    templateSeq,
    moligo1Seq,
    moligo2Seq,
    tagSeq,
    fwdPrimer,
    revPrimer,
}: MOLigoSchematicProps) {
    const fwdRCSeq = reverseComplement(fwdPrimer || '');

    const m2Len = moligo2Seq.length || 0;
    const m1Len = moligo1Seq.length || 0;
    const tagLen = tagSeq?.length || 0;
    const revLen = revPrimer?.length || 0;
    const fwdLen = fwdPrimer?.length || 0;

    const VW = 800;

    const leftArmLen = revLen;
    const rightArmLen = tagLen + fwdLen;
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

    const m2W = m2Len * pxPerNt;
    const m1W = m1Len * pxPerNt;
    const tmplW = m2W + m1W;

    const tmplX0 = pad + leftArmDx;
    const tmplX1 = tmplX0 + tmplW;
    const splitX = tmplX0 + m2W;

    const maxArmDx = Math.max(leftArmDx, rightArmDx);
    const tmplY = Math.max(50, maxArmDx + 20);
    const stH = 12;
    const VH = tmplY + stH + 15;

    const hw = 7;
    const nx = hw * Math.SQRT1_2;
    const ny = -hw * Math.SQRT1_2;
    const dw = hw * (Math.SQRT2 - 1);

    const L = { x: tmplX0 - leftArmDx, y: tmplY - 9 - leftArmDx };
    const C_left = { x: tmplX0, y: tmplY - 9 };

    const R = { x: splitX, y: tmplY - 9 };
    const C_right = { x: tmplX1, y: tmplY - 9 };

    const S_right = { x: tmplX1 + tagDx, y: tmplY - 9 - tagDx };
    const F = { x: tmplX1 + rightArmDx, y: tmplY - 9 - rightArmDx };

    const p_start = { top: { x: L.x + nx, y: L.y + ny }, bot: { x: L.x - nx, y: L.y - ny } };
    const p_miterL = {
        top: { x: C_left.x + (leftArmLen > 0 ? dw : 0), y: C_left.y - hw },
        bot: { x: C_left.x - (leftArmLen > 0 ? dw : 0), y: C_left.y + hw }
    };

    let polyRevP = '';
    if (revLen > 0) {
        polyRevP = `${p_start.top.x},${p_start.top.y} ${p_miterL.top.x},${p_miterL.top.y} ${p_miterL.bot.x},${p_miterL.bot.y} ${p_start.bot.x},${p_start.bot.y}`;
    }

    const p_splitFlat = { top: { x: R.x, y: R.y - hw }, bot: { x: R.x, y: R.y + hw } };
    const polyM2 = `${p_miterL.top.x},${p_miterL.top.y} ${p_splitFlat.top.x},${p_splitFlat.top.y} ${p_splitFlat.bot.x},${p_splitFlat.bot.y} ${p_miterL.bot.x},${p_miterL.bot.y}`;

    const p_miterR = {
        top: { x: C_right.x - (rightArmLen > 0 ? dw : 0), y: C_right.y - hw },
        bot: { x: C_right.x + (rightArmLen > 0 ? dw : 0), y: C_right.y + hw }
    };
    const polyM1 = `${p_splitFlat.top.x},${p_splitFlat.top.y} ${p_miterR.top.x},${p_miterR.top.y} ${p_miterR.bot.x},${p_miterR.bot.y} ${p_splitFlat.bot.x},${p_splitFlat.bot.y}`;

    const nx2 = -hw * Math.SQRT1_2;
    const ny2 = -hw * Math.SQRT1_2;
    const p_end = { top: { x: F.x + nx2, y: F.y + ny2 }, bot: { x: F.x - nx2, y: F.y - ny2 } };
    const p_splitR = { top: { x: S_right.x + nx2, y: S_right.y + ny2 }, bot: { x: S_right.x - nx2, y: S_right.y - ny2 } };

    let polyTAG = '';
    let polyFwdRC = '';

    if (tagLen > 0 && fwdLen > 0) {
        polyTAG = `${p_miterR.top.x},${p_miterR.top.y} ${p_splitR.top.x},${p_splitR.top.y} ${p_splitR.bot.x},${p_splitR.bot.y} ${p_miterR.bot.x},${p_miterR.bot.y}`;
        polyFwdRC = `${p_splitR.top.x},${p_splitR.top.y} ${p_end.top.x},${p_end.top.y} ${p_end.bot.x},${p_end.bot.y} ${p_splitR.bot.x},${p_splitR.bot.y}`;
    } else if (tagLen > 0 && fwdLen === 0) {
        polyTAG = `${p_miterR.top.x},${p_miterR.top.y} ${p_end.top.x},${p_end.top.y} ${p_end.bot.x},${p_end.bot.y} ${p_miterR.bot.x},${p_miterR.bot.y}`;
    } else if (tagLen === 0 && fwdLen > 0) {
        polyFwdRC = `${p_miterR.top.x},${p_miterR.top.y} ${p_end.top.x},${p_end.top.y} ${p_end.bot.x},${p_end.bot.y} ${p_miterR.bot.x},${p_miterR.bot.y}`;
    }

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
        <div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-inner overflow-hidden">
                <svg viewBox={`0 0 ${VW} ${VH}`} width="100%"
                    style={{ display: 'block', fontFamily: 'inherit' }}
                    aria-label="MOLigo provenance schematic">

                    <rect x={tmplX0} y={tmplY} width={tmplW} height={stH}
                        rx="3" fill={C.tmplFill} stroke={C.tmpl} strokeWidth="1.5"
                        opacity={0.3} />

                    <text x={tmplX0 - 6} y={tmplY + stH / 2 + 3} textAnchor="end"
                        fontSize="9" fontWeight="bold" fill={C.tmpl}>5'</text>
                    <text x={tmplX1 + 6} y={tmplY + stH / 2 + 3} textAnchor="start"
                        fontSize="9" fontWeight="bold" fill={C.tmpl}>3'</text>

                    <g opacity={0.15}>
                        {revLen > 0 && <polygon points={polyRevP} fill={C.revP} />}
                        <polygon points={polyM2} fill={C.m2} />
                    </g>

                    <g opacity={0.15}>
                        <polygon points={polyM1} fill={C.m1} />
                        {tagLen > 0 && <polygon points={polyTAG} fill={C.tag} />}
                        {fwdLen > 0 && <polygon points={polyFwdRC} fill={C.fwdRC} />}
                    </g>

                    <g>
                        {renderSeqChars(tmplFwd, { x: tmplX0, y: tmplY + stH / 2 }, { x: tmplX1, y: tmplY + stH / 2 }, C.tmpl)}
                        {renderSeqChars(revPrimer || '', L, C_left, C.revP)}
                        {renderSeqChars(moligo2Seq, C_left, R, C.m2)}
                        {renderSeqChars(moligo1Seq, R, C_right, C.m1)}
                        {renderSeqChars(tagSeq || '', C_right, S_right, C.tag)}
                        {renderSeqChars(fwdRCSeq, S_right, F, C.fwdRC)}
                    </g>

                    {Array.from({ length: 20 }).map((_, i) => {
                        const tickX = tmplX0 + (i + 0.5) * (tmplW / 20);
                        return <line key={i} x1={tickX} y1={tmplY - 2} x2={tickX} y2={tmplY - 0.5}
                            stroke={C.tmpl} strokeWidth="1" strokeLinecap="round" />;
                    })}
                    {Array.from({ length: 20 }).map((_, i) => {
                        const tickX = tmplX0 + (i + 0.5) * (tmplW / 20);
                        return <line key={i} x1={tickX} y1={tmplY + stH + 0.5} x2={tickX} y2={tmplY + stH + 2}
                            stroke={C.tmpl} strokeWidth="1" strokeLinecap="round" />;
                    })}

                </svg>
            </div>

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
        </div>
    );
}
