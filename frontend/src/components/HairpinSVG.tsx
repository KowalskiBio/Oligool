/**
 * HairpinSVG – renders an RNA/DNA secondary structure from a sequence + dot-bracket
 * as a clean 2D SVG diagram with:
 *   • Vertical stem with base-pair bonds
 *   • Curved loop at the top
 *   • Dangling 5'/3' tails
 */
import React from 'react';

interface HairpinSVGProps {
    seq: string;
    dotBracket: string;
}

interface ParsedHairpin {
    leftTail: string[];
    stem5: string[];   // 5'→3' direction (left side going up)
    stem3: string[];   // 3'→5' direction (right side going down, reversed to match)
    loop: string[];
    rightTail: string[];
}

function parseHairpin(seq: string, db: string): ParsedHairpin | null {
    if (!seq || !db || seq.length !== db.length) return null;

    const leftTail: string[] = [];
    const stem5: string[] = [];
    const stem3: string[] = [];
    const loop: string[] = [];
    const rightTail: string[] = [];
    let state = 0; // 0=5'tail, 1=stem(, 2=loop, 3=stem), 4=3'tail

    for (let i = 0; i < db.length; i++) {
        const c = seq[i], d = db[i];
        if (state === 0 && d === '.') leftTail.push(c);
        else if (state === 0 && d === '(') { state = 1; stem5.push(c); }
        else if (state === 1 && d === '(') stem5.push(c);
        else if (state === 1 && d === '.') { state = 2; loop.push(c); }
        else if (state === 2 && d === '.') loop.push(c);
        else if (state === 2 && d === ')') { state = 3; stem3.unshift(c); }
        else if (state === 3 && d === ')') stem3.unshift(c);
        else if (state === 3 && d === '.') { state = 4; rightTail.push(c); }
        else if (state === 4 && d === '.') rightTail.push(c);
    }

    if (stem5.length === 0 || stem5.length !== stem3.length) return null;
    return { leftTail, stem5, stem3, loop, rightTail };
}

function basePairSymbol(a: string, b: string): string {
    const pair = (a + b).toUpperCase();
    const watson = ['AT', 'TA', 'AU', 'UA', 'GC', 'CG'];
    const wobble = ['GT', 'TG', 'GU', 'UG'];
    if (watson.includes(pair)) return '|';
    if (wobble.includes(pair)) return '·';
    return ' ';
}

// Color bases by type
function baseColor(b: string): string {
    switch (b.toUpperCase()) {
        case 'A': return '#e74c3c'; // red
        case 'T': case 'U': return '#3498db'; // blue
        case 'G': return '#f39c12'; // amber
        case 'C': return '#2ecc71'; // green
        default: return '#94a3b8';
    }
}

