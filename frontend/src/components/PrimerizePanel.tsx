
interface PrimerizeProps {
    moligo1Seq: string;
    moligo2Seq: string;
    tagSeq: string;
    fwdPrimer: string;
    revPrimer: string;
    onTagChange: (v: string) => void;
    onFwdChange: (v: string) => void;
    onRevChange: (v: string) => void;
}

// Colour palette
const C = {
    m2: '#f59e0b', // amber   – MOLigo2 probe (annealed)
    m1: '#10b981', // emerald – MOLigo1 probe (annealed)
    tag: '#fb923c', // orange  – TAG (not annealed, goes up)
    fwd: '#6366f1', // indigo  – fwd primer binding site (not annealed, goes up)
    rev: '#f43f5e', // rose    – rev primer binding site (not annealed, goes up)
    tmpl: '#94a3b8', // slate   – template strands
    tmplFill: '#e2e8f0',
};

export default function PrimerizePanel({
    moligo1Seq, moligo2Seq,
    tagSeq, fwdPrimer, revPrimer,
    onTagChange, onFwdChange, onRevChange,
}: PrimerizeProps) {

    // ── Lengths ──────────────────────────────────────────────────────────
    const m2Len = moligo2Seq.length || 50;
    const m1Len = moligo1Seq.length || 50;
    const tagLen = tagSeq.length || 23;
    const fwdLen = fwdPrimer.length || 20;
    const revLen = revPrimer.length || 20;

    // ── SVG viewBox ─────────────────────────────────────────────────────
    const VW = 800;
    const VH = 300;

    // ── Template geometry ───────────────────────────────────────────────
    // The template is centered horizontally.  On the template sit:
    //   MOLigo2 probe (left)  +  MOLigo1 probe (right)   ← flat, annealed
    // The total template width is proportional to m2+m1.
    const pad = 60; // horizontal padding
    const tmplW = VW - 2 * pad;
    const tmplX0 = pad;
    const tmplX1 = VW - pad;
    const tmplY = 190; // top of + strand
    const stH = 12;  // strand height
    const gap = 6;   // gap between + and − strands

    // MOLigo probe regions on the template (flat, annealed)
    const m2Frac = m2Len / (m2Len + m1Len);
    const m2W = tmplW * m2Frac;
    const m1W = tmplW * (1 - m2Frac);
    const splitX = tmplX0 + m2W; // junction between M2 and M1 on template

    // ── Arms going UP (not annealed) ────────────────────────────────────
    // Left arm: from left end of MOLigo2 probe going UP-LEFT
    //   Bottom = Rev primer binding site, then TAG on top
    //   Total arm length in units = revLen + tagLen
    const armH = 120; // vertical height of each arm
    const armSpread = 80; // how far horizontally the arm tip extends beyond the template

    // Left arm – tip (top-left) and base (where it meets the template)
    const lArmBaseX = tmplX0;        // left edge of template
    const lArmBaseY = tmplY;         // top of template
    const lArmTipX = tmplX0 - armSpread;
    const lArmTipY = tmplY - armH;

    // Split left arm into: Rev (bottom portion) + TAG (top portion)
    const lTotal = revLen + tagLen;
    const revFrac = revLen / lTotal;
    const lSplitX = lArmBaseX + (lArmTipX - lArmBaseX) * revFrac;
    const lSplitY = lArmBaseY + (lArmTipY - lArmBaseY) * revFrac;

    // Right arm – tip (top-right) and base (right edge of template)
    const rArmBaseX = tmplX1;        // right edge of template
    const rArmBaseY = tmplY;
    const rArmTipX = tmplX1 + armSpread;
    const rArmTipY = tmplY - armH;

    // The right arm is entirely the Fwd primer binding site

    // ── Helper: angle for rotated text ──────────────────────────────────
    const lAngle = Math.atan2(lArmTipY - lArmBaseY, lArmTipX - lArmBaseX) * 180 / Math.PI;
    const rAngle = Math.atan2(rArmTipY - rArmBaseY, rArmTipX - rArmBaseX) * 180 / Math.PI;

    return (
        <div className="mt-4 border-t border-rose-100 dark:border-rose-900/30 pt-4">
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-bold text-rose-500 uppercase tracking-widest">🧬 Primerize Schematic</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">— edit sequences below</span>
            </div>

            {/* Editable fields */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.tag }}>
                        TAG Sequence
                    </label>
                    <input
                        type="text"
                        value={tagSeq}
                        onChange={e => onTagChange(e.target.value)}
                        className="px-2 py-1.5 text-xs font-mono border rounded bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-800/50 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-orange-400"
                        placeholder="TAG sequence…"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.fwd }}>
                        Forward Primer
                    </label>
                    <input
                        type="text"
                        value={fwdPrimer}
                        onChange={e => onFwdChange(e.target.value)}
                        className="px-2 py-1.5 text-xs font-mono border rounded bg-indigo-50 dark:bg-indigo-900/10 border-indigo-200 dark:border-indigo-800/50 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                        placeholder="Forward primer…"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.rev }}>
                        Reverse Primer
                    </label>
                    <input
                        type="text"
                        value={revPrimer}
                        onChange={e => onRevChange(e.target.value)}
                        className="px-2 py-1.5 text-xs font-mono border rounded bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-800/50 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-rose-400"
                        placeholder="Reverse primer…"
                    />
                </div>
            </div>

            {/* ── SVG Schematic ── */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-inner overflow-hidden">
                <svg viewBox={`0 0 ${VW} ${VH}`} width="100%"
                    style={{ display: 'block', fontFamily: 'inherit' }}
                    aria-label="MOLigo primerize schematic">

                    {/* ═══ TEMPLATE STRANDS (+ / −) ═══ */}
                    <rect x={tmplX0} y={tmplY} width={tmplW} height={stH}
                        rx="3" fill={C.tmplFill} stroke={C.tmpl} strokeWidth="1.5" />
                    <rect x={tmplX0} y={tmplY + stH + gap} width={tmplW} height={stH}
                        rx="3" fill={C.tmplFill} stroke={C.tmpl} strokeWidth="1.5" />
                    {/* + / − labels */}
                    <text x={tmplX0 - 8} y={tmplY + stH / 2 + 4} textAnchor="end"
                        fontSize="11" fontWeight="bold" fill={C.tmpl}>+</text>
                    <text x={tmplX0 - 8} y={tmplY + stH + gap + stH / 2 + 4} textAnchor="end"
                        fontSize="11" fontWeight="bold" fill={C.tmpl}>−</text>
                    {/* "Denatured target" label */}
                    <text x={(tmplX0 + tmplX1) / 2} y={tmplY + stH * 2 + gap + 18}
                        textAnchor="middle" fontSize="11" fill={C.tmpl} fontStyle="italic">
                        Denatured target (DNA or RNA)
                    </text>

                    {/* ═══ MOLigo2 PROBE — flat on template (LEFT half) ═══ */}
                    <rect x={tmplX0} y={tmplY - 16} width={m2W} height={14}
                        rx="3" fill={C.m2} opacity="0.85" />
                    <text x={tmplX0 + m2W / 2} y={tmplY - 6}
                        textAnchor="middle" fontSize="9" fontWeight="bold" fill="white">
                        MOLigo2 probe ({m2Len} nt)
                    </text>

                    {/* ═══ MOLigo1 PROBE — flat on template (RIGHT half) ═══ */}
                    <rect x={splitX} y={tmplY - 16} width={m1W} height={14}
                        rx="3" fill={C.m1} opacity="0.85" />
                    <text x={splitX + m1W / 2} y={tmplY - 6}
                        textAnchor="middle" fontSize="9" fontWeight="bold" fill="white">
                        MOLigo1 probe ({m1Len} nt)
                    </text>

                    {/* "Pho" label at the junction */}
                    <text x={splitX} y={tmplY - 22} textAnchor="middle"
                        fontSize="9" fontWeight="bold" fill={C.tmpl}>Pho</text>

                    {/* Annealing ticks: probe → template */}
                    {Array.from({ length: Math.min(10, Math.floor(m2W / 14)) }).map((_, i) => {
                        const frac = (i + 1) / (Math.min(10, Math.floor(m2W / 14)) + 1);
                        const x = tmplX0 + frac * m2W;
                        return <line key={`a2-${i}`} x1={x} y1={tmplY - 2} x2={x} y2={tmplY - 1}
                            stroke={C.m2} strokeWidth="1" opacity="0.6" />;
                    })}
                    {Array.from({ length: Math.min(10, Math.floor(m1W / 14)) }).map((_, i) => {
                        const frac = (i + 1) / (Math.min(10, Math.floor(m1W / 14)) + 1);
                        const x = splitX + frac * m1W;
                        return <line key={`a1-${i}`} x1={x} y1={tmplY - 2} x2={x} y2={tmplY - 1}
                            stroke={C.m1} strokeWidth="1" opacity="0.6" />;
                    })}

                    {/* ═══ LEFT ARM going UP (Rev primer + TAG) ═══ */}
                    {/* Rev primer binding site – bottom portion of left arm (rose) */}
                    <line x1={lArmBaseX} y1={lArmBaseY} x2={lSplitX} y2={lSplitY}
                        stroke={C.rev} strokeWidth="8" strokeLinecap="round" />
                    {/* TAG – top portion of left arm (orange) */}
                    <line x1={lSplitX} y1={lSplitY} x2={lArmTipX} y2={lArmTipY}
                        stroke={C.tag} strokeWidth="8" strokeLinecap="round" />

                    {/* Labels on left arm */}
                    <text x={(lSplitX + lArmTipX) / 2 - 10} y={(lSplitY + lArmTipY) / 2}
                        textAnchor="middle" fontSize="10" fontWeight="bold" fill={C.tag}
                        transform={`rotate(${lAngle}, ${(lSplitX + lArmTipX) / 2 - 10}, ${(lSplitY + lArmTipY) / 2})`}>
                        TAG ({tagLen} nt)
                    </text>
                    <text x={(lArmBaseX + lSplitX) / 2 - 10} y={(lArmBaseY + lSplitY) / 2}
                        textAnchor="middle" fontSize="9" fontWeight="bold" fill={C.rev}
                        transform={`rotate(${lAngle}, ${(lArmBaseX + lSplitX) / 2 - 10}, ${(lArmBaseY + lSplitY) / 2})`}>
                        Rev ({revLen} nt)
                    </text>

                    {/* MOLigo2 label at arm tip */}
                    <text x={lArmTipX + 2} y={lArmTipY - 10}
                        textAnchor="start" fontSize="12" fontWeight="bold" fill={C.m2}>
                        MOLigo2
                    </text>

                    {/* ═══ RIGHT ARM going UP (Fwd primer) ═══ */}
                    <line x1={rArmBaseX} y1={rArmBaseY} x2={rArmTipX} y2={rArmTipY}
                        stroke={C.fwd} strokeWidth="8" strokeLinecap="round" />

                    {/* Label on right arm */}
                    <text x={(rArmBaseX + rArmTipX) / 2 + 10} y={(rArmBaseY + rArmTipY) / 2}
                        textAnchor="middle" fontSize="10" fontWeight="bold" fill={C.fwd}
                        transform={`rotate(${rAngle}, ${(rArmBaseX + rArmTipX) / 2 + 10}, ${(rArmBaseY + rArmTipY) / 2})`}>
                        Fwd ({fwdLen} nt)
                    </text>

                    {/* MOLigo1 label at arm tip */}
                    <text x={rArmTipX - 2} y={rArmTipY - 10}
                        textAnchor="end" fontSize="12" fontWeight="bold" fill={C.m1}>
                        MOLigo1
                    </text>

                    {/* ═══ LEGEND (horizontal, below strands) ═══ */}
                    <g transform={`translate(${(tmplX0 + tmplX1) / 2 - 155}, ${tmplY + stH * 2 + gap + 30})`}>
                        <rect width="310" height="24" rx="6" fill="white" fillOpacity="0.08"
                            stroke={C.tmpl} strokeWidth="0.5" strokeOpacity="0.3" />
                        {[
                            { c: C.m2, l: 'MOLigo2' },
                            { c: C.tag, l: 'TAG' },
                            { c: C.m1, l: 'MOLigo1' },
                            { c: C.fwd, l: 'Fwd primer' },
                            { c: C.rev, l: 'Rev primer' },
                        ].map(({ c, l }, i) => (
                            <g key={l} transform={`translate(${8 + i * 62}, 9)`}>
                                <rect width="10" height="8" rx="2" fill={c} y="-1" />
                                <text x="13" y="7" fontSize="8" fill={C.tmpl} fontWeight="bold">{l}</text>
                            </g>
                        ))}
                    </g>
                </svg>
            </div>

            {/* Sequence summary cards */}
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {[
                    { label: 'TAG', seq: tagSeq, color: C.tag },
                    { label: 'Fwd Primer', seq: fwdPrimer, color: C.fwd },
                    { label: 'Rev Primer', seq: revPrimer, color: C.rev },
                    { label: 'MOLigo2', seq: moligo2Seq, color: C.m2 },
                ].map(({ label, seq, color }) => (
                    <div key={label} className="rounded-lg border border-slate-100 dark:border-slate-700 p-2 bg-slate-50 dark:bg-slate-800">
                        <div className="font-bold mb-1" style={{ color }}>{label}</div>
                        <div className="font-mono text-slate-600 dark:text-slate-400 break-all leading-tight"
                            style={{ fontSize: '10px' }}>
                            {seq || <span className="italic text-slate-400">—</span>}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
