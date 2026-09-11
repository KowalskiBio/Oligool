/**
 * Structure renderer preferences.
 *
 * Renderer: 'builtin' (default) is the original HairpinSVG/DimerSVG schematic;
 * 'strider' renders with the backend's strider.viz (matplotlib SVG, handles
 * multiloops, pseudoknots and two-strand dimers), always with the built-in
 * renderers kept as the fallback.
 *
 * Color: only affects the Strider renderer.  'identity' colors each base by
 * its letter (Oligool-style A/C/G/T palette); 'structure' colors by structural
 * element (stem, hairpin loop, interior loop, multiloop, exterior), which is
 * the Strider default look.
 *
 * Switching either in Settings applies live via the change event.
 */
export type StructureRendererMode = 'strider' | 'builtin';
export type StructureColorMode = 'identity' | 'structure';

const RENDERER_KEY = 'structure_renderer';
const COLOR_KEY = 'structure_color';
export const STRUCTURE_RENDERER_CHANGE_EVENT = 'structure-renderer-change';

export function getStructureRenderer(): StructureRendererMode {
    return localStorage.getItem(RENDERER_KEY) === 'strider' ? 'strider' : 'builtin';
}

export function setStructureRenderer(mode: StructureRendererMode): void {
    localStorage.setItem(RENDERER_KEY, mode);
    window.dispatchEvent(new CustomEvent(STRUCTURE_RENDERER_CHANGE_EVENT));
}

export function getStructureColor(): StructureColorMode {
    return localStorage.getItem(COLOR_KEY) === 'structure' ? 'structure' : 'identity';
}

export function setStructureColor(mode: StructureColorMode): void {
    localStorage.setItem(COLOR_KEY, mode);
    window.dispatchEvent(new CustomEvent(STRUCTURE_RENDERER_CHANGE_EVENT));
}
