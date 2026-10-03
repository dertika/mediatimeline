import type { Place } from "./store/db.js";

/**
 * The real route of a trip from GeoPulse (self-hosted location timeline):
 * the recorded GPS path, split into legs per means of transport.
 * https://github.com/tess1o/geopulse
 */

/** A point of the route: latitude, longitude, Unix time in seconds. */
export type RoutePoint = [number, number, number];

export interface RouteLeg {
  /** GeoPulse movement type, e.g. CAR, TRAIN, BOAT, FLIGHT, WALK; UNKNOWN without trip data. */
  mode: string;
  points: RoutePoint[];
}

interface GpsPointJson {
  latitude: number;
  longitude: number;
  timestamp: string;
}

interface TripJson {
  timestamp: string;
  /** Seconds. */
  tripDuration: number;
  movementType?: string | null;
}

export interface RouteOptions {
  /** Points closer than this to a privacy point (e.g. home) are left out. */
  privacyRadiusMeters: number;
  privacyPoints: Place[];
  /** Simplification tolerance in meters. */
  toleranceMeters?: number;
  /** Upper bound for the number of points sent to the browser. */
  maxPoints?: number;
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Douglas-Peucker on an equirectangular projection, good enough for a few kilometers. */
export function simplify(points: RoutePoint[], toleranceMeters: number): RoutePoint[] {
  if (points.length <= 2 || toleranceMeters <= 0) return points;
  const lat0 = toRad(points[0]![0]);
  const xy = points.map(([lat, lng]) => [toRad(lng) * Math.cos(lat0) * EARTH_RADIUS_M, toRad(lat) * EARTH_RADIUS_M]);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const [ax, ay] = xy[first]!;
    const [bx, by] = xy[last]!;
    const dx = bx! - ax!;
    const dy = by! - ay!;
    const len2 = dx * dx + dy * dy;
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = xy[i]!;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px! - ax!) * dx + (py! - ay!) * dy) / len2));
      const dist = Math.hypot(px! - (ax! + t * dx), py! - (ay! + t * dy));
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (index >= 0 && maxDist > toleranceMeters) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Turns GeoPulse's GPS path and timeline trips into route legs: only points
 * recorded during a trip (no jitter while staying somewhere), one leg per
 * trip, without points near the privacy places, simplified.
 * Without any trips (timeline not generated) the whole path is used.
 */
export function buildRoute(segments: GpsPointJson[][], trips: TripJson[], opts: RouteOptions): RouteLeg[] {
  const windows = trips
    .map((t) => {
      const start = Date.parse(t.timestamp) / 1000;
      return { start, end: start + (t.tripDuration || 0), mode: t.movementType || "UNKNOWN" };
    })
    .filter((w) => Number.isFinite(w.start))
    .sort((a, b) => a.start - b.start);
  const near = (lat: number, lng: number) =>
    opts.privacyPoints.some((p) => distanceMeters(lat, lng, p.lat, p.lng) < opts.privacyRadiusMeters);

  const legs: RouteLeg[] = [];
  for (const segment of segments) {
    let leg: (RouteLeg & { window: number }) | null = null;
    for (const p of segment) {
      const t = Date.parse(p.timestamp) / 1000;
      if (!Number.isFinite(t) || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
      const window = windows.length === 0 ? 0 : windows.findIndex((w) => t >= w.start && t <= w.end);
      if (window < 0 || near(p.latitude, p.longitude)) {
        leg = null;
        continue;
      }
      if (!leg || leg.window !== window) {
        leg = { mode: windows[window]?.mode ?? "UNKNOWN", points: [], window };
        legs.push(leg);
      }
      leg.points.push([round(p.latitude), round(p.longitude), Math.round(t)]);
    }
  }

  const tolerance = opts.toleranceMeters ?? 15;
  let result = legs
    .map(({ mode, points }) => ({ mode, points: simplify(points, tolerance) }))
    .filter((l) => l.points.length >= 2);
  // Very long trips: simplify harder until the route fits.
  const maxPoints = opts.maxPoints ?? 5000;
  for (let factor = 2; count(result) > maxPoints && factor <= 64; factor *= 2) {
    result = result.map(({ mode, points }) => ({ mode, points: simplify(points, tolerance * factor) }));
  }
  return result;
}

const round = (deg: number) => Math.round(deg * 1e5) / 1e5;
const count = (legs: RouteLeg[]) => legs.reduce((n, l) => n + l.points.length, 0);

/** Reads either GeoPulse's plain DTO or its { status, data } envelope. */
const unwrap = <T>(body: unknown): T =>
  (body && typeof body === "object" && "data" in body && "status" in body ? (body as { data: T }).data : body) as T;

/** GeoPulse's REST API before and after its v2 rework (paths and parameter names differ). */
const API_VARIANTS = {
  // Released 1.x (e.g. 1.39): answers wrapped in { status, data }.
  v1: { timeline: "/api/streaming-timeline", path: "/api/gps/path", from: "startTime", to: "endTime" },
  // v2 (GeoPulse main branch): plain DTOs.
  v2: { timeline: "/api/v1/timeline", path: "/api/v1/gps/points/path", from: "from", to: "to" },
} as const;
type ApiVariant = keyof typeof API_VARIANTS;

class GeoPulseHttpError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`GeoPulse answered ${status} for ${path}`);
  }
}

