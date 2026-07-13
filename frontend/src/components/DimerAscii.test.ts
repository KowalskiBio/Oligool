import { describe, it, expect } from 'vitest';
import { dimerAsciiFromItem } from './DimerAscii';

describe('dimerAsciiFromItem', () => {
  it('draws vertical bonds for a centered self-dimer', () => {
    const seq = 'GCATGC&GCATGC';
    const db = '((((((&))))))';
    const ascii = dimerAsciiFromItem(seq, db);
    expect(ascii).toBeDefined();
    const lines = ascii!.split('\n');
    expect(lines[1].replace(/\s/g, '').length).toBe(6);
  });

  it('draws vertical bonds for an offset self-dimer (suboptimal structure)', () => {
    // Strider suboptimal self-dimer for CAACAAGGTCCGTGAGCTTC:
    // the duplex is shifted, so the old (reversed) shift logic produced no bonds.
    const seq = 'CAACAAGGTCCGTGAGCTTC&CAACAAGGTCCGTGAGCTTC';
    const db = '....(((.((((.((.(((.&....))).)))).)).))).';
    const ascii = dimerAsciiFromItem(seq, db);
    expect(ascii).toBeDefined();
    const lines = ascii!.split('\n');
    const bondLine = lines[1];
    const bonds = bondLine.replace(/\s/g, '');
    expect(bonds.length).toBeGreaterThan(0);
  });

  it('draws vertical bonds for an offset heterodimer', () => {
    const seq = 'AAAACCCC&GGGGTTTT';
    const db = '....((((&))))....';
    const ascii = dimerAsciiFromItem(seq, db);
    expect(ascii).toBeDefined();
    const lines = ascii!.split('\n');
    const bondLine = lines[1];
    const bonds = bondLine.replace(/\s/g, '');
    expect(bonds.length).toBe(4);
  });
});
