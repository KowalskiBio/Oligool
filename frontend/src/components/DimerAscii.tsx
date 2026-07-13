interface DimerAsciiProps {
  /** Dimer sequence containing the '&' strand divider. */
  seq: string;
  /** Vienna-style dot-bracket containing the matching '&' divider. */
  dotBracket: string;
  /** Optional raw IDT response with pre-computed bond rows + padding. */
  raw?: {
    Bonds?: number[];
    TopLinePadding?: number;
    BottomLinePadding?: number;
    BondLinePadding?: number;
  } | null;
  className?: string;
}

const WC = new Set(['AT', 'TA', 'GC', 'CG', 'AU', 'UA']);
const WOBBLE = new Set(['GT', 'TG', 'GU', 'UG']);

function bondSymbol(a: string, b: string): string {
  const pair = `${a}${b}`.toUpperCase().replace(/U/g, 'T');
  if (WC.has(pair)) return '|';
  if (WOBBLE.has(pair)) return ':';
  return ' ';
}

/**
 * Build a 3-line ASCII heterodimer from an IDT-style raw Bonds array.
 * Falls back to dot-bracket parsing if the raw array is not available.
 */
function buildFromRaw(
  seq1: string,
  seq2: string,
  raw: NonNullable<DimerAsciiProps['raw']>
): string | undefined {
  if (!raw.Bonds || raw.Bonds.length === 0) return undefined;

  const topPad = raw.TopLinePadding ?? 0;
  const botPad = raw.BottomLinePadding ?? 0;
  const bondPad = raw.BondLinePadding ?? 0;
  const bonds = raw.Bonds;

  const top = "5' " + ' '.repeat(topPad) + seq1 + ' 3\'';
  const bot = "3' " + ' '.repeat(botPad) + seq1.split('').reverse().join('') + ' 5\'';
  // Heterodimer bottom strand is the reverse complement orientation in antiparallel display;
  // the raw bond padding already accounts for positioning; just display the second strand reversed.
  const botSeq = seq2.split('').reverse().join('');
  const botHetero = "3' " + ' '.repeat(botPad) + botSeq + ' 5\'';

  let bondLine = '';
  for (const b of bonds) {
    if (b === 2) bondLine += '|';
    else if (b === 1) bondLine += ':';
    else bondLine += ' ';
  }
  const bondStr = '   ' + ' '.repeat(bondPad) + bondLine;

  // Use heterodimer bottom strand when seq2 differs from seq1, otherwise self-dimer bottom is the
  // reversed first strand. Keep the same overall alignment so old self-dimer results carry over.
  const useHetero = seq2 !== seq1;
  return [top, bondStr, useHetero ? botHetero : bot].join('\n');
}

/**
 * Build a 3-line ASCII heterodimer by parsing the Vienna dot-bracket,
 * aligning the two strands so the median inter-strand base pair is vertical.
 */
