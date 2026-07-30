// Oligool session save / load.
//
// A session captures everything needed to resume work without re-running the
// (slow) BLAST + MAFFT pipeline: the search inputs, the BLAST hits, the MSA
// alignment, and — most importantly — the designed oligos, their pinned
// positions, and the flanking-primer work: the MSA highlight selection plus the
// full FlankingPrimersPanel state (designed candidates, the primers the user
// clicked "Use" on, their names, design parameters, manual regions, and any
// IDT structural analysis already fetched). Credentials are intentionally NOT
// included (they live in localStorage and are machine-local / sensitive).

export const OLIGOOL_SESSION_APP = 'oligool';
export const OLIGOOL_SESSION_VERSION = 1;

export interface BlastHit {
    accession: string;
    description: string;
    evalue: number;
    identity: number;
    query_cover: number;
    sstart?: number;
    send?: number;
    rank?: number;
}

export interface BlastMeta {
    rid: string;
    rtoe: number;
    query_len: number;
}

/** Absolute (1-indexed, gapped-column) coordinates locking the current oligo pair. */
export interface FixedAbsCoords {
    p1AbsStart: number; p1AbsEnd: number;
    p2AbsStart: number; p2AbsEnd: number;
    p1Seq: string; p2Seq: string;
    p1Tm: number; p2Tm: number;
    p1TmStrider?: number | null; p2TmStrider?: number | null;
    p1Gc: number; p2Gc: number;
}

/** A pinned ("Saved Position") oligo bookmark. */
export interface SavedPosition {
    id: string;
    label: string;
    createdAt: number;
    p1: { start: number; end: number; seq: string; gc: number; tm: number; tm_strider?: number | null };
    p2: { start: number; end: number; seq: string; gc: number; tm: number; tm_strider?: number | null };
    p1AbsStart: number; p1AbsEnd: number;
    p2AbsStart: number; p2AbsEnd: number;
    moligo1Shift: number; moligo2Shift: number;
    moligo1Len: number; moligo2Len: number;
    notes?: string;
    color?: string;
}

export const PIN_COLORS: { name: string; value: string }[] = [
    { name: 'slate', value: '#64748b' },
    { name: 'blue', value: '#3b82f6' },
    { name: 'emerald', value: '#10b981' },
    { name: 'amber', value: '#f59e0b' },
    { name: 'rose', value: '#f43f5e' },
    { name: 'violet', value: '#8b5cf6' },
];

/** Everything QueryViewer owns that should round-trip through a saved session. */
export interface OligoSnapshot {
    moligo1Shift: number;
    moligo2Shift: number;
    moligo1Len: number;
    moligo2Len: number;
    oligo1Name: string;
    oligo2Name: string;
    searchParams: any;
    advancedParams: any;
    idtAdvancedParams: any;
    tagSeq: string;
    fwdPrimer: string;
    revPrimer: string;
    savedPositions: SavedPosition[];
    interactiveFlankWindow: number;
    showFlankingPrimers: boolean;
    /** The currently designed oligo pair, locked to absolute coordinates. */
    currentOligo: FixedAbsCoords | null;
}

export interface FlankingPrimerSelection {
    fwd: { start: number; end: number } | null;
    rev: { start: number; end: number } | null;
    fwdName?: string;
    revName?: string;
    fwdSeq?: string;
    revSeq?: string;
    amplicon?: number;
}

/** A flanking-primer candidate as produced by the design pipeline (Primer3 or manual). */
export interface FlankingDesignedPrimer {
    sequence: string;
    length: number;
    gc_percent: number;
    tm: number | null;
    tm_strider: number | null;
    hairpin: { structure_found: boolean; tm: number | null; dg: number | null };
    homodimer: { structure_found: boolean; tm: number | null; dg: number | null };
    primer3: { tm: number | null; gc_percent: number | null; self_any: number | null; self_end: number | null; hairpin_th: number | null };
    interval?: [number, number];
    name?: string;
}

export interface FlankingDesignResult {
    forward: { num_returned: number; primers: FlankingDesignedPrimer[]; explain: string };
    reverse: { num_returned: number; primers: FlankingDesignedPrimer[]; explain: string };
    pair_metrics: { heterodimer: { structure_found: boolean; tm: number | null; dg: number | null } } | null;
}

