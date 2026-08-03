import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import type { CompleteReportData, IdtRawItem, IdtReportRawData, ReportContextMap, ReportContextRegion } from '../utils/report';
import { calcGC, reverseComplement } from '../utils/report';
import MOLigoSchematic from './MOLigoSchematic';
import HairpinSVG from './HairpinSVG';
import DimerAscii from './DimerAscii';

interface QueryReportProps {
    data: CompleteReportData;
}

const V = ({ children }: { children: ReactNode }) => <span className="font-bold text-zinc-900">{children}</span>;

const fmtNum = (v: number | undefined | null, digits = 1): string => {
    if (v === undefined || v === null) return 'N/A';
    return v.toFixed(digits);
};

const fmtDG = (v: number | undefined | null): string => {
    if (v === undefined || v === null) return 'N/A';
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toFixed(2)} kcal/mol`;
};

const firstDefined = (...values: (number | null | undefined)[]): number | undefined => {
    for (const v of values) {
        if (v !== undefined && v !== null) return v;
    }
    return undefined;
};

const extractTopLocalDg = (result?: IdtReportRawData): number | undefined => {
    const firstRaw = result?.raw ? (Array.isArray(result.raw) ? result.raw[0] : result.raw) : undefined;
    return firstDefined(result?.Local_DeltaG, result?.all_Local_DeltaG?.[0], firstRaw?.Local_DeltaG as number | undefined);
};

const rawItems = (result?: IdtReportRawData): IdtRawItem[] => {
    if (!result || !result.raw) return [];
    return Array.isArray(result.raw) ? result.raw : [result.raw];
};

const renderIdtSvg = (item: IdtRawItem, seq1?: string, seq2?: string) => {
    const db = item.DotBracket || item.Local_DotBracket || '';
    let seq = item.Sequence;
    if (!seq && db.includes('&')) {
        seq = `${seq1 || ''}&${seq2 || seq1 || ''}`;
    }
    if (!seq) seq = seq1 || '';

    const isDimer = seq.includes('&') || db.includes('&');
    if (!db) {
        return <p className="text-xs text-zinc-500 italic">No structure predicted</p>;
    }
    return (
        <div className="w-full bg-zinc-50 rounded border border-zinc-200 p-2">
            {isDimer ? (
                <DimerAscii seq={seq} dotBracket={db} raw={item} className="print:max-h-none print:overflow-visible" />
            ) : (
                <HairpinSVG seq={seq} dotBracket={db} />
            )}
        </div>
    );
};

const REGION_PALETTE: Record<string, { bg: string; text: string }> = {
    'MOLigo 1': { bg: 'bg-emerald-400', text: 'text-emerald-950' },
    'MOLigo 2': { bg: 'bg-amber-400', text: 'text-amber-950' },
    'Flanking Fwd': { bg: 'bg-blue-400', text: 'text-blue-950' },
    'Flanking Rev': { bg: 'bg-purple-400', text: 'text-purple-950' },
    'Fwd Primer Binding': { bg: 'bg-pink-400', text: 'text-pink-950' },
    'Rev Primer Binding': { bg: 'bg-fuchsia-400', text: 'text-fuchsia-950' },
};
const DEFAULT_REGION_STYLE = { bg: 'bg-gray-400', text: 'text-gray-950' };

const ContextMap = ({ contextMap }: { contextMap?: ReportContextMap }) => {
    if (!contextMap || !contextMap.sequence) return null;
    const { sequence, absStart, regions } = contextMap;
    const lineLen = 60;

    const regionStyle = (label: string): { bg: string; text: string } =>
        REGION_PALETTE[label] ?? DEFAULT_REGION_STYLE;

    const regionAt = (idx: number): ReportContextRegion | undefined =>
        regions.find(r => idx >= r.start && idx < r.end);

    const lines: string[] = [];
    for (let i = 0; i < sequence.length; i += lineLen) {
        lines.push(sequence.slice(i, i + lineLen).padEnd(lineLen, ' '));
    }

    const uniqueRegionLabels = Array.from(new Set(regions.map(r => r.label)));

    return (
        <div className="bg-gray-50 rounded border border-gray-200 p-3 inline-block">
            <div className="space-y-1">
                {lines.map((line, lineIdx) => {
                    const lineStart = absStart + lineIdx * lineLen;
                    return (
                        <div key={lineIdx} className="font-mono text-xs whitespace-nowrap break-inside-avoid-page">
                            <span className="text-gray-400 select-none inline-block w-20 text-right pr-3 print:w-16">{lineStart}</span>
                            <span className="whitespace-pre inline-block">
                                {line.split('').map((char, charIdx) => {
                                    const idx = lineIdx * lineLen + charIdx;
                                    const r = regionAt(idx);
                                    if (r) {
                                        return <span key={idx} className={`${regionStyle(r.label).bg} ${regionStyle(r.label).text} font-bold`}>{char}</span>;
                                    }
                                    return <span key={idx}>{char}</span>;
                                })}
                            </span>
                        </div>
                    );
                })}
            </div>
            <div className="flex flex-wrap gap-3 text-xs mt-3">
                {uniqueRegionLabels.map(label => (
                    <div key={label} className="flex items-center gap-1">
                        <span className={`inline-block w-3 h-3 rounded-sm ${regionStyle(label).bg}`} />
                        <span>{label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

const StructureSection = ({
    title,
    result,
    seq1,
    seq2,
}: {
    title: string;
    result?: IdtReportRawData;
    seq1?: string;
    seq2?: string;
}) => {
    const items = rawItems(result);
    if (items.length === 0) return null;

    const allDg = result?.all_DeltaG ?? [];
    const allLocalDg = result?.all_Local_DeltaG ?? [];
    const allIdtTm = result?.all_IDT_Tm ?? [];
    const allLocalTm = result?.all_Local_Tm ?? [];

    return (
        <div className="mb-4">
            <h3 className="text-sm font-bold text-gray-700 mb-2">{title} <span className="font-normal text-gray-500">({items.length})</span></h3>
            <div className="space-y-3">
                {items.map((item, idx) => {
                    const idtDg = allDg[idx] ?? (idx === 0 ? result?.DeltaG : undefined);
                    const localDg = allLocalDg[idx] ?? (idx === 0 ? result?.Local_DeltaG : undefined);
                    const idtTm = allIdtTm[idx] ?? (idx === 0 ? result?.IDT_Tm : undefined);
                    const localTm = allLocalTm[idx] ?? (idx === 0 ? result?.Local_Tm : undefined);
                    return (
                        <div key={idx} className="break-inside-avoid">
                            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-600 mb-1 whitespace-pre-wrap">
                                {fmtDG(idtDg) !== 'N/A' && <span>IDT ΔG{'\t'}<span className="font-bold text-gray-900">{fmtDG(idtDg)}</span></span>}
                                {fmtDG(localDg) !== 'N/A' && <span>Strider ΔG{'\t'}<span className="font-bold text-gray-900">{fmtDG(localDg)}</span></span>}
                                {fmtNum(idtTm) !== 'N/A' && <span>IDT Tm{'\t'}<span className="font-bold text-gray-900">{fmtNum(idtTm)} °C</span></span>}
                                {fmtNum(localTm) !== 'N/A' && <span>Local Tm{'\t'}<span className="font-bold text-gray-900">{fmtNum(localTm)} °C</span></span>}
                            </div>
                            {renderIdtSvg(item, seq1, seq2)}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default function QueryReport({ data }: QueryReportProps) {
    const fwdRC = data.fwdPrimer ? reverseComplement(data.fwdPrimer) : '';
    const fullOligo2 = (data.revPrimer || '') + data.moligo2Seq;
    const fullOligo1 = data.moligo1Seq + (data.tagSeq || '') + fwdRC;

    return createPortal(
        <div className="query-report">
            <style>
                {`
                    .query-report, .query-report * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    @media print {
                        .query-report { display: block !important; }
                        .query-report .break-avoid { break-inside: avoid; page-break-inside: avoid; }
                        .query-report .break-avoid-item { break-inside: avoid; page-break-inside: avoid; }
                        .query-report .grid > * { break-inside: avoid; page-break-inside: avoid; }
                    }
                    @media screen {
                        .query-report { display: none !important; }
                    }
                `}
            </style>

            <div className="p-6 max-w-5xl mx-auto bg-white text-black">
                <div className="mb-6 border-b-2 border-indigo-200 pb-4">
                    <h1 className="text-xl font-bold text-indigo-900">Oligool Complete Design Report</h1>
                    <p className="text-xs text-gray-500 mt-1">{new Date().toLocaleString()}</p>
                    {data.header && (
                        <p className="text-base font-medium text-gray-800 mt-2 break-words">{data.header}</p>
                    )}
                </div>

                {data.genbankHeader && (
                    <pre data-genbank-header className="font-mono text-[10px] leading-[1.15] text-gray-600 whitespace-pre-wrap break-words mb-6">{data.genbankHeader}</pre>
                )}

                {data.contextMap && (
                    <div className="break-avoid mb-6">
                        <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">CONTEXT MAP</h2>
                        <ContextMap contextMap={data.contextMap} />
                    </div>
                )}

                <div className="break-avoid mb-6">
                    <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">MOLIGO PROVENANCE SCHEMATIC</h2>
                    <MOLigoSchematic
                        light
                        templateSeq={data.targetSeq}
                        moligo1Seq={data.moligo1Seq}
                        moligo2Seq={data.moligo2Seq}
                        tagSeq={data.tagSeq}
                        fwdPrimer={data.fwdPrimer}
                        revPrimer={data.revPrimer}
                    />
                </div>

                <div className="break-inside-avoid mb-6 grid grid-cols-1 gap-3">
                    <div>
                        <h2 className="text-sm font-bold text-gray-800 border-b border-gray-300 pb-0.5 mb-1">{data.moligo1Name || 'MOLIGO 1'}</h2>
                        <p className="font-mono text-xs break-all bg-gray-50 p-1.5 rounded border border-gray-200">{data.moligo1Seq}</p>
                        <div className="text-xs text-gray-600 mt-1 flex flex-wrap gap-x-4 gap-y-0.5 whitespace-pre-wrap">
                            <span><span className="text-gray-500">Name{'\t'}</span><V>{data.moligo1Name}</V></span>
                            <span><span className="text-gray-500">Length{'\t'}</span><V>{data.moligo1Len} nt</V></span>
                            <span><span className="text-gray-500">GC{'\t'}</span><V>{fmtNum(calcGC(data.moligo1Seq))}%</V></span>
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap">
                            <span><span className="text-gray-500">Tm — P3{'\t'}</span><V>{fmtNum(data.moligo1TmP3)} °C</V> | <span className="text-gray-500">Strider{'\t'}</span><V>{fmtNum(data.moligo1TmStrider)} °C</V> | <span className="text-gray-500">IDT{'\t'}</span><V>{fmtNum(data.idtM1Tm)} °C</V></span>
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5 grid grid-cols-2 gap-x-6 gap-y-0.5 whitespace-pre-wrap">
                            <span><span className="text-gray-500">Hairpin IDT ΔG{'\t'}</span><V>{fmtDG(data.idtM1Hairpin?.DeltaG)}</V></span>
                            <span><span className="text-gray-500">Hairpin Strider ΔG{'\t'}</span><V>{fmtDG(extractTopLocalDg(data.idtM1Hairpin))}</V></span>
                            <span><span className="text-gray-500">Self-Dimer IDT ΔG{'\t'}</span><V>{fmtDG(data.idtM1SelfDimer?.DeltaG)}</V></span>
                            <span><span className="text-gray-500">Self-Dimer Strider ΔG{'\t'}</span><V>{fmtDG(extractTopLocalDg(data.idtM1SelfDimer))}</V></span>
                        </div>
                    </div>

                    <div>
                        <h2 className="text-sm font-bold text-gray-800 border-b border-gray-300 pb-0.5 mb-1">{data.moligo2Name || 'MOLIGO 2'}</h2>
                        <p className="font-mono text-xs break-all bg-gray-50 p-1.5 rounded border border-gray-200">{data.moligo2Seq}</p>
                        <div className="text-xs text-gray-600 mt-1 flex flex-wrap gap-x-4 gap-y-0.5 whitespace-pre-wrap">
                            <span><span className="text-gray-500">Name{'\t'}</span><V>{data.moligo2Name}</V></span>
                            <span><span className="text-gray-500">Length{'\t'}</span><V>{data.moligo2Len} nt</V></span>
                            <span><span className="text-gray-500">GC{'\t'}</span><V>{fmtNum(calcGC(data.moligo2Seq))}%</V></span>
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap">
                            <span><span className="text-gray-500">Tm — P3{'\t'}</span><V>{fmtNum(data.moligo2TmP3)} °C</V> | <span className="text-gray-500">Strider{'\t'}</span><V>{fmtNum(data.moligo2TmStrider)} °C</V> | <span className="text-gray-500">IDT{'\t'}</span><V>{fmtNum(data.idtM2Tm)} °C</V></span>
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5 grid grid-cols-2 gap-x-6 gap-y-0.5 whitespace-pre-wrap">
                            <span><span className="text-gray-500">Hairpin IDT ΔG{'\t'}</span><V>{fmtDG(data.idtM2Hairpin?.DeltaG)}</V></span>
                            <span><span className="text-gray-500">Hairpin Strider ΔG{'\t'}</span><V>{fmtDG(extractTopLocalDg(data.idtM2Hairpin))}</V></span>
                            <span><span className="text-gray-500">Self-Dimer IDT ΔG{'\t'}</span><V>{fmtDG(data.idtM2SelfDimer?.DeltaG)}</V></span>
                            <span><span className="text-gray-500">Self-Dimer Strider ΔG{'\t'}</span><V>{fmtDG(extractTopLocalDg(data.idtM2SelfDimer))}</V></span>
                        </div>
                    </div>
                </div>

                {data.tagSeq && (
                    <div className="break-avoid mb-6">
                        <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">TAG SEQUENCE</h2>
                        <p className="font-mono text-sm break-all bg-gray-50 p-3 rounded border border-gray-200">{data.tagSeq}</p>
                        {data.tagReg != null && (
                            <p className="text-sm text-gray-600 mt-1">A{String(data.tagReg).padStart(3, '0')}</p>
                        )}
                    </div>
                )}

                {(data.idtM1Hairpin || data.idtM1SelfDimer || data.idtM2Hairpin || data.idtM2SelfDimer || data.idtPairwise) && (
                    <div className="mb-6">
                        <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">SECONDARY STRUCTURE PREDICTIONS</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <StructureSection title="MOLigo 1 Hairpin" result={data.idtM1Hairpin} seq1={data.moligo1Seq} />
                            <StructureSection title="MOLigo 1 Self-Dimer" result={data.idtM1SelfDimer} seq1={data.moligo1Seq} />
                            <StructureSection title="MOLigo 2 Hairpin" result={data.idtM2Hairpin} seq1={data.moligo2Seq} />
                            <StructureSection title="MOLigo 2 Self-Dimer" result={data.idtM2SelfDimer} seq1={data.moligo2Seq} />
                            <StructureSection title="MOLigo 1 × MOLigo 2" result={data.idtPairwise} seq1={data.moligo1Seq} seq2={data.moligo2Seq} />
                        </div>
                    </div>
                )}

                <div className="break-avoid mb-6">
                    <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">FLANKING PRIMERS</h2>
                    {data.flankingFwdSeq ? (
                        <div className="mb-3">
                            <h3 className="text-sm font-bold text-gray-700">{data.flankingFwdName || 'Flanking Fwd'}</h3>
                            <p className="font-mono text-sm break-all bg-gray-50 p-2 rounded border border-gray-200">{data.flankingFwdSeq}</p>
                            <p className="text-sm text-gray-600 whitespace-pre-wrap">Length{'\t'}<V>{data.flankingFwdLen ?? data.flankingFwdSeq.length} nt</V> | GC{'\t'}<V>{fmtNum(data.flankingFwdGc)}%</V></p>
                            <p className="text-sm text-gray-600 whitespace-pre-wrap">Tm — P3{'\t'}<V>{fmtNum(data.flankingFwdTmP3)} °C</V> | Strider{'\t'}<V>{fmtNum(data.flankingFwdTmStrider)} °C</V> | IDT{'\t'}<V>{fmtNum(data.flankingFwdIDTTm)} °C</V></p>
                            <p className="text-sm text-gray-600 whitespace-pre-wrap">P3 Hairpin ΔG{'\t'}<V>{fmtDG(data.flankingFwdHairpinDg)}</V> (Tm{'\t'}<V>{fmtNum(data.flankingFwdHairpinTm)} °C</V>)</p>
                            <p className="text-sm text-gray-600 whitespace-pre-wrap">P3 Homodimer ΔG{'\t'}<V>{fmtDG(data.flankingFwdHomodimerDg)}</V> (Tm{'\t'}<V>{fmtNum(data.flankingFwdHomodimerTm)} °C</V>)</p>
                        </div>
                    ) : (
                        <p className="text-sm text-gray-500">No forward flanking primer designed.</p>
                    )}
                    {data.flankingRevSeq ? (
                        <div className="mb-3">
                            <h3 className="text-sm font-bold text-gray-700">{data.flankingRevName || 'Flanking Rev'}</h3>
                            <p className="font-mono text-sm break-all bg-gray-50 p-2 rounded border border-gray-200">{data.flankingRevSeq}</p>
                            <p className="text-sm text-gray-600 whitespace-pre-wrap">Length{'\t'}<V>{data.flankingRevLen ?? data.flankingRevSeq.length} nt</V> | GC{'\t'}<V>{fmtNum(data.flankingRevGc)}%</V></p>
                            <p className="text-sm text-gray-600 whitespace-pre-wrap">Tm — P3{'\t'}<V>{fmtNum(data.flankingRevTmP3)} °C</V> | Strider{'\t'}<V>{fmtNum(data.flankingRevTmStrider)} °C</V> | IDT{'\t'}<V>{fmtNum(data.flankingRevIDTTm)} °C</V></p>
                            <p className="text-sm text-gray-600 whitespace-pre-wrap">P3 Hairpin ΔG{'\t'}<V>{fmtDG(data.flankingRevHairpinDg)}</V> (Tm{'\t'}<V>{fmtNum(data.flankingRevHairpinTm)} °C</V>)</p>
                            <p className="text-sm text-gray-600 whitespace-pre-wrap">P3 Homodimer ΔG{'\t'}<V>{fmtDG(data.flankingRevHomodimerDg)}</V> (Tm{'\t'}<V>{fmtNum(data.flankingRevHomodimerTm)} °C</V>)</p>
                        </div>
                    ) : (
                        <p className="text-sm text-gray-500">No reverse flanking primer designed.</p>
                    )}
                    {((data.flankingHetDg != null || data.flankingHetTm != null) || data.ampliconLength != null) && (
                        <div>
                            <h3 className="text-sm font-bold text-gray-700">{(data.flankingFwdName || 'Primer1')} × {(data.flankingRevName || 'Primer2')}</h3>
                            {(data.flankingHetDg != null || data.flankingHetTm != null) && (
                                <p className="text-sm text-gray-600 whitespace-pre-wrap">Heterodimer ΔG{'\t'}<V>{fmtDG(data.flankingHetDg)}</V> (Tm{'\t'}<V>{fmtNum(data.flankingHetTm)} °C</V>)</p>
                            )}
                            {data.ampliconLength != null && (
                                <p className="text-sm text-gray-600 whitespace-pre-wrap">Amplicon length{'\t'}<V>{data.ampliconLength} bp</V></p>
                            )}
                        </div>
                    )}
                </div>

                {data.savedPositions && data.savedPositions.length > 0 && (
                    <div className="break-avoid mb-6">
                        <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">SAVED POSITIONS</h2>
                        <div className="space-y-3">
                            {data.savedPositions.map((pos) => (
                                <div key={pos.id} className="bg-gray-50 p-3 rounded border border-gray-200">
                                    <p className="text-sm font-bold text-gray-700 mb-1">{pos.label}</p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs whitespace-pre-wrap">
                                        <div>
                                            <span className="font-semibold text-gray-600">Oligo 1{'\t'}</span>{pos.p1.seq}
                                            <br />
                                            <span className="text-gray-500">bp <span className="font-bold text-gray-900">{pos.p1AbsStart}–{pos.p1AbsEnd}</span> | GC <span className="font-bold text-gray-900">{pos.p1.gc.toFixed(1)}%</span> | Tm <span className="font-bold text-gray-900">{pos.p1.tm.toFixed(1)}°C</span></span>
                                        </div>
                                        <div>
                                            <span className="font-semibold text-gray-600">Oligo 2{'\t'}</span>{pos.p2.seq}
                                            <br />
                                            <span className="text-gray-500">bp <span className="font-bold text-gray-900">{pos.p2AbsStart}–{pos.p2AbsEnd}</span> | GC <span className="font-bold text-gray-900">{pos.p2.gc.toFixed(1)}%</span> | Tm <span className="font-bold text-gray-900">{pos.p2.tm.toFixed(1)}°C</span></span>
                                        </div>
                                    </div>
                                    {pos.notes && <p className="text-xs text-gray-500 mt-1 italic">{pos.notes}</p>}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="break-avoid mb-6">
                    <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">FINAL ORDER SEQUENCES</h2>
                    <div className="font-mono text-xs whitespace-pre-wrap break-all bg-gray-50 p-3 rounded border border-gray-200">
                        {[
                            `${data.moligo2Name || 'Oligo 2'} (RevP + M2)\t${fullOligo2}`,
                            `${data.moligo1Name || 'Oligo 1'} (M1 + TAG + RC-FwdP)\t${fullOligo1}`,
                            ...(data.flankingFwdSeq ? [`${data.flankingFwdName || 'Flanking Fwd'}\t${data.flankingFwdSeq}`] : []),
                            ...(data.flankingRevSeq ? [`${data.flankingRevName || 'Flanking Rev'}\t${data.flankingRevSeq}`] : []),
                        ].join('\n')}
                    </div>
                </div>

                <div className="mt-8 pt-4 border-t border-gray-300 text-xs text-gray-400">
                    Oligool | Complete Design Report
                </div>
            </div>
        </div>,
        document.body
    );
}
