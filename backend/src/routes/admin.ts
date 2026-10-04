import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ACCENTS } from "../accent.js";
import { createAdminGuard } from "../auth/adminGuard.js";
import { hashPassword } from "../auth/unlock.js";
import { CAPTION_SOURCES } from "../caption.js";
import type { Share } from "../store/db.js";
import type { AppDeps } from "../app.js";
import { publicBaseUrl } from "../url.js";
import { forwardableHeaders, pipeUpstream } from "./proxy.js";
import { isExpired } from "./public.js";

const CreateShareBody = z.object({ albumId: z.string().min(1) });

const PlaceBody = z.object({
  name: z.string().trim().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const UpdateShareBody = z.object({
  enabled: z.boolean().optional(),
  titleOverride: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v)),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  password: z.string().min(1).max(200).nullable().optional(),
  captionSource: z.enum(CAPTION_SOURCES).optional(),
  showComments: z.boolean().optional(),
  tourIntervalSeconds: z.number().int().min(2).max(60).optional(),
  tourRadiusMeters: z.number().int().min(100).max(50_000).optional(),
  tourVideoMaxSeconds: z.number().int().min(0).max(600).optional(),
  tripStart: PlaceBody.nullable().optional(),
  tripEnd: PlaceBody.nullable().optional(),
  tripEndSameAsStart: z.boolean().optional(),
  showRoute: z.boolean().optional(),
  accent: z.enum(ACCENTS).optional(),
});

const GeocodeQuery = z.object({ q: z.string().trim().min(2).max(100) });

const IdParams = z.object({ id: z.coerce.number().int().positive() });

export async function adminRoutes(app: FastifyInstance, deps: AppDeps) {
  const { store, immich, cache, config, geocoder } = deps;

  app.addHook(
    "onRequest",
    createAdminGuard({ trustedProxies: config.server.trustedProxies, ...config.admin }),
  );

  const baseUrl = (req: FastifyRequest) => publicBaseUrl(config, req);

  const toDto = (share: Share, req: FastifyRequest) => ({
    id: share.id,
    albumId: share.albumId,
    url: `${baseUrl(req)}/t/${share.token}`,
    titleOverride: share.titleOverride,
    enabled: share.enabled,
    expiresAt: share.expiresAt,
    expired: isExpired(share),
    hasPassword: share.passwordHash !== null,
    captionSource: share.captionSource,
    showComments: share.showComments,
    tourIntervalSeconds: share.tourIntervalSeconds,
    tourRadiusMeters: share.tourRadiusMeters,
    tourVideoMaxSeconds: share.tourVideoMaxSeconds,
    tripStart: share.tripStart,
    tripEnd: share.tripEnd,
    tripEndSameAsStart: share.tripEndSameAsStart,
    showRoute: share.showRoute,
    accent: share.accent,
    createdAt: share.createdAt,
    createdBy: share.createdBy,
  });

  // Also tells the admin page which optional integrations are set up.
  app.get("/api/admin/me", async (req) => ({ ...req.adminUser, geopulse: Boolean(config.geopulse) }));

  app.get("/api/admin/immich/albums", async (req) => {
    const albums = await immich.listAlbums();
    const shares = store.list();
    return albums
      .map((a) => ({
        id: a.id,
        albumName: a.albumName,
        description: a.description ?? null,
        assetCount: a.assetCount,
        thumbnailAssetId: a.albumThumbnailAssetId ?? null,
        startDate: a.startDate ?? null,
        endDate: a.endDate ?? null,
        shares: shares.filter((s) => s.albumId === a.id).map((s) => toDto(s, req)),
      }))
      .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? ""));
  });

  app.get<{ Params: { assetId: string } }>(
    "/api/admin/immich/assets/:assetId/thumbnail",
    async (req, reply) => {
      const upstream = await immich.thumbnail(req.params.assetId, "thumbnail", forwardableHeaders(req));
      return pipeUpstream(reply, upstream, "private, max-age=3600");
    },
  );

  // Place search for the start and end of a trip.
  app.get("/api/admin/geocode", async (req, reply) => {
    const query = GeocodeQuery.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_query" });
    try {
      return await geocoder.search(query.data.q);
    } catch (err) {
      req.log.warn({ err }, "geocoder request failed");
      return reply.code(502).send({ error: "geocoder_unavailable" });
    }
  });

  app.get("/api/admin/shares", async (req) => store.list().map((s) => toDto(s, req)));

  app.post("/api/admin/shares", async (req, reply) => {
    const body = CreateShareBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    // Verifies the album exists and that the API key can read it.
    await immich.getAlbum(body.data.albumId);
    const share = store.create(body.data.albumId, req.adminUser?.name ?? null);
    return reply.code(201).send(toDto(share, req));
  });

  app.patch("/api/admin/shares/:id", async (req, reply) => {
    const params = IdParams.safeParse(req.params);
    const body = UpdateShareBody.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_body" });
    const { password, ...rest } = body.data;
    const updated = store.update(params.data.id, {
      ...rest,
      expiresAt: rest.expiresAt === undefined ? undefined : rest.expiresAt && new Date(rest.expiresAt).toISOString(),
      passwordHash: password === undefined ? undefined : password && (await hashPassword(password)),
    });
    if (!updated) return reply.code(404).send({ error: "not_found" });
    return toDto(updated, req);
  });

  app.delete("/api/admin/shares/:id", async (req, reply) => {
    const params = IdParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_body" });
    if (!store.delete(params.data.id)) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  app.post("/api/admin/cache/clear", async () => {
    cache.invalidate();
    return { ok: true };
  });
}
