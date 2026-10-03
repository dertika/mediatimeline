import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "./version";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const versionOf = (path: string) => (JSON.parse(read(path)) as { version: string }).version;

describe("version", () => {
  it("is the same in all package.json files", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(versionOf("../../../package.json")).toBe(VERSION);
    expect(versionOf("../../../backend/package.json")).toBe(VERSION);
  });

  it("has an entry at the top of the changelog", () => {
    const first = read("../../../CHANGELOG.md").match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1];
    expect(first).toBe(VERSION);
  });
});
