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
    /** TAG entry reg number from the roller list (constants/tags.ts), when the current TAG matches the database. */
    tagReg?: number;
    /** TAG part number from the roller list, e.g. "MTAG-A018". */
    tagPartNumber?: string;
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

    flankingRevName?: string;
    flankingRevSeq?: string;
    flankingRevLen?: number;
    flankingRevGc?: number;

    /** Amplicon size (bp) spanned by the selected flanking primer pair. */
    ampliconLength?: number;

    /** Primer3 melting temperature (°C) of the forward flanking primer. */
    flankingFwdTmP3?: number | null;
    /** Strider melting temperature (°C) of the forward flanking primer. */
    flankingFwdTmStrider?: number | null;
    /** IDT melting temperature (°C) of the forward flanking primer. */
    flankingFwdIDTTm?: number;
    /** Primer3 hairpin ΔG (kcal/mol, 25 °C) of the forward flanking primer. */
    flankingFwdHairpinDg?: number | null;
    /** Primer3 hairpin Tm (°C) of the forward flanking primer. */
    flankingFwdHairpinTm?: number | null;
    /** Primer3 homodimer ΔG (kcal/mol, 25 °C) of the forward flanking primer. */
    flankingFwdHomodimerDg?: number | null;
    /** Primer3 homodimer Tm (°C) of the forward flanking primer. */
    flankingFwdHomodimerTm?: number | null;

    flankingRevTmP3?: number | null;
    flankingRevTmStrider?: number | null;
    flankingRevIDTTm?: number;
    flankingRevHairpinDg?: number | null;
    flankingRevHairpinTm?: number | null;
    flankingRevHomodimerDg?: number | null;
    flankingRevHomodimerTm?: number | null;

    /** Primer3 heterodimer ΔG (kcal/mol, 25 °C) of the flanking primer pair. */
    flankingHetDg?: number | null;
    /** Primer3 heterodimer Tm (°C) of the flanking primer pair. */
    flankingHetTm?: number | null;

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

const section = (title: string): string => `\n=== ${title} ===\n`;

const kv = (label: string, value: string | number | undefined | null): string =>
    `${label}: ${value ?? 'N/A'}`;

export const buildCompleteReportTxt = (data: CompleteReportData): string => {
    const lines: string[] = [];

    lines.push('Oligool Design Report');
    lines.push(`Generated: ${new Date().toISOString()}`);

    lines.push(section('HEADER'));
    if (data.header) {
        lines.push(data.header);
    } else {
        lines.push(kv('Job Name', data.jobName));
        lines.push(kv('Query ID', data.queryId));
    }
    lines.push(kv('Target Region', `${data.targetStart} - ${data.targetEnd}`));
    lines.push(kv('Target Length', `${data.targetSeq.length} nt`));

    lines.push(section('TARGET SEQUENCE'));
    lines.push(data.targetSeq);

    lines.push(section(`MOLIGO 1${data.moligo1Name ? ` - ${data.moligo1Name}` : ''}`));
    lines.push(data.moligo1Seq);

    lines.push(section(`MOLIGO 2${data.moligo2Name ? ` - ${data.moligo2Name}` : ''}`));
    lines.push(data.moligo2Seq);

    if (data.tagSeq) {
        lines.push(section('TAG'));
        lines.push(data.tagSeq);
        if (data.tagReg != null) {
            lines.push(`No.: ${data.tagReg}${data.tagPartNumber ? ` (${data.tagPartNumber})` : ''}`);
        }
    }

    if (data.fwdPrimer || data.revPrimer) {
        lines.push(section('UNIVERSAL PRIMERS'));
        if (data.fwdPrimer) {
            lines.push('Forward Primer:');
            lines.push(data.fwdPrimer);
            lines.push('Forward Primer (reverse complement):');
            lines.push(reverseComplement(data.fwdPrimer));
        }
        if (data.revPrimer) {
            lines.push('Reverse Primer:');
            lines.push(data.revPrimer);
        }
    }

    lines.push(section('FLANKING PRIMERS'));
    if (data.flankingFwdSeq) {
        lines.push(`${data.flankingFwdName || 'Forward Flanking Primer'}:`);
        lines.push(data.flankingFwdSeq);
    }
    if (data.flankingRevSeq) {
        lines.push(`${data.flankingRevName || 'Reverse Flanking Primer'}:`);
        lines.push(data.flankingRevSeq);
    }
    if (!data.flankingFwdSeq && !data.flankingRevSeq) {
        lines.push('No flanking primers designed yet.');
    }

    lines.push(section('FINAL ORDER SEQUENCES'));
    const fwdRC = data.fwdPrimer ? reverseComplement(data.fwdPrimer) : '';
    const fullOligo2 = (data.revPrimer || '') + data.moligo2Seq;
    const fullOligo1 = data.moligo1Seq + (data.tagSeq?.toLowerCase() || '') + fwdRC;
    lines.push('Oligo 2 (RevP + M2):');
    lines.push(fullOligo2);
    lines.push('Oligo 1 (M1 + TAG + RC-FwdP):');
    lines.push(fullOligo1);

    lines.push('\n--- End of Report ---\n');

    return lines.join('\n');
};
