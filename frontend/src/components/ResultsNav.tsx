/**
 * ResultsNav – fixed left rail for jumping between the main result sections:
 * BLAST results, the upper MSA viewer, the Oligo provenance card and the
 * Flanking primer provenance card.  Entries appear only for sections that are
 * currently mounted; the one on screen is highlighted (scrollspy).
 *
 * Entries with subdivisions (e.g. Oligo provenance: Context Viewer / Secondary
 * structures) are expanded by default, revealing indented sub-links; a small
 * chevron button at the end of the group collapses it, and clicking the parent
 * icon re-expands it.  Sub-links are only offered while their anchor is
 * actually mounted (tracked via a MutationObserver).  The rail hides below
 * 1400px so it never overlaps the centered max-w-7xl content.
 */
import React, { useEffect, useState } from 'react';

export interface NavSubTarget {
    /** DOM id of the sub-section to scroll to. */
    id: string;
    label: string;
}

export interface NavTarget {
    /** DOM id of the section to scroll to. */
    id: string;
    label: string;
    icon: React.ReactNode;
    /** Whether the section is currently mounted in the results flow. */
    visible: boolean;
    /** Optional subdivisions revealed when the entry is expanded. */
    children?: NavSubTarget[];
}

/** Tracks which of the given DOM ids currently exist. */
function useDomPresence(ids: string[]): Record<string, boolean> {
    const key = ids.join('|');
    const [present, setPresent] = useState<Record<string, boolean>>({});
    useEffect(() => {
        const list = key ? key.split('|') : [];
        const check = () => {
            const next: Record<string, boolean> = {};
            for (const id of list) next[id] = !!document.getElementById(id);
            setPresent(prev =>
                list.every(id => prev[id] === next[id]) ? prev : next
            );
        };
        check();
        const observer = new MutationObserver(check);
        observer.observe(document.body, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [key]);
    return present;
}

export default function ResultsNav({ targets }: { targets: NavTarget[] }) {
    const enabled = targets.filter(t => t.visible);
    const enabledKey = enabled.map(t => t.id).join('|');
    const subIds = enabled.flatMap(t => (t.children ?? []).map(c => c.id));
    const presence = useDomPresence(subIds);
    const [active, setActive] = useState<string | null>(null);
    // Groups with subdivisions are expanded unless the user collapsed them.
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!enabledKey) return;
        const ids = enabledKey.split('|');
        const onScroll = () => {
            let current: string | null = null;
            for (const id of ids) {
                const el = document.getElementById(id);
                if (el && el.getBoundingClientRect().top <= 160) current = id;
            }
            setActive(current);
        };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, [enabledKey]);

    if (enabled.length === 0) return null;

    const scrollTo = (id: string) =>
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    return (
        <nav
            aria-label="Results sections"
            className="fixed left-4 top-1/2 -translate-y-1/2 z-40 hidden min-[1400px]:flex flex-col gap-1 p-1.5 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white/90 dark:bg-zinc-900/90 backdrop-blur shadow-lg"
        >
            {enabled.map(t => {
                const subs = (t.children ?? []).filter(c => presence[c.id]);
                const isCollapsed = collapsed.has(t.id);
                return (
                    <div key={t.id} className="flex flex-col">
                        <button
                            onClick={() => {
                                if (subs.length > 0 && isCollapsed) {
                                    setCollapsed(prev => {
                                        const next = new Set(prev);
                                        next.delete(t.id);
                                        return next;
                                    });
                                }
                                scrollTo(t.id);
                            }}
                            title={t.label}
                            aria-label={t.label}
                            aria-expanded={subs.length > 0 ? !isCollapsed : undefined}
                            aria-current={active === t.id ? 'true' : undefined}
                            className={`group relative w-9 h-9 flex items-center justify-center rounded-xl transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300 ${
                                active === t.id || (!isCollapsed && subs.length > 0)
                                    ? 'bg-accent-700/10 dark:bg-accent-300/10 text-accent-800 dark:text-accent-200'
                                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200'
                            }`}
                        >
                            {t.icon}
                            {subs.length > 0 && isCollapsed && (
                                <span className="absolute right-0.5 bottom-0.5 w-1.5 h-1.5 rounded-full opacity-40 bg-zinc-400 dark:bg-zinc-500 group-hover:opacity-70" />
                            )}
                            <span className="pointer-events-none absolute left-full ml-3 px-2 py-1 rounded-md text-[13px] font-medium whitespace-nowrap bg-zinc-900 dark:bg-zinc-200 text-white dark:text-zinc-900 opacity-0 group-hover:opacity-100 transition-opacity shadow-md">
                                {t.label}
                            </span>
                        </button>
                        {!isCollapsed && subs.length > 0 && (
                            <div className="ml-2.5 pl-2 border-l border-zinc-200 dark:border-zinc-700 flex flex-col gap-0.5 py-1">
                                {subs.map(c => (
                                    <button
                                        key={c.id}
                                        onClick={() => scrollTo(c.id)}
                                        title={c.label}
                                        aria-label={c.label}
                                        aria-current={active === c.id ? 'true' : undefined}
                                        className={`px-2 py-1 rounded-md text-[11px] font-medium text-left whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300 ${
                                            active === c.id
                                                ? 'text-accent-800 dark:text-accent-200 bg-accent-700/10 dark:bg-accent-300/10'
                                                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                        }`}
                                    >
                                        {c.label}
                                    </button>
                                ))}
                                <button
                                    onClick={() =>
                                        setCollapsed(prev => new Set(prev).add(t.id))
                                    }
                                    title={`Collapse ${t.label}`}
                                    aria-label={`Collapse ${t.label}`}
                                    className="mt-0.5 w-5 h-5 flex items-center justify-center rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300"
                                >
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 15l8-8 8 8" />
                                    </svg>
                                </button>
                            </div>
                        )}
                    </div>
                );
            })}
        </nav>
    );
}
