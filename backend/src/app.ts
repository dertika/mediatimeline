import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { Config } from "./config.js";
import { AlbumCache } from "./immich/cache.js";
import { ImmichClient, ImmichError } from "./immich/client.js";
import { adminRoutes } from "./routes/admin.js";
import { previewRoutes } from "./routes/preview.js";
import { publicRoutes } from "./routes/public.js";
import type { ShareStore } from "./store/db.js";

export interface AppDeps {
  config: Config;
  store: ShareStore;
  immich: ImmichClient;
  cache: AlbumCache;
}

export interface BuildOptions {
  config: Config;
  store: ShareStore;
  sessionSecret: string;
  immich?: ImmichClient;
  logger?: FastifyServerOptions["logger"];
}

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const { config, store } = opts;
  const immich = opts.immich ?? new ImmichClient(config.immich.url, config.immich.apiKey);

  const app = Fastify({
    logger: opts.logger ?? true,
    trustProxy: config.server.trustedProxies,
  });

  const cache = new AlbumCache(immich, config.cache.albumTtlSeconds * 1000, Date.now, (msg, err) =>
    app.log.warn({ err }, msg),
  );
  const deps: AppDeps = { config, store, immich, cache };

  await app.register(cookie, { secret: opts.sessionSecret });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ImmichError) {
      req.log.warn({ err }, "Immich request failed");
      const notFound = err.status === 404 || err.status === 400;
      return reply.code(notFound ? 404 : 502).send({ error: notFound ? "not_found" : "upstream_error" });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error({ err }, "request failed");
    return reply.code(500).send({ error: "internal_error" });
  });

  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async (_req, reply) => {
    const immichOk = await immich.ping();
    return reply.code(immichOk ? 200 : 503).send({ ok: immichOk, immich: immichOk });
  });

  await app.register(async (scope) => publicRoutes(scope, deps));
  await app.register(async (scope) => adminRoutes(scope, deps));

  const staticDir = config.server.staticDir;
  if (staticDir && existsSync(staticDir)) {
    // Real files (JS/CSS chunks, favicon) are served directly; every other GET
    // outside /api falls through to the SPA entry point.
    await app.register(fastifyStatic, { root: staticDir, index: false });
    const indexHtml = readFileSync(join(staticDir, "index.html"), "utf8");
    await app.register(async (scope) => previewRoutes(scope, deps, indexHtml));
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== "GET" || req.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.header("cache-control", "no-cache").sendFile("index.html");
    });
  }

  return app;
}
