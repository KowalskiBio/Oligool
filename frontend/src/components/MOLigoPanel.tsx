import { useState, useEffect } from 'react';
import { TAG_DATABASE } from '../constants/tags';
import { reverseComplement } from '../utils/dna';
import MOLigoSchematic from './MOLigoSchematic';

interface IdtRawItem {
    Local_DeltaG?: number;
    DeltaG?: number;
    deltaG?: number;
    IDT_Tm?: number;
    Local_Tm?: number;
    Tm?: number;
    DotBracket?: string;
    Sequence?: string;
    [key: string]: unknown;
}

export type IdtRawResult = IdtRawItem | IdtRawItem[];

export interface IdtSingleResult {
    hairpin?: { DeltaG?: number; raw?: IdtRawResult };
    self_dimer?: { DeltaG?: number; raw?: IdtRawResult };
    analyze?: IdtRawResult;
}

export interface MoligoIdtResults {
    m1?: IdtSingleResult;
    m2?: IdtSingleResult;
    pairwise?: { DeltaG?: number; raw?: IdtRawResult };
}

export interface MOLigoProps {
    templateSeq: string;
    moligo1Seq: string;
    moligo2Seq: string;
    tagSeq?: string;
    fwdPrimer?: string;
    revPrimer?: string;
    queryId?: string;
    jobName?: string;
    onTagChange?: (val: string) => void;
    onFwdChange?: (val: string) => void;
    onRevChange?: (val: string) => void;
    onProceed?: () => void;
    moligoIdtResults?: MoligoIdtResults;
    idtCredentials?: {
        clientId: string;
        clientSecret: string;
        username?: string;
        password?: string;
        region?: 'us' | 'eu';
    };
    idtAdvancedParams?: {
        mv_conc: number;
        mg_conc: number;
        dntp_conc: number;
        oligo_conc: number;
    };
}

