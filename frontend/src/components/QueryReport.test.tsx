import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import QueryReport from './QueryReport';
import type { CompleteReportData } from '../utils/report';
import { reverseComplement } from '../utils/report';

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
    tagReg: 18,
    tagPartNumber: 'MTAG-A018',
    ampliconLength: 150,
    flankingFwdName: 'FlnkF1',
    flankingFwdSeq: 'CGATCGATTTTTCCCCAAAA',
    flankingFwdLen: 20,
    flankingFwdGc: 45,
    flankingFwdTmP3: 61.2,
    flankingFwdTmStrider: 60.1,
    flankingFwdIDTTm: 62.5,
    flankingFwdHairpinDg: -1.2,
    flankingFwdHairpinTm: 42.0,
    flankingFwdHomodimerDg: -3.4,
    flankingFwdHomodimerTm: 38.5,
    flankingRevName: 'FlnkR1',
    flankingRevSeq: 'GGGGAAAACCCCTTTTGGGG',
    flankingRevLen: 20,
    flankingRevGc: 60,
    flankingRevTmP3: 63.0,
    flankingRevTmStrider: 62.2,
    flankingRevIDTTm: 64.1,
    flankingRevHairpinDg: -0.5,
    flankingRevHairpinTm: 35.0,
    flankingRevHomodimerDg: -2.9,
    flankingRevHomodimerTm: 36.1,
    flankingHetDg: -5.6,
    flankingHetTm: 41.0,
    savedPositions: [],
};

/** Text content of the section (h2 + siblings) whose heading matches `headingText`. */
const sectionText = (report: Element, headingText: string): string => {
    const heading = Array.from(report.querySelectorAll('h2')).find(
        h => (h.textContent ?? '').trim() === headingText
    );
    expect(heading, `heading "${headingText}" should exist`).toBeTruthy();
    return heading!.parentElement?.textContent ?? '';
};

/** Combined textContent of the MOLIGO 1 and MOLIGO 2 sections. */
const moligoSectionsText = (report: Element): string => {
    const heads = Array.from(report.querySelectorAll('h2')).filter(h => {
        const t = (h.textContent ?? '').trim();
        return t === baseData.moligo1Name || t === baseData.moligo2Name;
    });
    expect(heads.length).toBeGreaterThanOrEqual(2);
    return heads.map(h => h.parentElement?.textContent ?? '').join('\n');
};

