export type Palette = Record<string, string>;

export const ACCENT_PRESETS: Record<string, Palette> = {
  teal: {
    '50': '#f0fdfa', '100': '#ccfbf1', '200': '#99f6e4', '300': '#5eead4',
    '400': '#2dd4bf', '500': '#14b8a6', '600': '#0d9488', '700': '#0f766e',
    '800': '#115e59', '900': '#134e4a', '950': '#042f2e',
  },
  blue: {
    '50': '#eff6ff', '100': '#dbeafe', '200': '#bfdbfe', '300': '#93c5fd',
    '400': '#60a5fa', '500': '#3b82f6', '600': '#2563eb', '700': '#1d4ed8',
    '800': '#1e40af', '900': '#1e3a8a', '950': '#172554',
  },
  emerald: {
    '50': '#ecfdf5', '100': '#d1fae5', '200': '#a7f3d0', '300': '#6ee7b7',
    '400': '#34d399', '500': '#10b981', '600': '#059669', '700': '#047857',
    '800': '#065f46', '900': '#064e3b', '950': '#022c22',
  },
  violet: {
    '50': '#f5f3ff', '100': '#ede9fe', '200': '#ddd6fe', '300': '#c4b5fd',
    '400': '#a78bfa', '500': '#8b5cf6', '600': '#7c3aed', '700': '#6d28d9',
    '800': '#5b21b6', '900': '#4c1d95', '950': '#2e1065',
  },
  rose: {
    '50': '#fff1f2', '100': '#ffe4e6', '200': '#fecdd3', '300': '#fda4af',
    '400': '#fb7185', '500': '#f43f5e', '600': '#e11d48', '700': '#be123c',
    '800': '#9f1239', '900': '#881337', '950': '#4c0519',
  },
  amber: {
    '50': '#fffbeb', '100': '#fef3c7', '200': '#fde68a', '300': '#fcd34d',
    '400': '#fbbf24', '500': '#f59e0b', '600': '#d97706', '700': '#b45309',
    '800': '#92400e', '900': '#78350f', '950': '#451a03',
  },
};

export const NEUTRAL_PRESETS: Record<string, Palette> = {
  zinc: {
    '50': '#fafafa', '100': '#f4f4f5', '200': '#e4e4e7', '300': '#d4d4d8',
    '400': '#a1a1aa', '500': '#71717a', '600': '#52525b', '700': '#3f3f46',
    '800': '#27272a', '900': '#18181b', '950': '#09090b',
  },
  stone: {
    '50': '#fafaf9', '100': '#f5f5f4', '200': '#e7e5e4', '300': '#d6d3d1',
    '400': '#a8a29e', '500': '#78716c', '600': '#57534e', '700': '#44403c',
    '800': '#292524', '900': '#1c1917', '950': '#0c0a09',
  },
  slate: {
    '50': '#f8fafc', '100': '#f1f5f9', '200': '#e2e8f0', '300': '#cbd5e1',
    '400': '#94a3b8', '500': '#64748b', '600': '#475569', '700': '#334155',
    '800': '#1e293b', '900': '#0f172a', '950': '#020617',
  },
  neutral: {
    '50': '#fafafa', '100': '#f5f5f5', '200': '#e5e5e5', '300': '#d4d4d4',
    '400': '#a3a3a3', '500': '#737373', '600': '#525252', '700': '#404040',
    '800': '#262626', '900': '#171717', '950': '#0a0a0a',
  },
};

export const WALLPAPERS = [
  'wallhaven-0jepq4.jpg', 'wallhaven-1qgwdg.jpg', 'wallhaven-43e8w9.jpg',
  'wallhaven-45d2y5.jpg', 'wallhaven-48gv20.jpg', 'wallhaven-4dvzl4.jpg',
  'wallhaven-4lwj9l.jpg', 'wallhaven-4vev8n.jpg', 'wallhaven-4vm38p.jpg',
  'wallhaven-e7jj6r.jpg', 'wallhaven-j865jy.jpg', 'wallhaven-mdjrqy.jpg',
  'wallhaven-n625q4.jpg', 'wallhaven-n65epw.png', 'wallhaven-nr22zq.jpg',
  'wallhaven-og2dr9.png', 'wallhaven-xl19lv.jpg', 'wallhaven-ymmwkd.jpg',
];

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

const WHITE = '#ffffff';
const BLACK = '#000000';

function mix(hex1: string, hex2: string, weight: number): string {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  const r = Math.round(r1 * (1 - weight) + r2 * weight);
  const g = Math.round(g1 * (1 - weight) + g2 * weight);
  const b = Math.round(b1 * (1 - weight) + b2 * weight);
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

export function generatePalette(baseHex: string): Palette {
  return {
    '50': mix(baseHex, WHITE, 0.95),
    '100': mix(baseHex, WHITE, 0.90),
    '200': mix(baseHex, WHITE, 0.75),
    '300': mix(baseHex, WHITE, 0.60),
    '400': mix(baseHex, WHITE, 0.30),
    '500': mix(baseHex, WHITE, 0.10),
    '600': baseHex,
    '700': mix(baseHex, BLACK, 0.15),
    '800': mix(baseHex, BLACK, 0.30),
    '900': mix(baseHex, BLACK, 0.45),
    '950': mix(baseHex, BLACK, 0.60),
  };
}

export function applyAccentPreset(name: string, customHex?: string) {
  const palette = name === 'custom' && customHex
    ? generatePalette(customHex)
    : ACCENT_PRESETS[name];
  if (!palette) return;
  const root = document.documentElement;
  for (const shade of SHADES) {
    root.style.setProperty(`--color-accent-${shade}`, palette[shade]);
  }
}

export function applyNeutralPreset(name: string, customHex?: string) {
  const palette = name === 'custom' && customHex
    ? generatePalette(customHex)
    : NEUTRAL_PRESETS[name];
  if (!palette) return;
  const root = document.documentElement;
  for (const shade of SHADES) {
    root.style.setProperty(`--color-zinc-${shade}`, palette[shade]);
  }
}

export function clearThemeOverrides() {
  const root = document.documentElement;
  for (const shade of SHADES) {
    root.style.removeProperty(`--color-accent-${shade}`);
    root.style.removeProperty(`--color-zinc-${shade}`);
  }
}
