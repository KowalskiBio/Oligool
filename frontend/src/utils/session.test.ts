import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  OLIGOOL_SESSION_APP,
  OLIGOOL_SESSION_VERSION,
  type SavedPosition,
  buildSessionFilename,
  migrateSession,
  parseSessionText,
  exportPositionsCSV,
  exportPositionsTSV,
} from './session'

describe('buildSessionFilename', () => {
  it('uses the job name and current date', () => {
    const name = buildSessionFilename('My Gene')
    expect(name).toMatch(/^My_Gene_\d{8}\.oligool\.json$/)
  })

  it('sanitizes special characters', () => {
    const name = buildSessionFilename('Gene: ABC/123 (test)')
    expect(name).toMatch(/^Gene_ABC_123_test_\d{8}\.oligool\.json$/)
  })

  it('falls back to oligool for empty names', () => {
    const name = buildSessionFilename('   ')
    expect(name).toMatch(/^oligool_\d{8}\.oligool\.json$/)
  })
})

describe('migrateSession', () => {
  const baseSession = {
    app: OLIGOOL_SESSION_APP,
    version: 1,
    savedAt: '2026-01-01T00:00:00.000Z',
    jobName: 'Test',
    search: {
      input: 'ATCG',
      organism: 'Homo sapiens',
      eValue: '0.05',
      percIdentity: '90',
      filterMatches: true,
      maxHitsPreset: '50',
      customHits: '',
    },
    results: {
      blastHits: [],
      filteredHits: [],
      blastMeta: null,
      showMatches: false,
      alignment: '>Query\nATCG',
      autofindSelectedAccessions: [],
    },
    oligo: null,
    flankingPrimers: null,
  }

  it('accepts a valid current session', () => {
    const migrated = migrateSession(baseSession)
    expect(migrated.app).toBe(OLIGOOL_SESSION_APP)
    expect(migrated.version).toBe(OLIGOOL_SESSION_VERSION)
    expect(migrated.results.alignment).toBe('>Query\nATCG')
  })

  it('rejects non-objects', () => {
    expect(() => migrateSession('not an object')).toThrow('not an Oligool session')
  })

  it('rejects sessions from other apps', () => {
    expect(() => migrateSession({ app: 'other', version: 1, results: { alignment: 'A' } })).toThrow('not an Oligool session')
  })

  it('rejects sessions newer than supported', () => {
    expect(() => migrateSession({ ...baseSession, version: 999 })).toThrow('Unsupported session version')
  })

  it('rejects sessions missing alignment', () => {
    expect(() => migrateSession({ ...baseSession, results: { ...baseSession.results, alignment: '' } })).toThrow('missing its alignment')
  })

  it('migrates an older session without notes and color fields', () => {
    const legacyPosition: Partial<SavedPosition> = {
      id: 'pin-1',
      label: 'Legacy',
      createdAt: 123,
      p1: { start: 1, end: 20, seq: 'ATCG', gc: 50, tm: 60 },
      p2: { start: 30, end: 50, seq: 'GCTA', gc: 50, tm: 60 },
      p1AbsStart: 1,
      p1AbsEnd: 20,
      p2AbsStart: 30,
      p2AbsEnd: 50,
      moligo1Shift: 0,
      moligo2Shift: 0,
      moligo1Len: 20,
      moligo2Len: 21,
    }
    const legacy = {
      ...baseSession,
      version: 0,
      oligo: {
        moligo1Shift: 0,
        moligo2Shift: 0,
        moligo1Len: 20,
        moligo2Len: 21,
        oligo1Name: 'O1',
        oligo2Name: 'O2',
        searchParams: {},
        advancedParams: {},
        idtAdvancedParams: {},
        tagSeq: '',
        fwdPrimer: '',
        revPrimer: '',
        savedPositions: [legacyPosition],
        interactiveFlankWindow: 200,
        showFlankingPrimers: false,
        currentOligo: null,
      },
    }
    const migrated = migrateSession(legacy)
    const pos = migrated.oligo!.savedPositions[0]
    expect(pos.notes).toBe('')
    expect(pos.color).toBe('slate')
  })

  it('fills default search values when missing', () => {
    const minimal = {
      app: OLIGOOL_SESSION_APP,
      version: 1,
      results: { alignment: '>Query\nATCG' },
    }
    const migrated = migrateSession(minimal)
    expect(migrated.search.input).toBe('')
    expect(migrated.search.eValue).toBe('0.05')
    expect(migrated.search.filterMatches).toBe(false)
  })

  it('preserves selectedSequence and msaViewport when present', () => {
    const withViewport = {
      ...baseSession,
      results: {
        ...baseSession.results,
        selectedSequence: { id: 'Query', seq: 'ATCG', start: 0, end: 3, fullSeq: 'ATCG', ungappedOffset: 0 },
        msaViewport: { scrollLeft: 120, scrollTop: 0, viewFraction: 0.25, viewMode: 'letters' },
      },
    }
    const migrated = migrateSession(withViewport)
    expect(migrated.results.selectedSequence).toEqual(withViewport.results.selectedSequence)
    expect(migrated.results.msaViewport).toEqual(withViewport.results.msaViewport)
  })

  it('allows missing selectedSequence and msaViewport', () => {
    const migrated = migrateSession(baseSession)
    expect(migrated.results.selectedSequence).toBeUndefined()
    expect(migrated.results.msaViewport).toBeUndefined()
  })

  it('preserves flanking primer names through migrateSession', () => {
    const withNames = {
      ...baseSession,
      flankingPrimers: {
        fwd: { start: 10, end: 30 },
        rev: { start: 100, end: 120 },
        fwdName: 'Fwd_Left',
        revName: 'Rev_Right',
      },
    }
    const migrated = migrateSession(withNames)
    expect(migrated.flankingPrimers).not.toBeNull()
    expect(migrated.flankingPrimers!.fwd).toEqual({ start: 10, end: 30 })
    expect(migrated.flankingPrimers!.rev).toEqual({ start: 100, end: 120 })
    expect(migrated.flankingPrimers!.fwdName).toBe('Fwd_Left')
    expect(migrated.flankingPrimers!.revName).toBe('Rev_Right')
  })

  it('missing flanking primer names load as undefined', () => {
    const withoutNames = {
      ...baseSession,
      flankingPrimers: {
        fwd: { start: 50, end: 70 },
        rev: null,
      },
    }
    const migrated = migrateSession(withoutNames)
    expect(migrated.flankingPrimers).not.toBeNull()
    expect(migrated.flankingPrimers!.fwd).toEqual({ start: 50, end: 70 })
    expect(migrated.flankingPrimers!.rev).toBeNull()
    expect(migrated.flankingPrimers!.fwdName).toBeUndefined()
    expect(migrated.flankingPrimers!.revName).toBeUndefined()
  })

  it('handles null flankingPrimers in session', () => {
    const migrated = migrateSession(baseSession)
    expect(migrated.flankingPrimers).toBeNull()
  })
})

