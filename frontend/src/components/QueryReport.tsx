import { createPortal } from 'react-dom';
import type { CompleteReportData, IdtRawItem, IdtReportRawData, ReportContextMap, ReportContextRegion } from '../utils/report';
import { calcGC, reverseComplement } from '../utils/report';
import MOLigoSchematic from './MOLigoSchematic';
import HairpinSVG from './HairpinSVG';
import DimerSVG from './DimerSVG';

interface QueryReportProps {
    data: CompleteReportData;
}

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
    const db = item.DotBracket || '';
    let seq = item.Sequence;
    if (!seq && db.includes('&')) {
        seq = `${seq1 || ''}&${seq2 || seq1 || ''}`;
    }
    if (!seq) seq = seq1 || '';

    const isDimer = seq.includes('&') || db.includes('&');
    if (!db) {
        return <p className="text-xs text-gray-500 italic">No structure predicted</p>;
    }
    return (
        <div className="w-full bg-gray-50 rounded border border-gray-200 p-2">
            {isDimer ? (
                <DimerSVG seq={seq} dotBracket={db} />
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
                        <div key={idx}>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 mb-1">
                                <span>IDT ΔG: <span className="font-medium">{fmtDG(idtDg)}</span></span>
                                <span>Strider ΔG: <span className="font-medium">{fmtDG(localDg)}</span></span>
                                <span>IDT Tm: <span className="font-medium">{fmtNum(idtTm)} °C</span></span>
                                <span>Local Tm: <span className="font-medium">{fmtNum(localTm)} °C</span></span>
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
    const fullOligo1 = data.moligo1Seq + (data.tagSeq?.toLowerCase() || '') + fwdRC;

    return createPortal(
        <div className="query-report">
            <style>
                {`
                    .query-report, .query-report * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    @media print {
                        .query-report { display: block !important; }
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
                    <div className="mb-6">
                        <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">CONTEXT MAP</h2>
                        <ContextMap contextMap={data.contextMap} />
                    </div>
                )}

                <div className="mb-6">
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
                        <h2 className="text-sm font-bold text-gray-800 border-b border-gray-300 pb-0.5 mb-1">MOLIGO 1</h2>
                        <p className="font-mono text-xs break-all bg-gray-50 p-1.5 rounded border border-gray-200">{data.moligo1Seq}</p>
                        <div className="text-xs text-gray-600 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                            <span><span className="text-gray-500">Name:</span> {data.moligo1Name}</span>
                            <span><span className="text-gray-500">Length:</span> {data.moligo1Len} nt</span>
                            <span><span className="text-gray-500">GC:</span> {fmtNum(calcGC(data.moligo1Seq))}%</span>
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                            <span><span className="text-gray-500">Hairpin IDT ΔG:</span> {fmtDG(data.idtM1Hairpin?.DeltaG)}</span>
                            <span><span className="text-gray-500">Hairpin Strider ΔG:</span> {fmtDG(extractTopLocalDg(data.idtM1Hairpin))}</span>
                            <span><span className="text-gray-500">Self-Dimer IDT ΔG:</span> {fmtDG(data.idtM1SelfDimer?.DeltaG)}</span>
                            <span><span className="text-gray-500">Self-Dimer Strider ΔG:</span> {fmtDG(extractTopLocalDg(data.idtM1SelfDimer))}</span>
                        </div>
                    </div>

                    <div>
                        <h2 className="text-sm font-bold text-gray-800 border-b border-gray-300 pb-0.5 mb-1">MOLIGO 2</h2>
                        <p className="font-mono text-xs break-all bg-gray-50 p-1.5 rounded border border-gray-200">{data.moligo2Seq}</p>
                        <div className="text-xs text-gray-600 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                            <span><span className="text-gray-500">Name:</span> {data.moligo2Name}</span>
                            <span><span className="text-gray-500">Length:</span> {data.moligo2Len} nt</span>
                            <span><span className="text-gray-500">GC:</span> {fmtNum(calcGC(data.moligo2Seq))}%</span>
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                            <span><span className="text-gray-500">Hairpin IDT ΔG:</span> {fmtDG(data.idtM2Hairpin?.DeltaG)}</span>
                            <span><span className="text-gray-500">Hairpin Strider ΔG:</span> {fmtDG(extractTopLocalDg(data.idtM2Hairpin))}</span>
                            <span><span className="text-gray-500">Self-Dimer IDT ΔG:</span> {fmtDG(data.idtM2SelfDimer?.DeltaG)}</span>
                            <span><span className="text-gray-500">Self-Dimer Strider ΔG:</span> {fmtDG(extractTopLocalDg(data.idtM2SelfDimer))}</span>
                        </div>
                    </div>
                </div>

                {data.tagSeq && (
                    <div className="mb-6">
                        <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">TAG SEQUENCE</h2>
                        <p className="font-mono text-sm break-all bg-gray-50 p-3 rounded border border-gray-200">{data.tagSeq}</p>
                        {data.tagReg != null && (
                            <p className="text-sm text-gray-600 mt-1">A{String(data.tagReg).padStart(3, '0')}</p>
                        )}
                    </div>
                )}

                <div className="mb-6">
                    <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">UNIVERSAL PRIMERS</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {data.fwdPrimer && (
                            <div>
                                <h3 className="text-sm font-bold text-gray-700">Forward Primer</h3>
                                <p className="font-mono text-sm break-all bg-gray-50 p-2 rounded border border-gray-200">{data.fwdPrimer}</p>
                                <p className="text-sm text-gray-600">RC: {fwdRC}</p>
                            </div>
                        )}
                        {data.revPrimer && (
                            <div>
                                <h3 className="text-sm font-bold text-gray-700">Reverse Primer</h3>
                                <p className="font-mono text-sm break-all bg-gray-50 p-2 rounded border border-gray-200">{data.revPrimer}</p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="mb-6">
                    <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">MOLIGO 1 × MOLIGO 2</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">IDT ΔG:</span> {fmtDG(data.idtPairwise?.DeltaG)}</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Strider ΔG:</span> {fmtDG(extractTopLocalDg(data.idtPairwise))}</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">IDT Tm:</span> {fmtNum(data.idtPairwise?.IDT_Tm)} °C</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Local Tm:</span> {fmtNum(data.idtPairwise?.Local_Tm)} °C</div>
                    </div>
                </div>

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

                <div className="mb-6">
                    <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">FLANKING PRIMERS</h2>
                    {data.flankingFwdSeq ? (
                        <div className="mb-3">
                            <h3 className="text-sm font-bold text-gray-700">{data.flankingFwdName || 'Flanking Fwd'}</h3>
                            <p className="font-mono text-sm break-all bg-gray-50 p-2 rounded border border-gray-200">{data.flankingFwdSeq}</p>
                            <p className="text-sm text-gray-600">Length: {data.flankingFwdLen ?? data.flankingFwdSeq.length} nt | GC: {fmtNum(data.flankingFwdGc)}%</p>
                            <p className="text-sm text-gray-600">Tm — P3: {fmtNum(data.flankingFwdTmP3)} °C | Strider: {fmtNum(data.flankingFwdTmStrider)} °C | IDT: {fmtNum(data.flankingFwdIDTTm)} °C</p>
                            <p className="text-sm text-gray-600">Hairpin ΔG: {fmtDG(data.flankingFwdHairpinDg)} (Tm: {fmtNum(data.flankingFwdHairpinTm)} °C)</p>
                            <p className="text-sm text-gray-600">Homodimer ΔG: {fmtDG(data.flankingFwdHomodimerDg)} (Tm: {fmtNum(data.flankingFwdHomodimerTm)} °C)</p>
                        </div>
                    ) : (
                        <p className="text-sm text-gray-500">No forward flanking primer designed.</p>
                    )}
                    {data.flankingRevSeq ? (
                        <div>
                            <h3 className="text-sm font-bold text-gray-700">{data.flankingRevName || 'Flanking Rev'}</h3>
                            <p className="font-mono text-sm break-all bg-gray-50 p-2 rounded border border-gray-200">{data.flankingRevSeq}</p>
                            <p className="text-sm text-gray-600">Length: {data.flankingRevLen ?? data.flankingRevSeq.length} nt | GC: {fmtNum(data.flankingRevGc)}%</p>
                            <p className="text-sm text-gray-600">Tm — P3: {fmtNum(data.flankingRevTmP3)} °C | Strider: {fmtNum(data.flankingRevTmStrider)} °C | IDT: {fmtNum(data.flankingRevIDTTm)} °C</p>
                            <p className="text-sm text-gray-600">Hairpin ΔG: {fmtDG(data.flankingRevHairpinDg)} (Tm: {fmtNum(data.flankingRevHairpinTm)} °C)</p>
                            <p className="text-sm text-gray-600">Homodimer ΔG: {fmtDG(data.flankingRevHomodimerDg)} (Tm: {fmtNum(data.flankingRevHomodimerTm)} °C)</p>
                        </div>
                    ) : (
                        <p className="text-sm text-gray-500">No reverse flanking primer designed.</p>
                    )}
                    {(data.flankingHetDg != null || data.flankingHetTm != null) && (
                        <p className="text-sm text-gray-600">Heterodimer (fwd × rev) ΔG: {fmtDG(data.flankingHetDg)} (Tm: {fmtNum(data.flankingHetTm)} °C)</p>
                    )}
                    {data.ampliconLength != null && (
                        <p className="text-sm text-gray-600">Amplicon length: {data.ampliconLength} bp</p>
                    )}
                </div>

                {data.savedPositions && data.savedPositions.length > 0 && (
                    <div className="mb-6">
                        <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">SAVED POSITIONS</h2>
                        <div className="space-y-3">
                            {data.savedPositions.map((pos) => (
                                <div key={pos.id} className="bg-gray-50 p-3 rounded border border-gray-200">
                                    <p className="text-sm font-bold text-gray-700 mb-1">{pos.label}</p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                                        <div>
                                            <span className="font-semibold text-gray-600">Oligo 1:</span> {pos.p1.seq}
                                            <br />
                                            <span className="text-gray-500">bp {pos.p1AbsStart}–{pos.p1AbsEnd} | GC {pos.p1.gc.toFixed(1)}% | Tm {pos.p1.tm.toFixed(1)}°C</span>
                                        </div>
                                        <div>
                                            <span className="font-semibold text-gray-600">Oligo 2:</span> {pos.p2.seq}
                                            <br />
                                            <span className="text-gray-500">bp {pos.p2AbsStart}–{pos.p2AbsEnd} | GC {pos.p2.gc.toFixed(1)}% | Tm {pos.p2.tm.toFixed(1)}°C</span>
                                        </div>
                                    </div>
                                    {pos.notes && <p className="text-xs text-gray-500 mt-1 italic">{pos.notes}</p>}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="mb-6">
                    <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">FINAL ORDER SEQUENCES</h2>
                    <div className="font-mono text-xs whitespace-pre-wrap break-all bg-gray-50 p-3 rounded border border-gray-200">
                        {[
                            `Oligo 2 (RevP + M2)\t${fullOligo2}`,
                            `Oligo 1 (M1 + TAG + RC-FwdP)\t${fullOligo1}`,
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
