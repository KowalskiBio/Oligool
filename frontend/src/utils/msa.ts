export interface CleanRegion {
  readonly start: number
  readonly end: number
  readonly length: number
}

export interface Sequence {
  readonly id: string
  readonly seq: string
  readonly accession?: string
}

export const MIN_CLEAN_REGION_BP = 100

/**
 * Computes column indices where non-query sequences differ from the query sequence.
 * 
 * @param sequences - Aligned sequences; the first entry is the query.
 * @param selectedAccessions - Optional set of accession strings to filter non-query sequences.
 *   If undefined/null, all non-query sequences are included (backward compatible).
 * @param treatIndelsAsMismatches - When true, gaps in non-query sequences (deletions)
 *   and non-gap characters where the query is gapped (insertions) are treated as mismatches.
 *   Default false preserves the original gap-ignoring behavior.
 * @returns Set of column indices where selected non-query sequences differ from the query.
 */
export function computeMismatchCols(
  sequences: readonly Sequence[],
  selectedAccessions?: ReadonlySet<string>,
  treatIndelsAsMismatches = false,
): Set<number> {
  const set = new Set<number>();
  if (sequences.length < 2 || sequences[0].seq.length === 0) return set;
  
  const querySeq = sequences[0].seq;
  const seqLen = querySeq.length;
  
  for (let col = 0; col < seqLen; col++) {
    const qch = (querySeq[col] || '-').toUpperCase();
    const queryIsGap = qch === '-';
    if (queryIsGap && !treatIndelsAsMismatches) continue;
    
    for (let row = 1; row < sequences.length; row++) {
      // Skip rows based on accession filtering
      if (selectedAccessions) {
        const seqAccessions = sequences[row].accession;
        if (!seqAccessions || !selectedAccessions.has(seqAccessions)) {
          continue;
        }
      }
      
      const ch = (sequences[row].seq[col] || '-').toUpperCase();
      if (queryIsGap) {
        // Insertion in the non-query sequence: query is gapped but the hit is not.
        if (ch !== '-') {
          set.add(col);
          break;
        }
      } else if (ch === '-') {
        // Deletion in the non-query sequence.
        if (treatIndelsAsMismatches) {
          set.add(col);
          break;
        }
      } else if (ch !== qch) {
        set.add(col);
        break;
      }
    }
  }
  
  return set;
}

/**
 * Finds contiguous columns where the query sequence has a non-gap base and
 * none of the aligned sequences contributes a mismatch.
 *
 * @param sequences - Aligned sequences; the first entry is the query.
 * @param mismatchCols - Set of column indices that contain at least one mismatch
 *   against the query (ignoring gaps).
 * @returns Clean regions of at least {@link MIN_CLEAN_REGION_BP} bp, sorted longest-first.
 */
export function findCleanRegions(
  sequences: readonly Sequence[],
  mismatchCols: ReadonlySet<number>,
): CleanRegion[] {
  if (sequences.length === 0) {
    return []
  }

  const querySeq = sequences[0].seq
  const regions: CleanRegion[] = []
  let currentStart: number | null = null

  for (let col = 0; col <= querySeq.length; col++) {
    const withinBounds = col < querySeq.length
    const isClean = withinBounds && querySeq[col] !== '-' && !mismatchCols.has(col)

    if (isClean && currentStart === null) {
      currentStart = col
    }

    const reachedEnd = col === querySeq.length
    if ((reachedEnd || !isClean) && currentStart !== null) {
      const length = col - currentStart
      if (length >= MIN_CLEAN_REGION_BP) {
        regions.push({
          start: currentStart,
          end: col - 1,
          length,
        })
      }
      currentStart = null
    }
  }

  return regions.sort((a, b) => b.length - a.length)
}