export default function MOLigoPanel(props: MOLigoProps) {
    const {
        templateSeq,
        moligo1Seq, moligo2Seq,
        tagSeq, fwdPrimer, revPrimer,
        onTagChange, onFwdChange, onRevChange, onProceed
    } = props;

    const [isSchematicOpen, setIsSchematicOpen] = useState(() => localStorage.getItem('moligo_prov_schematic_open') !== 'false');
    const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

    const fwdRCSeq = reverseComplement(fwdPrimer || "");

    const leftOligoSeq = (revPrimer || "") + moligo2Seq;
    const rightOligoSeq = moligo1Seq + (tagSeq || "") + (fwdPrimer || "");

    const copyToClipboard = (text: string, label: string) => {
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(text).then(() => {
            setCopiedLabel(label);
            setTimeout(() => setCopiedLabel(null), 1500);
        }).catch(() => undefined);
    };

    useEffect(() => {
        localStorage.setItem('moligo_prov_schematic_open', String(isSchematicOpen));
    }, [isSchematicOpen]);

    // ── Lengths ──────────────────────────────────────────────────────────
    const tagLen = tagSeq?.length || 0;
    const revLen = revPrimer?.length || 0;
    const fwdLen = fwdPrimer?.length || 0;

    return (
        <div className="mt-6 pt-4 max-w-[85rem] mx-auto px-2 md:px-6">
            {/* Header */}
            <div
                id="moligo-provenance-toggle"
                className="flex items-center justify-between mb-3 cursor-pointer group"
                onClick={() => setIsSchematicOpen(!isSchematicOpen)}
            >
                <div className="flex items-center gap-2">
                    <svg className={`w-4 h-4 text-zinc-400 group-hover:text-zinc-600 transition-transform duration-200 ${isSchematicOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-sm font-bold text-zinc-500 uppercase tracking-widest group-hover:text-zinc-700 transition-colors">MOLigo Provenance Schematic</span>
                </div>
            </div>

            {/* ── SVG Schematic & Legend ── */}
            {isSchematicOpen && (
                <div>
                    <MOLigoSchematic
                        templateSeq={templateSeq}
                        moligo1Seq={moligo1Seq}
                        moligo2Seq={moligo2Seq}
                        tagSeq={tagSeq}
                        fwdPrimer={fwdPrimer}
                        revPrimer={revPrimer}
                    />
                </div>
            )}

            {/* ── Sequence Inputs & TAG Picker ── */}
            <div className="mt-8 pt-8">
                <div className="max-w-[85rem] mx-auto px-2 md:px-6 grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">

                    {/* Reverse Primer Input Box */}
                    <div className="card p-3 flex flex-col h-full">
                        <div className="flex justify-between items-start mb-2">
                            <div className="eyebrow flex items-center gap-1.5">
                                <span className="status-dot bg-purple-500" />
                                Universal Reverse Primer
                            </div>
                            <span className="text-[10px] font-mono tabular-nums text-zinc-400">{revLen}nt</span>
                        </div>
                        <div className="flex-1 bg-zinc-50 dark:bg-zinc-800/60 p-2 rounded-md border border-zinc-200 dark:border-zinc-700">
                            <textarea
                                className="w-full h-full min-h-[4rem] text-sm font-mono bg-transparent border-none outline-none resize-none text-zinc-700 dark:text-zinc-300 p-0 focus:ring-0"
                                value={revPrimer || ""}
                                onChange={(e) => onRevChange?.(e.target.value.toUpperCase().replace(/[^ATCGUatcgu]/g, ''))}
                                placeholder="Enter reverse primer..."
                                spellCheck={false}
                            />
                        </div>
                    </div>

                    {/* TAG Picker & Manual Input Box */}
                    <div className="card p-3 flex flex-col h-full">
                        <div className="flex justify-between items-start mb-2">
                            <div className="eyebrow flex items-center gap-1.5">
                                <span className="status-dot bg-red-500" />
                                TAG Sequence
                            </div>
                            <span className="text-[10px] font-mono tabular-nums text-zinc-400">{tagLen}nt</span>
                        </div>

                        <div className="flex flex-col gap-2 flex-1">
                            <select
                                className="input text-[10px] p-1.5"
                                onChange={(e) => {
                                    const tag = TAG_DATABASE.find(t => t.partNumber === e.target.value);
                                    if (tag) onTagChange?.(tag.antiTag);
                                }}
                                value={TAG_DATABASE.find(t => t.antiTag === tagSeq)?.partNumber || ""}
                            >
                                <option value="">-- Pick Database TAG --</option>
                                {TAG_DATABASE.map(tag => (
                                    <option key={tag.reg} value={tag.partNumber}>
                                        {tag.partNumber} ({tag.reg}) / {tag.antiTag}
                                    </option>
                                ))}
                            </select>

                            <div className="flex-1 bg-zinc-50 dark:bg-zinc-800/60 p-2 rounded-md border border-zinc-200 dark:border-zinc-700 flex flex-col">
                                <textarea
                                    className="w-full flex-1 min-h-[4rem] text-sm font-mono bg-transparent border-none outline-none resize-none text-zinc-700 dark:text-zinc-300 p-0 focus:ring-0"
                                    value={tagSeq || ""}
                                    onChange={(e) => onTagChange?.(e.target.value.toUpperCase().replace(/[^ATCGUatcgu]/g, ''))}
                                    placeholder="Manual entry..."
                                    spellCheck={false}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Forward Primer Input Box */}
                    <div className="card p-3 flex flex-col h-full">
                        <div className="flex justify-between items-start mb-2">
                            <div className="eyebrow flex items-center gap-1.5">
                                <span className="status-dot bg-pink-500" />
                                Universal Forward Primer
                            </div>
                            <span className="text-[10px] font-mono tabular-nums text-zinc-400">{fwdLen}nt</span>
                        </div>
                        <div className="flex-1 bg-zinc-50 dark:bg-zinc-800/60 p-2 rounded-md border border-zinc-200 dark:border-zinc-700 flex flex-col">
                            <textarea
                                className="w-full flex-1 min-h-[4rem] text-sm font-mono bg-transparent border-none outline-none resize-none text-zinc-700 dark:text-zinc-300 p-0 focus:ring-0"
                                value={fwdPrimer || ""}
                                onChange={(e) => onFwdChange?.(e.target.value.toUpperCase().replace(/[^ATCGUatcgu]/g, ''))}
                                placeholder="Enter forward primer..."
                                spellCheck={false}
                            />
                        </div>
                        {fwdLen > 0 && (
                            <div className="mt-3 border-t border-zinc-100 dark:border-zinc-700 pt-2 flex items-center justify-between">
                                <span className="text-[10px] text-zinc-500 font-mono truncate">
                                    RC: {fwdRCSeq}
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Copyable Final Oligos ── */}
                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-[85rem] mx-auto px-2 md:px-6">
                    <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-wider">
                                <span className="w-2 h-2 rounded-full bg-purple-400" />
                                <span className="w-2 h-2 rounded-full bg-amber-400" />
                                <span>Left Oligo</span>
                            </div>
                            <span className="text-[10px] font-mono text-zinc-400 font-bold">{leftOligoSeq.length}nt</span>
                        </div>
                        <div className="relative">
                            <div className="bg-zinc-50 dark:bg-zinc-900/50 p-2.5 rounded border border-zinc-200 dark:border-zinc-700 font-mono text-xs text-zinc-700 dark:text-zinc-300 break-all pr-16">
                                {leftOligoSeq || <span className="text-zinc-400 italic">Enter reverse primer and Oligo 2...</span>}
                            </div>
                            <button
                                onClick={() => copyToClipboard(leftOligoSeq, 'left')}
                                disabled={!leftOligoSeq}
                                className="absolute right-1.5 top-1/2 -tranzinc-y-1/2 btn-secondary text-[10px] px-2 py-1"
                            >
                                {copiedLabel === 'left' ? 'Copied!' : 'Copy'}
                            </button>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-wider">
                                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                                <span className="w-2 h-2 rounded-full bg-red-400" />
                                <span className="w-2 h-2 rounded-full bg-pink-400" />
                                <span>Right Oligo</span>
                            </div>
                            <span className="text-[10px] font-mono text-zinc-400 font-bold">{rightOligoSeq.length}nt</span>
                        </div>
                        <div className="relative">
                            <div className="bg-zinc-50 dark:bg-zinc-900/50 p-2.5 rounded border border-zinc-200 dark:border-zinc-700 font-mono text-xs text-zinc-700 dark:text-zinc-300 break-all pr-16">
                                {rightOligoSeq || <span className="text-zinc-400 italic">Enter Oligo 1, TAG, and forward primer...</span>}
                            </div>
                            <button
                                onClick={() => copyToClipboard(rightOligoSeq, 'right')}
                                disabled={!rightOligoSeq}
                                className="absolute right-1.5 top-1/2 -tranzinc-y-1/2 btn-secondary text-[10px] px-2 py-1"
                            >
                                {copiedLabel === 'right' ? 'Copied!' : 'Copy'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* ── Proceed Action ── */}
                <div className="mt-8 mb-6 flex justify-center items-center gap-4 flex-wrap">
                    <button
                        id="btn-proceed-design"
                        onClick={onProceed}
                        className="btn-primary px-6 py-2.5 text-sm active:scale-95"
                    >
                        Proceed with the Design
                    </button>
                </div>
            </div>
        </div>
    );
}