function buildFromDotBracket(seq1: string, seq2: string, db: string): string | undefined {
  if (!seq1 || !seq2) return undefined;

  const split = seq1.length;
  const full = db.replace('&', '');
  if (full.length !== seq1.length + seq2.length) return undefined;

  const stack: number[] = [];
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < full.length; i++) {
    const c = full[i];
    if (c === '(') {
      stack.push(i);
    } else if (c === ')') {
      const j = stack.pop();
      if (j !== undefined) {
        // keep smaller index first
        pairs.push([Math.min(i, j), Math.max(i, j)]);
      }
    }
  }

  // Inter-strand pairs only
  const inter = pairs.filter(([i, j]) => (i < split) !== (j < split));
  if (inter.length === 0) return undefined;

  // For display, seq2 is shown 3'→5' left-to-right.
  const revSeq2 = seq2.split('').reverse().join('');

  // Compute the constant horizontal offset between the strands using the median pair.
  // bottom_display_idx = len(seq2) - 1 - (j - split)
  const offsets = inter.map(([i, j]) => {
    const topIdx = i < split ? i : j;
    const botSeqIdx = (i < split ? j : i) - split;
    const botDisplayIdx = seq2.length - 1 - botSeqIdx;
    return botDisplayIdx - topIdx;
  });
  offsets.sort((a, b) => a - b);
  const offset = offsets[Math.floor(offsets.length / 2)];

  // One strand stays leftmost; shift the other so pairs can align vertically.
  // offset = botDisplayIdx - topIdx. When positive the bottom base is naturally
  // to the right, so we must shift the top strand right; when negative we shift
  // the bottom strand right.
  const labelWidth = 3;
  let topShift = 0;
  let botShift = 0;
  if (offset >= 0) topShift = offset;
  else botShift = -offset;

  const top = "5' " + ' '.repeat(topShift) + seq1;
  const bot = "3' " + ' '.repeat(botShift) + revSeq2;

  const maxLen = Math.max(top.length, bot.length);

  const bondArr: string[] = [];
  // labelWidth spaces before the first possible bond column
  for (let i = 0; i < labelWidth; i++) bondArr.push(' ');
  // spaces for whichever strand was shifted
  for (let i = 0; i < Math.max(topShift, botShift); i++) bondArr.push(' ');
  // bond characters up to max strand length
  for (let i = 0; i < Math.max(seq1.length, seq2.length); i++) bondArr.push(' ');
  // extend to maxLen
  while (bondArr.length < maxLen) bondArr.push(' ');

  for (const [i, j] of inter) {
    const topIdx = i < split ? i : j;
    const botSeqIdx = (i < split ? j : i) - split;
    const botDisplayIdx = seq2.length - 1 - botSeqIdx;
    const colTop = labelWidth + topShift + topIdx;
    const colBot = labelWidth + botShift + botDisplayIdx;
    if (colTop === colBot && colTop >= 0 && colTop < bondArr.length) {
      const a = seq1[topIdx];
      const b = seq2[botSeqIdx];
      bondArr[colTop] = bondSymbol(a, b);
    }
  }

  const bond = bondArr.join('');
  return [top, bond, bot].join('\n');
}

export default function DimerAscii({ seq, dotBracket, raw, className = '' }: DimerAsciiProps) {
  if (!seq || !dotBracket || !seq.includes('&')) {
    return <div className="text-[10px] text-slate-400 italic">Invalid dimer sequence</div>;
  }

  const [seq1, seq2 = ''] = seq.split('&');
  const [db1, db2] = dotBracket.split('&');

  // If the backend only returned one side of the dot-bracket (legacy / cofold), split at seq1 length.
  let db = dotBracket;
  if (db.includes('&')) db = db.replace('&', '');
  else if (db.length === seq1.length + seq2.length) {
    db = db.slice(0, seq1.length) + db.slice(seq1.length);
  }

  let ascii: string | undefined;
  if (raw && raw.Bonds && raw.Bonds.length > 0) {
    ascii = buildFromRaw(seq1, seq2, raw);
  }
  if (!ascii) {
    ascii = buildFromDotBracket(seq1, seq2, `${db1 || db.slice(0, seq1.length)}&${db2 || db.slice(seq1.length)}`);
  }

  if (!ascii) {
    return <div className="text-[10px] text-slate-400 italic">No base pairs predicted</div>;
  }

  return (
    <div className={`w-full overflow-x-auto overflow-y-auto max-h-40 bg-slate-100 dark:bg-slate-800 rounded p-2 ${className}`}>
      <pre className="font-mono text-[10px] sm:text-xs text-slate-700 dark:text-slate-300 whitespace-pre leading-[1.15] tracking-tighter">
        {ascii}
      </pre>
    </div>
  );
}

/**
 * Pure helper for inline usage in older components.
 */
export function dimerAsciiFromItem(
  seq: string,
  dotBracket: string,
  raw?: DimerAsciiProps['raw']
): string | undefined {
  if (!seq || !dotBracket || !seq.includes('&')) return undefined;
  const [seq1, seq2 = ''] = seq.split('&');
  if (raw && raw.Bonds && raw.Bonds.length > 0) {
    const fromRaw = buildFromRaw(seq1, seq2, raw);
    if (fromRaw) return fromRaw;
  }
  return buildFromDotBracket(seq1, seq2, dotBracket.includes('&') ? dotBracket : `${dotBracket.slice(0, seq1.length)}&${dotBracket.slice(seq1.length)}`);
}
