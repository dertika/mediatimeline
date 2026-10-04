import { describe, expect, it } from "vitest";
import { ACCENTS as BACKEND_ACCENTS, DEFAULT_ACCENT } from "../../../backend/src/accent";
import { ACCENTS } from "./accents";

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("accent colours", () => {
  it("match the backend list, default first", () => {
    expect(ACCENTS.map((a) => a.id)).toEqual([...BACKEND_ACCENTS]);
    expect(ACCENTS[0]!.id).toBe(DEFAULT_ACCENT);
  });

  it.each(ACCENTS)("$label keeps text on the accent readable (WCAG AA)", (a) => {
    expect(contrast(a.light, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(a.dark, a.darkText)).toBeGreaterThanOrEqual(4.5);
  });
});
