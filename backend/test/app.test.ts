import { gunzipSync } from "node:zlib";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { Geocoder } from "../src/geocoder.js";
import type { GeoPulseClient } from "../src/geopulse.js";
import { ShareStore } from "../src/store/db.js";
import { API_KEY, startMockImmich } from "./mockImmich.js";

let immich: Awaited<ReturnType<typeof startMockImmich>>;
let app: FastifyInstance;
let store: ShareStore;

const ADMIN = { "remote-user": "alice", "remote-groups": "users,admins" };

const PHOTON_MUNICH = {
  features: [
    { geometry: { coordinates: [11.5755, 48.1374] }, properties: { name: "München", state: "Bayern", country: "Deutschland" } },
    { geometry: { coordinates: [11.5754, 48.1373] }, properties: { name: "Marienplatz", city: "München", state: "Bayern", country: "Deutschland" } },
  ],
};
const geocoderRequests: string[] = [];
const fakePhoton: typeof fetch = async (input) => {
  const url = String(input);
  geocoderRequests.push(url);
  if (url.includes("q=kaputt")) return new Response("down", { status: 503 });
  return Response.json(PHOTON_MUNICH);
};

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
  geocoderRequests.length = 0;
  const geocoder = new Geocoder("https://photon.test", fakePhoton);
  app = await buildApp({ config, store, geocoder, sessionSecret: "x".repeat(32), logger: false });
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
    expect(res.json()).toEqual({ name: "alice", groups: ["users", "admins"], geopulse: false });
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
    expect(body.assets[0]).toMatchObject({ type: "image", caption: "Ankunft", lat: 60.4, lng: 5.3, comments: [] });
    expect(body.assets[1]).toMatchObject({ type: "video", caption: null, lat: null, width: 3000, height: 4000 });
    expect(body.assets[0]).not.toHaveProperty("description");
    expect(body.albumComments).toEqual([]);
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

describe("tour settings", () => {
  it("has defaults and exposes them in the timeline", async () => {
    const { url } = await createShare();
    const shares = (await app.inject({ url: "/api/admin/shares", headers: ADMIN })).json();
    expect(shares[0]).toMatchObject({ tourIntervalSeconds: 5, tourRadiusMeters: 1000, tourVideoMaxSeconds: 30 });
    const body = (await app.inject({ url: `/api/public/timeline/${tokenOf(url)}` })).json();
    expect(body.tour).toEqual({ intervalSeconds: 5, radiusMeters: 1000, videoMaxSeconds: 30, fromPhoto: false });
  });

  it("can be changed by the admin", async () => {
    const { id, url } = await createShare();
    const settings = { tourIntervalSeconds: 8, tourRadiusMeters: 2000, tourVideoMaxSeconds: 0 };
    const res = await app.inject({ method: "PATCH", url: `/api/admin/shares/${id}`, headers: ADMIN, payload: settings });
    expect(res.json()).toMatchObject(settings);
    const body = (await app.inject({ url: `/api/public/timeline/${tokenOf(url)}` })).json();
    expect(body.tour).toEqual({ intervalSeconds: 8, radiusMeters: 2000, videoMaxSeconds: 0, fromPhoto: false });
  });

  it.each([
    { tourIntervalSeconds: 1 },
    { tourIntervalSeconds: 61 },
    { tourIntervalSeconds: 2.5 },
    { tourRadiusMeters: 50 },
    { tourRadiusMeters: 60_000 },
    { tourVideoMaxSeconds: -1 },
    { tourVideoMaxSeconds: 601 },
  ])("rejects out-of-range values %o", async (payload) => {
    const { id } = await createShare();
    const res = await app.inject({ method: "PATCH", url: `/api/admin/shares/${id}`, headers: ADMIN, payload });
    expect(res.statusCode).toBe(400);
  });
});

describe("trip start and end", () => {
  const MUNICH = { name: "München", lat: 48.1374, lng: 11.5755 };
  const ROME = { name: "Rom", lat: 41.8933, lng: 12.4829 };

  it("is unset by default", async () => {
    const { url } = await createShare();
    const body = (await app.inject({ url: `/api/public/timeline/${tokenOf(url)}` })).json();
    expect(body.trip).toEqual({ start: null, end: null });
  });

  it("is set by the admin and shown in the timeline", async () => {
    const { id, url } = await createShare();
    const payload = { tripStart: MUNICH, tripEnd: ROME };
    const res = await app.inject({ method: "PATCH", url: `/api/admin/shares/${id}`, headers: ADMIN, payload });
    expect(res.json()).toMatchObject({ ...payload, tripEndSameAsStart: false });
    const body = (await app.inject({ url: `/api/public/timeline/${tokenOf(url)}` })).json();
    expect(body.trip).toEqual({ start: MUNICH, end: ROME });
  });

  it("follows the start for a round trip, and can be removed", async () => {
    const { id, url } = await createShare();
    const patch = (payload: object) =>
      app.inject({ method: "PATCH", url: `/api/admin/shares/${id}`, headers: ADMIN, payload });
    await patch({ tripStart: ROME, tripEnd: ROME, tripEndSameAsStart: true });
    await patch({ tripStart: MUNICH });
    const timeline = async () => (await app.inject({ url: `/api/public/timeline/${tokenOf(url)}` })).json();
    expect((await timeline()).trip).toEqual({ start: MUNICH, end: MUNICH });
    await patch({ tripStart: null, tripEnd: null, tripEndSameAsStart: false });
    expect((await timeline()).trip).toEqual({ start: null, end: null });
  });

  it.each([
    { tripStart: { name: "", lat: 1, lng: 1 } },
    { tripStart: { name: "x", lat: 91, lng: 1 } },
    { tripEnd: { name: "x", lat: 1, lng: 181 } },
    { tripEnd: "Rom" },
  ])("rejects invalid places %o", async (payload) => {
    const { id } = await createShare();
    const res = await app.inject({ method: "PATCH", url: `/api/admin/shares/${id}`, headers: ADMIN, payload });
    expect(res.statusCode).toBe(400);
  });
});