/** Durable FlankingPrimersPanel state: everything needed to reopen the panel exactly as left. */
export interface FlankingPanelState {
    params: {
        flankWindow: number;
        optSize: number; minSize: number; maxSize: number;
        optTm: number; minTm: number; maxTm: number;
        minGc: number; maxGc: number;
        numReturn: number;
        mvConc: number; dvConc: number; dntpConc: number; dnaConc: number;
    };
    showAdv: boolean;
    manual: {
        leftStart: number | null; leftEnd: number | null;
        rightStart: number | null; rightEnd: number | null;
    };
    result: FlankingDesignResult | null;
    /** The candidates the user clicked "Use" on (null when unused). */
    selFwd: FlankingDesignedPrimer | null;
    selRev: FlankingDesignedPrimer | null;
    fwdName: string;
    revName: string;
    /** Cached per-primer IDT structural analysis, keyed by sequence (API payloads). */
    idtResultsIndiv?: Record<string, unknown>;
    /** IDT pair (heterodimer/product) analysis for the selected fwd+rev pair. */
    pairIdtResults?: unknown;
}

/** Snapshot of the visible query sequence window shown in the MSA viewer. */
export interface SelectedSequence {
    id: string;
    seq: string;
    start: number;
    end: number;
    fullSeq?: string;
    ungappedOffset?: number;
}

/** MSA viewer viewport state so save/load restores the exact scroll/zoom the user left. */
export interface MsaViewport {
    scrollLeft: number;
    scrollTop: number;
    viewFraction: number;
    viewMode: 'bars' | 'letters';
}

export interface OligoolSession {
    app: typeof OLIGOOL_SESSION_APP;
    version: number;
    savedAt: string;
    jobName: string;
    search: {
        input: string;
        genbankHeader?: string;
        organism: string;
        eValue: string;
        percIdentity: string;
        filterMatches: boolean;
        maxHitsPreset: string;
        customHits: string;
    };
    results: {
        blastHits: BlastHit[];
        filteredHits: BlastHit[];
        blastMeta: BlastMeta | null;
        showMatches: boolean;
        alignment: string;
        autofindSelectedAccessions?: string[];
        autofindTreatIndelsAsMismatches?: boolean;
        selectedSequence?: SelectedSequence;
        msaViewport?: MsaViewport;
    };
    oligo: OligoSnapshot | null;
    flankingPrimers: FlankingPrimerSelection | null;
    flankingPanel?: FlankingPanelState | null;
}

/** Build a filesystem-safe filename like `My_Gene_20260611.oligool.json`. */
export function buildSessionFilename(jobName: string): string {
    const safe = (jobName || 'oligool')
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'oligool';
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    return `${safe}_${stamp}.oligool.json`;
}

