import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import QueryReport from './QueryReport';
import type { CompleteReportData } from '../utils/report';

const baseData: CompleteReportData = {
    jobName: 'Test',
    queryId: 'Q1',
    targetSeq: 'CATACCGATAACAACCACGAGCTAGTAAGCGCCGTCGCGCCAATAAATCTTATGCCACATGCCCGGAATTAGGTCTGTTACTCGTAGCAAACGTATGCGGACCACCCTCATTGGTCAGGTCCAGCGCATAGGGTAGGATAGGATCTGTACCATGCTCAATCAAACAGGAACAAGCTGGAATTTCCGATTGAATTTAGTGCAGGGGGATATATGTGTTGGCCATGCCCACCGAGAACCAAGACCTCCGACATCTTGATGGAATGGGTAGCCGCAGTCGAAACTCCACTTGGATTAGCTCCTAAG',
    targetStart: 0,
    targetEnd: 302,
    searchParams: { min_len: 15, max_l: 35, tm_min: 60, tm_max: 63, tm_diff: 1.5, gc_min: 30, gc_max: 80 },
    advancedParams: { salt_mono: 50, salt_div: 10, dntp_conc: 0.8, dna_conc: 500 },
    idtAdvancedParams: { mv_conc: 50, mg_conc: 10, dntp_conc: 0.8, oligo_conc: 0.25 },
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
    savedPositions: [],
};

describe('QueryReport', () => {
    it('renders the report container and MOLigo schematic', () => {
        render(<QueryReport data={baseData} />);
        const report = document.querySelector('.query-report');
        expect(report).toBeTruthy();
        expect(report!.querySelector('svg')).toBeTruthy();
        expect(screen.getByText('MOLIGO PROVENANCE SCHEMATIC')).toBeInTheDocument();
    });

    it('renders IDT hairpin and self-dimer SVGs when raw data is provided', () => {
        const dots16 = '.'.repeat(16);
        const hairpinDb = '....((......))..'; // 16 chars, simple hairpin
        const data: CompleteReportData = {
            ...baseData,
            idtM1Hairpin: { DeltaG: -1.23, raw: { DotBracket: hairpinDb, Sequence: baseData.moligo1Seq } },
            idtM1SelfDimer: { DeltaG: -0.88, raw: { DotBracket: `${dots16}&${dots16}`, Sequence: `${baseData.moligo1Seq}&${baseData.moligo1Seq}` } },
            idtPairwise: { DeltaG: -2.1, raw: { DotBracket: `${dots16}&${dots16}`, Sequence: `${baseData.moligo1Seq}&${baseData.moligo2Seq}` } },
        };
        render(<QueryReport data={data} />);
        const report = document.querySelector('.query-report');
        const svgs = report!.querySelectorAll('svg');
        expect(svgs.length).toBeGreaterThanOrEqual(4); // schematic + 3 structure SVGs
        expect(screen.getByText('SECONDARY STRUCTURE PREDICTIONS')).toBeInTheDocument();
    });

    it('renders comprehensive IDT/Strider thermodynamic data and sequence-mode schematic', () => {
        const hairpinDb = '....((......))..';
        const data: CompleteReportData = {
            ...baseData,
            idtM1Hairpin: {
                DeltaG: -1.23,
                Local_DeltaG: -0.95,
                IDT_Tm: 55.5,
                Local_Tm: 54.2,
                raw: { DotBracket: hairpinDb, Sequence: baseData.moligo1Seq },
            },
            idtM1SelfDimer: {
                DeltaG: -0.88,
                Local_DeltaG: -0.72,
                IDT_Tm: 48.1,
                Local_Tm: 47.3,
                raw: { DotBracket: `${'.'.repeat(16)}&${'.'.repeat(16)}`, Sequence: `${baseData.moligo1Seq}&${baseData.moligo1Seq}` },
            },
        };
        render(<QueryReport data={data} />);
        expect(screen.getAllByText('Hairpin IDT ΔG:').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Hairpin Strider ΔG:').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Hairpin Tm:').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Self-Dimer IDT ΔG:').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Self-Dimer Strider ΔG:').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Self-Dimer Tm:').length).toBeGreaterThanOrEqual(1);
        const report = document.querySelector('.query-report');
        const schematicSvg = report!.querySelector('svg');
        expect(schematicSvg?.textContent).toContain(baseData.moligo1Seq[0]);
    });

    it('renders saved positions', () => {
        const data: CompleteReportData = {
            ...baseData,
            savedPositions: [{
                id: 'p1',
                label: 'Position A',
                createdAt: Date.now(),
                p1: { start: 50, end: 70, seq: 'TATGCCACATGCCCGGAATTA', gc: 47.6, tm: 60 },
                p2: { start: 130, end: 150, seq: 'GGGTAGGATAGGATCTGTACC', gc: 52.4, tm: 60 },
                p1AbsStart: 51, p1AbsEnd: 71,
                p2AbsStart: 131, p2AbsEnd: 151,
                moligo1Shift: 0, moligo2Shift: 0, moligo1Len: 21, moligo2Len: 21,
                notes: 'Pinned for QA',
                color: 'slate',
            }],
        };
        render(<QueryReport data={data} />);
        expect(screen.getByText('SAVED POSITIONS')).toBeInTheDocument();
        expect(screen.getByText('Position A')).toBeInTheDocument();
        expect(screen.getByText('Pinned for QA')).toBeInTheDocument();
    });
});
