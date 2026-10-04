/** Curated accent colours a link can use; the palettes live in the frontend (lib/accents.ts). */
export const ACCENTS = ["gruen", "ozean", "fjord", "terrakotta", "aubergine"] as const;
export type Accent = (typeof ACCENTS)[number];
export const DEFAULT_ACCENT: Accent = "gruen";
