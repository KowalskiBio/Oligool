/**
 * StructureFigure – renders an oligo secondary structure (sequence + dot-bracket)
 * with the backend's Strider renderer (matplotlib SVG via POST /strider/render).
 *
 * The Strider view handles branched multiloops, pseudoknots and '&' two-strand
 * dimers that the built-in schematic cannot.  Whenever Strider is disabled,
 * still loading, or the render fails, the original renderer passed as
 * `fallback` (HairpinSVG / DimerSVG / ASCII art) is shown instead, so the
 * built-in visualizations remain available as a backup at all times.
 */
import React, { useEffect, useState } from 'react';
import { getStructureColor, getStructureRenderer, STRUCTURE_RENDERER_CHANGE_EVENT } from '../utils/structureRenderer';
import { openSvgStringInNewTab } from '../utils/openSvgTab';

interface StructureFigureProps {
    seq: string;
    dotBracket: string;
    /** Node rendered when Strider is off, loading, or failed (the built-in backup). */
    fallback: React.ReactNode;
}

const svgCache = new Map<string, string>();

export default function StructureFigure({ seq, dotBracket, fallback }: StructureFigureProps) {
    const [mode, setMode] = useState(getStructureRenderer);
    const [colorMode, setColorMode] = useState(getStructureColor);
    const [fetched, setFetched] = useState<{ key: string; svg: string } | null>(null);
    const [theme, setTheme] = useState<'light' | 'dark'>(() =>
        typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
            ? 'dark' : 'light');

    useEffect(() => {
        const onChange = () => {
            setMode(getStructureRenderer());
            setColorMode(getStructureColor());
        };
        window.addEventListener(STRUCTURE_RENDERER_CHANGE_EVENT, onChange);
        return () => window.removeEventListener(STRUCTURE_RENDERER_CHANGE_EVENT, onChange);
    }, []);

    // Oligool toggles dark mode by flipping the 'dark' class on <html>
    // (App.tsx); watch it so Strider figures re-render with the matching theme.
    useEffect(() => {
        const sync = () =>
            setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
        const observer = new MutationObserver(sync);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    const key = seq && dotBracket ? `${seq}|${dotBracket}|${colorMode}|${theme}` : null;
    const svg = key
        ? (svgCache.get(key) ?? (fetched?.key === key ? fetched.svg : null))
        : null;

    useEffect(() => {
        if (mode !== 'strider' || !key || svgCache.has(key)) return;
        let cancelled = false;
        const apiBase = ((import.meta.env.VITE_API_BASE as string) || '');
        fetch(`${apiBase}/strider/render`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sequence: seq, dot_bracket: dotBracket, view: 'structure', color: colorMode, theme }),
        })
            .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
            .then(data => {
                if (!cancelled && typeof data?.svg === 'string' && data.svg.includes('<svg')) {
                    svgCache.set(key, data.svg);
                    setFetched({ key, svg: data.svg });
                }
            })
            .catch(() => {
                /* keep the built-in fallback */
            });
        return () => { cancelled = true; };
    }, [mode, key, seq, dotBracket, colorMode, theme]);

    if (mode === 'strider' && svg) {
        return (
            <div
                className="w-full flex justify-center cursor-zoom-in [&_svg]:max-w-full [&_svg]:h-auto"
                role="button"
                aria-label="Open structure in a new tab"
                title="Strider render – click to open in a new tab"
                onClick={() => openSvgStringInNewTab(svg, 'Secondary structure (Strider)')}
                dangerouslySetInnerHTML={{ __html: svg }}
            />
        );
    }
    return <>{fallback}</>;
}
