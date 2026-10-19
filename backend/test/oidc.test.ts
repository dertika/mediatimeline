import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { ShareStore } from "../src/store/db.js";
import { API_KEY, startMockImmich } from "./mockImmich.js";
import { CLIENT_ID, CLIENT_SECRET, startMockOidc } from "./mockOidc.js";

const SECRET = "x".repeat(32);
const BASE = "https://timeline.example.com";
const ADMIN_HEADERS = { "remote-user": "carol", "remote-groups": "admins" };

let immich: Awaited<ReturnType<typeof startMockImmich>>;
let idp: Awaited<ReturnType<typeof startMockOidc>>;
let app: FastifyInstance;

beforeAll(async () => {
  immich = await startMockImmich();
  idp = await startMockOidc();
});
afterAll(async () => {
  await app?.close();
  await immich.app.close();
  await idp.app.close();
});

async function build(oidc: object | null = {}, allowedGroups = ["admins"], admin: object = {}) {
  await app?.close();
  const config = parseConfig({
    immich: { url: immich.url, apiKey: API_KEY },
    server: { trustedProxies: ["loopback"], publicBaseUrl: BASE },
    admin: {
      allowedGroups,
      ...admin,
      ...(oidc ? { oidc: { issuer: idp.issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, ...oidc } } : {}),
    },
  });
  app = await buildApp({ config, store: new ShareStore(":memory:"), sessionSecret: SECRET, logger: false });
}

beforeEach(async () => {
  idp.state.user = { sub: "u1", preferred_username: "alice", email: "alice@example.test", groups: ["admins"] };
  idp.state.claimsIn = "idtoken";
  idp.state.wrongNonce = false;
  await build();
});

/** "name=value" pairs of a response's Set-Cookie headers that set a value. */
function cookiesOf(res: LightMyRequestResponse): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of [res.headers["set-cookie"]].flat()) {
    if (typeof line !== "string") continue;
    const [pair] = line.split(";");
    const at = pair!.indexOf("=");
    out[pair!.slice(0, at)] = pair!.slice(at + 1);
  }
  return out;
}
const cookieHeader = (jar: Record<string, string>) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

/** Walks through the login: our login route, the provider, our callback. */
async function login(query = "", tweakCallback: (path: string) => string = (p) => p) {
  const start = await app.inject({ url: `/api/auth/login${query}` });
  expect(start.statusCode).toBe(302);
  const provider = await fetch(start.headers.location as string, { redirect: "manual" });
  const back = new URL(provider.headers.get("location")!);
  const callback = await app.inject({
    url: tweakCallback(back.pathname + back.search),
    headers: { cookie: cookieHeader(cookiesOf(start)) },
  });
  return { start, callback, session: cookiesOf(callback) };
}

