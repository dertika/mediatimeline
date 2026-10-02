import "photoswipe/style.css";
import type PhotoSwipe from "photoswipe";
import type { SlideData } from "photoswipe";
import { formatDayTime, placeOf } from "./format";
import type { TimelineAsset } from "./types";

const FALLBACK_SIZE = { width: 1440, height: 1080 };

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function toSlide(asset: TimelineAsset, apiBase: string): SlideData {
  const base = `${apiBase}/assets/${asset.id}`;
  const size = asset.width && asset.height ? { width: asset.width, height: asset.height } : FALLBACK_SIZE;
  if (asset.type === "video") {
    return {
      html: `<div class="mt-video"><video controls playsinline preload="metadata" poster="${escapeAttr(`${base}/preview`)}" src="${escapeAttr(`${base}/video`)}"></video></div>`,
    };
  }
  return { src: `${base}/preview`, msrc: `${base}/thumbnail`, ...size, alt: asset.caption ?? "" };
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
  apiBase: string,
  onClose?: (asset: TimelineAsset) => void,
): Promise<void> {
  const { default: PhotoSwipe } = await import("photoswipe");
  const pswp = new PhotoSwipe({
    dataSource: assets.map((a) => toSlide(a, apiBase)),
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
