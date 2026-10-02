import type { TimelineAsset } from "./types";

export type LatLng = [number, number];

export interface TourStop {
  /** Mean position of the stop's photos that have GPS. */
  center: LatLng;
  /** South-west / north-east corner of the stop's located photos. */
  bounds: [LatLng, LatLng];
  /** All assets of the stop in chronological order, including those without GPS. */
  assets: TimelineAsset[];
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in meters. */
export function distanceMeters([lat1, lng1]: LatLng, [lat2, lng2]: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

const positionOf = (a: TimelineAsset): LatLng | null => (a.lat !== null && a.lng !== null ? [a.lat, a.lng] : null);

/**
 * Splits the chronologically sorted assets into tour stops. A new stop starts
 * whenever a located photo is farther than `radiusMeters` from the current
 * stop's center; returning to an earlier place later is a new stop, because
 * the tour follows the timeline. Photos without GPS stay with the current stop
 * (leading ones join the first stop).
 */
export function buildStops(assets: TimelineAsset[], radiusMeters: number): TourStop[] {
  const stops: (TourStop & { located: LatLng[] })[] = [];
  let leading: TimelineAsset[] = [];

  for (const asset of assets) {
    const pos = positionOf(asset);
    const current = stops.at(-1);
    if (!pos) {
      if (current) current.assets.push(asset);
      else leading.push(asset);
      continue;
    }
    if (!current || distanceMeters(current.center, pos) > radiusMeters) {
      stops.push({ center: pos, bounds: [pos, pos], assets: [...leading, asset], located: [pos] });
      leading = [];
      continue;
    }
    current.assets.push(asset);
    current.located.push(pos);
    const n = current.located.length;
    current.center = [
      current.located.reduce((sum, p) => sum + p[0], 0) / n,
      current.located.reduce((sum, p) => sum + p[1], 0) / n,
    ];
    current.bounds = [
      [Math.min(current.bounds[0][0], pos[0]), Math.min(current.bounds[0][1], pos[1])],
      [Math.max(current.bounds[1][0], pos[0]), Math.max(current.bounds[1][1], pos[1])],
    ];
  }

  return stops.map(({ located: _located, ...stop }) => stop);
}

/** Flight duration in seconds: short hops are quick, long legs take up to 4 s. */
export function flightSeconds(from: LatLng, to: LatLng): number {
  const km = distanceMeters(from, to) / 1000;
  return Math.min(4, Math.max(1.5, 1.2 + 0.8 * Math.log10(1 + km)));
}

/**
 * Day of the trip, counted in calendar days of the local capture time:
 * the first medium's day is day 1, and gaps count (a photo three days
 * later is day 4).
 */
export function dayNumber(firstLocal: string, local: string): number {
  const day = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((day(local) - day(firstLocal)) / 86_400_000) + 1;
}
