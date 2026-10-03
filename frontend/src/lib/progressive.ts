/**
 * Progressive images: the small thumbnail shows first, the large preview is
 * loaded once the image has stayed near the screen for a moment, so fast
 * scrolling (or a long jump) doesn't queue dozens of large downloads.
 */

/** How long an image must stay near the screen before its large version loads. */
const DWELL_MS = 150;

const loaded = new Map<string, Promise<void>>();

/** Loads and decodes an image once; later calls share the same promise. */
export function preloadFull(url: string): Promise<void> {
  let done = loaded.get(url);
  if (!done) {
    const img = new Image();
    img.src = url;
    done = img.decode().catch((err: unknown) => {
      loaded.delete(url);
      throw err;
    });
    loaded.set(url, done);
  }
  return done;
}

export interface ProgressiveOptions {
  /** URL of the large version. */
  full: string;
  /** Attribute that shows the image: `src` for <img>, `poster` for <video>. */
  attr?: "src" | "poster";
}

/** Svelte action: swaps the element's thumbnail for `full` once it is near the screen. */
export function progressive(node: HTMLElement, { full, attr = "src" }: ProgressiveOptions) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const show = () => {
    observer.disconnect();
    preloadFull(full).then(
      () => {
        if (stopped) return;
        node.setAttribute(attr, full);
        node.dataset.loaded = "";
      },
      // The thumbnail stays when the large version can't be loaded.
      () => {},
    );
  };
  const observer = new IntersectionObserver(
    ([entry]) => {
      clearTimeout(timer);
      if (entry?.isIntersecting) timer = setTimeout(show, DWELL_MS);
    },
    // One screen height ahead, so it is usually ready when scrolled into view.
    { rootMargin: "100% 0px" },
  );
  observer.observe(node);
  return {
    destroy() {
      stopped = true;
      clearTimeout(timer);
      observer.disconnect();
    },
  };
}
