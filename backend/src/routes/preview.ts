import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppDeps } from "../app.js";
import { buildCaption } from "../caption.js";
import type { AlbumSnapshot } from "../immich/cache.js";
import type { Share } from "../store/db.js";
import { publicBaseUrl } from "../url.js";
import { isExpired } from "./public.js";

export interface LinkPreview {
  title: string;
  description: string;
  url: string;
  image: string | null;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const shortDate = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** "1. Juni 2026 – 3. Juni 2026" from Immich's local date-times (formatted as UTC). */
function dateRange(start: string | undefined, end: string | undefined): string | null {
  if (!start) return null;
  const s = shortDate.format(new Date(start));
  if (!end || start.slice(0, 10) === end.slice(0, 10)) return s;
  return `${s} – ${shortDate.format(new Date(end))}`;
}

/**
 * Preview of a shared timeline, or of one photo of it (`?foto=<assetId>`):
 * then that photo is the image and its caption, date and place the text.
 */
export function buildPreview(share: Share, snapshot: AlbumSnapshot, baseUrl: string, assetId?: string): LinkPreview {
  const { album, assets } = snapshot;
  const title = share.titleOverride ?? album.albumName;
  const url = `${baseUrl}/t/${share.token}`;
  const imageOf = (id: string) => `${baseUrl}/api/public/timeline/${share.token}/assets/${id}/preview`;

  if (share.passwordHash) {
    // Only what the password page shows anyway: the title, no photo.
    return { title, description: "Passwortgeschützte Foto-Timeline", url, image: null };
  }

  const photo = assetId ? assets.find((a) => a.id === assetId) : undefined;
  if (photo) {
    const caption = buildCaption(photo, snapshot.comments.get(photo.id) ?? [], share.captionSource);
    const place = [photo.city, photo.country].filter(Boolean).join(", ");
    const when = [shortDate.format(new Date(photo.localDateTime)), place].filter(Boolean).join(", ");
    return {
      title,
      description: [caption?.slice(0, 200), when].filter(Boolean).join(" · "),
      url: `${url}?foto=${encodeURIComponent(photo.id)}`,
      image: imageOf(photo.id),
    };
  }

  const count = `${assets.length} ${assets.length === 1 ? "Foto/Video" : "Fotos & Videos"}`;
  const range = dateRange(assets[0]?.localDateTime, assets.at(-1)?.localDateTime);
  const summary = [range, count].filter(Boolean).join(" · ");
  const albumText = album.description?.trim();
  const description = albumText ? `${summary} – ${albumText.slice(0, 200)}` : summary;

  const coverId =
    (album.albumThumbnailAssetId && snapshot.assetIds.has(album.albumThumbnailAssetId)
      ? album.albumThumbnailAssetId
      : assets.find((a) => a.type === "image")?.id) ?? null;
  const image = coverId ? imageOf(coverId) : null;

  return { title, description, url, image };
}

/** Puts title + Open Graph tags (read by messengers, which don't run JS) into the SPA shell. */
export function injectPreview(indexHtml: string, p: LinkPreview): string {
  const meta = [
    ["og:type", "website"],
    ["og:site_name", "mediatimeline"],
    ["og:title", p.title],
    ["og:description", p.description],
    ["og:url", p.url],
    ...(p.image ? [["og:image", p.image]] : []),
  ]
    .map(([k, v]) => `<meta property="${k}" content="${escapeHtml(v!)}" />`)
    .concat(
      `<meta name="description" content="${escapeHtml(p.description)}" />`,
      `<meta name="twitter:card" content="${p.image ? "summary_large_image" : "summary"}" />`,
    )
    .join("\n    ");
  // Replacer functions, so "$&" etc. in album names are not treated as patterns.
  return indexHtml
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(p.title)} · mediatimeline</title>`)
    .replace("</head>", () => `    ${meta}\n  </head>`);
}

export async function previewRoutes(app: FastifyInstance, deps: AppDeps, indexHtml: string) {
  const { store, cache, config } = deps;

  async function previewFor(token: string, req: FastifyRequest, assetId?: string): Promise<LinkPreview | null> {
    const share = store.getByToken(token);
    if (!share || !share.enabled || isExpired(share)) return null;
    try {
      return buildPreview(share, await cache.get(share.albumId), publicBaseUrl(config, req), assetId);
    } catch (err) {
      // The preview is a nicety; the page itself reports Immich errors.
      req.log.warn({ err }, "link preview unavailable");
      return null;
    }
  }

  app.get<{ Params: { token: string }; Querystring: { foto?: unknown } }>("/t/:token", async (req, reply) => {
    const foto = typeof req.query.foto === "string" ? req.query.foto : undefined;
    const preview = await previewFor(req.params.token, req, foto);
    return reply
      .header("cache-control", "no-cache")
      .type("text/html; charset=utf-8")
      .send(preview ? injectPreview(indexHtml, preview) : indexHtml);
  });
}
