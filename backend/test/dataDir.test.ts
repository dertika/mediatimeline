import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dataDirProblem } from "../src/dataDir.js";

describe("dataDirProblem", () => {
  const dirs: string[] = [];
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "mt-data-"));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      chmodSync(dir, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts a writable dir and creates a missing one", () => {
    const base = tempDir();
    expect(dataDirProblem(base)).toBeNull();
    expect(dataDirProblem(join(base, "nested", "data"))).toBeNull();
  });

  it("explains how to fix a dir that cannot be created", () => {
    const base = tempDir();
    writeFileSync(join(base, "file"), "");
    const problem = dataDirProblem(join(base, "file", "data"));
    expect(problem).toMatch(/is not writable/);
    expect(problem).toMatch(/sudo chown -R \d+:\d+/);
    expect(problem).toMatch(/user: "<uid>:<gid>"/);
  });

  // root may write anywhere, so a read-only dir only fails for other users.
  it.skipIf(process.getuid?.() === 0)("explains how to fix a read-only dir", () => {
    const dir = tempDir();
    chmodSync(dir, 0o500);
    expect(dataDirProblem(dir)).toMatch(/is not writable \(EACCES\)/);
  });
});
