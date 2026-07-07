import { describe, expect, it } from 'vitest'
import { findCleanRegions, computeMismatchCols, MIN_CLEAN_REGION_BP } from '../utils/msa'

const repeat = (base: string, times: number) => base.repeat(times)

describe('findCleanRegions', () => {
  it('returns an empty array when no sequences are provided', () => {
    const result = findCleanRegions([], new Set())
    expect(result).toEqual([])
  })

  it('returns the whole non-gap query span as one region when there are no other sequences', () => {
    const seq = repeat('ATCG', MIN_CLEAN_REGION_BP / 4)
    const sequences = [{ id: 'Query', seq }]
    const result = findCleanRegions(sequences, new Set())
    expect(result).toEqual([{ start: 0, end: seq.length - 1, length: seq.length }])
  })

  it('excludes gap columns in the query from clean regions', () => {
    const cleanBlock = repeat('ATCG', MIN_CLEAN_REGION_BP / 4)
    const sequences = [{ id: 'Query', seq: `${cleanBlock}--${cleanBlock}` }]
    const result = findCleanRegions(sequences, new Set())
    expect(result).toEqual([
      { start: 0, end: cleanBlock.length - 1, length: cleanBlock.length },
      { start: cleanBlock.length + 2, end: sequences[0].seq.length - 1, length: cleanBlock.length },
    ])
  })

  it('returns one continuous region when all non-query sequences match the query', () => {
    const seq = repeat('ATCG', MIN_CLEAN_REGION_BP / 4)
    const sequences = [
      { id: 'Query', seq },
      { id: 'Hit1', seq },
    ]
    const result = findCleanRegions(sequences, new Set())
    expect(result).toEqual([{ start: 0, end: seq.length - 1, length: seq.length }])
  })

  it('splits regions around a single mismatch column', () => {
    const left = repeat('ATCG', MIN_CLEAN_REGION_BP / 4)
    const right = repeat('GCTA', MIN_CLEAN_REGION_BP / 4)
    const sequences = [
      { id: 'Query', seq: `${left}A${right}` },
      { id: 'Hit1', seq: `${left}T${right}` },
    ]
    const mismatchCols = new Set([left.length])
    const result = findCleanRegions(sequences, mismatchCols)
    expect(result).toEqual([
      { start: 0, end: left.length - 1, length: left.length },
      { start: left.length + 1, end: sequences[0].seq.length - 1, length: right.length },
    ])
  })

  it('returns an empty array when every column has a mismatch', () => {
    const seq = repeat('ATCG', MIN_CLEAN_REGION_BP / 4)
    const sequences = [
      { id: 'Query', seq },
      { id: 'Hit1', seq: repeat('GCTA', MIN_CLEAN_REGION_BP / 4) },
    ]
    const mismatchCols = new Set(Array.from({ length: seq.length }, (_, i) => i))
    const result = findCleanRegions(sequences, mismatchCols)
    expect(result).toEqual([])
  })

  it('drops clean regions shorter than the 100 bp threshold', () => {
    const long = repeat('ATCG', MIN_CLEAN_REGION_BP / 4)
    const short = 'ATCG'
    const sequences = [
      { id: 'Query', seq: `${long}A${short}` },
      { id: 'Hit1', seq: `${long}T${short}` },
    ]
    const mismatchCols = new Set([long.length])
    const result = findCleanRegions(sequences, mismatchCols)
    expect(result).toEqual([{ start: 0, end: long.length - 1, length: long.length }])
  })

  it('ignores gaps in non-query sequences when computing clean regions', () => {
    const seq = repeat('ATCG', MIN_CLEAN_REGION_BP / 4)
    const sequences = [
      { id: 'Query', seq },
      { id: 'Hit1', seq: seq.slice(0, seq.length / 2) + '-' + seq.slice(seq.length / 2 + 1) },
    ]
    const result = findCleanRegions(sequences, new Set())
    expect(result).toEqual([{ start: 0, end: seq.length - 1, length: seq.length }])
  })
})

describe('computeMismatchCols', () => {
  it('returns mismatches from all non-query sequences when selectedAccessions is undefined', () => {
    const query = 'ATCGATCG'
    const sequences = [
      { id: 'Query', seq: query, accession: 'Query' },
      { id: 'Hit1', seq: 'ATCGTTCG', accession: 'Hit1' },
      { id: 'Hit2', seq: 'ATCGATCG', accession: 'Hit2' },
    ]
    const result = computeMismatchCols(sequences)
    expect(result).toEqual(new Set([4]))
  })

  it('only includes selected accessions when provided', () => {
    const query = 'ATCGATCG'
    const sequences = [
      { id: 'Query', seq: query, accession: 'Query' },
      { id: 'Hit1', seq: 'ATCGTTCG', accession: 'Hit1' },
      { id: 'Hit2', seq: 'ATCGGTCG', accession: 'Hit2' },
    ]
    const result = computeMismatchCols(sequences, new Set(['Hit2']))
    expect(result).toEqual(new Set([4]))
  })

  it('returns an empty set when no sequences are selected', () => {
    const query = 'ATCGATCG'
    const sequences = [
      { id: 'Query', seq: query, accession: 'Query' },
      { id: 'Hit1', seq: 'ATCGTTCG', accession: 'Hit1' },
    ]
    const result = computeMismatchCols(sequences, new Set())
    expect(result).toEqual(new Set())
  })

  it('ignores gaps in non-query sequences', () => {
    const query = 'ATCGATCG'
    const sequences = [
      { id: 'Query', seq: query, accession: 'Query' },
      { id: 'Hit1', seq: 'ATC-ATCG', accession: 'Hit1' },
    ]
    const result = computeMismatchCols(sequences, new Set(['Hit1']))
    expect(result).toEqual(new Set())
  })

  it('never treats the query as a mismatch source', () => {
    const query = 'ATCGATCG'
    const sequences = [
      { id: 'Query', seq: query, accession: 'Query' },
      { id: 'Hit1', seq: 'GCTAGCTA', accession: 'Hit1' },
    ]
    const result = computeMismatchCols(sequences, new Set(['Query', 'Hit1']))
    expect(result).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]))
  })

  it('treats gaps in non-query sequences as mismatches when treatIndelsAsMismatches is true', () => {
    const query = 'ATCGATCG'
    const sequences = [
      { id: 'Query', seq: query, accession: 'Query' },
      { id: 'Hit1', seq: 'ATC-ATCG', accession: 'Hit1' },
    ]
    const result = computeMismatchCols(sequences, new Set(['Hit1']), true)
    expect(result).toEqual(new Set([3]))
  })

  it('treats insertions in non-query sequences as mismatches when treatIndelsAsMismatches is true', () => {
    const query = 'ATC-ATCG'
    const sequences = [
      { id: 'Query', seq: query, accession: 'Query' },
      { id: 'Hit1', seq: 'ATCGATCG', accession: 'Hit1' },
    ]
    const result = computeMismatchCols(sequences, new Set(['Hit1']), true)
    expect(result).toEqual(new Set([3]))
  })

  it('still ignores gaps when treatIndelsAsMismatches is false', () => {
    const query = 'ATCGATCG'
    const sequences = [
      { id: 'Query', seq: query, accession: 'Query' },
      { id: 'Hit1', seq: 'ATC-ATCG', accession: 'Hit1' },
    ]
    const result = computeMismatchCols(sequences, new Set(['Hit1']), false)
    expect(result).toEqual(new Set())
  })
})
