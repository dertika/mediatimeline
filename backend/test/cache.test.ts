import { describe, expect, it, vi } from "vitest";
import { AlbumCache } from "../src/immich/cache.js";
import type { ImmichClient } from "../src/immich/client.js";

const TTL = 5 * 60_000;

/** Fake Immich: each load returns the album under a new name ("v1", "v2", …). */
function setup() {
  let now = 0;
  let version = 0;
  let fail = false;
  const getAlbum = vi.fn(async () => {
    if (fail) throw new Error("immich down");
    return { id: "a", albumName: `v${++version}` };
  });
  const client = {
    getAlbum,
    getAlbumAssets: async () => [],
    getAlbumComments: async () => [],
  } as unknown as ImmichClient;
  const warn = vi.fn();
  const cache = new AlbumCache(client, TTL, () => now, warn);
  const name = async () => (await cache.get("a")).album.albumName;
  return {
    cache,
    name,
    getAlbum,
    warn,
    at: (ms: number) => (now = ms),
    setFail: (f: boolean) => (fail = f),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("AlbumCache", () => {
  it("serves cached data within the TTL", async () => {
    const t = setup();
    expect(await t.name()).toBe("v1");
    t.at(TTL - 1);
    expect(await t.name()).toBe("v1");
    expect(t.getAlbum).toHaveBeenCalledTimes(1);
  });

  it("serves the expired state at once and reloads once in the background", async () => {
    const t = setup();
    await t.name();
    t.at(TTL + 1);
    const [first, second] = await Promise.all([t.name(), t.name()]);
    expect([first, second]).toEqual(["v1", "v1"]);
    await flush();
    expect(t.getAlbum).toHaveBeenCalledTimes(2);
    expect(await t.name()).toBe("v2");
  });

  it("keeps the previous state when the background reload fails, and retries later", async () => {
    const t = setup();
    await t.name();
    t.setFail(true);
    t.at(TTL + 1);
    expect(await t.name()).toBe("v1");
    await flush();
    expect(t.warn).toHaveBeenCalledTimes(1);
    expect(await t.name()).toBe("v1");
    await flush();
    expect(t.getAlbum).toHaveBeenCalledTimes(2);
    t.setFail(false);
    t.at(TTL + 31_000);
    expect(await t.name()).toBe("v1");
    await flush();
    // Failed loads don't count up: the next successful one is v2.
    expect(await t.name()).toBe("v2");
  });

  it("waits for a fresh load when the state is more than an hour stale", async () => {
    const t = setup();
    await t.name();
    t.at(TTL + 3600_000 + 1);
    expect(await t.name()).toBe("v2");
  });

  it("forgets everything on invalidate, also a running reload", async () => {
    const t = setup();
    await t.name();
    t.at(TTL + 1);
    await t.name();
    t.cache.invalidate("a");
    await flush();
    expect(await t.name()).toBe("v3");
  });
});