describe('QueryReport', () => {
    it('renders the report container and MOLigo schematic', () => {
        render(<QueryReport data={baseData} />);
        const report = document.querySelector('.query-report');
        expect(report).toBeTruthy();
        expect(report!.querySelector('svg')).toBeTruthy();
        expect(screen.getByText('MOLIGO PROVENANCE SCHEMATIC')).toBeInTheDocument();
    });

    it('renders hairpin as SVG and dimers as vertical-bond ASCII matching the oligo panel', () => {
        const hairpinDb = '....((......))..';
        const dimerSeq = 'GCATGC&GCATGC';
        const dimerDb = '((((((&))))))';
        const data: CompleteReportData = {
            ...baseData,
            idtM1Hairpin: { DeltaG: -1.23, raw: { DotBracket: hairpinDb, Sequence: baseData.moligo1Seq } },
            idtM1SelfDimer: { DeltaG: -0.88, raw: { DotBracket: dimerDb, Sequence: dimerSeq } },
        };
        render(<QueryReport data={data} />);
        const report = document.querySelector('.query-report')!;
        expect(screen.getByText('SECONDARY STRUCTURE PREDICTIONS')).toBeInTheDocument();
        expect(report.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2); // schematic + hairpin
        const dimerHeading = screen.getByText((_, node) =>
            node?.tagName === 'H3' && !!node.textContent?.startsWith('MOLigo 1 Self-Dimer'));
        const dimerSection = dimerHeading.parentElement!;
        const bondPre = dimerSection.querySelector('pre');
        expect(bondPre).toBeTruthy();
        const bondRow = bondPre!.textContent!.split('\n')[1];
        expect(bondRow.replace(/\s/g, '')).toBe('||||||');
        expect(dimerSection.querySelector('svg')).toBeNull();
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
        expect(screen.getAllByText('Hairpin IDT ΔG').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Hairpin Strider ΔG').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Self-Dimer IDT ΔG').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Self-Dimer Strider ΔG').length).toBeGreaterThanOrEqual(1);
        // Moligo tiles show only ΔG values — no Shift/Tm labels. Scope the negative
        // assertions to the MOLIGO sections: '(Tm: ...)' strings legitimately appear
        // in flanking-primer and structure sections of the report.
        const report = document.querySelector('.query-report')!;
        const moligoText = moligoSectionsText(report);
        expect(moligoText).not.toContain('Shift:');
        expect(moligoText).not.toContain('Analyze Tm:');
        expect(moligoText).not.toContain('Hairpin Tm:');
        expect(moligoText).not.toContain('Self-Dimer Tm:');
        const schematicSvg = report.querySelector('svg');
        expect(schematicSvg?.textContent).toContain(baseData.moligo1Seq[0]);
    });

    it('renders context map with colored moligo and flanking primer regions', () => {
        const target = 'A'.repeat(30) + 'GC' + 'T'.repeat(30);
        const m1 = target.slice(10, 18);
        const m2 = target.slice(40, 48);
        const fwdFlank = target.slice(0, 8);
        const revFlank = target.slice(52, 60);
        const data: CompleteReportData = {
            ...baseData,
            targetSeq: target,
            contextMap: {
                sequence: target.slice(0, 70),
                absStart: 1,
                regions: [
                    { start: 0, end: 8, label: 'Flanking Fwd', color: '#3b82f6' },
                    { start: 10, end: 18, label: 'MOLigo 1', color: '#10b981' },
                    { start: 40, end: 48, label: 'MOLigo 2', color: '#f59e0b' },
                    { start: 52, end: 60, label: 'Flanking Rev', color: '#c084fc' },
                ],
            },
        };
        render(<QueryReport data={data} />);
        expect(screen.getByText('CONTEXT MAP')).toBeInTheDocument();
        const report = document.querySelector('.query-report');
        expect(report?.textContent).toContain(m1);
        expect(report?.textContent).toContain(m2);
        expect(report?.textContent).toContain(fwdFlank);
        expect(report?.textContent).toContain(revFlank);
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

    it('renders the user-provided header instead of job/query defaults', () => {
        const header = 'PD166130.1 JP 2022523929-A/9: ANTIBODY BINDING HUMAN LAG-3';
        render(<QueryReport data={{ ...baseData, header }} />);
        expect(screen.getByText(header)).toBeInTheDocument();
        expect(screen.queryByText(/^Job:/)).not.toBeInTheDocument();
        expect(screen.queryByText(/^Query ID:/)).not.toBeInTheDocument();
        // Removed sections stay removed when a header is provided.
        expect(screen.queryByText('TARGET REGION')).not.toBeInTheDocument();
        expect(screen.queryByText('PARAMETERS')).not.toBeInTheDocument();
    });

    it('always renders the MOLigo schematic in light mode, even with dark mode active', () => {
        document.documentElement.classList.add('dark');
        try {
            render(<QueryReport data={baseData} />);
            const report = document.querySelector('.query-report')!;
            expect(report.innerHTML).not.toContain('dark:bg-slate-900');
            expect(report.querySelector('svg')!.closest('div.rounded-xl')?.className).not.toContain('dark:');
            expect(report.innerHTML).not.toContain('dark:text-slate-');
        } finally {
            document.documentElement.classList.remove('dark');
        }
    });

    it('shows no job/query fallback, no generated stamp, and no removed sections when no header is provided', () => {
        render(<QueryReport data={baseData} />);
        const report = document.querySelector('.query-report')!;
        expect(screen.queryByText(/^Job:/)).not.toBeInTheDocument();
        expect(screen.queryByText(/^Query ID:/)).not.toBeInTheDocument();
        expect(report.textContent).not.toMatch(/Generated/);
        // baseData includes searchParams/advancedParams/idtAdvancedParams, so a
        // PARAMETERS section would render if it still existed.
        expect(screen.queryByText('TARGET REGION')).not.toBeInTheDocument();
        expect(screen.queryByText('PARAMETERS')).not.toBeInTheDocument();
    });

    it('moligo headings contain no capture/reporter labels', () => {
        render(<QueryReport data={baseData} />);
        const report = document.querySelector('.query-report') as HTMLElement;
        const moligoHeadings = Array.from(report.querySelectorAll('h2')).filter(h => {
            const t = (h.textContent ?? '').trim();
            return t === baseData.moligo1Name || t === baseData.moligo2Name;
        });
        expect(moligoHeadings).toHaveLength(2);
        expect(within(report).queryByText(/CAPTURE|REPORTER/)).toBeNull();
    });

    it('TAG section shows roller number', () => {
        const { rerender } = render(<QueryReport data={baseData} />);
        let report = document.querySelector('.query-report')!;
        expect(sectionText(report, 'TAG SEQUENCE')).toContain('A018');

        rerender(<QueryReport data={{ ...baseData, tagReg: undefined }} />);
        report = document.querySelector('.query-report')!;
        expect(sectionText(report, 'TAG SEQUENCE')).not.toMatch(/A0\d{2}/);
    });

    it('universal primers section is removed from report', () => {
        render(<QueryReport data={baseData} />);
        expect(screen.queryByText('UNIVERSAL PRIMERS')).not.toBeInTheDocument();
    });

    it('pairwise shown only in secondary structure predictions', () => {
        const dots16 = '.'.repeat(16);
        const data: CompleteReportData = {
            ...baseData,
            idtPairwise: { DeltaG: -2.1, raw: { DotBracket: `${dots16}&${dots16}`, Sequence: `${baseData.moligo1Seq}&${baseData.moligo2Seq}` } },
        };
        render(<QueryReport data={data} />);
        expect(screen.queryByText('Moligo 1 with Moligo 2 pairwise')).not.toBeInTheDocument();
        expect(screen.getAllByText((_, node) => !!node?.textContent?.includes('MOLigo 1 × MOLigo 2')).length).toBeGreaterThan(0);
    });

    it('context map uses vivid palette and print color rule', () => {
        const target = 'A'.repeat(30) + 'GC' + 'T'.repeat(30);
        const data: CompleteReportData = {
            ...baseData,
            targetSeq: target,
            contextMap: {
                sequence: target.slice(0, 70),
                absStart: 1,
                regions: [
                    { start: 0, end: 8, label: 'Flanking Fwd', color: '#3b82f6' },
                    { start: 10, end: 18, label: 'MOLigo 1', color: '#10b981' },
                    { start: 40, end: 48, label: 'MOLigo 2', color: '#f59e0b' },
                    { start: 52, end: 60, label: 'Flanking Rev', color: '#c084fc' },
                ],
            },
        };
        render(<QueryReport data={data} />);
        const report = document.querySelector('.query-report')!;
        // M1-region character spans use the vivid emerald swatch.
        const charSpan = report.querySelector('span.bg-emerald-400');
        expect(charSpan).toBeTruthy();
        expect(charSpan!.textContent).toHaveLength(1);
        // Legend swatch for MOLigo 1 uses the same vivid color.
        const swatches = Array.from(report.querySelectorAll('span.inline-block'));
        const m1Swatch = swatches.find(s => (s.parentElement?.textContent ?? '').trim() === 'MOLigo 1');
        expect(m1Swatch).toBeTruthy();
        expect(m1Swatch!.className).toContain('bg-emerald-400');
        // Print stylesheet forces exact background colors.
        const styles = Array.from(report.querySelectorAll('style'));
        expect(styles.some(s => (s.textContent ?? '').includes('print-color-adjust: exact'))).toBe(true);
    });

    it('flanking primers full QC block', () => {
        const { rerender } = render(<QueryReport data={baseData} />);
        let report = document.querySelector('.query-report')!;
        let flankText = sectionText(report, 'FLANKING PRIMERS');
        expect(flankText).toContain('FlnkF1');
        expect(flankText).toContain(baseData.flankingFwdSeq);
        expect(flankText).toMatch(/Length\t20 nt \| GC\t45\.0%/);
        expect(flankText).toMatch(/Tm — P3\t61\.2 °C \| Strider\t60\.1 °C \| IDT\t62\.5 °C/);
        expect(flankText).toMatch(/P3 Hairpin ΔG\t-1\.20 kcal\/mol \(Tm\t42\.0 °C\)/);
        expect(flankText).toMatch(/P3 Homodimer ΔG\t-3\.40 kcal\/mol \(Tm\t38\.5 °C\)/);
        expect(flankText).toMatch(/Heterodimer ΔG\t-5\.60 kcal\/mol \(Tm\t41\.0 °C\)/);
        expect(flankText).toContain('Amplicon length\t150 bp');
        expect(flankText).toContain('FlnkF1 × FlnkR1');
        expect(flankText).toContain('FlnkR1');
        expect(flankText).toContain(baseData.flankingRevSeq);

        // With no QC fields designed, values degrade to N/A and het/amplicon lines disappear.
        rerender(
            <QueryReport
                data={{
                    ...baseData,
                    ampliconLength: undefined,
                    flankingFwdLen: undefined,
                    flankingFwdGc: undefined,
                    flankingFwdTmP3: undefined,
                    flankingFwdTmStrider: undefined,
                    flankingFwdIDTTm: undefined,
                    flankingFwdHairpinDg: undefined,
                    flankingFwdHairpinTm: undefined,
                    flankingFwdHomodimerDg: undefined,
                    flankingFwdHomodimerTm: undefined,
                    flankingRevLen: undefined,
                    flankingRevGc: undefined,
                    flankingRevTmP3: undefined,
                    flankingRevTmStrider: undefined,
                    flankingRevIDTTm: undefined,
                    flankingRevHairpinDg: undefined,
                    flankingRevHairpinTm: undefined,
                    flankingRevHomodimerDg: undefined,
                    flankingRevHomodimerTm: undefined,
                    flankingHetDg: undefined,
                    flankingHetTm: undefined,
                }}
            />
        );
        report = document.querySelector('.query-report')!;
        flankText = sectionText(report, 'FLANKING PRIMERS');
        expect(flankText).toContain('FlnkF1');
        expect(flankText).toMatch(/Tm — P3\tN\/A °C \| Strider\tN\/A °C \| IDT\tN\/A °C/);
        expect(flankText).toMatch(/P3 Hairpin ΔG\tN\/A/);
        expect(flankText).toMatch(/P3 Homodimer ΔG\tN\/A/);
        expect(flankText).not.toContain('Heterodimer');
        expect(flankText).not.toContain('Amplicon length');
    });

    it('final order lines are tab delimited', () => {
        render(<QueryReport data={baseData} />);
        const report = document.querySelector('.query-report')!;
        const foText = sectionText(report, 'FINAL ORDER SEQUENCES');
        const expectedOligo2 = `${baseData.revPrimer}${baseData.moligo2Seq}`;
        const expectedOligo1 =
            baseData.moligo1Seq + baseData.tagSeq! + reverseComplement(baseData.fwdPrimer!);
        expect(foText).toContain(`Oligo 2 (RevP + M2)\t${expectedOligo2}`);
        expect(foText).toContain(`Oligo 1 (M1 + TAG + RC-FwdP)\t${expectedOligo1}`);
        expect(foText).toContain(`${baseData.flankingFwdName}\t${baseData.flankingFwdSeq}`);
        expect(foText).toContain(`${baseData.flankingRevName}\t${baseData.flankingRevSeq}`);
        expect(foText).not.toContain('Length:');
    });

    it('renders the GenBank header block verbatim below the title and date when genbankHeader is provided', () => {
        const block = 'LOCUS       PD166130                 981 bp    DNA     linear   PAT 29-JAN-2025\nDEFINITION  JP 2022523929-A/9: ANTIBODY BINDING HUMAN LAG-3\nACCESSION   PD166130\nVERSION     PD166130.1';
        render(<QueryReport data={{ ...baseData, genbankHeader: block }} />);
        const report = document.querySelector('.query-report')!;
        const pre = report.querySelector('[data-genbank-header]');
        expect(pre).toBeTruthy();
        expect(pre!.textContent).toBe(block);
        const preClass = pre!.className;
        expect(preClass).toContain('text-[10px]');
        expect(preClass).not.toContain('font-bold');
        const title = report.querySelector('h1');
        expect(title).toBeTruthy();
        expect(title!.textContent).toBe('Oligool Complete Design Report');
        expect(title!.className).toContain('text-xl');
        expect(title!.compareDocumentPosition(pre!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('omits the GenBank header block when genbankHeader is absent', () => {
        render(<QueryReport data={baseData} />);
        expect(document.querySelector('[data-genbank-header]')).not.toBeInTheDocument();
    });
});
