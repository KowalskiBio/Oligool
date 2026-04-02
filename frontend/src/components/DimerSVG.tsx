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
    const [db1, db2] = dotBracket.split('&');

    if (!db1 || !db2 || seq1.length !== db1.length || seq2.length !== db2.length) {
        return <div className="text-[10px] text-slate-400 italic">Structure mismatch</div>;
    }

    // Layout constants
    const baseR = 8;
    const baseFont = 7.5;
    const horizontalStep = 22;
    const verticalGap = 40;
    const padding = 30;

    const maxLen = Math.max(seq1.length, seq2.length);
    const svgW = maxLen * horizontalStep + padding * 2;
    const svgH = verticalGap + padding * 2;

    const topY = padding;
    const botY = padding + verticalGap;

    // Pairing Logic
    // We need to find which indices in seq1 pair with which in seq2
    // ViennaRNA dimer notation: ( and ) can cross the &
    const pairs: [number, number, boolean][] = []; // [idx1, idx2, isInter]
    const stack: { idx: number, strand: number }[] = [];

    const fullSeq = seq1 + seq2;
    const fullDb = db1 + db2;
    const splitPoint = seq1.length;

    for (let i = 0; i < fullDb.length; i++) {
        if (fullDb[i] === '(') {
            stack.push({ idx: i, strand: i < splitPoint ? 1 : 2 });
        } else if (fullDb[i] === ')') {
            const open = stack.pop();
            if (open) {
                const isInter = (open.idx < splitPoint) !== (i < splitPoint);
                pairs.push([open.idx, i, isInter]);
            }
        }
    }

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

    // Draw Top Strand (5' -> 3')
    for (let i = 0; i < seq1.length; i++) {
        const x = padding + i * horizontalStep;
        elements.push(renderBase(x, topY, seq1[i], `s1-${i}`, i === 0 ? "5'" : i === seq1.length - 1 ? "3'" : undefined));
        if (i < seq1.length - 1) {
            elements.push(
                <line key={`bb1-${i}`} x1={x + baseR} y1={topY} x2={x + horizontalStep - baseR} y2={topY}
                    stroke="#94a3b8" strokeWidth={1} opacity={0.3} />
            );
        }
    }

    // Draw Bottom Strand (3' -> 5') - often dimers are antiparallel
    // We render seq2 from right to left to show pairing naturally if they are complementary
    for (let i = 0; i < seq2.length; i++) {
        const x = padding + (seq2.length - 1 - i) * horizontalStep;
        elements.push(renderBase(x, botY, seq2[i], `s2-${i}`, i === 0 ? "3'" : i === seq2.length - 1 ? "5'" : undefined));
        if (i < seq2.length - 1) {
            const nextX = padding + (seq2.length - 2 - i) * horizontalStep;
            elements.push(
                <line key={`bb2-${i}`} x1={x - baseR} y1={botY} x2={nextX + baseR} y2={botY}
                    stroke="#94a3b8" strokeWidth={1} opacity={0.3} />
            );
        }
    }

    // Draw Bonds
    pairs.forEach(([i, j, isInter], idx) => {
        if (isInter) {
            // Pair between strand 1 and strand 2
            const idx1 = i < splitPoint ? i : j;
            const idx2 = (i < splitPoint ? j : i) - splitPoint;
            
            const x1 = padding + idx1 * horizontalStep;
            const x2 = padding + (seq2.length - 1 - idx2) * horizontalStep;

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
            // Intra-strand pair (bulge/hairpin within dimer)
            // Just draw a small arc
            const sIdx1 = i < splitPoint ? i : i - splitPoint;
            const sIdx2 = j < splitPoint ? j : j - splitPoint;
            const strand = i < splitPoint ? 1 : 2;
            const y = strand === 1 ? topY : botY;
            
            const x1 = padding + (strand === 1 ? sIdx1 : seq2.length - 1 - sIdx1) * horizontalStep;
            const x2 = padding + (strand === 1 ? sIdx2 : seq2.length - 1 - sIdx2) * horizontalStep;
            
            const r = Math.abs(x1 - x2) / 2;
            const sweep = strand === 1 ? 0 : 1;

            elements.push(
                <path key={`intra-${idx}`}
                    d={`M ${x1} ${y + (strand === 1 ? -baseR : baseR)} A ${r} ${r/2} 0 0 ${sweep} ${x2} ${y + (strand === 1 ? -baseR : baseR)}`}
                    fill="none" stroke="#94a3b8" strokeWidth={1} opacity={0.4} />
            );
        }
    });

    return (
        <div className="w-full overflow-x-auto">
            <svg
                viewBox={`0 0 ${svgW} ${svgH}`}
                width={Math.max(svgW, 300)}
                style={{ maxHeight: '120px' }}
                className="mx-auto"
            >
                {elements}
            </svg>
        </div>
    );
}
