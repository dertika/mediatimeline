import type { TourStop } from "./tour";
import type { RouteLeg } from "./types";

type LatLng = [number, number];

/** Colours and German names of GeoPulse's movement types. */
const MODES: Record<string, { color: string; label: string }> = {
  WALK: { color: "#16a34a", label: "zu Fuß" },
  RUNNING: { color: "#16a34a", label: "zu Fuß" },
  BICYCLE: { color: "#65a30d", label: "Fahrrad" },
  CAR: { color: "#2563eb", label: "Auto" },
  MOTORCYCLE: { color: "#2563eb", label: "Motorrad" },
  PUBLIC_TRANSPORT: { color: "#9333ea", label: "Bus & Bahn" },
  TRAIN: { color: "#9333ea", label: "Zug" },
  BOAT: { color: "#0891b2", label: "Schiff" },
  FLIGHT: { color: "#64748b", label: "Flug" },
};
const OTHER = { color: "#d97706", label: "Unterwegs" };

export const modeStyle = (mode: string) => MODES[mode] ?? OTHER;

/** The modes of a route for the legend, each once, in order of appearance. */
export function routeModes(route: RouteLeg[]): { color: string; label: string }[] {
  const seen = new Map<string, { color: string; label: string }>();
  for (const leg of route) {
    const style = modeStyle(leg.mode);
    if (!seen.has(style.label)) seen.set(style.label, style);
  }
  return [...seen.values()];
}

/** The recorded points between two moments (Unix seconds), across legs, in time order. */
export function routeBetween(route: RouteLeg[], from: number, to: number): LatLng[] {
  return route
    .flatMap((leg) => leg.points)
    .filter(([, , t]) => t >= from && t <= to)
    .sort((a, b) => a[2] - b[2])
    .map(([lat, lng]) => [lat, lng]);
}

const seconds = (iso: string) => Date.parse(iso) / 1000;

/**
 * For each stop, the recorded way there from the previous stop with photos:
 * the route between the last photo there and the first photo here. Null
 * where nothing was recorded or a stop has no photos (start and end of the trip).
 */
export function stopLegs(stops: TourStop[], route: RouteLeg[] | null | undefined): (LatLng[] | null)[] {
  return stops.map((stop, i) => {
    const prev = stops[i - 1];
    if (!route?.length || !prev?.assets.length || !stop.assets.length) return null;
    const from = Math.max(...prev.assets.map((a) => seconds(a.takenAt)));
    const to = Math.min(...stop.assets.map((a) => seconds(a.takenAt)));
    const points = routeBetween(route, from, to);
    return points.length >= 2 ? points : null;
  });
}

/** Index of the point of `path` (from `start` on) closest to `at`. */
export function nearestAhead(path: LatLng[], at: LatLng, start = 0): number {
  const scale = Math.cos((at[0] * Math.PI) / 180);
  let best = start;
  let bestDist = Infinity;
  for (let i = start; i < path.length; i++) {
    const dLat = path[i]![0] - at[0];
    const dLng = (path[i]![1] - at[1]) * scale;
    const dist = dLat * dLat + dLng * dLng;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}
