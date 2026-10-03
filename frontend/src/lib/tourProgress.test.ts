import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPosition, savePosition } from "./tourProgress";

describe("tour progress", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const pos = { stop: 2, item: 1, label: "Ort 3 von 6", savedAt: 1_000 };

  it("remembers the position per link and forgets it when cleared", () => {
    savePosition("/t/a", pos);
    expect(loadPosition("/t/a", 2_000)).toEqual(pos);
    expect(loadPosition("/t/b", 2_000)).toBeNull();
    savePosition("/t/a", null);
    expect(loadPosition("/t/a", 2_000)).toBeNull();
  });

  it("expires after six hours", () => {
    savePosition("/t/a", pos);
    expect(loadPosition("/t/a", pos.savedAt + 5 * 3600_000)).toEqual(pos);
    expect(loadPosition("/t/a", pos.savedAt + 6 * 3600_000 + 1)).toBeNull();
  });

  it("works without storage", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => savePosition("/t/a", pos)).not.toThrow();
    expect(loadPosition("/t/a")).toBeNull();
  });
});