export default function HairpinSVG({ seq, dotBracket }: HairpinSVGProps) {
    const parsed = parseHairpin(seq, dotBracket);

    // Fallback for unparseable structures
    if (!parsed) {
        // All dots = no structure predicted
        const allDots = dotBracket && !dotBracket.includes('(') && !dotBracket.includes(')');
        if (allDots) {
            return (
                <div className="text-[10px] text-slate-400 dark:text-slate-500 italic py-1">
                    No secondary structure predicted
                </div>
            );
        }
        // Complex structure (multi-hairpin, pseudoknot) – show dot-bracket
        return (
            <pre className="font-mono text-[10px] text-slate-500 dark:text-slate-400 whitespace-pre">
                {seq}{'\n'}{dotBracket}
            </pre>
        );
    }

    const { leftTail, stem5, stem3, loop, rightTail } = parsed;

    // ── Layout constants ──────────────────────────────
    const baseR = 8;         // radius of base circles
    const baseFont = 7.5;    // font size for base letters
    const stemGap = 36;      // horizontal distance between stem sides
    const stemStep = 22;     // vertical distance between stem pairs
    const loopR = Math.max(20, (loop.length * 10) / Math.PI); // loop arc radius
    const tailStep = 16;     // spacing for dangling tails

    const stemLen = stem5.length;

    // Origin: the bottom of the stem
    const stemBottomY = 20 + Math.max(leftTail.length, rightTail.length) * tailStep;
    const stemTopY = stemBottomY - (stemLen - 1) * stemStep;
    const cx = 60 + leftTail.length * tailStep;  // center x between the two stem strands
    const leftX = cx - stemGap / 2;
    const rightX = cx + stemGap / 2;

    // Loop center is above the top of the stem
    const loopCenterY = stemTopY - loopR - 4;

    // SVG viewBox calculation
    const svgW = cx * 2 + 20;

    // ── Rendering helpers ──────────────────────────────
    const renderBase = (x: number, y: number, base: string, key: string) => (
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
        </g>
    );

    const elements: React.ReactElement[] = [];

    // ── 5' tail (horizontal, going left from stem bottom) ──
    for (let i = 0; i < leftTail.length; i++) {
        const tx = leftX - (leftTail.length - i) * tailStep;
        const ty = stemBottomY;
        elements.push(renderBase(tx, ty, leftTail[i], `lt-${i}`));
        // connector line
        if (i < leftTail.length - 1) {
            const nx = leftX - (leftTail.length - i - 1) * tailStep;
            elements.push(
                <line key={`ltl-${i}`} x1={tx + baseR} y1={ty} x2={nx - baseR} y2={ty}
                    stroke="#94a3b8" strokeWidth={1} opacity={0.4} />
            );
        }
    }
    // connector from last tail to first stem base
    if (leftTail.length > 0) {
        const lastTailX = leftX - tailStep;
        elements.push(
            <line key="lt-conn" x1={lastTailX + baseR} y1={stemBottomY} x2={leftX - baseR} y2={stemBottomY}
                stroke="#94a3b8" strokeWidth={1} opacity={0.4} />
        );
    }

    // ── 5' label ──
    const label5x = leftTail.length > 0
        ? leftX - leftTail.length * tailStep - 16
        : leftX - 18;
    elements.push(
        <text key="5p" x={label5x} y={stemBottomY + 1}
            textAnchor="middle" dominantBaseline="central"
            fontSize={8} fontFamily="sans-serif" fontWeight="bold" fill="#818cf8">
            5'
        </text>
    );

    // ── Stem pairs (bottom to top) ──────────────────────
    for (let i = 0; i < stemLen; i++) {
        const y = stemBottomY - i * stemStep;
        // Left base (5' strand going up)
        elements.push(renderBase(leftX, y, stem5[i], `s5-${i}`));
        // Right base (3' strand, reversed)
        elements.push(renderBase(rightX, y, stem3[i], `s3-${i}`));

        // Bond line between pair
        const sym = basePairSymbol(stem5[i], stem3[i]);
        if (sym !== ' ') {
            if (sym === '|') {
                elements.push(
                    <line key={`bond-${i}`}
                        x1={leftX + baseR + 2} y1={y} x2={rightX - baseR - 2} y2={y}
                        stroke="#818cf8" strokeWidth={1.5} opacity={0.6} />
                );
            } else {
                // wobble: dotted
                elements.push(
                    <line key={`bond-${i}`}
                        x1={leftX + baseR + 2} y1={y} x2={rightX - baseR - 2} y2={y}
                        stroke="#f59e0b" strokeWidth={1.5} opacity={0.5} strokeDasharray="2,2" />
                );
            }
        }

        // Backbone connectors along stem
        if (i > 0) {
            const prevY = stemBottomY - (i - 1) * stemStep;
            elements.push(
                <line key={`bb5-${i}`} x1={leftX} y1={prevY - baseR} x2={leftX} y2={y + baseR}
                    stroke="#94a3b8" strokeWidth={1} opacity={0.3} />
            );
            elements.push(
                <line key={`bb3-${i}`} x1={rightX} y1={prevY - baseR} x2={rightX} y2={y + baseR}
                    stroke="#94a3b8" strokeWidth={1} opacity={0.3} />
            );
        }
    }

    // ── Loop (arc at the top) ───────────────────────────
    if (loop.length > 0) {
        const topStemY = stemTopY;
        // Backbone from stem top to loop
        elements.push(
            <line key="bb5-loop" x1={leftX} y1={topStemY - baseR}
                x2={leftX} y2={topStemY - baseR - 6}
                stroke="#94a3b8" strokeWidth={1} opacity={0.3} />
        );
        elements.push(
            <line key="bb3-loop" x1={rightX} y1={topStemY - baseR}
                x2={rightX} y2={topStemY - baseR - 6}
                stroke="#94a3b8" strokeWidth={1} opacity={0.3} />
        );

        // Distribute loop bases along a semicircular arc from left to right
        const arcCx = cx;
        const arcCy = topStemY - baseR - 6;
        const arcR = stemGap / 2 + (loop.length > 2 ? (loop.length - 2) * 3 : 0);
        const totalAngle = Math.PI; // semicircle
        const angleStep = totalAngle / (loop.length + 1);

        for (let i = 0; i < loop.length; i++) {
            const angle = Math.PI + angleStep * (i + 1); // from left (π) to right (2π)
            const bx = arcCx + arcR * Math.cos(angle);
            const by = arcCy + arcR * Math.sin(angle);
            elements.push(renderBase(bx, by, loop[i], `loop-${i}`));

            // Arc backbone connectors
            if (i > 0) {
                const prevAngle = Math.PI + angleStep * i;
                const px = arcCx + arcR * Math.cos(prevAngle);
                const py = arcCy + arcR * Math.sin(prevAngle);
                elements.push(
                    <line key={`loopl-${i}`} x1={px} y1={py} x2={bx} y2={by}
                        stroke="#94a3b8" strokeWidth={1} opacity={0.3} />
                );
            }
        }

        // Connectors from stem ends to first/last loop base
        if (loop.length > 0) {
            const firstAngle = Math.PI + angleStep;
            const fx = arcCx + arcR * Math.cos(firstAngle);
            const fy = arcCy + arcR * Math.sin(firstAngle);
            elements.push(
                <line key="stem-loop-l" x1={leftX} y1={arcCy} x2={fx} y2={fy}
                    stroke="#94a3b8" strokeWidth={1} opacity={0.3} />
            );

            const lastAngle = Math.PI + angleStep * loop.length;
            const lx = arcCx + arcR * Math.cos(lastAngle);
            const ly = arcCy + arcR * Math.sin(lastAngle);
            elements.push(
                <line key="stem-loop-r" x1={rightX} y1={arcCy} x2={lx} y2={ly}
                    stroke="#94a3b8" strokeWidth={1} opacity={0.3} />
            );
        }
    } else {
        // No loop: just connect the two sides with a curved line
        const topY = stemTopY;
        elements.push(
            <path key="noloop"
                d={`M ${leftX} ${topY - baseR} Q ${cx} ${topY - 20} ${rightX} ${topY - baseR}`}
                fill="none" stroke="#94a3b8" strokeWidth={1} opacity={0.4} />
        );
    }

    // ── 3' tail (horizontal, going right from stem bottom) ──
    for (let i = 0; i < rightTail.length; i++) {
        const tx = rightX + (i + 1) * tailStep;
        const ty = stemBottomY;
        elements.push(renderBase(tx, ty, rightTail[i], `rt-${i}`));
        if (i === 0) {
            elements.push(
                <line key="rt-conn" x1={rightX + baseR} y1={stemBottomY} x2={tx - baseR} y2={ty}
                    stroke="#94a3b8" strokeWidth={1} opacity={0.4} />
            );
        } else {
            const px = rightX + i * tailStep;
            elements.push(
                <line key={`rtl-${i}`} x1={px + baseR} y1={ty} x2={tx - baseR} y2={ty}
                    stroke="#94a3b8" strokeWidth={1} opacity={0.4} />
            );
        }
    }

    // ── 3' label ──
    const label3x = rightTail.length > 0
        ? rightX + rightTail.length * tailStep + 16
        : rightX + 18;
    elements.push(
        <text key="3p" x={label3x} y={stemBottomY + 1}
            textAnchor="middle" dominantBaseline="central"
            fontSize={8} fontFamily="sans-serif" fontWeight="bold" fill="#fb923c">
            3'
        </text>
    );

    // Final SVG dimensions – compute bounding box
    const minX = Math.min(0, label5x - 16);
    const maxX = Math.max(svgW, label3x + 16, rightX + rightTail.length * tailStep + 30);
    const minY = loop.length > 0 ? loopCenterY - loopR - 14 : stemTopY - 30;
    const maxY = stemBottomY + 16;
    const finalW = maxX - minX;
    const finalH = maxY - minY;

    return (
        <svg
            viewBox={`${minX} ${minY} ${finalW} ${finalH}`}
            width="100%"
            style={{ maxHeight: '160px' }}
            preserveAspectRatio="xMidYMid meet"
        >
            {elements}
        </svg>
    );
}
