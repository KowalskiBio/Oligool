export interface AnchorGrid {
  readonly anchorLen: number
  readonly anchorCols: number[]
}

export interface InsertEntry {
  readonly row: number
  readonly boundary: number
  readonly text: string
}

export function buildAnchorGrid(querySeq: string): AnchorGrid {
  const anchorCols: number[] = []
  for (let i = 0; i < querySeq.length; i++) {
    if (querySeq[i] !== '-') anchorCols.push(i)
  }
  return { anchorLen: anchorCols.length, anchorCols }
}

export function firstAnchorAtOrAfter(anchorCols: readonly number[], gappedCol: number): number {
  let lo = 0
  let hi = anchorCols.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (anchorCols[mid] < gappedCol) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function lastAnchorAtOrBefore(anchorCols: readonly number[], gappedCol: number): number {
  let lo = -1
  let hi = anchorCols.length - 1
  while (lo < hi) {
    const mid = ((lo + hi) + 1) >>> 1
    if (anchorCols[mid] <= gappedCol) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function gappedRangeToAnchor(
  anchorCols: readonly number[],
  start: number,
  end: number,
): { start: number; end: number } {
  return {
    start: firstAnchorAtOrAfter(anchorCols, start),
    end: firstAnchorAtOrAfter(anchorCols, end),
  }
}

export function buildInsertRuns(
  sequences: readonly { readonly seq: string }[],
  grid: AnchorGrid,
): InsertEntry[] {
  const { anchorCols, anchorLen } = grid
  if (anchorLen === 0 || sequences.length < 2) return []

  const querySeq = sequences[0].seq
  const queryLen = querySeq.length
  const entries: InsertEntry[] = []

  for (let row = 1; row < sequences.length; row++) {
    const hitSeq = sequences[row].seq
    let runStart = -1

    for (let col = 0; col <= queryLen; col++) {
      const isInsertCol = col < queryLen && querySeq[col] === '-'
      if (isInsertCol) {
        if (runStart === -1) runStart = col
      } else if (runStart !== -1) {
        let text = ''
        for (let c = runStart; c < col; c++) {
          const ch = hitSeq[c]
          if (ch && ch !== '-') text += ch.toUpperCase()
        }
        if (text.length > 0) {
          const boundary = firstAnchorAtOrAfter(anchorCols, runStart)
          entries.push({ row, boundary, text })
        }
        runStart = -1
      }
    }
  }

  entries.sort((a, b) => a.boundary - b.boundary || a.row - b.row)
  return entries
}

export function groupInsertsByRow(entries: readonly InsertEntry[]): Map<number, InsertEntry[]> {
  const map = new Map<number, InsertEntry[]>()
  for (const e of entries) {
    let list = map.get(e.row)
    if (!list) {
      list = []
      map.set(e.row, list)
    }
    list.push(e)
  }
  return map
}
