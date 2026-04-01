import React from 'react';
import { createPortal } from 'react-dom';
import type { MOLigoProps } from './MOLigoPanel';

interface HighlightRange {
    start: number;
    end: number;
    color: string;
    bgColor?: string;
    bold?: boolean;
    underline?: boolean;
}

export default function MOLigoReport(props: MOLigoProps) {
    const { templateSeq, moligo1Seq, moligo2Seq, tagSeq, fwdPrimer, revPrimer, queryId, jobName } = props;

    // Helper functions for thermodynamic data mock if not exact
    const gcContent = (seq: string) => ((seq.match(/[GCgc]/g) || []).length / (seq.length || 1) * 100).toFixed(1);

    // Compute basic reverse complements
    const reverseComplement = (s: string) => {
        const dict: { [key: string]: string } = { 'A': 'T', 'T': 'A', 'C': 'G', 'G': 'C', 'N': 'N', 'a': 't', 't': 'a', 'c': 'g', 'g': 'c', 'n': 'n' };
        return s.split('').reverse().map(c => dict[c] || c).join('');
    };

    const fwdRCSeq = reverseComplement(fwdPrimer || "");

    // Build the format block for sequence matching
    // We try to find where M2 and M1 map in the templateSeq
    // Note: If they map to the reverse strand, finding exact match might fail without revcomp, 
    // but MOLigoPanel claims they bind directly to the (5'->3') strand shown
    
    let m2Start = templateSeq.toUpperCase().indexOf(moligo2Seq.toUpperCase());
    let m1Start = templateSeq.toUpperCase().indexOf(moligo1Seq.toUpperCase());

    const highlights: HighlightRange[] = [];
    if (m2Start >= 0) {
        highlights.push({ start: m2Start, end: m2Start + moligo2Seq.length, color: 'black', bgColor: '#4ade80' }); // Green marker
    }
    if (m1Start >= 0) {
        // As per the image, maybe yellow and red underlines
        // If there's a TAG sequence in the template (rare, but let's highlight M1 differently)
        const half = Math.floor(moligo1Seq.length / 2);
        highlights.push({ start: m1Start, end: m1Start + half, color: 'black', bgColor: '#facc15' }); // Yellow marker
        highlights.push({ start: m1Start + half, end: m1Start + moligo1Seq.length, color: 'red', bold: true, underline: true }); // Red underline marker
    }

    const formatGenBankSeq = (seq: string, offset = 1) => {
        const lines = [];
        const LINE_LEN = 60;
        
        for (let i = 0; i < seq.length; i += LINE_LEN) {
            const lineChunk = seq.slice(i, i + LINE_LEN);
            // Prefix line number (right aligned to 9 chars like standard format)
            const lineNum = (i + offset).toString().padStart(9, ' ');
            
            // Format chunks of 10
            const chunks = [];
            for (let j = 0; j < lineChunk.length; j += 10) {
                chunks.push(lineChunk.slice(j, j + 10));
            }
            
            let formattedLine = lineNum + " " + chunks.join(" ");
            lines.push({ start: i, end: i + LINE_LEN, relativeStart: i, formattedLine, chunks: lineChunk });
        }
        
        // This is a complex task: injecting HTML <mark> tags into a text blob properly without mutating react children haphazardly
        // A simpler way for the report: output characters one by one with inline spans based on highlights
        const renderHighlightedChars = () => {
            const result = [];
            let currentLine = [];
            
            for (let i = 0; i < seq.length; i++) {
                // Determine if char is in any highlight
                let activeHighlight = highlights.find(h => i >= h.start && i < h.end);
                
                let style: React.CSSProperties = {};
                if (activeHighlight) {
                    if (activeHighlight.color) style.color = activeHighlight.color;
                    if (activeHighlight.bgColor) style.backgroundColor = activeHighlight.bgColor;
                    if (activeHighlight.bold) style.fontWeight = 'bold';
                    if (activeHighlight.underline) style.textDecoration = 'underline';
                    if (activeHighlight.underline && activeHighlight.color) {
                        // Make the underline explicitly red and thick for visibility on print
                        style.textDecorationColor = activeHighlight.color;
                        style.textDecorationThickness = '2px';
                    }
                }
                
                // Add char
                currentLine.push(<span key={`c${i}`} style={style}>{seq[i].toLowerCase()}</span>);
                
                // Add space every 10
                if ((i + 1) % 10 === 0 && (i + 1) % 60 !== 0 && i !== seq.length - 1) {
                    currentLine.push(<span key={`s${i}`}> </span>);
                }
                
                // End of line
                if ((i + 1) % 60 === 0 || i === seq.length - 1) {
                    const lineNum = (i - (i % 60) + offset).toString().padStart(9, ' ').replace(/ /g, '\u00A0');
                    result.push(
                        <div key={`l${i}`} style={{ display: 'flex' }}>
                            <span style={{ width: '80px', flexShrink: 0, textAlign: 'right', paddingRight: '8px' }}>{lineNum}</span>
                            <span>{currentLine}</span>
                        </div>
                    );
                    currentLine = [];
                }
            }
            return result;
        };

        return <div style={{ whiteSpace: 'preWrap' }}>{renderHighlightedChars()}</div>;
    };

    const reportNode = (
        <div className="printable-report" style={{ display: 'none', fontFamily: 'monospace', padding: '40px', fontSize: '11px', lineHeight: '1.4', color: 'black', backgroundColor: 'white' }}>
            
            <div style={{ marginBottom: '20px' }}>
                <div>Nový design vazba přímo na koule</div>
                <div>{jobName || "Target Name Not Provided"}</div>
                <div>GenBank: <span style={{ textDecoration: 'underline' }}>{queryId?.split("|")[3] || queryId || "Unknown"}</span></div>
            </div>

            <div style={{ marginBottom: '20px' }}>
                <pre style={{ margin: 0 }}>
{`Go to:
LOCUS       ${(queryId?.split("|")[3] || queryId || "Unknown").padEnd(15, ' ')}  ${templateSeq.length} bp    DNA    circular  VRL 01-JAN-2024
DEFINITION  ${jobName || "Unknown Definition"}
ACCESSION   ${queryId?.split("|")[3] || queryId || "Unknown"}
VERSION     ${queryId?.split("|")[3] || queryId || "Unknown"}
KEYWORDS    complete genome.`}
                </pre>
            </div>

            <div style={{ marginBottom: '40px', fontFamily: '"Courier New", Courier, monospace', fontWeight: 500, letterSpacing: '0px' }}>
                {formatGenBankSeq(templateSeq)}
            </div>

            <div style={{ marginBottom: '20px' }}>
                <div>3' raménko (10mM MgCl2)</div>
                <br/>
                <pre style={{ margin: 0, fontFamily: 'monospace' }}>
{`SEQUENCE        5'- ${moligo1Seq.replace(/(.{3})/g, '$1 ').trim()} -3'
COMPLEMENT      5'- ${reverseComplement(moligo1Seq).replace(/(.{3})/g, '$1 ').trim()} -3'
LENGTH          ${moligo1Seq.length}
GC CONTENT      ${gcContent(moligo1Seq)} %`}
                </pre>
            </div>

            <div style={{ marginBottom: '20px' }}>
                <div>5' raménko (10mM MgCl2)</div>
                <br/>
                <pre style={{ margin: 0, fontFamily: 'monospace' }}>
{`SEQUENCE        5'- ${moligo2Seq.replace(/(.{3})/g, '$1 ').trim()} -3'
COMPLEMENT      5'- ${reverseComplement(moligo2Seq).replace(/(.{3})/g, '$1 ').trim()} -3'
LENGTH          ${moligo2Seq.length}
GC CONTENT      ${gcContent(moligo2Seq)} %`}
                </pre>
            </div>

            <div style={{ marginBottom: '30px', marginTop: '30px' }}>
                <div style={{ display: 'flex', marginBottom: '10px' }}>
                    <div style={{ width: '120px' }}>MOL1_TXX</div>
                    <div style={{ wordBreak: 'break-all' }}>
                        <span style={{ color: 'black' }}>{moligo1Seq.toLowerCase()}</span>
                        <b><span style={{ textTransform: 'uppercase' }}>{tagSeq}</span></b>
                        <span style={{ color: 'black' }}>{fwdRCSeq.toLowerCase()}</span>
                    </div>
                </div>
                <div style={{ display: 'flex' }}>
                    <div style={{ width: '120px' }}>MOL2_TXX</div>
                    <div style={{ wordBreak: 'break-all' }}>
                        <span style={{ textTransform: 'uppercase' }}>{revPrimer}</span>
                        <span style={{ color: 'black' }}>{moligo2Seq.toLowerCase()}</span>
                    </div>
                </div>
            </div>

            <div>
                <div style={{ marginBottom: '10px' }}>Produkt</div>
                <div style={{ wordBreak: 'break-all' }}>
                    <span style={{ textTransform: 'uppercase' }}>{revPrimer}</span>
                    <span>{moligo2Seq.toLowerCase()}{moligo1Seq.toLowerCase()}</span>
                    <b><span style={{ textTransform: 'uppercase' }}>{tagSeq}</span></b>
                    <span style={{ textTransform: 'uppercase' }}>{fwdRCSeq}</span>
                </div>
            </div>
        </div>
    );

    return createPortal(reportNode, document.body);
}
