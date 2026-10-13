import type { MediaUrl } from "./media";
import type { TimelineAsset } from "./types";

/**
 * Loads the photos and videos a tour is about to show, so that the switch to
 * the next one finds them ready: photos are loaded and decoded, of a video the
 * poster is decoded and its first seconds are fetched by a hidden video. Only
 * the most recent ones are kept, older ones are released.
 */
export class MediaPreloader {
  private images = new Map<string, { img: HTMLImageElement; ready: Promise<void> }>();
  private videos = new Map<string, HTMLVideoElement>();

  constructor(
    private readonly media: MediaUrl,
    private readonly maxImages = 6,
    private readonly maxVideos = 2,
  ) {}

  /** Starts loading; the promise resolves once the picture (the poster of a video) is decoded. It never rejects. */
  load(asset: TimelineAsset): Promise<void> {
    const url = this.media(asset, "preview");
    let entry = this.images.get(url);
    if (entry) {
      // Used again: moves to the end, so the oldest one is the next to go.
      this.images.delete(url);
    } else {
      const img = new Image();
      img.src = url;
      // A failed preload only means the picture loads the normal way later.
      entry = { img, ready: img.decode().catch(() => {}) };
    }
    this.images.set(url, entry);
    while (this.images.size > this.maxImages) this.images.delete(this.images.keys().next().value!);
    if (asset.type === "video") this.warmUp(this.media(asset, "video"));
    return entry.ready;
  }

  /** Loads several in order. */
  loadAll(assets: TimelineAsset[]): void {
    for (const asset of assets) void this.load(asset);
  }

  /** Lets the browser start fetching the video, without showing it. */
  private warmUp(url: string): void {
    let video = this.videos.get(url);
    if (video) {
      this.videos.delete(url);
    } else {
      video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.src = url;
    }
    this.videos.set(url, video);
    while (this.videos.size > this.maxVideos) {
      const [oldUrl, old] = this.videos.entries().next().value!;
      this.videos.delete(oldUrl);
      release(old);
    }
  }

  /** Frees everything, also stops downloads that are still running. */
  clear(): void {
    this.images.clear();
    for (const video of this.videos.values()) release(video);
    this.videos.clear();
  }
}

/** Dropping the source cancels a download that is still running. */
function release(video: HTMLVideoElement): void {
  video.removeAttribute("src");
  video.load();
}
