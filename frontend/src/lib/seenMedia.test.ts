import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSeen, newAssetIds, saveSeen } from "./seenMedia";

describe("seen media", () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const assets = ["a", "b", "c", "d"].map((id) => ({ id }));

  it("shows nothing as new on the first visit", () => {
    expect(loadSeen("/t/x")).toBeNull();
    expect(newAssetIds(assets, null)).toEqual([]);
  });

  it("finds the unseen assets in timeline order, also in the middle", () => {
    saveSeen("/t/x", new Set(["a", "c"]), assets);
    const seen = loadSeen("/t/x");
    expect(seen).toEqual(new Set(["a", "c"]));
    expect(newAssetIds(assets, seen)).toEqual(["b", "d"]);
    expect(loadSeen("/t/y")).toBeNull();
  });

  it("drops IDs of assets that were removed from the album", () => {
    saveSeen("/t/x", new Set(["a", "gone"]), assets);
    expect(loadSeen("/t/x")).toEqual(new Set(["a"]));
  });

  it("treats a broken stored value as a first visit", () => {
    data.set("mediatimeline:seen:/t/x", "{nope");
    expect(loadSeen("/t/x")).toBeNull();
    data.set("mediatimeline:seen:/t/x", '{"a":1}');
    expect(loadSeen("/t/x")).toBeNull();
  });
});
