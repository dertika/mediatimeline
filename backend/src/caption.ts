import type { TimelineAsset, TimelineComment } from "./immich/cache.js";

export const CAPTION_SOURCES = ["description", "firstComment", "descriptionOrFirstComment", "none"] as const;
export type CaptionSource = (typeof CAPTION_SOURCES)[number];

/** Picks the caption shown under a photo according to the share's caption mode. */
export function buildCaption(
  asset: Pick<TimelineAsset, "description">,
  comments: TimelineComment[],
  mode: CaptionSource,
): string | null {
  const firstComment = comments[0]?.text ?? null;
  switch (mode) {
    case "description":
      return asset.description;
    case "firstComment":
      return firstComment;
    case "descriptionOrFirstComment":
      return asset.description ?? firstComment;
    case "none":
      return null;
  }
}
