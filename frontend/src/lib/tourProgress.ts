/** Where a tour was left off, so it can continue after the page was reloaded or closed. */
export interface TourPosition {
  stop: number;
  item: number;
  /** For the start button, e.g. "Ort 3 von 6", "Start" or "Ziel". */
  label: string;
  savedAt: number;
}

/** After six hours the tour is offered from the beginning only. */
const MAX_AGE_MS = 6 * 3600_000;

const storageKey = (id: string) => `mediatimeline:tour:${id}`;

// Storage can be unavailable (private mode, blocked site data): resuming is a convenience only.
export function loadPosition(id: string, now = Date.now()): TourPosition | null {
  try {
    const raw = localStorage.getItem(storageKey(id));
    const pos = raw ? (JSON.parse(raw) as TourPosition) : null;
    return pos && now - pos.savedAt < MAX_AGE_MS ? pos : null;
  } catch {
    return null;
  }
}

export function savePosition(id: string, pos: TourPosition | null): void {
  try {
    if (pos) localStorage.setItem(storageKey(id), JSON.stringify(pos));
    else localStorage.removeItem(storageKey(id));
  } catch {
    // ignore
  }
}
