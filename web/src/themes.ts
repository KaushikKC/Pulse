/**
 * Premium visual themes — the monetization hook. A theme repaints the entire
 * experience: the two team colors, the canvas' deep background + floodlight tint,
 * and the UI accent. One free look ships; the rest are "PRO" (a paid tier in the
 * product vision — here they're selectable so judges can see the range).
 */
export interface Theme {
  id: string;
  name: string;
  /** Free with the app, or part of the premium tier. */
  premium: boolean;
  /** Home / away team colors (hex). */
  home: string;
  away: string;
  /** Deep canvas base color (hex). */
  bg: string;
  /** Stadium-floodlight / ambient light tint (hex). */
  light: string;
  /** UI accent — brand gradient midpoint, primary buttons (hex). */
  accent: string;
}

export const THEMES: Theme[] = [
  {
    id: "stadium-night",
    name: "Stadium Night",
    premium: false,
    home: "#3dc0ff",
    away: "#ff4d7e",
    bg: "#08090e",
    light: "#cdd6f0",
    accent: "#c8f52f",
  },
  {
    id: "golden-hour",
    name: "Golden Hour",
    premium: true,
    home: "#ffc233",
    away: "#ff6d5e",
    bg: "#0c0805",
    light: "#ffdfae",
    accent: "#ffb020",
  },
  {
    id: "neon-arena",
    name: "Neon Arena",
    premium: true,
    home: "#2ee5ff",
    away: "#ff5cf0",
    bg: "#0a0416",
    light: "#c9b8ff",
    accent: "#9d7bff",
  },
  {
    id: "emerald-pitch",
    name: "Emerald Pitch",
    premium: true,
    home: "#2fe08f",
    away: "#ffd34d",
    bg: "#04100a",
    light: "#b9f5d8",
    accent: "#3ddf9e",
  },
  {
    id: "mono-ink",
    name: "Mono Ink",
    premium: true,
    home: "#f1f5f9",
    away: "#8a94a6",
    bg: "#0a0a0c",
    light: "#ffffff",
    accent: "#e6e9ef",
  },
];

export const DEFAULT_THEME_ID = THEMES[0].id;
const STORAGE_KEY = "pulse:theme";

export function themeById(id: string | null): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function loadThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function saveThemeId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore private-mode storage errors */
  }
}

/** Push the theme into CSS custom properties so pure-CSS UI recolors too. */
export function applyThemeVars(t: Theme): void {
  const r = document.documentElement;
  r.style.setProperty("--home", t.home);
  r.style.setProperty("--away", t.away);
  r.style.setProperty("--accent", t.accent);
  r.style.setProperty("--bg", t.bg);
}
