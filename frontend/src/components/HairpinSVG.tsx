/**
 * HairpinSVG – renders an RNA/DNA secondary structure from a sequence + dot-bracket
 * as a clean 2D SVG diagram.
 *
 * Supports a single (unbranched) hairpin including bulges and internal loops,
 * e.g. ..((.((((.....)))).))  the gap between stems is bowed out to the side.
 *
 * Backbone is drawn as one continuous polyline through every base in sequence
 * order, so connectivity is correct regardless of bulges. Base pairs are drawn
 * as rungs. Multiloops (multiple sibling stems) are split into individual
 * stem-loop domains and rendered side by side. Pseudoknots fall back to text.
 */
import React from 'react';
import { openSvgInNewTab } from '../utils/openSvgTab';

interface HairpinSVGProps {
    seq: string;
    dotBracket: string;
    /** True for print output: never apply dark-mode variants. */
    light?: boolean;
}

/**
 * Parse a dot-bracket string into a list of [i, j] base pairs (i < j),
 * sorted outermost-first. Returns null for anything that isn't a single
 * unbranched stem (multiloop, pseudoknot, unbalanced, no pairs).
 */
function parsePairs(db: string): Array<[number, number]> | null {
    const stack: number[] = [];
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < db.length; i++) {
        const c = db[i];
        if (c === '(') stack.push(i);
        else if (c === ')') {
            const j = stack.pop();
            if (j === undefined) return null; // unbalanced
            pairs.push([j, i]);
        } else if (c !== '.') {
            return null; // pseudoknot / unsupported bracket type
        }
    }
    if (stack.length) return null; // unbalanced
    if (pairs.length === 0) return null; // no structure

    pairs.sort((a, b) => a[0] - b[0]);
    // Single unbranched stem ⇒ l strictly increasing AND r strictly decreasing.
    // Any violation means a multiloop (multiple sibling stems) → fall back.
    for (let k = 1; k < pairs.length; k++) {
        if (!(pairs[k][0] > pairs[k - 1][0] && pairs[k][1] < pairs[k - 1][1])) {
            return null;
        }
    }
    return pairs;
}

/**
 * Split a multiloop dot-bracket into individual single-stem domains.
 *
 * Each domain is a maximal run of properly-nested pairs. When a pair's right
 * index is NOT less than the previous pair's right index, a new stem group
 * begins. Returns null if the structure is a single stem (not a multiloop),
 * unbalanced, or contains unsupported characters.
 */
function splitStemGroups(
    seq: string, db: string,
): Array<{ seq: string; dotBracket: string }> | null {
    const stack: number[] = [];
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < db.length; i++) {
        const c = db[i];
        if (c === '(') stack.push(i);
        else if (c === ')') {
            const j = stack.pop();
            if (j === undefined) return null;
            pairs.push([j, i]);
        } else if (c !== '.') return null;
    }
    if (stack.length || pairs.length === 0) return null;

    pairs.sort((a, b) => a[0] - b[0]);

    const groups: Array<Array<[number, number]>> = [];
    let cur: Array<[number, number]> = [pairs[0]];
    let prevRight = pairs[0][1];

    for (let k = 1; k < pairs.length; k++) {
        if (pairs[k][1] < prevRight) {
            cur.push(pairs[k]);
            prevRight = pairs[k][1];
        } else {
            groups.push(cur);
            cur = [pairs[k]];
            prevRight = pairs[k][1];
        }
    }
    groups.push(cur);

    if (groups.length <= 1) return null;

    return groups.map(g => {
        // Within a group, pairs are sorted left-ascending and (by construction of
        // the grouping loop above) strictly nested, so g[0] is always the
        // outermost pair — its right index is the domain's true closing bound,
        // not g[last]'s (which is the innermost pair and closes earliest).
        const start = g[0][0];
        const end = g[0][1];
        return {
            seq: seq.slice(start, end + 1),
            dotBracket: db.slice(start, end + 1),
        };
    });
}

function basePairSymbol(a: string, b: string): 'wc' | 'wobble' | 'none' {
    const pair = (a + b).toUpperCase();
    const watson = ['AT', 'TA', 'AU', 'UA', 'GC', 'CG'];
    const wobble = ['GT', 'TG', 'GU', 'UG'];
    if (watson.includes(pair)) return 'wc';
    if (wobble.includes(pair)) return 'wobble';
    return 'none';
}

function baseColor(b: string): string {
    switch (b.toUpperCase()) {
        case 'A': return '#e74c3c'; // red
        case 'T': case 'U': return '#3498db'; // blue
        case 'G': return '#f39c12'; // amber
        case 'C': return '#2ecc71'; // green
        default: return '#94a3b8';
    }
}

