import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import { ShareStore } from "../src/store/db.js";
import { API_KEY, startMockImmich } from "./mockImmich.js";

const INDEX = `<!doctype html><html><head><title>mediatimeline</title></head><body>app</body></html>`;

let immich: Awaited<ReturnType<typeof startMockImmich>>;
let app: FastifyInstance;
let store: ShareStore;

beforeAll(async () => {
  immich = await startMockImmich();
});
afterAll(async () => {
  await app?.close();
  await immich.app.close();
});

beforeEach(async () => {
  await app?.close();
  const staticDir = mkdtempSync(join(tmpdir(), "mt-static-"));
  writeFileSync(join(staticDir, "index.html"), INDEX);
  store = new ShareStore(":memory:");
  const config = parseConfig({
    immich: { url: immich.url, apiKey: API_KEY },
    server: { publicBaseUrl: "https://timeline.example.com", staticDir },
  });
  app = await buildApp({ config, store, sessionSecret: "x".repeat(32), logger: false });
});

const meta = (html: string, prop: string) =>
  html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`))?.[1];

describe("link preview", () => {
  it("puts album name, summary and cover image into the share page", async () => {
    const share = store.create("album-1", null);
    const res = await app.inject({ url: `/t/${share.token}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<title>Norwegen 2026 · mediatimeline</title>");
    expect(meta(res.body, "og:title")).toBe("Norwegen 2026");
    expect(meta(res.body, "og:description")).toBe("1. Juni 2026 – 3. Juni 2026 · 3 Fotos &amp; Videos – Roadtrip");
    expect(meta(res.body, "og:url")).toBe(`https://timeline.example.com/t/${share.token}`);
    expect(meta(res.body, "og:image")).toBe(
      `https://timeline.example.com/api/public/timeline/${share.token}/assets/a2/preview`,
    );
    expect(res.body).toContain("<body>app</body>");
  });

  it("uses the title override and escapes HTML", async () => {
    const share = store.create("album-1", null);
    store.update(share.id, { titleOverride: `Sommer "$&" <script>` });
    const res = await app.inject({ url: `/t/${share.token}` });
    expect(meta(res.body, "og:title")).toBe("Sommer &quot;$&amp;&quot; &lt;script&gt;");
    expect(res.body).not.toContain("<script>");
  });

  it("reveals only the title for password-protected links", async () => {
    const share = store.create("album-1", null);
    store.update(share.id, { passwordHash: "x" });
    const res = await app.inject({ url: `/t/${share.token}` });
    expect(meta(res.body, "og:title")).toBe("Norwegen 2026");
    expect(meta(res.body, "og:description")).toBe("Passwortgeschützte Foto-Timeline");
    expect(meta(res.body, "og:image")).toBeUndefined();
    expect(res.body).not.toContain("Roadtrip");
  });

  it("serves the plain page for unknown, disabled or expired links", async () => {
    const disabled = store.create("album-1", null);
    store.update(disabled.id, { enabled: false });
    const expired = store.create("album-1", null);
    store.update(expired.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    for (const token of ["unknown", disabled.token, expired.token]) {
      const res = await app.inject({ url: `/t/${token}` });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(INDEX);
    }
  });
});

describe("SPA entry", () => {
  it("serves the app at the root path and for client-side routes", async () => {
    for (const url of ["/", "/admin"]) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.headers["cache-control"], url).toBe("no-cache");
      expect(res.body).toBe(INDEX);
    }
  });
});
