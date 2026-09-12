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
 *
 * Keyboard: single-letter shortcuts (B/M/O/P for sections, C/S/P for
 * sub-sections) teleport to the matching target; the letter is shown as a
 * small kbd chip on each row.  Shortcuts are ignored while typing in an
 * input, textarea or select.
 */
import React, { useEffect, useRef, useState } from 'react';

export interface NavSubTarget {
    /** DOM id of the sub-section to scroll to. */
    id: string;
    label: string;
    /** Optional keyboard shortcut (single letter) that scrolls here. */
    hotkey?: string;
}

export interface NavTarget {
    /** DOM id of the section to scroll to. */
    id: string;
    label: string;
    icon: React.ReactNode;
    /** Whether the section is currently mounted in the results flow. */
    visible: boolean;
    /** Optional keyboard shortcut (single letter) that scrolls here. */
    hotkey?: string;
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
    const subIds = enabled.flatMap(t => (t.children ?? []).map(c => c.id));
    const presence = useDomPresence(subIds);
    const [active, setActive] = useState<string | null>(null);
    // Groups with subdivisions are expanded unless the user collapsed them.
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    // Scrollspy order follows the results flow: each section followed by its
    // mounted subdivisions, so the rail lights up the exact sub-section on
    // screen instead of only the top-level card.
    const orderKey = enabled
        .flatMap(t => [t.id, ...(t.children ?? []).filter(c => presence[c.id]).map(c => c.id)])
        .join('|');

    useEffect(() => {
        if (!orderKey) return;
        const order = orderKey.split('|');
        const onScroll = () => {
            let current: string | null = null;
            for (const id of order) {
                const el = document.getElementById(id);
                if (el && el.getBoundingClientRect().top <= 160) current = id;
            }
            // At the very bottom the last section can sit above the
            // threshold line without ever crossing it; light it up anyway.
            if (
                current === null ||
                (current !== order[order.length - 1] &&
                    window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2)
            ) {
                const lastEl = document.getElementById(order[order.length - 1]);
                if (lastEl) current = order[order.length - 1];
            }
            setActive(current);
        };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, [orderKey]);

    // Keyboard navigation: B/M/O/P teleport to the main sections; C/S/P drill
    // into the sub-sections.  When two sub-sections share a key (both Context
    // Viewers are C, Primers repeats P), the one belonging to the section the
    // user is currently in wins; pressing P inside the primer section jumps to
    // the Primers list, anywhere else it jumps to the Primer Provenance card.
    const latest = useRef({ enabled, active, presence });
    useEffect(() => {
        latest.current = { enabled, active, presence };
    });
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
            const el = e.target as HTMLElement | null;
            if (
                !el ||
                el.isContentEditable ||
                ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
            ) {
                return;
            }
            const key = e.key.toLowerCase();
            const { enabled: targets, active: current, presence: present } = latest.current;
            const scrollTo = (id: string) =>
                document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            // 1) A sub-section of the section we are currently in wins.
            const inTop = targets.find(
                t =>
                    t.id === current ||
                    (t.children ?? []).some(c => c.id === current && present[c.id])
            );
            const drill = (inTop?.children ?? []).find(
                c => present[c.id] && c.hotkey === key
            );
            if (drill) {
                scrollTo(drill.id);
                return;
            }
            // 2) Top-level hotkey.
            const top = targets.find(t => t.hotkey === key);
            if (top) {
                scrollTo(top.id);
                return;
            }
            // 3) Fallback: first mounted sub-section with that hotkey.
            for (const t of targets) {
                const sub = (t.children ?? []).find(c => present[c.id] && c.hotkey === key);
                if (sub) {
                    scrollTo(sub.id);
                    return;
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

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
                // The parent lights up only while the viewport is inside its
                // section (the card itself or one of its sub-sections).
                const sectionActive =
                    active === t.id || (subs.some(c => c.id === active) && !isCollapsed);
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
                            aria-expanded={subs.length > 0 ? !isCollapsed : undefined}
                            aria-current={active === t.id ? 'true' : undefined}
                            className={`group flex items-center gap-2 w-full px-2 py-1.5 rounded-xl transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300 ${
                                sectionActive
                                    ? 'bg-accent-700/10 dark:bg-accent-300/10 text-accent-800 dark:text-accent-200'
                                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200'
                            }`}
                        >
                            <span className="shrink-0">{t.icon}</span>
                            <span className="text-[13px] font-medium whitespace-nowrap">{t.label}</span>
                            {t.hotkey && (
                                <span className="ml-auto px-1.5 py-0.5 rounded-md border text-[10px] font-semibold leading-none border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500">
                                    {t.hotkey.toUpperCase()}
                                </span>
                            )}
                            {subs.length > 0 && isCollapsed && !t.hotkey && (
                                <span className="ml-auto w-1.5 h-1.5 rounded-full opacity-40 bg-zinc-400 dark:bg-zinc-500 group-hover:opacity-70" />
                            )}
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
                                        className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium text-left whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300 ${
                                            active === c.id
                                                ? 'text-accent-800 dark:text-accent-200 bg-accent-700/10 dark:bg-accent-300/10'
                                                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                        }`}
                                    >
                                        <span
                                            className={`w-1 h-1 rounded-full bg-current transition-opacity ${
                                                active === c.id ? 'opacity-100' : 'opacity-0'
                                            }`}
                                        />
                                        {c.label}
                                        {c.hotkey && (
                                            <span className="ml-auto px-1 py-0.5 rounded border text-[9px] font-semibold leading-none border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500">
                                                {c.hotkey.toUpperCase()}
                                            </span>
                                        )}
                                    </button>
                                ))}
                                <button
                                    onClick={() =>
                                        setCollapsed(prev => new Set(prev).add(t.id))
                                    }
                                    aria-label={`Collapse ${t.label}`}
                                    className="mt-0.5 self-end w-5 h-5 flex items-center justify-center rounded-md text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-300"
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
