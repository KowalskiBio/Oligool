import React from 'react';

interface DimerSVGProps {
    seq: string; // contains '&'
    dotBracket: string; // contains '&'
}

// Color bases by type - matching HairpinSVG
function baseColor(b: string): string {
    switch (b.toUpperCase()) {
        case 'A': return '#e74c3c'; // red
        case 'T': case 'U': return '#3498db'; // blue
        case 'G': return '#f39c12'; // amber
        case 'C': return '#2ecc71'; // green
        default: return '#94a3b8';
    }
}

function basePairSymbol(a: string, b: string): string {
    const pair = (a + b).toUpperCase();
    const watson = ['AT', 'TA', 'AU', 'UA', 'GC', 'CG'];
    const wobble = ['GT', 'TG', 'GU', 'UG'];
    if (watson.includes(pair)) return '|';
    if (wobble.includes(pair)) return '·';
    return ' ';
}

export default function DimerSVG({ seq, dotBracket }: DimerSVGProps) {
    if (!seq || !dotBracket || !seq.includes('&')) {
        return <div className="text-[10px] text-slate-400 italic">Invalid dimer structure</div>;
    }

    const [seq1, seq2] = seq.split('&');
    let [db1, db2] = dotBracket.split('&');

    // ViennaRNA sometimes omits '&' from cofold structure output — recover by splitting at seq1.length
    if (!db2 && dotBracket.length === seq1.length + seq2.length) {
        db1 = dotBracket.slice(0, seq1.length);
        db2 = dotBracket.slice(seq1.length);
    }

    if (!db1 || !db2 || !seq1 || !seq2 || seq1.length !== db1.length || seq2.length !== db2.length) {
        console.error('[DimerSVG] mismatch', { seq, dotBracket, seq1, seq2, db1, db2 });
        return <div className="text-[10px] text-slate-400 italic">Structure mismatch</div>;
    }

    // Layout constants
    const baseR = 8;
    const baseFont = 7.5;
    const horizontalStep = 22;
    const verticalGap = 40;
    const padding = 30;

    const fullSeq = seq1 + seq2;
    const fullDb = db1 + db2;
    const splitPoint = seq1.length;

    // Parse pairs
    const pairs: [number, number, boolean][] = [];
    const stack: { idx: number }[] = [];
    for (let i = 0; i < fullDb.length; i++) {
        if (fullDb[i] === '(') {
            stack.push({ idx: i });
        } else if (fullDb[i] === ')') {
            const open = stack.pop();
            if (open) {
                const isInter = (open.idx < splitPoint) !== (i < splitPoint);
                pairs.push([open.idx, i, isInter]);
            }
        }
    }

    // Compute horizontal offset for bottom strand so paired bases align vertically.
    // For an inter-strand pair (idx1, idx2): top x = idx1*step, bottom x (no offset) = (seq2.length-1-idx2)*step.
    // Required shift = idx1*step - (seq2.length-1-idx2)*step = (idx1+idx2-(seq2.length-1))*step
    const interPairs = pairs.filter(([,, isInter]) => isInter);
    let botShift = 0;
    if (interPairs.length > 0) {
        const offsets = interPairs.map(([i, j]) => {
            const idx1 = i < splitPoint ? i : j;
            const idx2 = (i < splitPoint ? j : i) - splitPoint;
            return (idx1 + idx2 - (seq2.length - 1)) * horizontalStep;
        });
        offsets.sort((a, b) => a - b);
        botShift = offsets[Math.floor(offsets.length / 2)]; // median
    }

    // Compute canvas bounds
    const topLeft = padding;
    const topRight = padding + (seq1.length - 1) * horizontalStep;
    const botLeft = padding + botShift;
    const botRight = padding + botShift + (seq2.length - 1) * horizontalStep;
    const canvasLeft = Math.min(topLeft, botLeft);
    const canvasRight = Math.max(topRight, botRight);
    const xOff = canvasLeft < 0 ? -canvasLeft + padding : 0; // extra left margin if bottom shifts negative
    const svgW = canvasRight - canvasLeft + padding * 2;
    const svgH = verticalGap + padding * 2;
    const topY = padding;
    const botY = padding + verticalGap;

    const top = (i: number) => xOff + padding + i * horizontalStep;
    // Bottom strand drawn right-to-left in memory so seq2[0]=3', seq2[n-1]=5'
    const bot = (idx2: number) => xOff + padding + botShift + (seq2.length - 1 - idx2) * horizontalStep;

    const elements: React.ReactElement[] = [];

    const renderBase = (x: number, y: number, base: string, key: string, label?: string) => (
        <g key={key}>
            <circle cx={x} cy={y} r={baseR} fill={baseColor(base)} opacity={0.15} />
            <text
                x={x} y={y + 0.5}
                textAnchor="middle" dominantBaseline="central"
                fontSize={baseFont} fontFamily="monospace" fontWeight="bold"
                fill={baseColor(base)}
            >
                {base.toUpperCase()}
            </text>
            {label && (
                <text x={x} y={y + (y === topY ? -12 : 12)} textAnchor="middle" fontSize={8} fill="#94a3b8" fontWeight="bold">
                    {label}
                </text>
            )}
        </g>
    );

    // Top strand (5'→3')
    for (let i = 0; i < seq1.length; i++) {
        const x = top(i);
        elements.push(renderBase(x, topY, seq1[i], `s1-${i}`, i === 0 ? "5'" : i === seq1.length - 1 ? "3'" : undefined));
        if (i < seq1.length - 1) {
            elements.push(
                <line key={`bb1-${i}`} x1={x + baseR} y1={topY} x2={top(i + 1) - baseR} y2={topY}
                    stroke="#94a3b8" strokeWidth={1} opacity={0.3} />
            );
        }
    }

    // Bottom strand drawn antiparallel: seq2[n-1] (3' end) leftmost, seq2[0] (5' end) rightmost
    for (let i = 0; i < seq2.length; i++) {
        const x = bot(i);
        elements.push(renderBase(x, botY, seq2[i], `s2-${i}`, i === 0 ? "5'" : i === seq2.length - 1 ? "3'" : undefined));
        if (i < seq2.length - 1) {
            elements.push(
                <line key={`bb2-${i}`} x1={x - baseR} y1={botY} x2={bot(i + 1) + baseR} y2={botY}
                    stroke="#94a3b8" strokeWidth={1} opacity={0.3} />
            );
        }
    }

    // Bonds
    pairs.forEach(([i, j, isInter], idx) => {
        if (isInter) {
            const idx1 = i < splitPoint ? i : j;
            const idx2 = (i < splitPoint ? j : i) - splitPoint;
            const x1 = top(idx1);
            const x2 = bot(idx2);
            const sym = basePairSymbol(fullSeq[i], fullSeq[j]);
            const isWobble = sym === '·';
            elements.push(
                <line key={`bond-${idx}`}
                    x1={x1} y1={topY + baseR + 2} x2={x2} y2={botY - baseR - 2}
                    stroke={isWobble ? "#f59e0b" : "#818cf8"}
                    strokeWidth={1.5}
                    opacity={isWobble ? 0.5 : 0.6}
                    strokeDasharray={isWobble ? "2,2" : "0"} />
            );
        } else {
            const sIdx1 = i < splitPoint ? i : i - splitPoint;
            const sIdx2 = j < splitPoint ? j : j - splitPoint;
            const strand = i < splitPoint ? 1 : 2;
            const y = strand === 1 ? topY : botY;
            const x1 = strand === 1 ? top(sIdx1) : bot(sIdx1);
            const x2 = strand === 1 ? top(sIdx2) : bot(sIdx2);
            const r = Math.abs(x1 - x2) / 2;
            const sweep = strand === 1 ? 0 : 1;
            elements.push(
                <path key={`intra-${idx}`}
                    d={`M ${x1} ${y + (strand === 1 ? -baseR : baseR)} A ${r} ${r / 2} 0 0 ${sweep} ${x2} ${y + (strand === 1 ? -baseR : baseR)}`}
                    fill="none" stroke="#94a3b8" strokeWidth={1} opacity={0.4} />
            );
        }
    });

    return (
        <div className="w-full">
            <svg
                viewBox={`0 0 ${svgW} ${svgH}`}
                width="100%"
                style={{ maxHeight: '120px' }}
                className="mx-auto"
            >
                {elements}
            </svg>
        </div>
    );
}
