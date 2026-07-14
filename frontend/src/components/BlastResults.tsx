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
            className={`hover:bg-indigo-100/50 dark:hover:bg-indigo-900/30 transition-colors cursor-pointer ${
                idx % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50/50 dark:bg-slate-800/50'
            } ${dimmed ? 'opacity-60' : ''}`}
        >
            <td className="px-4 py-2.5 text-slate-400 dark:text-slate-500 font-mono text-xs">{idx + 1}</td>
            <td className="px-4 py-2.5">
                <a
                    href={`https://www.ncbi.nlm.nih.gov/nuccore/${hit.accession}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-mono text-xs font-medium hover:underline"
                    onClick={e => e.stopPropagation()}
                >
                    {hit.accession}
                </a>
            </td>
            <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300 max-w-md truncate" title={hit.description}>
                {hit.description}
            </td>
            <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600 dark:text-slate-400">
                {hit.evalue.toExponential(1)}
            </td>
            <td className="px-4 py-2.5 text-right">
                <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        hit.identity >= 100
                            ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                            : hit.identity >= 95
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : hit.identity >= 80
                            ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    }`}
                >
                    {hit.identity}%
                </span>
            </td>
            <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600 dark:text-slate-400">
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
        <div className="mt-6 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden bg-white dark:bg-slate-800 transition-colors">
            <div
                className="px-5 py-4 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center cursor-pointer transition-colors"
                onClick={() => setIsCollapsed(!isCollapsed)}
            >
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    BLAST Results
                    <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
                        ({totalVisible} hit{totalVisible !== 1 ? 's' : ''})
                    </span>
                    {filteredHits.length > 0 && (
                        <span className="text-xs font-normal text-slate-400 dark:text-slate-500">
                            · {filteredHits.length} exact match{filteredHits.length !== 1 ? 'es' : ''} filtered
                        </span>
                    )}
                </h2>
                <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                    {filteredHits.length > 0 && onToggleShowMatches && (
                        <button
                            onClick={onToggleShowMatches}
                            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                                showMatches
                                    ? 'bg-purple-600 text-white border-purple-600 hover:bg-purple-700'
                                    : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600'
                            }`}
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
                        className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-transform duration-200"
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
                            <tr className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                <th className="px-4 py-3 text-left font-semibold">#</th>
                                <th className="px-4 py-3 text-left font-semibold">Accession</th>
                                <th className="px-4 py-3 text-left font-semibold">Description</th>
                                <th className="px-4 py-3 text-right font-semibold">E-value</th>
                                <th className="px-4 py-3 text-right font-semibold">Identity %</th>
                                <th className="px-4 py-3 text-right font-semibold">Query Cover %</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {hits.map((hit, idx) => (
                                <HitRow key={hit.accession + idx} hit={hit} idx={idx} onHitClick={onHitClick} />
                            ))}
                            {showMatches && filteredHits.length > 0 && (
                                <>
                                    <tr className="bg-purple-50 dark:bg-purple-900/10">
                                        <td colSpan={6} className="px-4 py-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 border-t border-purple-100 dark:border-purple-900/30">
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
