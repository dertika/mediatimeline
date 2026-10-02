import type { TimelineAsset } from "./types";

export type MediaKind = "thumbnail" | "preview" | "video";

/** URL of one of an asset's media files. */
export type MediaUrl = (asset: Pick<TimelineAsset, "id">, kind: MediaKind) => string;

/** Media proxied by the backend for a share. */
export const apiMedia =
  (apiBase: string): MediaUrl =>
  (asset, kind) =>
    `${apiBase}/assets/${asset.id}/${kind}`;

/** Static files as published for the demo: `<base>/<id>/<kind>.jpg|mp4`. */
export const staticMedia =
  (base: string): MediaUrl =>
  (asset, kind) =>
    `${base}/${asset.id}/${kind}.${kind === "video" ? "mp4" : "jpg"}`;
