/** Subset of the Immich API used by mediatimeline. */

export interface ImmichExifInfo {
  dateTimeOriginal?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  description?: string | null;
  exifImageWidth?: number | null;
  exifImageHeight?: number | null;
  orientation?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface ImmichAsset {
  id: string;
  type: "IMAGE" | "VIDEO" | "AUDIO" | "OTHER";
  fileCreatedAt: string;
  localDateTime: string;
  duration?: string | null;
  isTrashed?: boolean;
  /** The album owner's (API key's) favorite heart. */
  isFavorite?: boolean;
  width?: number | null;
  height?: number | null;
  exifInfo?: ImmichExifInfo | null;
}

export interface ImmichAlbum {
  id: string;
  albumName: string;
  description?: string | null;
  assetCount: number;
  albumThumbnailAssetId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  updatedAt?: string;
  assets?: ImmichAsset[];
}

export interface ImmichActivity {
  id: string;
  createdAt: string;
  type: "comment" | "like";
  assetId: string | null;
  comment?: string | null;
  user: { name: string };
}

export type ThumbnailSize = "thumbnail" | "preview";

export class ImmichError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class ImmichClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("x-api-key", this.apiKey);
    headers.set("accept", headers.get("accept") ?? "application/json");
    return this.fetchImpl(`${this.baseUrl}/api${path}`, { ...init, headers });
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.request(path, init);
    if (!res.ok) {
      throw new ImmichError(`Immich ${init?.method ?? "GET"} ${path} → ${res.status}`, res.status);
    }
    return (await res.json()) as T;
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.json<{ res: string }>("/server/ping");
      return res.res === "pong";
    } catch {
      return false;
    }
  }

  listAlbums(): Promise<ImmichAlbum[]> {
    return this.json<ImmichAlbum[]>("/albums");
  }

  getAlbum(id: string): Promise<ImmichAlbum> {
    return this.json<ImmichAlbum>(`/albums/${encodeURIComponent(id)}?withoutAssets=true`);
  }

  /**
   * All assets of an album including EXIF data. Uses the metadata search
   * (paginated) and falls back to the legacy embedded `assets` of the album
   * response for older Immich versions.
   */
  async getAlbumAssets(id: string): Promise<ImmichAsset[]> {
    try {
      const assets: ImmichAsset[] = [];
      let page: number | null = 1;
      while (page !== null) {
        const res: { assets: { items: ImmichAsset[]; nextPage: string | null } } = await this.json(
          "/search/metadata",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ albumIds: [id], withExif: true, page, size: 1000 }),
          },
        );
        assets.push(...res.assets.items);
        page = res.assets.nextPage ? Number(res.assets.nextPage) : null;
      }
      return assets;
    } catch (err) {
      if (!(err instanceof ImmichError) || err.status !== 400) throw err;
      const album = await this.json<ImmichAlbum>(`/albums/${encodeURIComponent(id)}`);
      return album.assets ?? [];
    }
  }

  /** All comments and likes of an album (on the album itself and on its assets). */
  getAlbumActivities(albumId: string): Promise<ImmichActivity[]> {
    return this.json<ImmichActivity[]>(`/activities?albumId=${encodeURIComponent(albumId)}`);
  }

  /**
   * Streams a thumbnail/preview. The raw Response is returned so it can be
   * piped; `forward` carries conditional request headers (If-None-Match, …).
   */
  thumbnail(
    assetId: string,
    size: ThumbnailSize,
    forward: Record<string, string> = {},
  ): Promise<Response> {
    return this.request(`/assets/${encodeURIComponent(assetId)}/thumbnail?size=${size}`, {
      headers: { ...forward, accept: "image/*" },
    });
  }

  /** Streams the transcoded video; `forward` carries Range/conditional headers. */
  videoPlayback(assetId: string, forward: Record<string, string> = {}): Promise<Response> {
    return this.request(`/assets/${encodeURIComponent(assetId)}/video/playback`, {
      headers: { ...forward, accept: "video/*" },
    });
  }
}
