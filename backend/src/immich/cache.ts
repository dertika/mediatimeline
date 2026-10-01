import type { ImmichAlbum, ImmichAsset, ImmichClient } from "./client.js";

export interface TimelineAsset {
  id: string;
  type: "image" | "video";
  /** Instant the photo was taken (ISO, UTC) – used for sorting. */
  takenAt: string;
  /** Wall-clock time at the place the photo was taken, encoded as ISO without real zone. */
  localDateTime: string;
  description: string | null;
  lat: number | null;
  lng: number | null;
  width: number | null;
  height: number | null;
  city: string | null;
  country: string | null;
}

export interface AlbumSnapshot {
  album: ImmichAlbum;
  assets: TimelineAsset[];
  assetIds: Set<string>;
}

const ROTATED_ORIENTATIONS = new Set(["5", "6", "7", "8"]);

export function toTimelineAsset(asset: ImmichAsset): TimelineAsset | null {
  if (asset.isTrashed) return null;
  if (asset.type !== "IMAGE" && asset.type !== "VIDEO") return null;
  const exif = asset.exifInfo ?? {};

  let width = asset.width ?? exif.exifImageWidth ?? null;
  let height = asset.height ?? exif.exifImageHeight ?? null;
  if (asset.width == null && exif.orientation && ROTATED_ORIENTATIONS.has(String(exif.orientation))) {
    [width, height] = [height, width];
  }

  const hasGeo = typeof exif.latitude === "number" && typeof exif.longitude === "number";
  const description = exif.description?.trim() || null;

  return {
    id: asset.id,
    type: asset.type === "VIDEO" ? "video" : "image",
    takenAt: new Date(exif.dateTimeOriginal ?? asset.fileCreatedAt).toISOString(),
    localDateTime: asset.localDateTime,
    description,
    lat: hasGeo ? exif.latitude! : null,
    lng: hasGeo ? exif.longitude! : null,
    width,
    height,
    city: exif.city ?? null,
    country: exif.country ?? null,
  };
}

export function sortByTakenAt(assets: TimelineAsset[]): TimelineAsset[] {
  return [...assets].sort((a, b) => a.takenAt.localeCompare(b.takenAt) || a.id.localeCompare(b.id));
}

/** In-memory TTL cache of album metadata + assets with in-flight de-duplication. */
export class AlbumCache {
  private entries = new Map<string, { expires: number; value: Promise<AlbumSnapshot> }>();

  constructor(
    private readonly client: ImmichClient,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(albumId: string): Promise<AlbumSnapshot> {
    const hit = this.entries.get(albumId);
    if (hit && hit.expires > this.now()) return hit.value;

    const value = this.load(albumId);
    this.entries.set(albumId, { expires: this.now() + this.ttlMs, value });
    value.catch(() => this.entries.delete(albumId));
    return value;
  }

  invalidate(albumId?: string): void {
    if (albumId) this.entries.delete(albumId);
    else this.entries.clear();
  }

  private async load(albumId: string): Promise<AlbumSnapshot> {
    const [album, rawAssets] = await Promise.all([
      this.client.getAlbum(albumId),
      this.client.getAlbumAssets(albumId),
    ]);
    const assets = sortByTakenAt(
      rawAssets.map(toTimelineAsset).filter((a): a is TimelineAsset => a !== null),
    );
    return { album, assets, assetIds: new Set(assets.map((a) => a.id)) };
  }
}
