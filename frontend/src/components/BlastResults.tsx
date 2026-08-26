import React, { useState } from 'react';

interface BlastHit {
    accession: string;
    description: string;
    evalue: number;
    identity: number;
    query_cover: number;
}

interface BlastResultsProps {
    hits: BlastHit[];
    filteredHits?: BlastHit[];
    showMatches?: boolean;
    onToggleShowMatches?: () => void;
    onHitClick?: (hit: BlastHit) => void;
}

const HitRow: React.FC<{ hit: BlastHit; idx: number; dimmed?: boolean; onHitClick?: (hit: BlastHit) => void }> = ({ hit, idx, dimmed, onHitClick }) => {
    const handleRowClick = (e: React.MouseEvent<HTMLTableRowElement>) => {
        if (!onHitClick) return;

        const target = e.target as HTMLElement;
        const anchor = target.closest('a');
        if (anchor?.getAttribute('href')?.includes('ncbi.nlm.nih.gov')) {
            return;
        }

        onHitClick(hit);
    };

    return (
        <tr
            onClick={handleRowClick}
            className={`hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer ${
                idx % 2 === 0 ? 'bg-white dark:bg-zinc-900' : 'bg-zinc-50/50 dark:bg-zinc-800/50'
            } ${dimmed ? 'opacity-60' : ''}`}
        >
            <td className="px-4 py-2.5 text-zinc-400 dark:text-zinc-500 font-mono text-[13px]">{idx + 1}</td>
            <td className="px-4 py-2.5">
                <a
                    href={`https://www.ncbi.nlm.nih.gov/nuccore/${hit.accession}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-700 dark:text-accent-300 hover:text-accent-800 dark:hover:text-accent-200 font-mono text-[13px] font-medium hover:underline"
                    onClick={e => e.stopPropagation()}
                >
                    {hit.accession}
                </a>
            </td>
            <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300 max-w-md truncate" title={hit.description}>
                {hit.description}
            </td>
            <td className="px-4 py-2.5 text-right font-mono text-[13px] text-zinc-600 dark:text-zinc-400">
                {hit.evalue.toExponential(1)}
            </td>
            <td className="px-4 py-2.5 text-right">
                <span className="inline-flex items-center justify-end gap-1.5 text-[13px] font-medium font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                    <span
                        className={`status-dot ${
                            hit.identity >= 100
                                ? 'bg-accent-600 dark:bg-accent-300'
                                : hit.identity >= 95
                                ? 'bg-emerald-600 dark:bg-emerald-400'
                                : hit.identity >= 80
                                ? 'bg-amber-600 dark:bg-amber-400'
                                : 'bg-red-600 dark:bg-red-400'
                        }`}
                    />
                    {hit.identity}%
                </span>
            </td>
            <td className="px-4 py-2.5 text-right font-mono text-[13px] text-zinc-600 dark:text-zinc-400">
                {hit.query_cover}%
            </td>
        </tr>
    );
};

const BlastResults: React.FC<BlastResultsProps> = ({ hits, filteredHits = [], showMatches = false, onToggleShowMatches, onHitClick }) => {
    const [isCollapsed, setIsCollapsed] = useState(true);

    const safeHits = hits || [];
    const totalVisible = safeHits.length + (showMatches ? filteredHits.length : 0);

    if (!hits || hits.length === 0) return null;

    return (
        <div className="mt-6 card overflow-hidden">
            <div
                className="panel-header flex justify-between items-center cursor-pointer"
                onClick={() => setIsCollapsed(!isCollapsed)}
            >
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    BLAST Results
                    <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">
                        ({totalVisible} hit{totalVisible !== 1 ? 's' : ''})
                    </span>
                    {filteredHits.length > 0 && (
                        <span className="text-[13px] font-normal text-zinc-400 dark:text-zinc-500">
                            · {filteredHits.length} exact match{filteredHits.length !== 1 ? 'es' : ''} filtered
                        </span>
                    )}
                </h2>
                <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                    {filteredHits.length > 0 && onToggleShowMatches && (
                        <button
                            onClick={onToggleShowMatches}
                            className={`btn-secondary ${showMatches ? 'icon-btn-active' : ''}`}
                            title={showMatches ? 'Hide 100% identity matches' : 'Show 100% identity matches'}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                {showMatches ? (
                                    <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                                ) : null}
                                <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                            </svg>
                            {showMatches ? 'Hide matches' : `Show matches (${filteredHits.length})`}
                        </button>
                    )}
                    <button
                        className="icon-btn transition-transform duration-200"
                        style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        aria-label={isCollapsed ? 'Expand BLAST Results' : 'Collapse BLAST Results'}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
            </div>
            {!isCollapsed && (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
                                <th className="px-4 py-3 text-left font-semibold">#</th>
                                <th className="px-4 py-3 text-left font-semibold">Accession</th>
                                <th className="px-4 py-3 text-left font-semibold">Description</th>
                                <th className="px-4 py-3 text-right font-semibold">E-value</th>
                                <th className="px-4 py-3 text-right font-semibold">Identity %</th>
                                <th className="px-4 py-3 text-right font-semibold">Query Cover %</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-700">
                            {hits.map((hit, idx) => (
                                <HitRow key={hit.accession + idx} hit={hit} idx={idx} onHitClick={onHitClick} />
                            ))}
                            {showMatches && filteredHits.length > 0 && (
                                <>
                                    <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                                        <td colSpan={6} className="px-4 py-1.5 text-[13px] font-medium text-accent-700 dark:text-accent-300 border-t border-zinc-200 dark:border-zinc-800">
                                            100% identity matches (filtered)
                                        </td>
                                    </tr>
                                    {filteredHits.map((hit, idx) => (
                                        <HitRow key={hit.accession + idx} hit={hit} idx={hits.length + idx} dimmed onHitClick={onHitClick} />
                                    ))}
                                </>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default BlastResults;
