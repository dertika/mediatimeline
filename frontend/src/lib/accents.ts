/**
 * Curated accent colours a shared timeline can use (chosen per link in the
 * admin). Each has a light and a dark variant; all keep text on the accent
 * readable (WCAG AA, ≥ 4.5:1). Ids match backend/src/accent.ts.
 */
export interface Accent {
  id: string;
  label: string;
  /** Accent in light mode, with white text on it. */
  light: string;
  /** Accent in dark mode, with `darkText` on it. */
  dark: string;
  darkText: string;
}

export const ACCENTS: Accent[] = [
  { id: "gruen", label: "Waldgrün", light: "#2f6f5e", dark: "#6cc2a8", darkText: "#0d1f19" },
  { id: "ozean", label: "Ozeanblau", light: "#1f5f8b", dark: "#7cb8e4", darkText: "#0b1d2b" },
  { id: "fjord", label: "Fjordtürkis", light: "#0f6e78", dark: "#5cc6cf", darkText: "#06262a" },
  { id: "terrakotta", label: "Terrakotta", light: "#b0502a", dark: "#f0a37a", darkText: "#2a1309" },
  { id: "aubergine", label: "Aubergine", light: "#6a3d9a", dark: "#c3a3e8", darkText: "#1f1030" },
];

/** The default accent is the one in app.css; others override it for the page. */
export function applyAccent(id: string | undefined): void {
  const accent = ACCENTS.find((a) => a.id === id);
  let style = document.getElementById("mt-accent");
  if (!accent || accent.id === ACCENTS[0]!.id) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = "mt-accent";
    document.head.append(style);
  }
  style.textContent = `:root { --accent: ${accent.light}; --accent-contrast: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --accent: ${accent.dark}; --accent-contrast: ${accent.darkText}; } }`;
}
