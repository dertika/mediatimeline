import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { ShareStore } from "../src/store/db.js";
import { API_KEY, startMockImmich } from "./mockImmich.js";

let immich: Awaited<ReturnType<typeof startMockImmich>>;
let app: FastifyInstance;
let store: ShareStore;

const ADMIN = { "remote-user": "alice", "remote-groups": "users,admins" };

beforeAll(async () => {
  immich = await startMockImmich();
});
afterAll(async () => {
  await immich.app.close();
});

beforeEach(async () => {
  await app?.close();
  store = new ShareStore(":memory:");
  const config = parseConfig({
    immich: { url: immich.url, apiKey: API_KEY },
    server: { trustedProxies: ["loopback"], publicBaseUrl: "https://timeline.example.com" },
    admin: { allowedGroups: ["admins"] },
  });
  app = await buildApp({ config, store, sessionSecret: "x".repeat(32), logger: false });
});

async function createShare(albumId = "album-1") {
  const res = await app.inject({ method: "POST", url: "/api/admin/shares", headers: ADMIN, payload: { albumId } });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: number; url: string };
}
const tokenOf = (url: string) => url.split("/t/")[1]!;

describe("admin guard", () => {
  it("rejects requests without Remote-User", async () => {
    const res = await app.inject({ url: "/api/admin/shares" });
    expect(res.statusCode).toBe(401);
  });

  it("ignores Remote-User from untrusted peers", async () => {
    const res = await app.inject({ url: "/api/admin/shares", headers: ADMIN, remoteAddress: "203.0.113.5" });
    expect(res.statusCode).toBe(401);
  });

  it("enforces allowed groups", async () => {
    const res = await app.inject({ url: "/api/admin/shares", headers: { "remote-user": "bob", "remote-groups": "users" } });
    expect(res.statusCode).toBe(403);
  });

  it("returns the current user", async () => {
    const res = await app.inject({ url: "/api/admin/me", headers: ADMIN });
    expect(res.json()).toEqual({ name: "alice", groups: ["users", "admins"] });
  });
});

