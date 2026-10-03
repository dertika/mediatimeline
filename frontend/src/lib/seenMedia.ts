/**
 * Which photos and videos of a link were already seen in this browser, so the
 * timeline can point out the ones added since the last visit.
 */

const storageKey = (id: string) => `mediatimeline:seen:${id}`;

// Storage can be unavailable (private mode, blocked site data): the hint is a convenience only.
/** The seen asset IDs, or null on the first visit (nothing stored yet). */
export function loadSeen(id: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return null;
    const ids: unknown = JSON.parse(raw);
    return Array.isArray(ids) ? new Set(ids.filter((x): x is string => typeof x === "string")) : null;
  } catch {
    return null;
  }
}

/** Stores the seen IDs, limited to assets still in the album so deleted ones don't pile up. */
export function saveSeen(id: string, seen: Set<string>, assets: { id: string }[]): void {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(assets.filter((a) => seen.has(a.id)).map((a) => a.id)));
  } catch {
    // ignore
  }
}

/** IDs of the assets not seen yet, in timeline order; none on the first visit. */
export function newAssetIds(assets: { id: string }[], seen: Set<string> | null): string[] {
  return seen ? assets.filter((a) => !seen.has(a.id)).map((a) => a.id) : [];
}
