/**
 * The timelines this browser has opened, for the start page. The list lives in this
 * browser only; the server learns nothing from it. Storage can be unavailable (private
 * mode, blocked site data, Safari clearing it after a week): the list is a convenience.
 */

const STORAGE_KEY = "mediatimeline:visited";
/** More than this and the oldest entries drop out. */
export const MAX_VISITED = 30;

export interface Visited {
  token: string;
  /** Title at the last visit, shown while the server can't be asked. */
  title: string;
  /** ISO moment of the last visit. */
  lastVisit: string;
}

/** The list with this visit first; an earlier entry of the same link is replaced. */
export function withVisit(list: Visited[], token: string, title: string, now: Date): Visited[] {
  return [{ token, title, lastVisit: now.toISOString() }, ...list.filter((v) => v.token !== token)].slice(0, MAX_VISITED);
}

/** Reads the stored text; anything that doesn't look like the list yields an empty list. */
export function parseVisited(raw: string | null): Visited[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (v): v is Visited =>
          !!v && typeof v.token === "string" && typeof v.title === "string" && !Number.isNaN(Date.parse(v.lastVisit)),
      )
      .slice(0, MAX_VISITED);
  } catch {
    return [];
  }
}

export function loadVisited(): Visited[] {
  try {
    return parseVisited(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function save(list: Visited[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export function recordVisit(token: string, title: string): void {
  save(withVisit(loadVisited(), token, title, new Date()));
}

export function forgetVisit(token: string): Visited[] {
  const list = loadVisited().filter((v) => v.token !== token);
  save(list);
  return list;
}

/** "gerade eben", "vor 5 Min.", "vor 3 Std.", "gestern", "vor 4 Tagen", later the date. */
export function formatAgo(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "gestern";
  if (days < 14) return `vor ${days} Tagen`;
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(iso));
}