/** Trigger a browser download of the session as a pretty-printed JSON file. */
export function downloadSession(session: OligoolSession): void {
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildSessionFilename(session.jobName);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const DEFAULT_SEARCH = {
    input: '',
    genbankHeader: '',
    organism: '',
    eValue: '0.05',
    percIdentity: '0',
    filterMatches: false,
    maxHitsPreset: '50',
    customHits: '',
};

const DEFAULT_RESULTS = {
    blastHits: [] as BlastHit[],
    filteredHits: [] as BlastHit[],
    blastMeta: null as BlastMeta | null,
    showMatches: false,
    alignment: '',
    autofindSelectedAccessions: [] as string[],
    autofindTreatIndelsAsMismatches: false,
};

function normalizePrimer(primer: unknown): SavedPosition['p1'] {
    const p = primer && typeof primer === 'object' ? primer as Record<string, unknown> : {};
    return {
        start: typeof p.start === 'number' ? p.start : 0,
        end: typeof p.end === 'number' ? p.end : 0,
        seq: typeof p.seq === 'string' ? p.seq : '',
        gc: typeof p.gc === 'number' ? p.gc : 0,
        tm: typeof p.tm === 'number' ? p.tm : 0,
        tm_strider: typeof p.tm_strider === 'number' ? p.tm_strider : null,
    };
}

function normalizeSavedPosition(pos: Partial<SavedPosition>): SavedPosition {
    return {
        id: typeof pos.id === 'string' ? pos.id : `pin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: typeof pos.label === 'string' ? pos.label : 'Position',
        createdAt: typeof pos.createdAt === 'number' ? pos.createdAt : Date.now(),
        p1: normalizePrimer(pos.p1),
        p2: normalizePrimer(pos.p2),
        p1AbsStart: typeof pos.p1AbsStart === 'number' ? pos.p1AbsStart : 0,
        p1AbsEnd: typeof pos.p1AbsEnd === 'number' ? pos.p1AbsEnd : 0,
        p2AbsStart: typeof pos.p2AbsStart === 'number' ? pos.p2AbsStart : 0,
        p2AbsEnd: typeof pos.p2AbsEnd === 'number' ? pos.p2AbsEnd : 0,
        moligo1Shift: typeof pos.moligo1Shift === 'number' ? pos.moligo1Shift : 0,
        moligo2Shift: typeof pos.moligo2Shift === 'number' ? pos.moligo2Shift : 0,
        moligo1Len: typeof pos.moligo1Len === 'number' ? pos.moligo1Len : 0,
        moligo2Len: typeof pos.moligo2Len === 'number' ? pos.moligo2Len : 0,
        notes: typeof pos.notes === 'string' ? pos.notes : '',
        color: typeof pos.color === 'string' ? pos.color : 'slate',
    };
}

export const FLANKING_PANEL_DEFAULTS: FlankingPanelState = {
    params: {
        flankWindow: 200,
        optSize: 20, minSize: 16, maxSize: 27,
        optTm: 62.0, minTm: 57.0, maxTm: 67.0,
        minGc: 20.0, maxGc: 80.0,
        numReturn: 5,
        mvConc: 50.0, dvConc: 3, dntpConc: 0.8, dnaConc: 200.0,
    },
    showAdv: false,
    manual: { leftStart: null, leftEnd: null, rightStart: null, rightEnd: null },
    result: null,
    selFwd: null,
    selRev: null,
    fwdName: '',
    revName: '',
    idtResultsIndiv: {},
    pairIdtResults: null,
};

function normalizeFlankingPrimer(primer: unknown): FlankingDesignedPrimer | null {
    if (!primer || typeof primer !== 'object') return null;
    const q = primer as Partial<FlankingDesignedPrimer>;
    if (typeof q.sequence !== 'string' || !q.sequence) return null;
    return {
        sequence: q.sequence,
        length: typeof q.length === 'number' ? q.length : q.sequence.length,
        gc_percent: typeof q.gc_percent === 'number' ? q.gc_percent : 0,
        tm: typeof q.tm === 'number' ? q.tm : null,
        tm_strider: typeof q.tm_strider === 'number' ? q.tm_strider : null,
        hairpin: q.hairpin && typeof q.hairpin === 'object' ? q.hairpin : { structure_found: false, tm: null, dg: null },
        homodimer: q.homodimer && typeof q.homodimer === 'object' ? q.homodimer : { structure_found: false, tm: null, dg: null },
        primer3: q.primer3 && typeof q.primer3 === 'object' ? q.primer3 : { tm: null, gc_percent: null, self_any: null, self_end: null, hairpin_th: null },
        interval: Array.isArray(q.interval) && q.interval.length === 2 && q.interval.every((n) => typeof n === 'number')
            ? [q.interval[0], q.interval[1]]
            : undefined,
        name: typeof q.name === 'string' ? q.name : undefined,
    };
}

function normalizeFlankingPanel(panel: unknown): FlankingPanelState | null {
    if (!panel || typeof panel !== 'object') return null;
    const p = panel as Record<string, unknown>;
    const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
    const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const params = (p.params && typeof p.params === 'object' ? p.params : {}) as Record<string, unknown>;
    const manual = (p.manual && typeof p.manual === 'object' ? p.manual : {}) as Record<string, unknown>;
    const d = FLANKING_PANEL_DEFAULTS.params;
    return {
        params: {
            flankWindow: num(params.flankWindow, d.flankWindow),
            optSize: num(params.optSize, d.optSize),
            minSize: num(params.minSize, d.minSize),
            maxSize: num(params.maxSize, d.maxSize),
            optTm: num(params.optTm, d.optTm),
            minTm: num(params.minTm, d.minTm),
            maxTm: num(params.maxTm, d.maxTm),
            minGc: num(params.minGc, d.minGc),
            maxGc: num(params.maxGc, d.maxGc),
            numReturn: num(params.numReturn, d.numReturn),
            mvConc: num(params.mvConc, d.mvConc),
            dvConc: num(params.dvConc, d.dvConc),
            dntpConc: num(params.dntpConc, d.dntpConc),
            dnaConc: num(params.dnaConc, d.dnaConc),
        },
        showAdv: typeof p.showAdv === 'boolean' ? p.showAdv : FLANKING_PANEL_DEFAULTS.showAdv,
        manual: {
            leftStart: numOrNull(manual.leftStart),
            leftEnd: numOrNull(manual.leftEnd),
            rightStart: numOrNull(manual.rightStart),
            rightEnd: numOrNull(manual.rightEnd),
        },
        result: (p.result && typeof p.result === 'object' ? p.result : null) as FlankingDesignResult | null,
        selFwd: normalizeFlankingPrimer(p.selFwd),
        selRev: normalizeFlankingPrimer(p.selRev),
        fwdName: typeof p.fwdName === 'string' ? p.fwdName : '',
        revName: typeof p.revName === 'string' ? p.revName : '',
        idtResultsIndiv: p.idtResultsIndiv && typeof p.idtResultsIndiv === 'object'
            ? p.idtResultsIndiv as Record<string, unknown>
            : {},
        pairIdtResults: p.pairIdtResults ?? null,
    };
}

function normalizeBlastMeta(meta: unknown): BlastMeta | null {
    if (!meta || typeof meta !== 'object') return null;
    const m = meta as Record<string, unknown>;
    return {
        rid: typeof m.rid === 'string' ? m.rid : '',
        rtoe: typeof m.rtoe === 'number' ? m.rtoe : 0,
        query_len: typeof m.query_len === 'number' ? m.query_len : 0,
    };
}

function normalizeOligoSnapshot(oligo: unknown): OligoSnapshot | null {
    if (!oligo || typeof oligo !== 'object') return null;
    const o = oligo as Record<string, unknown>;
    const rawPositions = Array.isArray(o.savedPositions) ? o.savedPositions : [];
    return {
        moligo1Shift: typeof o.moligo1Shift === 'number' ? o.moligo1Shift : 0,
        moligo2Shift: typeof o.moligo2Shift === 'number' ? o.moligo2Shift : 0,
        moligo1Len: typeof o.moligo1Len === 'number' ? o.moligo1Len : 0,
        moligo2Len: typeof o.moligo2Len === 'number' ? o.moligo2Len : 0,
        oligo1Name: typeof o.oligo1Name === 'string' ? o.oligo1Name : '',
        oligo2Name: typeof o.oligo2Name === 'string' ? o.oligo2Name : '',
        searchParams: o.searchParams ?? {},
        advancedParams: o.advancedParams ?? {},
        idtAdvancedParams: o.idtAdvancedParams ?? {},
        tagSeq: typeof o.tagSeq === 'string' ? o.tagSeq : '',
        fwdPrimer: typeof o.fwdPrimer === 'string' ? o.fwdPrimer : '',
        revPrimer: typeof o.revPrimer === 'string' ? o.revPrimer : '',
        savedPositions: rawPositions.map(normalizeSavedPosition),
        interactiveFlankWindow: typeof o.interactiveFlankWindow === 'number' ? o.interactiveFlankWindow : 200,
        showFlankingPrimers: typeof o.showFlankingPrimers === 'boolean' ? o.showFlankingPrimers : false,
        currentOligo: o.currentOligo && typeof o.currentOligo === 'object' ? (o.currentOligo as FixedAbsCoords) : null,
    };
}

/** Migrate an older session object to the current schema. Missing fields are filled with safe defaults. */
export function migrateSession(data: unknown): OligoolSession {
    if (!data || typeof data !== 'object') {
        throw new Error('This file is not an Oligool session.');
    }
    const d = data as Record<string, unknown>;
    if (d.app !== OLIGOOL_SESSION_APP) {
        throw new Error('This file is not an Oligool session.');
    }
    if (typeof d.version !== 'number' || d.version > OLIGOOL_SESSION_VERSION) {
        throw new Error(`Unsupported session version (${d.version}). Please update Oligool.`);
    }

    const search = d.search && typeof d.search === 'object' ? d.search as Record<string, unknown> : {};
    const results = d.results && typeof d.results === 'object' ? d.results as Record<string, unknown> : {};

    const session: OligoolSession = {
        app: OLIGOOL_SESSION_APP,
        version: OLIGOOL_SESSION_VERSION,
        savedAt: typeof d.savedAt === 'string' ? d.savedAt : new Date().toISOString(),
        jobName: typeof d.jobName === 'string' ? d.jobName : 'oligool',
        search: {
            input: typeof search.input === 'string' ? search.input : DEFAULT_SEARCH.input,
            genbankHeader: typeof search.genbankHeader === 'string' ? search.genbankHeader : DEFAULT_SEARCH.genbankHeader,
            organism: typeof search.organism === 'string' ? search.organism : DEFAULT_SEARCH.organism,
            eValue: typeof search.eValue === 'string' ? search.eValue : DEFAULT_SEARCH.eValue,
            percIdentity: typeof search.percIdentity === 'string' ? search.percIdentity : DEFAULT_SEARCH.percIdentity,
            filterMatches: typeof search.filterMatches === 'boolean' ? search.filterMatches : DEFAULT_SEARCH.filterMatches,
            maxHitsPreset: typeof search.maxHitsPreset === 'string' ? search.maxHitsPreset : DEFAULT_SEARCH.maxHitsPreset,
            customHits: typeof search.customHits === 'string' ? search.customHits : DEFAULT_SEARCH.customHits,
        },
        results: {
            blastHits: Array.isArray(results.blastHits) ? results.blastHits as BlastHit[] : DEFAULT_RESULTS.blastHits,
            filteredHits: Array.isArray(results.filteredHits) ? results.filteredHits as BlastHit[] : DEFAULT_RESULTS.filteredHits,
            blastMeta: normalizeBlastMeta(results.blastMeta),
            showMatches: typeof results.showMatches === 'boolean' ? results.showMatches : DEFAULT_RESULTS.showMatches,
            alignment: typeof results.alignment === 'string' ? results.alignment : DEFAULT_RESULTS.alignment,
            autofindSelectedAccessions: Array.isArray(results.autofindSelectedAccessions)
                ? results.autofindSelectedAccessions as string[]
                : DEFAULT_RESULTS.autofindSelectedAccessions,
            autofindTreatIndelsAsMismatches: typeof results.autofindTreatIndelsAsMismatches === 'boolean'
                ? results.autofindTreatIndelsAsMismatches
                : DEFAULT_RESULTS.autofindTreatIndelsAsMismatches,
            selectedSequence: results.selectedSequence && typeof results.selectedSequence === 'object'
                ? results.selectedSequence as SelectedSequence
                : undefined,
            msaViewport: results.msaViewport && typeof results.msaViewport === 'object'
                ? (results.msaViewport as MsaViewport)
                : undefined,
        },
        oligo: normalizeOligoSnapshot(d.oligo),
        flankingPrimers: d.flankingPrimers && typeof d.flankingPrimers === 'object' ? d.flankingPrimers as FlankingPrimerSelection : null,
        flankingPanel: normalizeFlankingPanel(d.flankingPanel),
    };

    if (!session.results.alignment) {
        throw new Error('Session file is missing its alignment — nothing to restore.');
    }

    return session;
}

/** Parse and validate a session file's text. Throws a user-facing Error on problems. */
export function parseSessionText(text: string): OligoolSession {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('Not a valid JSON file.');
    }
    return migrateSession(data);
}

function escapeField(value: string, delimiter: string): string {
    if (value.includes(delimiter) || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

function buildPositionsTSV(positions: SavedPosition[], delimiter: ',' | '\t'): string {
    const headers = ['label', 'color', 'notes', 'p1_seq', 'p1_abs_start', 'p1_abs_end', 'p1_gc', 'p1_tm', 'p2_seq', 'p2_abs_start', 'p2_abs_end', 'p2_gc', 'p2_tm'];
    const rows = positions.map((pos) => [
        pos.label,
        pos.color || 'slate',
        pos.notes || '',
        pos.p1.seq,
        String(pos.p1AbsStart),
        String(pos.p1AbsEnd),
        pos.p1.gc.toFixed(1),
        pos.p1.tm.toFixed(1),
        pos.p2.seq,
        String(pos.p2AbsStart),
        String(pos.p2AbsEnd),
        pos.p2.gc.toFixed(1),
        pos.p2.tm.toFixed(1),
    ]);
    return [headers, ...rows]
        .map((row) => row.map((cell) => escapeField(cell, delimiter)).join(delimiter))
        .join('\n');
}

export function exportPositionsCSV(positions: SavedPosition[], jobName: string): void {
    const content = buildPositionsTSV(positions, ',');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${buildSessionFilename(jobName).replace('.oligool.json', '')}_positions.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportPositionsTSV(positions: SavedPosition[], jobName: string): void {
    const content = buildPositionsTSV(positions, '\t');
    const blob = new Blob([content], { type: 'text/tab-separated-values;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${buildSessionFilename(jobName).replace('.oligool.json', '')}_positions.tsv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
