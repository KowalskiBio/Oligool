import { reverseComplement } from './dna';
import type { SavedPosition } from './session';

export { reverseComplement };

export interface IdtRawItem {
    DotBracket?: string;
    Sequence?: string;
    Bonds?: number[];
    TopLinePadding?: number;
    BottomLinePadding?: number;
    BondLinePadding?: number;
    [key: string]: unknown;
}

export interface IdtReportRawData {
    DeltaG?: number;
    /** Best IDT melting temperature (°C) for this structure class, when available. */
    IDT_Tm?: number;
    /** Strider/local ΔG (kcal/mol) for the best structure. */
    Local_DeltaG?: number;
    /** Strider/local melting temperature (°C) for the best structure. */
    Local_Tm?: number;
    raw?: IdtRawItem | IdtRawItem[];
    /** Per-structure IDT ΔG values (kcal/mol) for the top suboptimal structures. */
    all_DeltaG?: (number | null)[];
    /** Per-structure Strider/local ΔG values (kcal/mol). */
    all_Local_DeltaG?: (number | null)[];
    /** Per-structure IDT Tm values (°C). */
    all_IDT_Tm?: (number | null)[];
    /** Per-structure Strider/local Tm values (°C). */
    all_Local_Tm?: (number | null)[];
}

export const calcGC = (seq: string): number => {
    const s = seq.toUpperCase();
    const gc = (s.match(/[GC]/g) || []).length;
    return seq.length > 0 ? (gc / seq.length) * 100 : 0;
};

export const downloadTxt = (content: string, filename: string): void => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

export interface CompleteReportData {
    jobName: string;
    queryId: string;
    /** FASTA/GenBank header provided by the user; shown instead of job/query defaults. */
    header?: string;
    targetSeq: string;
    targetStart: number;
    targetEnd: number;

    searchParams: Record<string, unknown>;
    advancedParams?: Record<string, unknown>;
    idtAdvancedParams?: {
        mv_conc: number;
        mg_conc: number;
        dntp_conc: number;
        oligo_conc: number;
    };

    moligo1Name: string;
    moligo1Seq: string;
    moligo1Shift: number;
    moligo1Len: number;

    moligo2Name: string;
    moligo2Seq: string;
    moligo2Shift: number;
    moligo2Len: number;

    tagSeq?: string;
    fwdPrimer?: string;
    revPrimer?: string;

    idtM1Hairpin?: IdtReportRawData;
    idtM1SelfDimer?: IdtReportRawData;
    idtM1Analyze?: unknown;
    idtM1Tm?: number;
    idtM2Hairpin?: IdtReportRawData;
    idtM2SelfDimer?: IdtReportRawData;
    idtM2Analyze?: unknown;
    idtM2Tm?: number;
    idtPairwise?: IdtReportRawData;

    savedPositions?: SavedPosition[];

    flankingFwdName?: string;
    flankingFwdSeq?: string;
    flankingFwdLen?: number;
    flankingFwdGc?: number;
    flankingFwdTm?: number;

    flankingRevName?: string;
    flankingRevSeq?: string;
    flankingRevLen?: number;
    flankingRevGc?: number;
    flankingRevTm?: number;

    /** Visual context map showing moligos and flanking primers in the surrounding sequence. */
    contextMap?: ReportContextMap;
}

export interface ReportContextRegion {
    /** 0-based inclusive start, relative to contextMap.sequence. */
    start: number;
    /** 0-based exclusive end, relative to contextMap.sequence. */
    end: number;
    label: string;
    /** Hex color or Tailwind background class. */
    color: string;
    /** Text color for letters inside the region. */
    textColor?: string;
}

