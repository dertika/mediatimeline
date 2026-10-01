import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isUnlocked, setUnlockCookie, verifyPassword } from "../auth/unlock.js";
import { ImmichError } from "../immich/client.js";
import type { AlbumSnapshot } from "../immich/cache.js";
import type { Share } from "../store/db.js";
import type { AppDeps } from "../app.js";
import { forwardableHeaders, pipeUpstream } from "./proxy.js";

export function isExpired(share: Share, now = Date.now()): boolean {
  return share.expiresAt !== null && Date.parse(share.expiresAt) <= now;
}

interface Resolved {
  share: Share;
  snapshot: AlbumSnapshot;
}

export async function publicRoutes(app: FastifyInstance, deps: AppDeps) {
  const { store, cache, immich, config } = deps;

  async function loadSnapshot(share: Share, reply: FastifyReply) {
    try {
      return await cache.get(share.albumId);
    } catch (err) {
      if (err instanceof ImmichError && (err.status === 404 || err.status === 400)) {
        reply.code(404).send({ error: "not_found" });
        return undefined;
      }
      throw err;
    }
  }

  /**
   * Validates token → share → album and the optional password. Sends the
   * error response itself and returns undefined when access is denied.
   */
  async function resolve(
    token: string,
    req: FastifyRequest,
    reply: FastifyReply,
    opts: { revealTitle: boolean },
  ): Promise<Resolved | undefined> {
    const share = store.getByToken(token);
    if (!share || !share.enabled) {
      reply.code(404).send({ error: "not_found" });
      return undefined;
    }
    if (isExpired(share)) {
      reply.code(410).send({ error: "expired" });
      return undefined;
    }
    if (share.passwordHash && !isUnlocked(req, share)) {
      if (!opts.revealTitle) {
        reply.code(401).send({ error: "password_required", passwordRequired: true });
        return undefined;
      }
      const snapshot = await loadSnapshot(share, reply);
      if (!snapshot) return undefined;
      reply.code(401).send({
        error: "password_required",
        passwordRequired: true,
        title: share.titleOverride ?? snapshot.album.albumName,
      });
      return undefined;
    }
    const snapshot = await loadSnapshot(share, reply);
    return snapshot && { share, snapshot };
  }

  app.get<{ Params: { token: string } }>("/api/public/timeline/:token", async (req, reply) => {
    const r = await resolve(req.params.token, req, reply, { revealTitle: true });
    if (!r) return reply;
    const { album, assets } = r.snapshot;
    reply.header("cache-control", "private, no-cache");
    return {
      title: r.share.titleOverride ?? album.albumName,
      description: album.description?.trim() || null,
      startDate: assets[0]?.localDateTime ?? null,
      endDate: assets.at(-1)?.localDateTime ?? null,
      assets,
    };
  });

  app.post<{ Params: { token: string }; Body: { password?: unknown } }>(
    "/api/public/timeline/:token/unlock",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "15 minutes",
          keyGenerator: (req: FastifyRequest) =>
            `${req.ip}:${(req.params as { token: string }).token}`,
        },
      },
    },
    async (req, reply) => {
      const share = store.getByToken(req.params.token);
      if (!share || !share.enabled) return reply.code(404).send({ error: "not_found" });
      if (isExpired(share)) return reply.code(410).send({ error: "expired" });
      if (!share.passwordHash) return { ok: true };

      const password = typeof req.body?.password === "string" ? req.body.password : "";
      if (!(await verifyPassword(share.passwordHash, password))) {
        return reply.code(401).send({ error: "wrong_password" });
      }
      setUnlockCookie(reply, share, config.server.unlockTtlHours);
      return { ok: true };
    },
  );

  const mediaRoute = async (
    req: FastifyRequest<{ Params: { token: string; assetId: string } }>,
    reply: FastifyReply,
    fetchMedia: (assetId: string) => Promise<Response>,
  ) => {
    const r = await resolve(req.params.token, req, reply, { revealTitle: false });
    if (!r) return reply;
    if (!r.snapshot.assetIds.has(req.params.assetId)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const upstream = await fetchMedia(req.params.assetId);
    const cacheControl = r.share.passwordHash
      ? "private, max-age=3600"
      : "public, max-age=86400";
    return pipeUpstream(reply, upstream, cacheControl);
  };

  for (const size of ["thumbnail", "preview"] as const) {
    app.get<{ Params: { token: string; assetId: string } }>(
      `/api/public/timeline/:token/assets/:assetId/${size}`,
      (req, reply) =>
        mediaRoute(req, reply, (id) => immich.thumbnail(id, size, forwardableHeaders(req))),
    );
  }

  app.get<{ Params: { token: string; assetId: string } }>(
    "/api/public/timeline/:token/assets/:assetId/video",
    (req, reply) =>
      mediaRoute(req, reply, (id) => immich.videoPlayback(id, forwardableHeaders(req))),
  );
}
