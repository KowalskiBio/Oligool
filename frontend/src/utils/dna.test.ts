import { describe, it, expect } from 'vitest';
import { parseSequenceHeader } from './dna';

describe('parseSequenceHeader', () => {
    it('extracts a GenBank-style header without the leading >', () => {
        const input = '>PD166130.1 JP 2022523929-A/9: ANTIBODY BINDING HUMAN LAG-3\nGCAAGTACCAAGGGACCTAGTG\nCTCTTGGATGTCTCGTTAAGG';
        expect(parseSequenceHeader(input)).toBe('PD166130.1 JP 2022523929-A/9: ANTIBODY BINDING HUMAN LAG-3');
    });

    it('returns undefined for a raw sequence without a header', () => {
        expect(parseSequenceHeader('GCAAGTACCAAGGG\nCTCTTGGATGTCTC')).toBeUndefined();
    });

    it('returns undefined for empty input', () => {
        expect(parseSequenceHeader('')).toBeUndefined();
        expect(parseSequenceHeader('   \n  ')).toBeUndefined();
    });

    it('skips blank lines before the header', () => {
        expect(parseSequenceHeader('\n\n>my_sequence description\nATCG')).toBe('my_sequence description');
    });

    it('returns undefined when a sequence line precedes the header', () => {
        expect(parseSequenceHeader('ATCGATCG\n>late_header\nATCG')).toBeUndefined();
    });

    it('returns undefined for a bare > with no text', () => {
        expect(parseSequenceHeader('>\nATCGATCG')).toBeUndefined();
    });

    it('handles CRLF line endings', () => {
        expect(parseSequenceHeader('>seq1\r\nATCG\r\nATCG')).toBe('seq1');
    });
});