describe("OpenID Connect login", () => {
  it("is not there without admin.oidc and the admin API only asks for the headers", async () => {
    await build(null);
    expect((await app.inject({ url: "/api/auth/login" })).statusCode).toBe(404);
    const res = await app.inject({ url: "/api/admin/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
  });

  it("tells the admin page where to sign in", async () => {
    const res = await app.inject({ url: "/api/admin/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized", login: "/api/auth/login" });
  });

  it("sends the browser to the provider with state, nonce and a PKCE challenge", async () => {
    const res = await app.inject({ url: "/api/auth/login" });
    expect(res.statusCode).toBe(302);
    const url = new URL(res.headers.location as string);
    expect(url.origin).toBe(idp.issuer);
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/callback`);
    expect(url.searchParams.get("scope")).toBe("openid profile email groups");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect([res.headers["set-cookie"]].flat().join("\n")).toMatch(/mt_oidc=[^;]+;.*HttpOnly/i);
  });

  it("signs in, remembers the user and lets the admin API through", async () => {
    const { callback, session } = await login();
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("/admin");
    expect(session.mt_admin).toBeTruthy();
    expect([callback.headers["set-cookie"]].flat().join("\n")).toMatch(/mt_admin=[^;]+;.*HttpOnly/i);

    const headers = { cookie: cookieHeader({ mt_admin: session.mt_admin! }) };
    const me = await app.inject({ url: "/api/admin/me", headers });
    expect(me.json()).toMatchObject({ name: "alice", groups: ["admins"], via: "oidc" });
    expect((await app.inject({ url: "/api/admin/shares", headers })).statusCode).toBe(200);
  });

  it("reads the user claims from the user info endpoint when the ID token has none", async () => {
    idp.state.claimsIn = "userinfo";
    const { session } = await login();
    const me = await app.inject({ url: "/api/admin/me", headers: { cookie: cookieHeader({ mt_admin: session.mt_admin! }) } });
    expect(me.json()).toMatchObject({ name: "alice", groups: ["admins"], via: "oidc" });
  });

  it("only goes back to pages of the admin area", async () => {
    expect((await login("?return=/admin?album=1")).callback.headers.location).toBe("/admin?album=1");
    expect((await login("?return=//evil.example")).callback.headers.location).toBe("/admin");
    expect((await login("?return=https://evil.example/admin")).callback.headers.location).toBe("/admin");
  });

  it("turns away someone outside admin.allowedGroups", async () => {
    idp.state.user.groups = ["family"];
    const { callback, session } = await login();
    expect(callback.headers.location).toBe("/admin?login=forbidden");
    expect(session.mt_admin).toBeUndefined();
  });

  it("lets everyone the provider signs in through when admin.allowedGroups is empty", async () => {
    await build({}, []);
    idp.state.user.groups = undefined;
    const { session } = await login();
    expect(session.mt_admin).toBeTruthy();
  });

  it("refuses a nonce that is not ours, a changed state and a missing login cookie", async () => {
    idp.state.wrongNonce = true;
    expect((await login()).callback.headers.location).toBe("/admin?login=failed");
    idp.state.wrongNonce = false;

    const changed = await login("", (p) => p.replace(/state=[^&]+/, "state=other"));
    expect(changed.callback.headers.location).toBe("/admin?login=failed");
    expect(changed.session.mt_admin).toBeUndefined();

    const noCookie = await app.inject({ url: "/api/auth/callback?code=abc&state=def" });
    expect(noCookie.headers.location).toBe("/admin?login=failed");
  });

  it("fails the login, not the service, when the provider cannot be reached", async () => {
    await build({ issuer: "http://127.0.0.1:1" });
    const res = await app.inject({ url: "/api/auth/login" });
    expect(res.headers.location).toBe("/admin?login=failed");
    expect((await app.inject({ url: "/healthz" })).statusCode).toBe(200);
  });

  it("does not accept forged, tampered or expired session cookies", async () => {
    const { session } = await login();
    const me = (cookie: string) => app.inject({ url: "/api/admin/me", headers: { cookie: `mt_admin=${cookie}` } });
    expect((await me(session.mt_admin!)).statusCode).toBe(200);
    expect((await me(session.mt_admin!.replace(/.$/, "x"))).statusCode).toBe(401);
    expect((await me("e30")).statusCode).toBe(401);

    const payload = (exp: number) => Buffer.from(JSON.stringify({ name: "alice", groups: ["admins"], exp })).toString("base64url");
    const signed = (exp: number) => encodeURIComponent(fastifyCookie.sign(payload(exp), SECRET));
    expect((await me(signed(Math.floor(Date.now() / 1000) + 60))).statusCode).toBe(200);
    expect((await me(signed(Math.floor(Date.now() / 1000) - 1))).statusCode).toBe(401);
  });

  it("applies admin.allowedGroups to a session that is already open", async () => {
    const { session } = await login();
    await build({}, ["other"]);
    const me = await app.inject({ url: "/api/admin/me", headers: { cookie: cookieHeader({ mt_admin: session.mt_admin! }) } });
    expect(me.statusCode).toBe(403);
  });

  it("turns away changes that come from another site", async () => {
    const { session } = await login();
    const headers = { cookie: cookieHeader({ mt_admin: session.mt_admin! }) };
    const create = (origin?: string) =>
      app.inject({ method: "POST", url: "/api/admin/cache/clear", headers: origin ? { ...headers, origin } : headers });
    expect((await create("https://evil.example")).statusCode).toBe(403);
    expect((await create(BASE)).statusCode).toBe(200);
    expect((await create()).statusCode).toBe(200);
  });

  it("signs out", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/logout" });
    expect(res.statusCode).toBe(204);
    expect([res.headers["set-cookie"]].flat().join("\n")).toMatch(/mt_admin=;/);
  });

  it("keeps the proxy headers working and ahead of a session", async () => {
    const withHeaders = await app.inject({ url: "/api/admin/me", headers: ADMIN_HEADERS });
    expect(withHeaders.json()).toMatchObject({ name: "carol", via: "header" });

    const { session } = await login();
    const both = await app.inject({
      url: "/api/admin/me",
      headers: { ...ADMIN_HEADERS, cookie: cookieHeader({ mt_admin: session.mt_admin! }) },
    });
    expect(both.json()).toMatchObject({ name: "carol", via: "header" });
  });

  it("falls back to the session when the proxy secret is missing", async () => {
    await build({}, ["admins"], { proxySecret: "p".repeat(32) });
    const { session } = await login();
    const res = await app.inject({
      url: "/api/admin/me",
      headers: { ...ADMIN_HEADERS, cookie: cookieHeader({ mt_admin: session.mt_admin! }) },
    });
    expect(res.json()).toMatchObject({ name: "alice", via: "oidc" });
  });

  it("does not trust the headers from an address that is no proxy", async () => {
    const res = await app.inject({ url: "/api/admin/me", headers: ADMIN_HEADERS, remoteAddress: "203.0.113.5" });
    expect(res.statusCode).toBe(401);
  });
});
