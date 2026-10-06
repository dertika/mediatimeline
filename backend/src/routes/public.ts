import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isUnlocked, setUnlockCookie, verifyPassword } from "../auth/unlock.js";
import { buildCaption } from "../caption.js";
import { ImmichError } from "../immich/client.js";
import { ALBUM_COMMENTS, type AlbumSnapshot } from "../immich/cache.js";
import type { RouteLeg } from "../geopulse.js";
import type { Place, Share } from "../store/db.js";
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
  const { store, cache, immich, config, geopulse } = deps;

  /** The real route from GeoPulse, if switched on for the link; the timeline works without it. */
  async function routeFor(share: Share, snapshot: AlbumSnapshot, req: FastifyRequest): Promise<RouteLeg[] | null> {
    const { assets } = snapshot;
    if (!share.showRoute || !geopulse || !config.geopulse || assets.length < 2) return null;
    const tripEnd = share.tripEndSameAsStart ? share.tripStart : share.tripEnd;
    const from = assets[0]!.takenAt;
    const to = assets.at(-1)!.takenAt;
    try {
      const route = await geopulse.route(from, to, {
        privacyRadiusMeters: config.geopulse.privacyRadiusMeters,
        privacyPoints: [share.tripStart, tripEnd].filter((p): p is Place => p !== null),
      });
      if (route.length === 0) req.log.info({ from, to }, "GeoPulse has no trips or GPS points for this album");
      return route;
    } catch (err) {
      req.log.warn({ err }, "GeoPulse route not available");
      return null;
    }
  }

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
    const { album, assets, comments } = r.snapshot;
    const { captionSource, showComments } = r.share;
    const route = await routeFor(r.share, r.snapshot, req);
    reply.header("cache-control", "private, no-cache");
    return {
      title: r.share.titleOverride ?? album.albumName,
      description: album.description?.trim() || null,
      startDate: assets[0]?.localDateTime ?? null,
      endDate: assets.at(-1)?.localDateTime ?? null,
      captionSource,
      accent: r.share.accent,
      tour: {
        intervalSeconds: r.share.tourIntervalSeconds,
        radiusMeters: r.share.tourRadiusMeters,
        videoMaxSeconds: r.share.tourVideoMaxSeconds,
        fromPhoto: r.share.photoClickTour,
        highlightMin: r.share.highlightMinLikes,
      },
      trip: {
        start: r.share.tripStart,
        end: r.share.tripEndSameAsStart ? r.share.tripStart : r.share.tripEnd,
      },
      route,
      albumComments: showComments ? (comments.get(ALBUM_COMMENTS) ?? []) : [],
      assets: assets.map(({ description, ...asset }) => {
        const assetComments = comments.get(asset.id) ?? [];
        return {
          ...asset,
          caption: buildCaption({ description }, assetComments, captionSource),
          comments: showComments ? assetComments : [],
        };
      }),
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
