import { useState, useEffect } from 'react';
import { TAG_DATABASE } from '../constants/tags';
import MOLigoReport from './MOLigoReport';
import HairpinSVG from './HairpinSVG';
import DimerSVG from './DimerSVG';

export interface MOLigoProps {
    templateSeq: string;
    moligo1Seq: string;
    moligo2Seq: string;
    tagSeq?: string;
    fwdPrimer?: string;
    revPrimer?: string;
    queryId?: string;
    jobName?: string;
    onTagChange?: (val: string) => void;
    onFwdChange?: (val: string) => void;
    onRevChange?: (val: string) => void;
    onProceed?: () => void;
    idtCredentials?: {
        clientId: string;
        clientSecret: string;
        username?: string;
        password?: string;
    };
    idtAdvancedParams?: {
        mv_conc: number;
        mg_conc: number;
        dntp_conc: number;
        oligo_conc: number;
    };
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

export default function MOLigoPanel(props: MOLigoProps) {
    const {
        templateSeq,
        moligo1Seq, moligo2Seq,
        tagSeq, fwdPrimer, revPrimer,
        onTagChange, onFwdChange, onRevChange, onProceed,
        idtCredentials, idtAdvancedParams
    } = props;

    const [isSeqMode, setIsSeqMode] = useState(() => localStorage.getItem('moligo_prov_seq_mode') === 'true');
    const [isSchematicOpen, setIsSchematicOpen] = useState(() => localStorage.getItem('moligo_prov_schematic_open') !== 'false');
    const [copyFeedback, setCopyFeedback] = useState<string>('');

    const handleCopy = (text: string) => {
        const doFallback = () => {
            const el = document.createElement('textarea');
            el.value = text;
            el.style.position = 'fixed';
            el.style.left = '-9999px';
            el.style.top = '-9999px';
            document.body.appendChild(el);
            el.focus();
            el.select();
            try { document.execCommand('copy'); setCopyFeedback('Copied!'); }
            catch { setCopyFeedback('Failed'); }
            document.body.removeChild(el);
            setTimeout(() => setCopyFeedback(''), 2000);
        };
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => {
                setCopyFeedback('Copied!');
                setTimeout(() => setCopyFeedback(''), 2000);
            }).catch(() => doFallback());
        } else {
            doFallback();
        }
    };

    // Product Analysis State
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [idtResults, setIdtResults] = useState<any>(null);
    const [analysisError, setAnalysisError] = useState<string | null>(null);

    const fwdRCSeq = reverseComplement(fwdPrimer || "");
    const fullOligo2 = (revPrimer || "") + moligo2Seq;
    const fullOligo1 = moligo1Seq + (tagSeq || "") + fwdRCSeq;

    const runProductAnalysis = async () => {
        if (!idtCredentials) {
            setAnalysisError("IDT Credentials not found. Please set them in settings.");
            return;
        }
        setIsAnalyzing(true);
        setAnalysisError(null);
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
            if (!tRes.ok) throw new Error("IDT Auth Failed");
            const { access_token } = await tRes.json();

            const aRes = await fetch(((import.meta.env.VITE_API_BASE as string) || "") + '/idt/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    p1_seq: fullOligo1,
                    p2_seq: fullOligo2,
                    token: access_token,
                    mg_conc: idtAdvancedParams?.mg_conc ?? 10.0,
                    mv_conc: idtAdvancedParams?.mv_conc ?? 50.0,
                    dntp_conc: idtAdvancedParams?.dntp_conc ?? 0.8,
                    oligo_conc: idtAdvancedParams?.oligo_conc ?? 0.25
                })
            });
            if (!aRes.ok) throw new Error("Product Analysis Failed");
            const results = await aRes.json();
            setIdtResults(results);
        } catch (err: any) {
            setAnalysisError(err.message);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const getIdtStatusColor = (dg: number | undefined) => {
        if (dg === undefined || dg === null) return 'text-slate-400';
        if (dg < -9) return 'text-red-500 font-bold';
        if (dg < -6) return 'text-amber-500 font-bold';
        return 'text-emerald-500 font-bold';
    };

    const renderResultCard = (title: string, data: any) => {
        if (!data || data.error) return null;
        const items = Array.isArray(data.raw) ? data.raw : [data.raw];
        const topDg = data.DeltaG;

        return (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3 shadow-sm flex flex-col gap-2">
                <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-2">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-ellipsis overflow-hidden whitespace-nowrap">{title}</span>
                    <span className={`text-xs flex-shrink-0 ${getIdtStatusColor(topDg)}`}>{topDg != null ? `${topDg.toFixed(2)} kcal/mol` : 'N/A'}</span>
                </div>
                <div className="flex flex-col gap-3 mt-1">
                    {items.slice(0, 1).map((item: any, i: number) => (
                        <div key={i} className="flex flex-col gap-2">
                            {item.DotBracket && (
                                <div className="bg-slate-50 dark:bg-slate-800/50 rounded p-2">
                                    {item.Sequence.includes('&') ? (
                                        <DimerSVG seq={item.Sequence} dotBracket={item.DotBracket} />
                                    ) : (
                                        <HairpinSVG seq={item.Sequence} dotBracket={item.DotBracket} />
                                    )}
                                </div>
                            )}
                            <div className="flex justify-between items-center text-[9px] text-slate-400 font-medium px-1">
                                <span>Vienna ΔG: <b className="text-slate-500">{item.ViennaRNA_DeltaG?.toFixed(2) || 'N/A'}</b></span>
                                <span>Vienna Tm: <b className="text-slate-500">{item.Local_Tm?.toFixed(1) || 'N/A'}°C</b></span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    useEffect(() => {
        localStorage.setItem('moligo_prov_seq_mode', String(isSeqMode));
    }, [isSeqMode]);

    useEffect(() => {
        localStorage.setItem('moligo_prov_schematic_open', String(isSchematicOpen));
    }, [isSchematicOpen]);

    // ── Lengths ──────────────────────────────────────────────────────────
    const m2Len = moligo2Seq.length || 0;
    const m1Len = moligo1Seq.length || 0;
    const tagLen = tagSeq?.length || 0;
    const revLen = revPrimer?.length || 0;
    const fwdLen = fwdPrimer?.length || 0;

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
        <div className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-4 max-w-[85rem] mx-auto px-2 md:px-6">
            {/* Header */}
            <div 
                className="flex items-center justify-between mb-3 cursor-pointer group"
                onClick={() => setIsSchematicOpen(!isSchematicOpen)}
            >
                <div className="flex items-center gap-2">
                    <svg className={`w-4 h-4 text-slate-400 group-hover:text-slate-600 transition-transform duration-200 ${isSchematicOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-sm font-bold text-slate-500 uppercase tracking-widest group-hover:text-slate-700 transition-colors">MOLigo Provenance Schematic</span>
                </div>
                {isSchematicOpen && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setIsSeqMode(!isSeqMode); }}
                        className={`px-4 py-1.5 text-xs font-bold rounded-full border transition-all uppercase tracking-tight ${isSeqMode
                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-200 dark:shadow-indigo-900/20'
                            : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-indigo-400 hover:text-indigo-600'
                            }`}
                    >
                        {isSeqMode ? '🔡 Shape Mode' : '🔡 Seq Mode'}
                    </button>
                )}
            </div>

            {/* ── SVG Schematic & Legend ── */}
            {isSchematicOpen && (
                <div className="animate-in fade-in slide-in-from-top-4 duration-300">
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
                                    stroke={C.tmpl} strokeWidth="1" strokeLinecap="round" />;
                            })}
                            {Array.from({ length: 20 }).map((_, i) => {
                                const tickX = tmplX0 + (i + 0.5) * (tmplW / 20);
                                return <line key={i} x1={tickX} y1={tmplY + stH + 0.5} x2={tickX} y2={tmplY + stH + 2}
                                    stroke={C.tmpl} strokeWidth="1" strokeLinecap="round" />;
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
                </div>
            )}

            {/* ── Sequence Inputs & TAG Picker ── */}
            <div className="mt-8 pt-8 border-t border-slate-100 dark:border-slate-800">
                <div className="max-w-[85rem] mx-auto px-2 md:px-6 grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">

                    {/* Reverse Primer Input Box */}
                    <div className="bg-white dark:bg-slate-800 rounded-lg border border-purple-200 dark:border-purple-900/30 p-3 shadow-sm flex flex-col h-full">
                        <div className="flex justify-between items-start mb-2">
                            <div className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
                                Universal Reverse Primer
                            </div>
                            <span className="text-[10px] font-mono text-slate-400 font-bold">{revLen}nt</span>
                        </div>
                        <div className="flex-1 bg-purple-50/50 dark:bg-purple-900/10 p-2 rounded border border-purple-100 dark:border-purple-900/20">
                            <textarea
                                className="w-full h-full min-h-[4rem] text-sm font-mono bg-transparent border-none outline-none resize-none text-slate-700 dark:text-slate-300 p-0 focus:ring-0"
                                value={revPrimer || ""}
                                onChange={(e) => onRevChange?.(e.target.value.toUpperCase().replace(/[^ATCGUatcgu]/g, ''))}
                                placeholder="Enter reverse primer..."
                                spellCheck={false}
                            />
                        </div>
                    </div>

                    {/* TAG Picker & Manual Input Box */}
                    <div className="bg-white dark:bg-slate-800 rounded-lg border border-red-200 dark:border-red-900/30 p-3 shadow-sm flex flex-col h-full">
                        <div className="flex justify-between items-start mb-2">
                            <div className="text-xs font-bold text-red-600 dark:text-red-400 uppercase tracking-wider">
                                TAG Sequence
                            </div>
                            <span className="text-[10px] font-mono text-slate-400 font-bold">{tagLen}nt</span>
                        </div>

                        <div className="flex flex-col gap-2 flex-1">
                            <select
                                className="w-full p-1.5 text-[10px] border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded focus:ring-red-500 focus:border-red-500 outline-none transition-colors"
                                onChange={(e) => {
                                    const tag = TAG_DATABASE.find(t => t.partNumber === e.target.value);
                                    if (tag) onTagChange?.(tag.complementary);
                                }}
                                value={TAG_DATABASE.find(t => t.complementary === tagSeq)?.partNumber || ""}
                            >
                                <option value="">-- Pick Database TAG --</option>
                                {TAG_DATABASE.map(tag => (
                                    <option key={tag.reg} value={tag.partNumber}>
                                        {tag.partNumber} ({tag.reg}) — {tag.antiTag}
                                    </option>
                                ))}
                            </select>

                            <div className="flex-1 bg-red-50/50 dark:bg-red-900/10 p-2 rounded border border-red-100 dark:border-red-900/20 flex flex-col">
                                <textarea
                                    className="w-full flex-1 min-h-[4rem] text-sm font-mono bg-transparent border-none outline-none resize-none text-slate-700 dark:text-slate-300 p-0 focus:ring-0"
                                    value={tagSeq || ""}
                                    onChange={(e) => onTagChange?.(e.target.value.toUpperCase().replace(/[^ATCGUatcgu]/g, ''))}
                                    placeholder="Manual entry..."
                                    spellCheck={false}
                                />
                            </div>
                        </div>
                        {tagLen > 0 && (
                            <div className="mt-3 border-t border-slate-100 dark:border-slate-700 pt-2 flex items-center justify-between">
                                <span className="text-[10px] text-slate-500 font-mono truncate">
                                    RC: {reverseComplement(tagSeq || "")}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Forward Primer Input Box */}
                    <div className="bg-white dark:bg-slate-800 rounded-lg border border-pink-200 dark:border-pink-900/30 p-3 shadow-sm flex flex-col h-full">
                        <div className="flex justify-between items-start mb-2">
                            <div className="text-xs font-bold text-pink-600 dark:text-pink-400 uppercase tracking-wider">
                                Universal Forward Primer
                            </div>
                            <span className="text-[10px] font-mono text-slate-400 font-bold">{fwdLen}nt</span>
                        </div>
                        <div className="flex-1 bg-pink-50/50 dark:bg-pink-900/10 p-2 rounded border border-pink-100 dark:border-pink-900/20 flex flex-col">
                            <textarea
                                className="w-full flex-1 min-h-[4rem] text-sm font-mono bg-transparent border-none outline-none resize-none text-slate-700 dark:text-slate-300 p-0 focus:ring-0"
                                value={fwdPrimer || ""}
                                onChange={(e) => onFwdChange?.(e.target.value.toUpperCase().replace(/[^ATCGUatcgu]/g, ''))}
                                placeholder="Enter forward primer..."
                                spellCheck={false}
                            />
                        </div>
                        {fwdLen > 0 && (
                            <div className="mt-3 border-t border-slate-100 dark:border-slate-700 pt-2 flex items-center justify-between">
                                <span className="text-[10px] text-slate-500 font-mono truncate">
                                    RC: {fwdRCSeq}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Ready to Order Section ── */}
                <div className="mt-8 p-5 bg-gradient-to-br from-indigo-50/50 to-purple-50/50 dark:from-indigo-900/10 dark:to-purple-900/10 rounded-2xl border border-indigo-100 dark:border-indigo-900/30 shadow-sm animate-in fade-in zoom-in-95 duration-500">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center">
                            <span className="text-lg">📦</span>
                        </div>
                        <h4 className="text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">Ready to Order Sequences (Full Assembly)</h4>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                        {/* Final Oligo 2 Assembly */}
                        <div className="flex flex-col gap-2">
                            <div className="flex justify-between items-center px-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Oligo 2 (Reporter: RevP + M2)</label>
                                <button
                                    onClick={() => handleCopy((revPrimer || "") + moligo2Seq)}
                                    className="text-[10px] font-bold px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-colors"
                                >
                                    {copyFeedback || 'Copy'}
                                </button>
                            </div>
                            <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 font-mono text-xs break-all shadow-sm">
                                <span style={{ color: C.revP }}>{revPrimer}</span>
                                <span style={{ color: C.m2 }}>{moligo2Seq}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 px-1">
                                Full length: <b className="text-indigo-500">{(revPrimer?.length || 0) + moligo2Seq.length}nt</b>
                            </div>
                        </div>

                        {/* Final Oligo 1 Assembly */}
                        <div className="flex flex-col gap-2">
                            <div className="flex justify-between items-center px-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Oligo 1 (Capture: M1 + TAG + RC-FwdP)</label>
                                <button
                                    onClick={() => handleCopy(moligo1Seq + (tagSeq?.toLowerCase() || "") + fwdRCSeq)}
                                    className="text-[10px] font-bold px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-colors"
                                >
                                    {copyFeedback || 'Copy'}
                                </button>
                            </div>
                            <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 font-mono text-xs break-all shadow-sm">
                                <span style={{ color: C.m1 }}>{moligo1Seq}</span>
                                <span style={{ color: C.tag }}>{tagSeq?.toLowerCase()}</span>
                                <span style={{ color: C.fwdRC }}>{fwdRCSeq}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 px-1">
                                Full length: <b className="text-indigo-500">{moligo1Seq.length + (tagSeq?.length || 0) + fwdRCSeq.length}nt</b>
                            </div>
                        </div>
                    </div>
                </div>

                {idtResults && (
                    <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {renderResultCard("Oligo 2 Stability (RevP+M2)", idtResults.m2.hairpin)}
                        {renderResultCard("Oligo 1 Stability (M1+TAG+RC-FwdP)", idtResults.m1.hairpin)}
                        {renderResultCard("HeteroDimer Pairwise", idtResults.pairwise)}
                    </div>
                )}

                {/* ── Report & Analysis Actions ── */}
                <div className="mt-8 flex justify-end items-center gap-4 flex-wrap">
                    {analysisError && <span className="text-xs text-red-500 font-medium uppercase tracking-tight">{analysisError}</span>}
                    <button
                        onClick={runProductAnalysis}
                        disabled={isAnalyzing}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold transition-all shadow-md active:scale-95 border ${
                            isAnalyzing 
                            ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed' 
                            : 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300'
                        }`}
                    >
                        {isAnalyzing ? (
                            <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                        )}
                        {isAnalyzing ? 'Analyzing Products...' : 'Analyze Products'}
                    </button>
                    <button
                        id="btn-proceed-design"
                        onClick={onProceed}
                        className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white px-6 py-2.5 rounded-lg font-bold transition-all shadow-lg shadow-emerald-200/50 dark:shadow-emerald-900/30 active:scale-95 border border-emerald-400"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                        Proceed with the Design
                    </button>
                    <MOLigoReport {...props} />
                </div>
            </div>
        </div>
    );
}