/** Reads the route of a time range from GeoPulse with a user API token; results are cached briefly. */
export class GeoPulseClient {
  private cache = new Map<string, { expires: number; value: Promise<RouteLeg[]> }>();
  /** The API variant that answered last; tried first next time. */
  private variant: ApiVariant = "v1";

  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly ttlMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  route(from: string, to: string, opts: RouteOptions): Promise<RouteLeg[]> {
    const key = JSON.stringify([from, to, opts.privacyRadiusMeters, opts.privacyPoints]);
    const hit = this.cache.get(key);
    if (hit && hit.expires > this.now()) return hit.value;
    for (const [k, v] of this.cache) if (v.expires <= this.now()) this.cache.delete(k);
    const value = this.load(from, to, opts);
    this.cache.set(key, { expires: this.now() + this.ttlMs, value });
    value.catch(() => this.cache.delete(key));
    return value;
  }

  private async load(from: string, to: string, opts: RouteOptions): Promise<RouteLeg[]> {
    const first = this.variant;
    const other: ApiVariant = first === "v1" ? "v2" : "v1";
    try {
      return await this.loadWith(first, from, to, opts);
    } catch (err) {
      if (!(err instanceof GeoPulseHttpError && err.status === 404)) throw err;
    }
    try {
      const legs = await this.loadWith(other, from, to, opts);
      this.variant = other;
      return legs;
    } catch (err) {
      if (err instanceof GeoPulseHttpError && err.status === 404) {
        throw new Error(`GeoPulse knows neither API v1 nor v2 at ${this.url}: is geopulse.url the backend, without /api?`);
      }
      throw err;
    }
  }

  private async loadWith(variant: ApiVariant, from: string, to: string, opts: RouteOptions): Promise<RouteLeg[]> {
    const api = API_VARIANTS[variant];
    const range = new URLSearchParams({ [api.from]: from, [api.to]: to });
    const [path, timeline] = await Promise.all([
      this.get<{ points?: GpsPointJson[]; segments?: GpsPointJson[][] }>(`${api.path}?${range}&simplify=false`),
      this.get<{ trips?: TripJson[] }>(`${api.timeline}?${range}`),
    ]);
    const segments = path.segments?.length ? path.segments : path.points?.length ? [path.points] : [];
    return buildRoute(segments, timeline.trips ?? [], opts);
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.url}${path}`, {
      headers: { "x-api-key": this.apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new GeoPulseHttpError(res.status, path.split("?")[0]!);
    return unwrap<T>(await res.json());
  }
}
