import { describe, it, expect } from 'vitest';
import { buildCompleteReportTxt, reverseComplement } from './report';
import type { CompleteReportData } from './report';

/** Minimal CompleteReportData fixture mirrored from QueryReport.test.tsx baseData. */
const makeData = (): CompleteReportData => ({
    jobName: 'Test',
    queryId: 'Q1',
    targetSeq:
        'CATACCGATAACAACCACGAGCTAGTAAGCGCCGTCGCGCCAATAAATCTTATGCCACATGCCCGGAATTAGGTCTGTTACTCGTAGCAAACGTATGCGGACCACCCTCATTGGTCAGGTCCAGCGCATAGGGTAGGATAGGATCTGTACCATGCTCAATCAAACAGGAACAAGCTGGAATTTCCGATTGAATTTAGTGCAGGGGGATATATGTGTTGGCCATGCCCACCGAGAACCAAGACCTCCGACATCTTGATGGAATGGGTAGCCGCAGTCGAAACTCCACTTGGATTAGCTCCTAAG',
    targetStart: 0,
    targetEnd: 302,
    searchParams: { min_len: 15, max_l: 35, tm_min: 60, tm_max: 63, tm_diff: 1.5, gc_min: 30, gc_max: 80 },
    moligo1Name: 'Oligo 1',
    moligo1Seq: 'CGTCGCGCCAATAAAT',
    moligo1Shift: 2,
    moligo1Len: 16,
    moligo2Name: 'Oligo 2',
    moligo2Seq: 'ACGAGCTAGTAAGCGC',
    moligo2Shift: 2,
    moligo2Len: 16,
    tagSeq: 'taattgaattgaaagataagtgt',
    fwdPrimer: 'TATCCGTCCATCCAAGTCCG',
    revPrimer: 'TGCGTACTACCATACCTGCC',
});

describe('buildCompleteReportTxt', () => {
    it('txt report starts at FLANKING PRIMERS — no header/target/moligo/tag/primers sections', () => {
        const data = makeData();
        const txt = buildCompleteReportTxt(data);
        expect(txt.startsWith('=== FLANKING PRIMERS ===')).toBe(true);
        expect(txt).not.toContain('Oligool Design Report');
        expect(txt).not.toContain('=== HEADER ===');
        expect(txt).not.toContain('=== TARGET SEQUENCE ===');
        expect(txt).not.toContain(`=== ${data.moligo1Name} ===`);
        expect(txt).not.toContain(`=== ${data.moligo2Name} ===`);
        expect(txt).not.toContain('=== TAG ===');
        expect(txt).not.toContain('=== UNIVERSAL PRIMERS ===');
    });

    it('txt keeps FINAL ORDER SEQUENCES with renamed oligo labels and RC', () => {
        const data = makeData();
        const txt = buildCompleteReportTxt(data);
        expect(txt).toContain('=== FINAL ORDER SEQUENCES ===');
        expect(txt).toContain(reverseComplement(data.fwdPrimer!));
        expect(txt).toContain(`${data.moligo2Name} (RevP + M2):`);
        expect(txt).toContain(`${data.moligo1Name} (M1 + TAG + RC-FwdP):`);
        expect(txt).not.toContain('SEARCH PARAMETERS');
        expect(txt).not.toContain('DeltaG');
        expect(txt).not.toContain('ΔG');
    });

    it('txt includes flanking primers when present', () => {
        const data: CompleteReportData = {
            ...makeData(),
            flankingFwdName: 'FlnkF1',
            flankingFwdSeq: 'CGATCGATTTTTCCCCAAAA',
            flankingRevName: 'FlnkR1',
            flankingRevSeq: 'GGGGAAAACCCCTTTTGGGG',
        };
        const txt = buildCompleteReportTxt(data);
        expect(txt).toContain('FlnkF1:');
        expect(txt).toContain('CGATCGATTTTTCCCCAAAA');
        expect(txt).toContain('FlnkR1:');
        expect(txt).toContain('GGGGAAAACCCCTTTTGGGG');
    });
});
