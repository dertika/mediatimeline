import { describe, expect, it } from "vitest";
import { MAX_VISITED, formatAgo, parseVisited, withVisit, type Visited } from "./visited";

const at = (n: number) => new Date(Date.UTC(2026, 9, 1, 12, n));
const entry = (token: string, n = 0): Visited => ({ token, title: `T ${token}`, lastVisit: at(n).toISOString() });

describe("withVisit", () => {
  it("puts the newest visit first and replaces an earlier one of the same link", () => {
    const list = withVisit(withVisit([], "a", "A", at(1)), "b", "B", at(2));
    expect(list.map((v) => v.token)).toEqual(["b", "a"]);
    const again = withVisit(list, "a", "A neu", at(3));
    expect(again.map((v) => v.token)).toEqual(["a", "b"]);
    expect(again[0]).toEqual({ token: "a", title: "A neu", lastVisit: at(3).toISOString() });
  });

  it("keeps at most MAX_VISITED entries and drops the oldest", () => {
    let list: Visited[] = [];
    for (let i = 0; i < MAX_VISITED + 5; i++) list = withVisit(list, `t${i}`, "x", at(i));
    expect(list).toHaveLength(MAX_VISITED);
    expect(list[0]!.token).toBe(`t${MAX_VISITED + 4}`);
    expect(list.some((v) => v.token === "t0")).toBe(false);
  });
});

describe("parseVisited", () => {
  it("reads a stored list", () => {
    expect(parseVisited(JSON.stringify([entry("a"), entry("b")])).map((v) => v.token)).toEqual(["a", "b"]);
  });

  it("yields an empty list for nothing, broken JSON or something else", () => {
    expect(parseVisited(null)).toEqual([]);
    expect(parseVisited("{kaputt")).toEqual([]);
    expect(parseVisited('{"a":1}')).toEqual([]);
  });

  it("skips entries with the wrong shape", () => {
    const raw = JSON.stringify([entry("a"), { token: 5 }, null, { token: "x", title: "T", lastVisit: "gestern" }]);
    expect(parseVisited(raw).map((v) => v.token)).toEqual(["a"]);
  });
});

describe("formatAgo", () => {
  const now = at(0);
  const before = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it("says how long ago in German", () => {
    expect(formatAgo(before(20_000), now)).toBe("gerade eben");
    expect(formatAgo(before(5 * 60_000), now)).toBe("vor 5 Min.");
    expect(formatAgo(before(3 * 3_600_000), now)).toBe("vor 3 Std.");
    expect(formatAgo(before(30 * 3_600_000), now)).toBe("gestern");
    expect(formatAgo(before(4 * 86_400_000), now)).toBe("vor 4 Tagen");
    expect(formatAgo(before(40 * 86_400_000), now)).toMatch(/2026/);
  });
});