describe("place search", () => {
  it("returns short names with context, for admins only", async () => {
    expect((await app.inject({ url: "/api/admin/geocode?q=münchen" })).statusCode).toBe(401);
    const res = await app.inject({ url: "/api/admin/geocode?q=m%C3%BCnchen", headers: ADMIN });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { name: "München", lat: 48.1374, lng: 11.5755, detail: "Bayern, Deutschland" },
      { name: "Marienplatz, München", lat: 48.1373, lng: 11.5754, detail: "Bayern, Deutschland" },
    ]);
    expect(geocoderRequests[0]).toBe("https://photon.test/api/?q=m%C3%BCnchen&limit=6&lang=de");
  });

  it("caches results", async () => {
    await app.inject({ url: "/api/admin/geocode?q=rom", headers: ADMIN });
    await app.inject({ url: "/api/admin/geocode?q=Rom", headers: ADMIN });
    expect(geocoderRequests).toHaveLength(1);
  });

  it("rejects too short queries and reports an unavailable geocoder", async () => {
    expect((await app.inject({ url: "/api/admin/geocode?q=a", headers: ADMIN })).statusCode).toBe(400);
    const res = await app.inject({ url: "/api/admin/geocode?q=kaputt", headers: ADMIN });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "geocoder_unavailable" });
  });
});

describe("accent colour", () => {
  it("defaults to green, can be chosen from the curated list and reaches the timeline", async () => {
    const { id, url } = await createShare();
    const timeline = () => app.inject({ url: `/api/public/timeline/${tokenOf(url)}` }).then((r) => r.json());
    expect((await timeline()).accent).toBe("gruen");
    const ok = await app.inject({ method: "PATCH", url: `/api/admin/shares/${id}`, headers: ADMIN, payload: { accent: "terrakotta" } });
    expect(ok.json().accent).toBe("terrakotta");
    expect((await timeline()).accent).toBe("terrakotta");
    const bad = await app.inject({ method: "PATCH", url: `/api/admin/shares/${id}`, headers: ADMIN, payload: { accent: "#ff0000" } });
    expect(bad.statusCode).toBe(400);
  });
});

describe("tour from a photo", () => {
  it("is off by default and can be switched on per link", async () => {
    const { id, url } = await createShare();
    const timeline = () => app.inject({ url: `/api/public/timeline/${tokenOf(url)}` }).then((r) => r.json());
    expect((await timeline()).tour.fromPhoto).toBe(false);
    const ok = await app.inject({ method: "PATCH", url: `/api/admin/shares/${id}`, headers: ADMIN, payload: { photoClickTour: true } });
    expect(ok.json().photoClickTour).toBe(true);
    expect((await timeline()).tour.fromPhoto).toBe(true);
  });
});

