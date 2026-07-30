import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import HairpinSVG from './HairpinSVG';
import DimerSVG from './DimerSVG';

describe('HairpinSVG / DimerSVG print-friendly layout', () => {
    it('chunks long fallback dot-bracket text every 60 chars', () => {
        // Two independent stem regions => multiloop => <pre> fallback (no SVG possible).
        const seq = 'A'.repeat(130);
        const dotBracket = '((((....))))' + '.'.repeat(58) + '((....))' + '.'.repeat(52);
        expect(dotBracket).toHaveLength(130);

        const { container } = render(<HairpinSVG seq={seq} dotBracket={dotBracket} />);
        const pre = container.querySelector('pre');
        expect(pre).toBeTruthy();

        const lines = (pre!.textContent ?? '').replace(/\n$/, '').split('\n');
        // Long structures must be wrapped into <=60-char chunks (seq + bracket per block).
        expect(lines.length).toBeGreaterThan(2);
        for (const line of lines) {
            expect(line.length).toBeLessThanOrEqual(60);
        }
    });

    it('DimerSVG scales to fit container width', () => {
        const seq = `${'A'.repeat(60)}&${'T'.repeat(60)}`;
        const dotBracket = `${'('.repeat(20)}${'.'.repeat(40)}&${')'.repeat(20)}${'.'.repeat(40)}`;

        const { container } = render(<DimerSVG seq={seq} dotBracket={dotBracket} />);
        const svg = container.querySelector('svg');
        expect(svg).toBeTruthy();
        expect(svg!.getAttribute('width')).toBe('100%');
        expect(svg!.getAttribute('viewBox')).toBeTruthy();
        const wrapper = container.firstElementChild;
        expect(wrapper).toBeTruthy();
        expect(wrapper!.className).not.toContain('overflow-x-auto');
    });

    it('HairpinSVG regular hairpin (16-char) still renders an svg with width 100%', () => {
        const { container } = render(
            <HairpinSVG seq="CGTCGCGCCAATAAAT" dotBracket="....((......)).." />
        );
        const svg = container.querySelector('svg');
        expect(svg).toBeTruthy();
        expect(svg!.getAttribute('width')).toBe('100%');
    });
});