export interface ReportContextMap {
    /** Sequence window containing all marked regions. */
    sequence: string;
    /** 1-based absolute start position of the window in the full ungapped sequence. */
    absStart: number;
    /** Marked regions within the window. */
    regions: ReportContextRegion[];
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

const section = (title: string): string => `\n=== ${title} ===\n`;

const kv = (label: string, value: string | number | undefined | null): string =>
    `${label}: ${value ?? 'N/A'}`;

const firstDefined = (...values: (number | null | undefined)[]): number | undefined => {
    for (const v of values) {
        if (v !== undefined && v !== null) return v;
    }
    return undefined;
};

const extractTopTm = (result?: IdtReportRawData): number | undefined => {
    if (!result) return undefined;
    const firstRaw = Array.isArray(result.raw) ? result.raw[0] : result.raw;
    return firstDefined(
        result.IDT_Tm,
        result.Local_Tm,
        result.all_IDT_Tm?.[0],
        result.all_Local_Tm?.[0],
        firstRaw?.IDT_Tm as number | undefined,
        firstRaw?.Local_Tm as number | undefined,
        firstRaw?.Tm as number | undefined
    );
};

const extractTopLocalDg = (result?: IdtReportRawData): number | undefined => {
    if (!result) return undefined;
    const firstRaw = Array.isArray(result.raw) ? result.raw[0] : result.raw;
    return firstDefined(result.Local_DeltaG, result.all_Local_DeltaG?.[0], firstRaw?.Local_DeltaG as number | undefined);
};

const rawItems = (result?: IdtReportRawData): IdtRawItem[] => {
    if (!result || !result.raw) return [];
    return Array.isArray(result.raw) ? result.raw : [result.raw];
};

const fmtThermoLine = (label: string, result?: IdtReportRawData): string => {
    const items = rawItems(result);
    if (items.length === 0) {
        return `${label}: IDT ΔG: N/A | Strider ΔG: N/A | Tm: N/A`;
    }

    const parts: string[] = [];
    parts.push(`IDT ΔG: ${fmtDG(result?.DeltaG)}`);
    parts.push(`Strider ΔG: ${fmtDG(extractTopLocalDg(result))}`);
    const tm = extractTopTm(result);
    parts.push(`Tm: ${fmtNum(tm)} °C`);

    if (items.length > 1) {
        parts.push(`structures: ${items.length}`);
    }
    return `${label}: ${parts.join(' | ')}`;
};

const CONTEXT_LINE_LEN = 80;

const fmtStructureDetails = (title: string, result?: IdtReportRawData): string[] => {
    const items = rawItems(result);
    if (items.length === 0) return [];

    const out: string[] = [];
    out.push(`\n${title}:`);
    const allDg = result?.all_DeltaG ?? [];
    const allLocalDg = result?.all_Local_DeltaG ?? [];
    const allIdtTm = result?.all_IDT_Tm ?? [];
    const allLocalTm = result?.all_Local_Tm ?? [];

    items.forEach((item, idx) => {
        const idtDg = allDg[idx] ?? (idx === 0 ? result?.DeltaG : undefined);
        const localDg = allLocalDg[idx] ?? (idx === 0 ? result?.Local_DeltaG : undefined);
        const idtTm = allIdtTm[idx] ?? (idx === 0 ? result?.IDT_Tm : undefined);
        const localTm = allLocalTm[idx] ?? (idx === 0 ? result?.Local_Tm : undefined);
        const db = item.DotBracket || '';
        const seq = item.Sequence || '';
        out.push(`  Structure ${idx + 1}:`);
        out.push(`    IDT ΔG: ${fmtDG(idtDg)} | Strider ΔG: ${fmtDG(localDg)} | IDT Tm: ${fmtNum(idtTm)} °C | Local Tm: ${fmtNum(localTm)} °C`);
        if (seq) out.push(`    Sequence: ${seq}`);
        if (db) out.push(`    Dot-Bracket: ${db}`);
    });
    return out;
};

const REGION_SYMBOLS: Record<string, string> = {
    'MOLigo 1': '1',
    'MOLigo 2': '2',
    'Flanking Fwd': 'F',
    'Flanking Rev': 'R',
    'Fwd Primer Binding': 'f',
    'Rev Primer Binding': 'r',
};

const REGION_PRIORITY: Record<string, number> = {
    'MOLigo 1': 1,
    'MOLigo 2': 2,
    'Flanking Fwd': 3,
    'Flanking Rev': 4,
    'Fwd Primer Binding': 5,
    'Rev Primer Binding': 6,
};

const fmtContextMap = (contextMap?: ReportContextMap): string[] => {
    if (!contextMap || !contextMap.sequence) return [];
    const { sequence, absStart, regions } = contextMap;
    const out: string[] = [];
    out.push(section('CONTEXT MAP'));
    out.push(`Window: ${absStart} - ${absStart + sequence.length - 1} (${sequence.length} nt)`);

    const legendParts: string[] = [];
    Object.entries(REGION_SYMBOLS).forEach(([label, symbol]) => {
        if (regions.some(r => r.label === label)) {
            legendParts.push(`${symbol} = ${label}`);
        }
    });
    if (legendParts.length > 0) out.push(`Legend: ${legendParts.join(' | ')}`);
    out.push('');

    for (let i = 0; i < sequence.length; i += CONTEXT_LINE_LEN) {
        const lineSeq = sequence.slice(i, i + CONTEXT_LINE_LEN);
        const lineStart = absStart + i;
        const offset = i;
        const markers = Array(lineSeq.length).fill(' ');
        for (let j = 0; j < lineSeq.length; j++) {
            const absIdx = offset + j;
            let best: ReportContextRegion | null = null;
            for (const r of regions) {
                if (absIdx >= r.start && absIdx < r.end) {
                    if (!best || (REGION_PRIORITY[r.label] ?? 99) < (REGION_PRIORITY[best.label] ?? 99)) {
                        best = r;
                    }
                }
            }
            if (best) markers[j] = REGION_SYMBOLS[best.label] ?? '?';
        }
        out.push(`${String(lineStart).padStart(8, ' ')}  ${lineSeq}`);
        if (markers.some(m => m !== ' ')) {
            out.push(`${' '.repeat(10)}   ${markers.join('')}`);
        }
    }
    return out;
};

export const buildCompleteReportTxt = (data: CompleteReportData): string => {
    const lines: string[] = [];

    lines.push('Oligool Complete Design Report');
    lines.push(`Generated: ${new Date().toISOString()}`);

    lines.push(section('JOB & QUERY'));
    if (data.header) {
        lines.push(kv('Header', data.header));
    } else {
        lines.push(kv('Job Name', data.jobName));
        lines.push(kv('Query ID', data.queryId));
    }
    lines.push(kv('Target Region', `${data.targetStart} - ${data.targetEnd}`));
    lines.push(kv('Target Length', `${data.targetSeq.length} nt`));
    lines.push(`Sequence:\n${data.targetSeq}`);

    lines.push(section('SEARCH PARAMETERS'));
    Object.entries(data.searchParams).forEach(([key, value]) => {
        lines.push(kv(key, String(value)));
    });
    if (data.advancedParams && Object.keys(data.advancedParams).length > 0) {
        lines.push('\nAdvanced Search Parameters:');
        Object.entries(data.advancedParams).forEach(([key, value]) => {
            lines.push(`  ${key}: ${String(value)}`);
        });
    }
    if (data.idtAdvancedParams) {
        lines.push('\nIDT Advanced Parameters:');
        lines.push(`  mv_conc: ${data.idtAdvancedParams.mv_conc} mM`);
        lines.push(`  mg_conc: ${data.idtAdvancedParams.mg_conc} mM`);
        lines.push(`  dntp_conc: ${data.idtAdvancedParams.dntp_conc} mM`);
        lines.push(`  oligo_conc: ${data.idtAdvancedParams.oligo_conc} µM`);
    }

    lines.push(section('MOLIGO 1'));
    lines.push(kv('Name', data.moligo1Name));
    lines.push(`Sequence: ${data.moligo1Seq}`);
    lines.push(`Shift: ${data.moligo1Shift} | Length: ${data.moligo1Len} nt | GC: ${fmtNum(calcGC(data.moligo1Seq))}%`);
    lines.push(fmtThermoLine('Hairpin', data.idtM1Hairpin));
    lines.push(fmtThermoLine('Self-Dimer', data.idtM1SelfDimer));
    lines.push(`Analyze Tm: ${fmtNum(data.idtM1Tm)} °C`);

    lines.push(section('MOLIGO 2'));
    lines.push(kv('Name', data.moligo2Name));
    lines.push(`Sequence: ${data.moligo2Seq}`);
    lines.push(`Shift: ${data.moligo2Shift} | Length: ${data.moligo2Len} nt | GC: ${fmtNum(calcGC(data.moligo2Seq))}%`);
    lines.push(fmtThermoLine('Hairpin', data.idtM2Hairpin));
    lines.push(fmtThermoLine('Self-Dimer', data.idtM2SelfDimer));
    lines.push(`Analyze Tm: ${fmtNum(data.idtM2Tm)} °C`);

    if (data.tagSeq) {
        lines.push(section('TAG'));
        lines.push(`Sequence: ${data.tagSeq}`);
        lines.push(`Length: ${data.tagSeq.length} nt`);
    }

    lines.push(section('UNIVERSAL PRIMERS'));
    if (data.fwdPrimer) {
        lines.push(`Forward Primer: ${data.fwdPrimer}`);
        lines.push(`  RC: ${reverseComplement(data.fwdPrimer)}`);
        lines.push(`  Length: ${data.fwdPrimer.length} nt | GC: ${fmtNum(calcGC(data.fwdPrimer))}%`);
    }
    if (data.revPrimer) {
        lines.push(`Reverse Primer: ${data.revPrimer}`);
        lines.push(`  Length: ${data.revPrimer.length} nt | GC: ${fmtNum(calcGC(data.revPrimer))}%`);
    }

    lines.push(section('PAIRWISE INTERACTION'));
    lines.push(fmtThermoLine('MOLigo 1 ↔ MOLigo 2 Heterodimer', data.idtPairwise));

    const hasStructures = data.idtM1Hairpin || data.idtM1SelfDimer || data.idtM2Hairpin || data.idtM2SelfDimer || data.idtPairwise;
    if (hasStructures) {
        lines.push(section('SECONDARY STRUCTURE DETAILS'));
        lines.push(...fmtStructureDetails('MOLigo 1 Hairpin', data.idtM1Hairpin));
        lines.push(...fmtStructureDetails('MOLigo 1 Self-Dimer', data.idtM1SelfDimer));
        lines.push(...fmtStructureDetails('MOLigo 2 Hairpin', data.idtM2Hairpin));
        lines.push(...fmtStructureDetails('MOLigo 2 Self-Dimer', data.idtM2SelfDimer));
        lines.push(...fmtStructureDetails('Pairwise Heterodimer', data.idtPairwise));
    }

    lines.push(section('FLANKING PRIMERS'));
    if (data.flankingFwdSeq) {
        lines.push(`Forward: ${data.flankingFwdName || 'Forward Flanking Primer'}`);
        lines.push(`  Sequence: ${data.flankingFwdSeq}`);
        lines.push(`  Length: ${data.flankingFwdLen ?? data.flankingFwdSeq.length} nt | GC: ${fmtNum(data.flankingFwdGc)}% | Tm: ${fmtNum(data.flankingFwdTm)} °C`);
    }
    if (data.flankingRevSeq) {
        lines.push(`Reverse: ${data.flankingRevName || 'Reverse Flanking Primer'}`);
        lines.push(`  Sequence: ${data.flankingRevSeq}`);
        lines.push(`  Length: ${data.flankingRevLen ?? data.flankingRevSeq.length} nt | GC: ${fmtNum(data.flankingRevGc)}% | Tm: ${fmtNum(data.flankingRevTm)} °C`);
    }
    if (!data.flankingFwdSeq && !data.flankingRevSeq) {
        lines.push('No flanking primers designed yet.');
    }

    lines.push(...fmtContextMap(data.contextMap));

    lines.push(section('FINAL ORDER SEQUENCES'));
    const fwdRC = data.fwdPrimer ? reverseComplement(data.fwdPrimer) : '';
    const fullOligo2 = (data.revPrimer || '') + data.moligo2Seq;
    const fullOligo1 = data.moligo1Seq + (data.tagSeq?.toLowerCase() || '') + fwdRC;
    lines.push(`Oligo 2 (RevP + M2): ${fullOligo2}`);
    lines.push(`  Length: ${fullOligo2.length} nt | GC: ${fmtNum(calcGC(fullOligo2))}%`);
    lines.push(`Oligo 1 (M1 + TAG + RC-FwdP): ${fullOligo1}`);
    lines.push(`  Length: ${fullOligo1.length} nt | GC: ${fmtNum(calcGC(fullOligo1))}%`);

    lines.push('\n--- End of Report ---\n');

    return lines.join('\n');
};