describe('parseSessionText', () => {
  it('parses valid JSON text', () => {
    const text = JSON.stringify({
      app: OLIGOOL_SESSION_APP,
      version: 1,
      results: { alignment: '>Query\nATCG' },
    })
    const session = parseSessionText(text)
    expect(session.app).toBe(OLIGOOL_SESSION_APP)
  })

  it('throws on invalid JSON', () => {
    expect(() => parseSessionText('not json')).toThrow('Not a valid JSON file')
  })
})

describe('position exports', () => {
  const positions: SavedPosition[] = [
    {
      id: 'p1',
      label: 'Test, "quote"',
      createdAt: 1,
      notes: 'has\nnewline',
      color: 'blue',
      p1: { start: 1, end: 10, seq: 'ATCG', gc: 50.1234, tm: 60.5678 },
      p2: { start: 20, end: 30, seq: 'GCTA', gc: 45.5, tm: 55 },
      p1AbsStart: 1,
      p1AbsEnd: 10,
      p2AbsStart: 20,
      p2AbsEnd: 30,
      moligo1Shift: 0,
      moligo2Shift: 0,
      moligo1Len: 10,
      moligo2Len: 11,
    },
  ]

  let createdUrls: string[] = []

  beforeEach(() => {
    createdUrls = []
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        const url = `blob:${blob.type}:${createdUrls.length}`
        createdUrls.push(url)
        return url
      },
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exports CSV with comma delimiter and quoted fields', () => {
    let capturedBlob: Blob | null = null
    vi.stubGlobal('Blob', class extends Blob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options)
        capturedBlob = this as Blob
      }
    })
    exportPositionsCSV(positions, 'Job')
    expect(createdUrls.length).toBe(1)
    expect(capturedBlob).not.toBeNull()
    expect(capturedBlob!.type).toBe('text/csv;charset=utf-8;')
    vi.unstubAllGlobals()
  })

  it('exports TSV with tab delimiter', () => {
    let capturedParts: BlobPart[] | null = null
    vi.stubGlobal('Blob', class extends Blob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options)
        capturedParts = parts
      }
    })
    exportPositionsTSV(positions, 'Job')
    expect(createdUrls.length).toBe(1)
    expect(capturedParts).not.toBeNull()
    const content = capturedParts![0] as string
    expect(content.startsWith('label\tcolor\tnotes')).toBe(true)
    expect(content.includes('\tblue\t')).toBe(true)
    vi.unstubAllGlobals()
  })
})
