import "photoswipe/style.css";
import type PhotoSwipe from "photoswipe";
import type { SlideData } from "photoswipe";
import { formatDayTime, placeOf } from "./format";
import type { MediaUrl } from "./media";
import { photoLink, shareLink } from "./share";
import type { TimelineAsset } from "./types";

const FALLBACK_SIZE = { width: 1440, height: 1080 };

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function toSlide(asset: TimelineAsset, media: MediaUrl): SlideData {
  const size = asset.width && asset.height ? { width: asset.width, height: asset.height } : FALLBACK_SIZE;
  if (asset.type === "video") {
    return {
      html: `<div class="mt-video"><video controls playsinline preload="metadata" poster="${escapeAttr(media(asset, "preview"))}" src="${escapeAttr(media(asset, "video"))}"></video></div>`,
    };
  }
  return { src: media(asset, "preview"), msrc: media(asset, "thumbnail"), ...size, alt: asset.caption ?? "" };
}

function pauseVideos(pswp: PhotoSwipe, except?: HTMLElement) {
  pswp.element?.querySelectorAll("video").forEach((video) => {
    if (!except?.contains(video)) video.pause();
  });
}

/**
 * Opens the fullscreen gallery (swipe, arrows, keyboard, pinch zoom without a zoom button) at `index`.
 * `onClose` receives the asset that was shown last, so the page can scroll to it.
 */
export async function openGallery(
  assets: TimelineAsset[],
  index: number,
  media: MediaUrl,
  title: string,
  onClose?: (asset: TimelineAsset) => void,
): Promise<void> {
  const { default: PhotoSwipe } = await import("photoswipe");
  const pswp = new PhotoSwipe({
    dataSource: assets.map((a) => toSlide(a, media)),
    index,
    counter: false,
    zoom: false,
    bgOpacity: 1,
    showHideAnimationType: "fade",
    arrowPrevTitle: "Zurück",
    arrowNextTitle: "Weiter",
    closeTitle: "Schließen",
    errorMsg: "Das Bild konnte nicht geladen werden.",
  });

  // Small overlays in the corners: date + counter, place, caption.
  const overlays: { name: string; appendTo: "bar" | "root"; text: (a: TimelineAsset, i: number) => string }[] = [
    { name: "mt-date", appendTo: "bar", text: (a, i) => `${formatDayTime(a.localDateTime)}  ·  ${i + 1} / ${assets.length}` },
    { name: "mt-place", appendTo: "root", text: (a) => placeOf(a) },
    { name: "mt-caption", appendTo: "root", text: (a) => a.caption ?? "" },
  ];
  pswp.on("uiRegister", () => {
    // Link to the photo shown, like the share button under each photo.
    pswp.ui?.registerElement({
      name: "mt-share",
      title: "Link teilen",
      order: 9,
      isButton: true,
      html: '<svg class="pswp__icn" viewBox="0 0 24 24" width="22" height="22" style="color: var(--pswp-icon-color); fill: none" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/></g></svg>',
      onClick: (_event, _el, instance) => {
        const asset = assets[instance.currIndex];
        if (asset) void shareLink(photoLink(asset.id), title);
      },
    });
    for (const overlay of overlays) {
      pswp.ui?.registerElement({
        name: overlay.name,
        order: 5,
        isButton: false,
        appendTo: overlay.appendTo,
        onInit: (el, instance) => {
          const update = () => {
            const asset = assets[instance.currIndex];
            const text = asset ? overlay.text(asset, instance.currIndex) : "";
            el.textContent = text;
            el.hidden = text === "";
          };
          instance.on("change", update);
          update();
        },
      });
    }
  });

  pswp.on("change", () => {
    pauseVideos(pswp, pswp.currSlide?.container);
    // Lift the bottom overlays above the native video controls.
    pswp.element?.classList.toggle("mt-is-video", assets[pswp.currIndex]?.type === "video");
  });
  pswp.on("close", () => {
    pauseVideos(pswp);
    const last = assets[pswp.currIndex];
    if (last) onClose?.(last);
  });
  pswp.init();
}
