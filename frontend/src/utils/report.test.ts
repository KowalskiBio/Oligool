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
    it('includes TAG roller number in txt when tagReg set', () => {
        const txt = buildCompleteReportTxt({ ...makeData(), tagReg: 18, tagPartNumber: 'MTAG-A018' });
        expect(txt).toContain('=== TAG ===');
        expect(txt).toContain('No.: 18 (MTAG-A018)');
    });

    it('omits TAG number line when tagReg absent', () => {
        const txt = buildCompleteReportTxt(makeData());
        expect(txt).toContain('=== TAG ===');
        expect(txt).not.toContain('No.:');
    });

    it('txt keeps sequences-only layout', () => {
        const data = makeData();
        const txt = buildCompleteReportTxt(data);
        expect(txt).toContain('Oligool Design Report');
        expect(txt).toContain('=== HEADER ===');
        expect(txt).toContain('=== TARGET SEQUENCE ===');
        expect(txt).toContain(`=== MOLIGO 1 - ${data.moligo1Name} ===`);
        expect(txt).toContain(`=== MOLIGO 2 - ${data.moligo2Name} ===`);
        expect(txt).toContain('=== FINAL ORDER SEQUENCES ===');
        expect(txt).toContain(reverseComplement(data.fwdPrimer!));
        expect(txt).not.toContain('SEARCH PARAMETERS');
        expect(txt).not.toContain('DeltaG');
        expect(txt).not.toContain('ΔG');
    });
});
