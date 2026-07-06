// Oligool session save / load.
//
// A session captures everything needed to resume work without re-running the
// (slow) BLAST + MAFFT pipeline: the search inputs, the BLAST hits, the MSA
// alignment, and — most importantly — the designed oligos, their pinned
// positions, and the flanking-primer selection. Credentials are intentionally
// NOT included (they live in localStorage and are machine-local / sensitive).

export const OLIGOOL_SESSION_APP = 'oligool';
export const OLIGOOL_SESSION_VERSION = 1;

export interface BlastHit {
    accession: string;
    description: string;
    evalue: number;
    identity: number;
    query_cover: number;
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
    p1Gc: number; p2Gc: number;
}

/** A pinned ("Saved Position") oligo bookmark. */
export interface SavedPosition {
    id: string;
    label: string;
    createdAt: number;
    p1: { start: number; end: number; seq: string; gc: number; tm: number };
    p2: { start: number; end: number; seq: string; gc: number; tm: number };
    p1AbsStart: number; p1AbsEnd: number;
    p2AbsStart: number; p2AbsEnd: number;
    moligo1Shift: number; moligo2Shift: number;
    moligo1Len: number; moligo2Len: number;
}

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
}

export interface OligoolSession {
    app: typeof OLIGOOL_SESSION_APP;
    version: number;
    savedAt: string;
    jobName: string;
    search: {
        input: string;
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
    };
    oligo: OligoSnapshot | null;
    flankingPrimers: FlankingPrimerSelection | null;
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

/** Parse and validate a session file's text. Throws a user-facing Error on problems. */
export function parseSessionText(text: string): OligoolSession {
    let data: any;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('Not a valid JSON file.');
    }
    if (!data || typeof data !== 'object' || data.app !== OLIGOOL_SESSION_APP) {
        throw new Error('This file is not an Oligool session.');
    }
    if (typeof data.version !== 'number' || data.version > OLIGOOL_SESSION_VERSION) {
        throw new Error(`Unsupported session version (${data.version}). Please update Oligool.`);
    }
    if (!data.results || typeof data.results.alignment !== 'string' || !data.results.alignment) {
        throw new Error('Session file is missing its alignment — nothing to restore.');
    }
    return data as OligoolSession;
}
