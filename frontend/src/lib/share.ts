/** Links to single photos of a timeline: `/t/<token>?foto=<assetId>`. */

const PARAM = "foto";

/** The photo a link points to, if any. */
export function fotoParam(search: string = location.search): string | null {
  return new URLSearchParams(search).get(PARAM)?.trim() || null;
}

/** Link to a photo of the current timeline. */
export function photoLink(assetId: string, loc: Pick<Location, "origin" | "pathname"> = location): string {
  return `${loc.origin}${loc.pathname}?${PARAM}=${encodeURIComponent(assetId)}`;
}

/**
 * Shares a link: the system share sheet where there is one (phones),
 * otherwise the link is copied and a short note shown.
 */
export async function shareLink(url: string, title: string): Promise<void> {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (err) {
      // Closed by the user: nothing to do. Anything else: fall back to copying.
      if ((err as Error).name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast("Link kopiert");
  } catch {
    window.prompt("Link zum Kopieren:", url);
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** A short note at the bottom of the screen, also above the fullscreen gallery. */
export function showToast(text: string): void {
  let el = document.getElementById("mt-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "mt-toast";
    el.setAttribute("role", "status");
    el.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:calc(24px + env(safe-area-inset-bottom))",
      "transform:translateX(-50%)",
      "z-index:200000",
      "padding:10px 18px",
      "border-radius:999px",
      "background:rgb(20 22 21 / 0.88)",
      "color:#fff",
      "font:600 0.9rem/1.2 system-ui,sans-serif",
      "box-shadow:0 6px 20px rgb(0 0 0 / 0.3)",
      "pointer-events:none",
      "transition:opacity 0.25s",
    ].join(";");
    document.body.append(el);
  }
  el.textContent = text;
  el.style.opacity = "1";
  clearTimeout(toastTimer);
  const toast = el;
  toastTimer = setTimeout(() => (toast.style.opacity = "0"), 2000);
}