describe("GeoPulse route", () => {
  const ROUTE = [{ mode: "CAR", points: [[48.1, 11.5, 1], [48.2, 11.6, 2]] }];

  async function appWithGeoPulse(route: () => Promise<unknown>) {
    await app.close();
    const config = parseConfig({
      immich: { url: immich.url, apiKey: API_KEY },
      server: { trustedProxies: ["loopback"] },
      admin: { allowedGroups: ["admins"] },
      geopulse: { url: "http://geopulse:8080/api/v1/", apiKey: "gp-key", privacyRadiusMeters: 500 },
    });
    expect(config.geopulse?.url).toBe("http://geopulse:8080");
    const calls: unknown[][] = [];
    const geopulse = { route: async (...args: unknown[]) => (calls.push(args), route()) } as unknown as GeoPulseClient;
    app = await buildApp({ config, store, geopulse, sessionSecret: "x".repeat(32), logger: false });
    return calls;
  }

  it("is only included when switched on for the link, with the trip ends as privacy places", async () => {
    const calls = await appWithGeoPulse(async () => ROUTE);
    expect((await app.inject({ url: "/api/admin/me", headers: ADMIN })).json().geopulse).toBe(true);
    const { id, url } = await createShare();
    const timeline = () => app.inject({ url: `/api/public/timeline/${tokenOf(url)}` }).then((r) => r.json());
    expect((await timeline()).route).toBeNull();
    expect(calls).toHaveLength(0);

    const home = { name: "Zuhause", lat: 48.1, lng: 11.5 };
    const res = await app.inject({
      method: "PATCH",
      url: `/api/admin/shares/${id}`,
      headers: ADMIN,
      payload: { showRoute: true, tripStart: home, tripEndSameAsStart: true },
    });
    expect(res.json().showRoute).toBe(true);
    const body = await timeline();
    expect(body.route).toEqual(ROUTE);
    const [from, to, opts] = calls[0] as [string, string, { privacyRadiusMeters: number; privacyPoints: unknown[] }];
    expect(from).toBe(body.assets[0].takenAt);
    expect(to).toBe(body.assets.at(-1).takenAt);
    expect(opts).toEqual({ privacyRadiusMeters: 500, privacyPoints: [home, home] });
  });

  it("keeps the timeline working when GeoPulse fails", async () => {
    await appWithGeoPulse(async () => {
      throw new Error("down");
    });
    const { id, url } = await createShare();
    await app.inject({ method: "PATCH", url: `/api/admin/shares/${id}`, headers: ADMIN, payload: { showRoute: true } });
    const res = await app.inject({ url: `/api/public/timeline/${tokenOf(url)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().route).toBeNull();
  });
});

describe("comments", () => {
  async function shareWith(settings: Record<string, unknown>) {
    const { id, url } = await createShare();
    const res = await app.inject({ method: "PATCH", url: `/api/admin/shares/${id}`, headers: ADMIN, payload: settings });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject(settings);
    return (await app.inject({ url: `/api/public/timeline/${tokenOf(url)}` })).json();
  }
  const captions = (body: { assets: { id: string; caption: string | null }[] }) =>
    Object.fromEntries(body.assets.map((a) => [a.id, a.caption]));

  it("defaults to the description without exposing comments", async () => {
    const { url } = await createShare();
    const shares = (await app.inject({ url: "/api/admin/shares", headers: ADMIN })).json();
    expect(shares[0]).toMatchObject({ captionSource: "description", showComments: false });
    const body = (await app.inject({ url: `/api/public/timeline/${tokenOf(url)}` })).json();
    expect(JSON.stringify(body)).not.toContain("Alice");
  });

  it("uses the oldest comment as caption", async () => {
    const body = await shareWith({ captionSource: "firstComment" });
    expect(captions(body)).toEqual({ a1: "Endlich da", a2: "Fähre!", a3: null });
    expect(JSON.stringify(body)).not.toContain("Bob");
  });

  it("falls back from description to the first comment", async () => {
    const body = await shareWith({ captionSource: "descriptionOrFirstComment" });
    expect(captions(body)).toEqual({ a1: "Ankunft", a2: "Fähre!", a3: "Abschied" });
  });

  it("can hide captions entirely", async () => {
    const body = await shareWith({ captionSource: "none" });
    expect(captions(body)).toEqual({ a1: null, a2: null, a3: null });
  });

  it("shows all comments with author names, oldest first, without likes", async () => {
    const body = await shareWith({ showComments: true });
    expect(body.assets[0].comments).toEqual([
      { author: "Alice Muster", text: "Endlich da", createdAt: "2026-06-04T09:00:00Z" },
      { author: "Bob Beispiel", text: "Was für ein Licht!", createdAt: "2026-06-05T10:00:00Z" },
    ]);
    expect(body.albumComments).toEqual([{ author: "Alice Muster", text: "Tolle Reise", createdAt: "2026-06-06T08:00:00Z" }]);
    expect(JSON.stringify(body)).not.toContain("anderes Album");
  });

  it("rejects unknown caption modes", async () => {
    const { id } = await createShare();
    const res = await app.inject({ method: "PATCH", url: `/api/admin/shares/${id}`, headers: ADMIN, payload: { captionSource: "exif" } });
    expect(res.statusCode).toBe(400);
  });

  it("keeps working when the API key may not read comments", async () => {
    immich.state.activitiesForbidden = true;
    try {
      const body = await shareWith({ captionSource: "descriptionOrFirstComment", showComments: true });
      expect(captions(body)).toEqual({ a1: "Ankunft", a2: null, a3: "Abschied" });
      expect(body.albumComments).toEqual([]);
    } finally {
      immich.state.activitiesForbidden = false;
    }
  });
});

describe("media proxy", () => {
  it("compresses the timeline JSON but not the media", async () => {
    const { id, url } = await createShare();
    // With comments the JSON is above the 1 KB threshold.
    await app.inject({ method: "PATCH", url: `/api/admin/shares/${id}`, headers: ADMIN, payload: { showComments: true } });
    const token = tokenOf(url);
    const headers = { "accept-encoding": "gzip" };
    const json = await app.inject({ url: `/api/public/timeline/${token}`, headers });
    expect(json.headers["content-encoding"]).toBe("gzip");
    expect(JSON.parse(gunzipSync(json.rawPayload).toString()).assets).toHaveLength(3);
    const image = await app.inject({ url: `/api/public/timeline/${token}/assets/a1/preview`, headers });
    expect(image.headers["content-encoding"]).toBeUndefined();
    expect(image.body).toBe("a1:preview");
  });

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