describe("admin api", () => {
  it("lists Immich albums with their shares", async () => {
    const share = await createShare();
    const res = await app.inject({ url: "/api/admin/immich/albums", headers: ADMIN });
    const albums = res.json();
    expect(albums.map((a: { albumName: string }) => a.albumName)).toEqual(["Norwegen 2026", "Privat"]);
    expect(albums[0].shares).toHaveLength(1);
    expect(albums[0].shares[0].url).toBe(share.url);
    expect(share.url).toMatch(/^https:\/\/timeline\.example\.com\/t\/[\w-]{43}$/);
  });

  it("rejects shares for unknown albums", async () => {
    const res = await app.inject({ method: "POST", url: "/api/admin/shares", headers: ADMIN, payload: { albumId: "nope" } });
    expect(res.statusCode).toBe(404);
  });

  it("updates and deletes shares", async () => {
    const { id } = await createShare();
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/admin/shares/${id}`,
      headers: ADMIN,
      payload: { titleOverride: "Sommer", expiresAt: "2030-01-01T00:00:00+01:00", password: "geheim" },
    });
    expect(patched.json()).toMatchObject({
      titleOverride: "Sommer",
      expiresAt: "2029-12-31T23:00:00.000Z",
      hasPassword: true,
      expired: false,
    });
    expect(JSON.stringify(patched.json())).not.toContain("geheim");

    const del = await app.inject({ method: "DELETE", url: `/api/admin/shares/${id}`, headers: ADMIN });
    expect(del.statusCode).toBe(204);
    expect(store.list()).toHaveLength(0);
  });
});

describe("public timeline", () => {
  it("returns assets sorted ascending with captions and geo data", async () => {
    const { url } = await createShare();
    const res = await app.inject({ url: `/api/public/timeline/${tokenOf(url)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe("Norwegen 2026");
    expect(body.assets.map((a: { id: string }) => a.id)).toEqual(["a1", "a2", "a3"]);
    expect(body.assets[0]).toMatchObject({ type: "image", description: "Ankunft", lat: 60.4, lng: 5.3 });
    expect(body.assets[1]).toMatchObject({ type: "video", description: null, lat: null, width: 3000, height: 4000 });
  });

  it("returns 404 for unknown or disabled tokens", async () => {
    expect((await app.inject({ url: "/api/public/timeline/unknown" })).statusCode).toBe(404);
    const { id, url } = await createShare();
    store.update(id, { enabled: false });
    expect((await app.inject({ url: `/api/public/timeline/${tokenOf(url)}` })).statusCode).toBe(404);
  });

  it("returns 410 for expired links, including media", async () => {
    const { id, url } = await createShare();
    store.update(id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const token = tokenOf(url);
    expect((await app.inject({ url: `/api/public/timeline/${token}` })).statusCode).toBe(410);
    expect((await app.inject({ url: `/api/public/timeline/${token}/assets/a1/preview` })).statusCode).toBe(410);
  });
});

describe("media proxy", () => {
  it("serves thumbnails only for assets of the shared album", async () => {
    const { url } = await createShare();
    const token = tokenOf(url);
    const ok = await app.inject({ url: `/api/public/timeline/${token}/assets/a1/preview` });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("a1:preview");
    expect(ok.headers["content-type"]).toBe("image/webp");
    expect(ok.headers["cache-control"]).toBe("public, max-age=86400");

    const foreign = await app.inject({ url: `/api/public/timeline/${token}/assets/b1/preview` });
    expect(foreign.statusCode).toBe(404);
    const trashed = await app.inject({ url: `/api/public/timeline/${token}/assets/a4/thumbnail` });
    expect(trashed.statusCode).toBe(404);
  });

  it("never leaks the API key and forwards conditional requests", async () => {
    const { url } = await createShare();
    const res = await app.inject({
      url: `/api/public/timeline/${tokenOf(url)}/assets/a1/thumbnail`,
      headers: { "if-none-match": '"a1-thumbnail"' },
    });
    expect(res.statusCode).toBe(304);
    expect(JSON.stringify(res.headers)).not.toContain(API_KEY);
  });

  it("forwards Range requests for videos", async () => {
    const { url } = await createShare();
    const res = await app.inject({
      url: `/api/public/timeline/${tokenOf(url)}/assets/a2/video`,
      headers: { range: "bytes=2-5" },
    });
    expect(res.statusCode).toBe(206);
    expect(res.body).toBe("2345");
    expect(res.headers["content-range"]).toBe("bytes 2-5/10");
    expect(res.headers["accept-ranges"]).toBe("bytes");
  });
});

describe("password protection", () => {
  async function protectedShare() {
    const { id, url } = await createShare();
    await app.inject({ method: "PATCH", url: `/api/admin/shares/${id}`, headers: ADMIN, payload: { password: "geheim" } });
    return { id, token: tokenOf(url) };
  }

  it("requires the password before revealing assets", async () => {
    const { token } = await protectedShare();
    const res = await app.inject({ url: `/api/public/timeline/${token}` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "password_required", passwordRequired: true, title: "Norwegen 2026" });
    expect((await app.inject({ url: `/api/public/timeline/${token}/assets/a1/preview` })).statusCode).toBe(401);
  });

  it("unlocks with the right password via a signed cookie", async () => {
    const { token } = await protectedShare();
    const wrong = await app.inject({ method: "POST", url: `/api/public/timeline/${token}/unlock`, payload: { password: "falsch" } });
    expect(wrong.statusCode).toBe(401);

    const right = await app.inject({ method: "POST", url: `/api/public/timeline/${token}/unlock`, payload: { password: "geheim" } });
    expect(right.statusCode).toBe(200);
    const cookie = right.cookies.find((c) => c.name === "mt_unlock")!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: `/api/public/timeline/${token}` });

    const cookies = { mt_unlock: cookie.value };
    expect((await app.inject({ url: `/api/public/timeline/${token}`, cookies })).statusCode).toBe(200);
    const media = await app.inject({ url: `/api/public/timeline/${token}/assets/a1/preview`, cookies });
    expect(media.statusCode).toBe(200);
    expect(media.headers["cache-control"]).toBe("private, max-age=3600");

    const forged = { mt_unlock: cookie.value.replace(/^\d+/, "999") };
    expect((await app.inject({ url: `/api/public/timeline/${token}`, cookies: forged })).statusCode).toBe(401);
  });

  it("invalidates unlock cookies when the password changes", async () => {
    const { id, token } = await protectedShare();
    const unlock = await app.inject({ method: "POST", url: `/api/public/timeline/${token}/unlock`, payload: { password: "geheim" } });
    const cookies = { mt_unlock: unlock.cookies[0]!.value };
    await app.inject({ method: "PATCH", url: `/api/admin/shares/${id}`, headers: ADMIN, payload: { password: "neu" } });
    expect((await app.inject({ url: `/api/public/timeline/${token}`, cookies })).statusCode).toBe(401);
  });

  it("is public again once the password is removed", async () => {
    const { id, token } = await protectedShare();
    await app.inject({ method: "PATCH", url: `/api/admin/shares/${id}`, headers: ADMIN, payload: { password: null } });
    expect((await app.inject({ url: `/api/public/timeline/${token}` })).statusCode).toBe(200);
  });

  it("rate-limits unlock attempts", async () => {
    const { token } = await protectedShare();
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({ method: "POST", url: `/api/public/timeline/${token}/unlock`, payload: { password: "x" } });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});

describe("health", () => {
  it("reports Immich readiness", async () => {
    expect((await app.inject({ url: "/healthz" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/readyz" })).json()).toEqual({ ok: true, immich: true });
  });
});