export default function HairpinSVG({ seq, dotBracket, light = false }: HairpinSVGProps) {
    const dk = (darkClass: string): string => (light ? '' : darkClass);
    const valid = seq && dotBracket && seq.length === dotBracket.length;
    const pairs = valid ? parsePairs(dotBracket) : null;

    if (!pairs) {
        const allDots = dotBracket && !dotBracket.includes('(') && !dotBracket.includes(')');
        if (allDots) {
            return (
                <div className={`text-[13px] text-zinc-400 ${dk('dark:text-zinc-500')} italic py-1`}>
                    No secondary structure predicted
                </div>
            );
        }
        // Multiloop: try splitting into individual stem-loop domains and render
        // each as a separate HairpinSVG side by side.
        const stemGroups = valid ? splitStemGroups(seq, dotBracket) : null;
        if (stemGroups && stemGroups.length > 1) {
            return (
                <div className="flex gap-1 items-end justify-center overflow-x-auto">
                    {stemGroups.map((g, i) => (
                        <HairpinSVG key={i} seq={g.seq} dotBracket={g.dotBracket} light={light} />
                    ))}
                </div>
            );
        }
        // Pseudoknot / unparseable – show dot-bracket
        const blockPairs: string[] = [];
        for (let start = 0; start < Math.max(seq.length, dotBracket.length); start += 50) {
            blockPairs.push(`${seq.slice(start, start + 50)}\n${dotBracket.slice(start, start + 50)}`);
        }
        return (
            <pre className={`font-mono text-[13px] text-zinc-500 ${dk('dark:text-zinc-400')} whitespace-pre-wrap break-all overflow-x-auto`}>
                {blockPairs.join('\n\n')}
            </pre>
        );
    }

    // ── Layout constants ──────────────────────────────
    const baseR = 8;          // spacing reference (bond gaps, bounding box)
    const haloR = 5.5;        // visible halo radius behind each base letter
    const baseFont = 7.5;
    const stemGap = 36;       // horizontal distance between the two stem strands
    const stemStep = 22;      // vertical distance between stacked stem pairs
    const bulgeStep = 18;     // extra vertical room per unpaired bulge/internal-loop base
    const bulgeOffset = 15;   // how far bulge bases bow out from the strand
    const tailStep = 16;      // spacing for dangling 5'/3' tails

    const n = pairs.length;
    const L = seq.length;

    const firstL = pairs[0][0];
    const firstR = pairs[0][1];
    const lastL = pairs[n - 1][0];
    const lastR = pairs[n - 1][1];

    const leftTailLen = firstL;            // indices 0 .. firstL-1
    const rightTailLen = L - 1 - firstR;   // indices firstR+1 .. L-1
    const loopLen = lastR - lastL - 1;     // indices lastL+1 .. lastR-1

    const cx = 100 + leftTailLen * tailStep + bulgeOffset;
    const leftX = cx - stemGap / 2;
    const rightX = cx + stemGap / 2;
    const stemBottomY = 170;

    // Vertical level of each stem rung (outermost at bottom, innermost at top)
    const levels: number[] = new Array(n);
    levels[0] = stemBottomY;
    for (let k = 1; k < n; k++) {
        const leftGap = pairs[k][0] - pairs[k - 1][0] - 1;
        const rightGap = pairs[k - 1][1] - pairs[k][1] - 1;
        const gap = Math.max(leftGap, rightGap);
        levels[k] = levels[k - 1] - stemStep - gap * bulgeStep;
    }
    const stemTopY = levels[n - 1];

    // ── Position every base by sequence index ──────────
    const pos: Array<{ x: number; y: number } | null> = new Array(L).fill(null);

    // 5' tail – horizontal, going left from the bottom stem
    for (let i = 0; i < leftTailLen; i++) {
        pos[i] = { x: leftX - (leftTailLen - i) * tailStep, y: stemBottomY };
    }
    // 3' tail – horizontal, going right from the bottom stem
    for (let t = 0; t < rightTailLen; t++) {
        const idx = firstR + 1 + t;
        pos[idx] = { x: rightX + (t + 1) * tailStep, y: stemBottomY };
    }

    // Stem rungs
    for (let k = 0; k < n; k++) {
        pos[pairs[k][0]] = { x: leftX, y: levels[k] };
        pos[pairs[k][1]] = { x: rightX, y: levels[k] };
    }

    // Bulge / internal-loop bases between consecutive rungs
    for (let k = 1; k < n; k++) {
        const yLow = levels[k - 1];
        const yHigh = levels[k];
        // left side: indices pairs[k-1][0]+1 .. pairs[k][0]-1
        const lStart = pairs[k - 1][0] + 1;
        const lEnd = pairs[k][0] - 1;
        const lCount = lEnd - lStart + 1;
        for (let m = 0; m < lCount; m++) {
            const frac = (m + 1) / (lCount + 1);
            pos[lStart + m] = {
                x: leftX - bulgeOffset,
                y: yLow - (yLow - yHigh) * frac,
            };
        }
        // right side: indices pairs[k][1]+1 .. pairs[k-1][1]-1
        const rStart = pairs[k][1] + 1;
        const rEnd = pairs[k - 1][1] - 1;
        const rCount = rEnd - rStart + 1;
        for (let m = 0; m < rCount; m++) {
            const frac = (m + 1) / (rCount + 1);
            // order along 3'→5'? sequence index increases from rStart, which
            // sits just above the inner rung; place top→bottom accordingly.
            pos[rStart + m] = {
                x: rightX + bulgeOffset,
                y: yHigh + (yLow - yHigh) * frac,
            };
        }
    }

    // Loop bases – distributed along a semicircle above the top rung
    const arcCx = cx;
    const arcCy = stemTopY - baseR - 6;
    const arcR = Math.max(stemGap / 2, (loopLen * 9) / Math.PI);
    if (loopLen > 0) {
        const angleStep = Math.PI / (loopLen + 1);
        for (let m = 0; m < loopLen; m++) {
            const idx = lastL + 1 + m;
            const angle = Math.PI + angleStep * (m + 1); // π (left) → 2π (right)
            pos[idx] = {
                x: arcCx + arcR * Math.cos(angle),
                y: arcCy + arcR * Math.sin(angle),
            };
        }
    }

    // ── Build SVG elements ─────────────────────────────
    const elements: React.ReactElement[] = [];

    // Backbone: one continuous polyline through consecutive bases
    for (let i = 0; i < L - 1; i++) {
        const a = pos[i], b = pos[i + 1];
        if (!a || !b) continue;
        elements.push(
            <line key={`bb-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="#94a3b8" strokeWidth={1} opacity={0.35} />
        );
    }

    // Base-pair bonds (rungs)
    for (let k = 0; k < n; k++) {
        const a = pos[pairs[k][0]]!, b = pos[pairs[k][1]]!;
        const sym = basePairSymbol(seq[pairs[k][0]], seq[pairs[k][1]]);
        if (sym === 'none') continue;
        elements.push(
            <line key={`bond-${k}`}
                x1={a.x + baseR + 1} y1={a.y} x2={b.x - baseR - 1} y2={b.y}
                stroke={sym === 'wc' ? '#818cf8' : '#f59e0b'}
                strokeWidth={1.5}
                opacity={sym === 'wc' ? 0.6 : 0.5}
                strokeDasharray={sym === 'wc' ? undefined : '2,2'} />
        );
    }

    // Bases (drawn last so they sit on top of lines)
    for (let i = 0; i < L; i++) {
        const p = pos[i];
        if (!p) continue;
        const base = seq[i];
        elements.push(
            <g key={`base-${i}`}>
                <circle cx={p.x} cy={p.y} r={haloR} fill={baseColor(base)} opacity={0.18} />
                <text x={p.x} y={p.y + 0.5}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize={baseFont} fontFamily="monospace" fontWeight="bold"
                    fill={baseColor(base)}>
                    {base.toUpperCase()}
                </text>
            </g>
        );
    }

    // 5' / 3' labels
    const fivePrimeX = leftTailLen > 0 ? pos[0]!.x - 16 : leftX - 18;
    elements.push(
        <text key="5p" x={fivePrimeX} y={stemBottomY + 1}
            textAnchor="middle" dominantBaseline="central"
            fontSize={13} fontFamily="sans-serif" fontWeight="bold" fill="#818cf8">
            5'
        </text>
    );
    const threePrimeX = rightTailLen > 0 ? pos[L - 1]!.x + 16 : rightX + 18;
    elements.push(
        <text key="3p" x={threePrimeX} y={stemBottomY + 1}
            textAnchor="middle" dominantBaseline="central"
            fontSize={13} fontFamily="sans-serif" fontWeight="bold" fill="#fb923c">
            3'
        </text>
    );

    // ── Bounding box from all placed points ────────────
    let minX = fivePrimeX, maxX = threePrimeX, minY = arcCy - arcR, maxY = stemBottomY;
    for (let i = 0; i < L; i++) {
        const p = pos[i];
        if (!p) continue;
        minX = Math.min(minX, p.x - baseR);
        maxX = Math.max(maxX, p.x + baseR);
        minY = Math.min(minY, p.y - baseR);
        maxY = Math.max(maxY, p.y + baseR);
    }
    const pad = 8;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;

    return (
        <svg
            viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
            width="100%"
            style={{ maxHeight: '220px' }}
            preserveAspectRatio="xMidYMid meet"
            className="cursor-zoom-in"
            role="button"
            aria-label="Open structure in a new tab"
            onClick={(e) => openSvgInNewTab(e.currentTarget, 'Hairpin structure')}
        >
            <title>Click to open in a new tab</title>
            {elements}
        </svg>
    );
}
