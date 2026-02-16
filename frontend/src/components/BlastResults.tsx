import React from 'react';

interface BlastHit {
    accession: string;
    description: string;
    evalue: number;
    identity: number;
    query_cover: number;
}

interface BlastResultsProps {
    hits: BlastHit[];
}

const BlastResults: React.FC<BlastResultsProps> = ({ hits }) => {
    if (!hits || hits.length === 0) return null;

    return (
        <div className="mt-6 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden bg-white dark:bg-slate-800 transition-colors">
            <div className="px-5 py-4 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 border-b border-slate-200 dark:border-slate-700">
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                    BLAST Results
                    <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">
                        ({hits.length} hits)
                    </span>
                </h2>
            </div>
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
                            <tr
                                key={idx}
                                className={`hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 transition-colors ${idx % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50/50 dark:bg-slate-800/50'
                                    }`}
                            >
                                <td className="px-4 py-2.5 text-slate-400 dark:text-slate-500 font-mono text-xs">{idx + 1}</td>
                                <td className="px-4 py-2.5">
                                    <a
                                        href={`https://www.ncbi.nlm.nih.gov/nuccore/${hit.accession}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-mono text-xs font-medium hover:underline"
                                    >
                                        {hit.accession}
                                    </a>
                                </td>
                                <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300 max-w-md truncate" title={hit.description}>{hit.description}</td>
                                <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600 dark:text-slate-400">
                                    {hit.evalue.toExponential(1)}
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                    <span
                                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${hit.identity >= 95
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
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default BlastResults;
