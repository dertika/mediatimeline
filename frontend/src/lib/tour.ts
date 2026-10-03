import type { TimelineAsset, TourSettings } from "./types";

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

export interface FlightCurve {
  /** Length of the flight in Leaflet's units; its flyTo takes 0.8 s per unit by default. */
  length: number;
  /** Distance travelled (in start-zoom pixels) after `s` units. */
  u(s: number): number;
  /** Visible width (in start-zoom pixels) after `s` units, i.e. how far out the flight has zoomed. */
  w(s: number): number;
}

/**
 * The zoom-and-pan curve of Leaflet's `flyTo` (van Wijk & Nuij), with the
 * same constants, so that the tour can know the flight before it starts.
 * `w0`/`w1`: visible width at start/end, `u1`: distance, all in pixels at the
 * start zoom.
 */
export function flightCurve(w0: number, w1: number, u1: number): FlightCurve {
  const rho = 1.42;
  const rho2 = rho * rho;
  const r = (end: boolean) => {
    const t1 = w1 * w1 - w0 * w0 + (end ? -1 : 1) * rho2 * rho2 * u1 * u1;
    const b = t1 / (2 * (end ? w1 : w0) * rho2 * u1);
    const sq = Math.sqrt(b * b + 1) - b;
    return sq < 1e-9 ? -18 : Math.log(sq);
  };
  const r0 = r(false);
  return {
    length: (r(true) - r0) / rho,
    u: (s) => (w0 * (Math.cosh(r0) * Math.tanh(r0 + rho * s) - Math.sinh(r0))) / rho2,
    w: (s) => (w0 * Math.cosh(r0)) / Math.cosh(r0 + rho * s),
  };
}

/**
 * Flight duration in seconds: Leaflet's natural pace for the curve, so long
 * legs that zoom far out take longer; between 1.5 and 8 s.
 */
export function flightDuration(curveLength: number): number {
  return Math.min(8, Math.max(1.5, 0.8 * curveLength));
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

/** Assumed length of a flight and of a video without a length limit, for the estimate. */
const FLIGHT_SECONDS = 4;
const VIDEO_SECONDS = 20;

/**
 * Rough length of a tour in seconds, shown on the start button: overview,
 * a flight and a map pause per place, every photo and video, a card per
 * further day and the final overview.
 */
export function estimateTourSeconds(stops: TourStop[], days: number, tour: TourSettings): number {
  const media = stops
    .flatMap((s) => s.assets)
    .reduce((sum, a) => sum + (a.type === "video" ? tour.videoMaxSeconds || VIDEO_SECONDS : tour.intervalSeconds), 0);
  const extraDays = Math.max(0, days - 1);
  return 2 + stops.length * (FLIGHT_SECONDS + tour.intervalSeconds) + media + extraDays * tour.intervalSeconds + 3;
}
