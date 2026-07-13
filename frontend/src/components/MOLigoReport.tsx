import React from 'react';
import { createPortal } from 'react-dom';
import type { MOLigoProps, IdtRawResult } from './MOLigoPanel';

interface HighlightRange {
    start: number;
    end: number;
    color: string;
    bgColor?: string;
    bold?: boolean;
    underline?: boolean;
}

export default function MOLigoReport(props: MOLigoProps) {
    const { templateSeq, moligo1Seq, moligo2Seq, tagSeq, fwdPrimer, revPrimer, queryId, jobName, reportData } = props;

    const gcContent = (seq: string) => ((seq.match(/[GCgc]/g) || []).length / (seq.length || 1) * 100).toFixed(1);

    const reverseComplement = (s: string) => {
        const dict: { [key: string]: string } = { 'A': 'T', 'T': 'A', 'C': 'G', 'G': 'C', 'N': 'N', 'a': 't', 't': 'a', 'c': 'g', 'g': 'c', 'n': 'n' };
        return s.split('').reverse().map(c => dict[c] || c).join('');
    };

    const fwdRCSeq = reverseComplement(fwdPrimer || "");

    const extractBestTm = (raw: IdtRawResult | undefined): number | undefined => {
        if (!raw) return undefined;
        if (Array.isArray(raw)) {
            for (const item of raw) {
                const tm = item?.IDT_Tm ?? item?.Local_Tm ?? item?.Tm;
                if (tm !== undefined && tm !== null) return Number(tm);
            }
            return undefined;
        }
        const tm = raw.IDT_Tm ?? raw.Local_Tm ?? raw.Tm;
        return tm !== undefined && tm !== null ? Number(tm) : undefined;
    };

    const dgStr = (v?: number) => v !== undefined ? `${v.toFixed(2)} kcal/mol` : 'N/A';
    const tmStr = (raw?: IdtRawResult | undefined) => {
        const tm = extractBestTm(raw);
        return tm !== undefined ? `${tm.toFixed(1)} °C` : 'N/A';
    };

    const m2Start = templateSeq.toUpperCase().indexOf(moligo2Seq.toUpperCase());
    const m1Start = templateSeq.toUpperCase().indexOf(moligo1Seq.toUpperCase());

    const highlights: HighlightRange[] = [];
    if (m2Start >= 0) {
        highlights.push({ start: m2Start, end: m2Start + moligo2Seq.length, color: 'black', bgColor: '#4ade80' });
    }
    if (m1Start >= 0) {
        const half = Math.floor(moligo1Seq.length / 2);
        highlights.push({ start: m1Start, end: m1Start + half, color: 'black', bgColor: '#facc15' });
        highlights.push({ start: m1Start + half, end: m1Start + moligo1Seq.length, color: 'red', bold: true, underline: true });
    }

    const formatGenBankSeq = (seq: string, offset = 1) => {
        const renderHighlightedChars = () => {
            const result = [];
            let currentLine: React.ReactNode[] = [];

            for (let i = 0; i < seq.length; i++) {
                const activeHighlight = highlights.find(h => i >= h.start && i < h.end);
                const style: React.CSSProperties = {};
                if (activeHighlight) {
                    if (activeHighlight.color) style.color = activeHighlight.color;
                    if (activeHighlight.bgColor) style.backgroundColor = activeHighlight.bgColor;
                    if (activeHighlight.bold) style.fontWeight = 'bold';
                    if (activeHighlight.underline) style.textDecoration = 'underline';
                    if (activeHighlight.underline && activeHighlight.color) {
                        style.textDecorationColor = activeHighlight.color;
                        style.textDecorationThickness = '2px';
                    }
                }

                currentLine.push(<span key={`c${i}`} style={style}>{seq[i].toLowerCase()}</span>);

                if ((i + 1) % 10 === 0 && (i + 1) % 60 !== 0 && i !== seq.length - 1) {
                    currentLine.push(<span key={`s${i}`}> </span>);
                }

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

    const ThermoRow = ({ label, hairpinDg, hairpinRaw, dimerDg }: { label: string; hairpinDg?: number; hairpinRaw?: IdtRawResult | undefined; dimerDg?: number }) => (
        <div style={{ display: 'flex', marginBottom: '6px' }}>
            <div style={{ width: '180px', fontWeight: 'bold' }}>{label}</div>
            <div style={{ flex: 1 }}>
                Hairpin ΔG: {dgStr(hairpinDg)} (Tm: {tmStr(hairpinRaw)})&nbsp;&nbsp;|&nbsp;&nbsp;
                Self-Dimer ΔG: {dgStr(dimerDg)}
            </div>
        </div>
    );

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

            {reportData && (
                <div style={{ marginBottom: '30px', borderTop: '1px solid black', paddingTop: '20px' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '12px', fontSize: '13px' }}>Thermodynamic Analysis</div>
                    <ThermoRow
                        label="MOLIGO 1 (M1)"
                        hairpinDg={reportData.moligo1?.hairpin?.DeltaG}
                        hairpinRaw={reportData.moligo1?.hairpin?.raw}
                        dimerDg={reportData.moligo1?.self_dimer?.DeltaG}
                    />
                    <ThermoRow
                        label="MOLIGO 2 (M2)"
                        hairpinDg={reportData.moligo2?.hairpin?.DeltaG}
                        hairpinRaw={reportData.moligo2?.hairpin?.raw}
                        dimerDg={reportData.moligo2?.self_dimer?.DeltaG}
                    />
                    <ThermoRow
                        label="Forward Primer"
                        hairpinDg={reportData.fwdPrimer?.hairpin?.DeltaG}
                        hairpinRaw={reportData.fwdPrimer?.hairpin?.raw}
                        dimerDg={reportData.fwdPrimer?.self_dimer?.DeltaG}
                    />
                    <ThermoRow
                        label="Reverse Primer"
                        hairpinDg={reportData.revPrimer?.hairpin?.DeltaG}
                        hairpinRaw={reportData.revPrimer?.hairpin?.raw}
                        dimerDg={reportData.revPrimer?.self_dimer?.DeltaG}
                    />
                    <div style={{ marginTop: '12px' }}>
                        M1–M2 Hetero-Dimer ΔG: {dgStr(reportData.moligoPairwise?.DeltaG)}&nbsp;&nbsp;|&nbsp;&nbsp;
                        Fwd–Rev Hetero-Dimer ΔG: {dgStr(reportData.primerPairwise?.DeltaG)}
                    </div>
                </div>
            )}

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
