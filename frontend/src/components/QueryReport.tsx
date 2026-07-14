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

const extractTopTm = (result?: IdtReportRawData): number | undefined => {
    const firstRaw = result?.raw ? (Array.isArray(result.raw) ? result.raw[0] : result.raw) : undefined;
    return firstDefined(
        result?.IDT_Tm,
        result?.Local_Tm,
        result?.all_IDT_Tm?.[0],
        result?.all_Local_Tm?.[0],
        firstRaw?.IDT_Tm as number | undefined,
        firstRaw?.Local_Tm as number | undefined,
        firstRaw?.Tm as number | undefined
    );
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
        <div className="w-full overflow-x-auto bg-gray-50 rounded border border-gray-200 p-2">
            {isDimer ? (
                <DimerSVG seq={seq} dotBracket={db} />
            ) : (
                <HairpinSVG seq={seq} dotBracket={db} />
            )}
        </div>
    );
};

const ContextMap = ({ contextMap }: { contextMap?: ReportContextMap }) => {
    if (!contextMap || !contextMap.sequence) return null;
    const { sequence, absStart, regions } = contextMap;
    const lineLen = 60;

    const regionClass = (label: string): string => {
        switch (label) {
            case 'MOLigo 1': return 'bg-emerald-200 text-emerald-900';
            case 'MOLigo 2': return 'bg-amber-200 text-amber-900';
            case 'Flanking Fwd': return 'bg-blue-200 text-blue-900';
            case 'Flanking Rev': return 'bg-purple-200 text-purple-900';
            case 'Fwd Primer Binding': return 'bg-pink-200 text-pink-900';
            case 'Rev Primer Binding': return 'bg-fuchsia-200 text-fuchsia-900';
            default: return 'bg-gray-200 text-gray-900';
        }
    };

    const regionSwatch = (label: string): string => {
        switch (label) {
            case 'MOLigo 1': return 'bg-emerald-200';
            case 'MOLigo 2': return 'bg-amber-200';
            case 'Flanking Fwd': return 'bg-blue-200';
            case 'Flanking Rev': return 'bg-purple-200';
            case 'Fwd Primer Binding': return 'bg-pink-200';
            case 'Rev Primer Binding': return 'bg-fuchsia-200';
            default: return 'bg-gray-200';
        }
    };

    const regionAt = (idx: number): ReportContextRegion | undefined =>
        regions.find(r => idx >= r.start && idx < r.end);

    const lines: string[] = [];
    for (let i = 0; i < sequence.length; i += lineLen) {
        lines.push(sequence.slice(i, i + lineLen));
    }

    const uniqueRegionLabels = Array.from(new Set(regions.map(r => r.label)));

    return (
        <div className="bg-gray-50 rounded border border-gray-200 p-3">
            <div className="flex flex-wrap gap-3 text-xs mb-3">
                {uniqueRegionLabels.map(label => (
                    <div key={label} className="flex items-center gap-1">
                        <span className={`inline-block w-3 h-3 rounded-sm ${regionSwatch(label)}`} />
                        <span>{label}</span>
                    </div>
                ))}
            </div>
            <div className="space-y-1">
                {lines.map((line, lineIdx) => {
                    const lineStart = absStart + lineIdx * lineLen;
                    return (
                        <div key={lineIdx} className="font-mono text-xs whitespace-nowrap break-inside-avoid-page">
                            <span className="text-gray-400 select-none inline-block w-20 text-right pr-3 print:w-16">{lineStart}</span>
                            <span className="whitespace-pre">
                                {line.split('').map((char, charIdx) => {
                                    const idx = lineIdx * lineLen + charIdx;
                                    const r = regionAt(idx);
                                    if (r) {
                                        return <span key={idx} className={`${regionClass(r.label)} font-bold px-[1px]`}>{char}</span>;
                                    }
                                    return <span key={idx}>{char}</span>;
                                })}
                            </span>
                        </div>
                    );
                })}
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

    const paramEntries = Object.entries(data.searchParams || {});
    const advancedEntries = Object.entries(data.advancedParams || {});

    return createPortal(
        <div className="query-report">
            <style>
                {`
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
                    <h1 className="text-3xl font-bold text-indigo-900">Oligool Complete Design Report</h1>
                    <p className="text-gray-600 mt-1">Job: {data.jobName || 'N/A'}</p>
                    <p className="text-gray-600">Query ID: {data.queryId}</p>
                    <p className="text-gray-500 text-sm mt-1">Generated: {new Date().toISOString()}</p>
                </div>

                <div className="mb-6">
                    <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">TARGET REGION</h2>
                    <p className="text-sm text-gray-600">Region: {data.targetStart} - {data.targetEnd}</p>
                    <p className="text-sm text-gray-600">Length: {data.targetSeq.length} nt | GC: {fmtNum(calcGC(data.targetSeq))}%</p>
                    <p className="font-mono text-sm break-all bg-gray-50 p-3 rounded border border-gray-200 mt-2">{data.targetSeq}</p>
                </div>

                {data.contextMap && (
                    <div className="mb-6">
                        <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">CONTEXT MAP</h2>
                        <ContextMap contextMap={data.contextMap} />
                    </div>
                )}

                {(paramEntries.length > 0 || advancedEntries.length > 0 || data.idtAdvancedParams) && (
                    <div className="mb-6">
                        <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">PARAMETERS</h2>
                        {paramEntries.length > 0 && (
                            <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                                {paramEntries.map(([key, value]) => (
                                    <div key={key} className="flex justify-between bg-gray-50 p-2 rounded border border-gray-200">
                                        <span className="font-medium text-gray-600">{key}</span>
                                        <span className="font-mono">{String(value)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {advancedEntries.length > 0 && (
                            <div className="mb-3">
                                <h3 className="text-sm font-bold text-gray-700 mb-1">Advanced Search Parameters</h3>
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                    {advancedEntries.map(([key, value]) => (
                                        <div key={key} className="flex justify-between bg-gray-50 p-2 rounded border border-gray-200">
                                            <span className="font-medium text-gray-600">{key}</span>
                                            <span className="font-mono">{String(value)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {data.idtAdvancedParams && (
                            <div>
                                <h3 className="text-sm font-bold text-gray-700 mb-1">IDT Advanced Parameters</h3>
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                    <div className="flex justify-between bg-gray-50 p-2 rounded border border-gray-200"><span>mv_conc</span><span>{data.idtAdvancedParams.mv_conc} mM</span></div>
                                    <div className="flex justify-between bg-gray-50 p-2 rounded border border-gray-200"><span>mg_conc</span><span>{data.idtAdvancedParams.mg_conc} mM</span></div>
                                    <div className="flex justify-between bg-gray-50 p-2 rounded border border-gray-200"><span>dntp_conc</span><span>{data.idtAdvancedParams.dntp_conc} mM</span></div>
                                    <div className="flex justify-between bg-gray-50 p-2 rounded border border-gray-200"><span>oligo_conc</span><span>{data.idtAdvancedParams.oligo_conc} µM</span></div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div className="mb-6">
                    <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">MOLIGO PROVENANCE SCHEMATIC</h2>
                    <MOLigoSchematic
                        templateSeq={data.targetSeq}
                        moligo1Seq={data.moligo1Seq}
                        moligo2Seq={data.moligo2Seq}
                        tagSeq={data.tagSeq}
                        fwdPrimer={data.fwdPrimer}
                        revPrimer={data.revPrimer}
                        seqMode={true}
                    />
                </div>

                <div className="mb-6">
                    <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">MOLIGO 1 (CAPTURE)</h2>
                    <p className="font-mono text-sm break-all bg-gray-50 p-3 rounded border border-gray-200">{data.moligo1Seq}</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mt-2">
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Name:</span> {data.moligo1Name}</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Shift:</span> {data.moligo1Shift}</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Length:</span> {data.moligo1Len} nt</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">GC:</span> {fmtNum(calcGC(data.moligo1Seq))}%</div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mt-2">
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Hairpin IDT ΔG:</span> {fmtDG(data.idtM1Hairpin?.DeltaG)}</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Hairpin Strider ΔG:</span> {fmtDG(extractTopLocalDg(data.idtM1Hairpin))}</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Hairpin Tm:</span> {fmtNum(extractTopTm(data.idtM1Hairpin))} °C</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Analyze Tm:</span> {fmtNum(data.idtM1Tm)} °C</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Self-Dimer IDT ΔG:</span> {fmtDG(data.idtM1SelfDimer?.DeltaG)}</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Self-Dimer Strider ΔG:</span> {fmtDG(extractTopLocalDg(data.idtM1SelfDimer))}</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Self-Dimer Tm:</span> {fmtNum(extractTopTm(data.idtM1SelfDimer))} °C</div>
                    </div>
                </div>

                <div className="mb-6">
                    <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">MOLIGO 2 (REPORTER)</h2>
                    <p className="font-mono text-sm break-all bg-gray-50 p-3 rounded border border-gray-200">{data.moligo2Seq}</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mt-2">
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Name:</span> {data.moligo2Name}</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Shift:</span> {data.moligo2Shift}</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Length:</span> {data.moligo2Len} nt</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">GC:</span> {fmtNum(calcGC(data.moligo2Seq))}%</div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mt-2">
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Hairpin IDT ΔG:</span> {fmtDG(data.idtM2Hairpin?.DeltaG)}</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Hairpin Strider ΔG:</span> {fmtDG(extractTopLocalDg(data.idtM2Hairpin))}</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Hairpin Tm:</span> {fmtNum(extractTopTm(data.idtM2Hairpin))} °C</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Analyze Tm:</span> {fmtNum(data.idtM2Tm)} °C</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Self-Dimer IDT ΔG:</span> {fmtDG(data.idtM2SelfDimer?.DeltaG)}</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Self-Dimer Strider ΔG:</span> {fmtDG(extractTopLocalDg(data.idtM2SelfDimer))}</div>
                        <div className="bg-gray-50 p-2 rounded border border-gray-200"><span className="text-gray-600">Self-Dimer Tm:</span> {fmtNum(extractTopTm(data.idtM2SelfDimer))} °C</div>
                    </div>
                </div>

                {data.tagSeq && (
                    <div className="mb-6">
                        <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">TAG SEQUENCE</h2>
                        <p className="font-mono text-sm break-all bg-gray-50 p-3 rounded border border-gray-200">{data.tagSeq}</p>
                        <p className="text-sm text-gray-600 mt-1">Length: {data.tagSeq.length} nt</p>
                    </div>
                )}

                <div className="mb-6">
                    <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">UNIVERSAL PRIMERS</h2>
                    {data.fwdPrimer && (
                        <div className="mb-3">
                            <h3 className="text-sm font-bold text-gray-700">Forward Primer</h3>
                            <p className="font-mono text-sm break-all bg-gray-50 p-2 rounded border border-gray-200">{data.fwdPrimer}</p>
                            <p className="text-sm text-gray-600">RC: {fwdRC}</p>
                            <p className="text-sm text-gray-600">Length: {data.fwdPrimer.length} nt | GC: {fmtNum(calcGC(data.fwdPrimer))}%</p>
                        </div>
                    )}
                    {data.revPrimer && (
                        <div>
                            <h3 className="text-sm font-bold text-gray-700">Reverse Primer</h3>
                            <p className="font-mono text-sm break-all bg-gray-50 p-2 rounded border border-gray-200">{data.revPrimer}</p>
                            <p className="text-sm text-gray-600">Length: {data.revPrimer.length} nt | GC: {fmtNum(calcGC(data.revPrimer))}%</p>
                        </div>
                    )}
                </div>

                <div className="mb-6">
                    <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">PAIRWISE INTERACTION</h2>
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
                            <StructureSection title="Pairwise Heterodimer" result={data.idtPairwise} seq1={data.moligo1Seq} seq2={data.moligo2Seq} />
                        </div>
                    </div>
                )}

                <div className="mb-6">
                    <h2 className="text-lg font-bold text-gray-800 mb-2 border-b border-gray-300 pb-1">FLANKING PRIMERS</h2>
                    {data.flankingFwdSeq ? (
                        <div className="mb-3">
                            <h3 className="text-sm font-bold text-gray-700">{data.flankingFwdName || 'Forward Flanking Primer'}</h3>
                            <p className="font-mono text-sm break-all bg-gray-50 p-2 rounded border border-gray-200">{data.flankingFwdSeq}</p>
                            <p className="text-sm text-gray-600">Length: {data.flankingFwdLen ?? data.flankingFwdSeq.length} nt | GC: {fmtNum(data.flankingFwdGc)}% | Tm: {fmtNum(data.flankingFwdTm)} °C</p>
                        </div>
                    ) : (
                        <p className="text-sm text-gray-500">No forward flanking primer designed.</p>
                    )}
                    {data.flankingRevSeq ? (
                        <div>
                            <h3 className="text-sm font-bold text-gray-700">{data.flankingRevName || 'Reverse Flanking Primer'}</h3>
                            <p className="font-mono text-sm break-all bg-gray-50 p-2 rounded border border-gray-200">{data.flankingRevSeq}</p>
                            <p className="text-sm text-gray-600">Length: {data.flankingRevLen ?? data.flankingRevSeq.length} nt | GC: {fmtNum(data.flankingRevGc)}% | Tm: {fmtNum(data.flankingRevTm)} °C</p>
                        </div>
                    ) : (
                        <p className="text-sm text-gray-500">No reverse flanking primer designed.</p>
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-gray-50 p-3 rounded border border-gray-200">
                            <h3 className="font-bold text-gray-700 text-sm mb-1">Oligo 2 (RevP + M2)</h3>
                            <p className="font-mono text-xs break-all">{fullOligo2}</p>
                            <p className="text-xs text-gray-600 mt-1">Length: {fullOligo2.length} nt | GC: {fmtNum(calcGC(fullOligo2))}%</p>
                        </div>
                        <div className="bg-gray-50 p-3 rounded border border-gray-200">
                            <h3 className="font-bold text-gray-700 text-sm mb-1">Oligo 1 (M1 + TAG + RC-FwdP)</h3>
                            <p className="font-mono text-xs break-all">{fullOligo1}</p>
                            <p className="text-xs text-gray-600 mt-1">Length: {fullOligo1.length} nt | GC: {fmtNum(calcGC(fullOligo1))}%</p>
                        </div>
                    </div>
                </div>

                <div className="mt-8 pt-4 border-t border-gray-300 text-xs text-gray-400">
                    Generated by Oligool | Complete Design Report
                </div>
            </div>
        </div>,
        document.body
    );
}
