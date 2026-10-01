// Immich's localDateTime is the wall-clock time at the place the photo was
// taken, encoded as if it were UTC – so it is always formatted in UTC.
const dayFormat = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const timeFormat = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export const formatDay = (local: string) => dayFormat.format(new Date(local));
export const formatTime = (local: string) => timeFormat.format(new Date(local));
export const dayKey = (local: string) => local.slice(0, 10);

export function formatRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const s = shortDate.format(new Date(start));
  if (!end || dayKey(start) === dayKey(end)) return s;
  return `${s} – ${shortDate.format(new Date(end))}`;
}

/** Real local date-time (browser zone) for admin views, e.g. expiry dates. */
export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
