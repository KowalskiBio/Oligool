import { describe, expect, it } from 'vitest'
import {
  buildAnchorGrid,
  firstAnchorAtOrAfter,
  lastAnchorAtOrBefore,
  gappedRangeToAnchor,
  buildInsertRuns,
  groupInsertsByRow,
} from './anchorGrid'

describe('buildAnchorGrid', () => {
  it('returns identity for ungapped query', () => {
    expect(buildAnchorGrid('ACGT')).toEqual({ anchorLen: 4, anchorCols: [0, 1, 2, 3] })
  })

  it('skips leading and trailing gaps', () => {
    expect(buildAnchorGrid('--AC--GT--')).toEqual({ anchorLen: 4, anchorCols: [2, 3, 6, 7] })
  })

  it('skips internal gap runs', () => {
    expect(buildAnchorGrid('AC--GT')).toEqual({ anchorLen: 4, anchorCols: [0, 1, 4, 5] })
  })

  it('returns empty for all-gap query', () => {
    expect(buildAnchorGrid('----')).toEqual({ anchorLen: 0, anchorCols: [] })
  })

  it('handles single base', () => {
    expect(buildAnchorGrid('A')).toEqual({ anchorLen: 1, anchorCols: [0] })
  })

  it('handles empty query', () => {
    expect(buildAnchorGrid('')).toEqual({ anchorLen: 0, anchorCols: [] })
  })
})

describe('firstAnchorAtOrAfter', () => {
  const cols = [0, 1, 4, 5] // query "AC--GT"

  it('returns the anchor at exact position', () => {
    expect(firstAnchorAtOrAfter(cols, 4)).toBe(2)
  })

  it('returns the next anchor when inside an insert run', () => {
    expect(firstAnchorAtOrAfter(cols, 2)).toBe(2)
  })

  it('returns 0 for col before first anchor', () => {
    expect(firstAnchorAtOrAfter(cols, -1)).toBe(0)
  })

  it('returns anchorLen for col after last anchor', () => {
    expect(firstAnchorAtOrAfter(cols, 99)).toBe(4)
  })
})

describe('lastAnchorAtOrBefore', () => {
  const cols = [0, 1, 4, 5] // query "AC--GT"

  it('returns the anchor at exact position', () => {
    expect(lastAnchorAtOrBefore(cols, 4)).toBe(2)
  })

  it('returns the previous anchor when inside an insert run', () => {
    expect(lastAnchorAtOrBefore(cols, 2)).toBe(1)
  })

  it('returns -1 for col before first anchor', () => {
    expect(lastAnchorAtOrBefore(cols, -1)).toBe(-1)
  })

  it('returns last anchor for col after last anchor', () => {
    expect(lastAnchorAtOrBefore(cols, 99)).toBe(3)
  })
})

describe('gappedRangeToAnchor', () => {
  const cols = [0, 1, 4, 5] // query "AC--GT"

  it('converts exact half-open range', () => {
    expect(gappedRangeToAnchor(cols, 0, 5)).toEqual({ start: 0, end: 3 })
  })

  it('converts range ending inside an insert run', () => {
    expect(gappedRangeToAnchor(cols, 0, 3)).toEqual({ start: 0, end: 2 })
  })
})

describe('buildInsertRuns', () => {
  it('returns empty when query has no gaps', () => {
    const grid = buildAnchorGrid('ACGT')
    const seqs = [{ seq: 'ACGT' }, { seq: 'ACGT' }]
    expect(buildInsertRuns(seqs, grid)).toEqual([])
  })

  it('detects single-base insert in a hit', () => {
    const grid = buildAnchorGrid('AC-GT')
    const seqs = [{ seq: 'AC-GT' }, { seq: 'ACTGT' }]
    expect(buildInsertRuns(seqs, grid)).toEqual([
      { row: 1, boundary: 2, text: 'T' },
    ])
  })

  it('detects multi-base insert run', () => {
    const grid = buildAnchorGrid('A---T')
    const seqs = [{ seq: 'A---T' }, { seq: 'AGGGT' }]
    expect(buildInsertRuns(seqs, grid)).toEqual([
      { row: 1, boundary: 1, text: 'GGG' },
    ])
  })

  it('filters out hit dashes inside insert runs', () => {
    const grid = buildAnchorGrid('A---T')
    const seqs = [{ seq: 'A---T' }, { seq: 'A-G-T' }]
    expect(buildInsertRuns(seqs, grid)).toEqual([
      { row: 1, boundary: 1, text: 'G' },
    ])
  })

  it('skips entries when hit has no bases in insert run', () => {
    const grid = buildAnchorGrid('AC--GT')
    const seqs = [{ seq: 'AC--GT' }, { seq: 'AC--GT' }]
    expect(buildInsertRuns(seqs, grid)).toEqual([])
  })

  it('handles leading insert run', () => {
    const grid = buildAnchorGrid('--AC')
    const seqs = [{ seq: '--AC' }, { seq: 'TTAC' }]
    expect(buildInsertRuns(seqs, grid)).toEqual([
      { row: 1, boundary: 0, text: 'TT' },
    ])
  })

  it('handles trailing insert run', () => {
    const grid = buildAnchorGrid('AC--')
    const seqs = [{ seq: 'AC--' }, { seq: 'ACGT' }]
    expect(buildInsertRuns(seqs, grid)).toEqual([
      { row: 1, boundary: 2, text: 'GT' },
    ])
  })

  it('sorts entries by (boundary, row)', () => {
    const grid = buildAnchorGrid('A--C--G')
    const seqs = [
      { seq: 'A--C--G' },
      { seq: 'AXXCYYG' },
      { seq: 'AUUCUUG' },
    ]
    const result = buildInsertRuns(seqs, grid)
    expect(result).toEqual([
      { row: 1, boundary: 1, text: 'XX' },
      { row: 2, boundary: 1, text: 'UU' },
      { row: 1, boundary: 2, text: 'YY' },
      { row: 2, boundary: 2, text: 'UU' },
    ])
  })
})

describe('groupInsertsByRow', () => {
  it('groups entries by row', () => {
    const entries = [
      { row: 1, boundary: 1, text: 'A' },
      { row: 2, boundary: 1, text: 'T' },
      { row: 1, boundary: 3, text: 'GC' },
    ]
    const map = groupInsertsByRow(entries)
    expect(map.get(1)).toEqual([
      { row: 1, boundary: 1, text: 'A' },
      { row: 1, boundary: 3, text: 'GC' },
    ])
    expect(map.get(2)).toEqual([{ row: 2, boundary: 1, text: 'T' }])
    expect(map.has(3)).toBe(false)
  })

  it('returns empty map for empty input', () => {
    expect(groupInsertsByRow([]).size).toBe(0)
  })
})
