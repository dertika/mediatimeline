import "leaflet/dist/leaflet.css";
import "./map.css";
import type * as Leaflet from "leaflet";
import { flightCurve } from "./tour";

export type L = typeof Leaflet;

export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_SIZE = 256;

/**
 * Loads Leaflet (and optionally markercluster) and creates a map with the
 * OSM tile layer and the shared styling, including dark mode.
 */
export async function createBaseMap(
  container: HTMLElement,
  options: Leaflet.MapOptions & { cluster?: boolean; tileOptions?: Leaflet.TileLayerOptions } = {},
): Promise<{ L: L; map: Leaflet.Map }> {
  const { cluster, tileOptions, ...mapOptions } = options;
  const L = (await import("leaflet")).default;
  if (cluster) {
    // markercluster is a classic plugin that extends the global L.
    (window as unknown as { L: L }).L = L;
    await Promise.all([
      import("leaflet.markercluster"),
      import("leaflet.markercluster/dist/MarkerCluster.css"),
      import("leaflet.markercluster/dist/MarkerCluster.Default.css"),
    ]);
  }
  container.classList.add("mt-map");
  const map = L.map(container, mapOptions);
  L.tileLayer(TILE_URL, {
    ...tileOptions,
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  return { L, map };
}

/** Accent colour from the CSS tokens (light/dark aware). */
export const accentColor = (el: Element) =>
  getComputedStyle(el).getPropertyValue("--accent").trim() || "#2f6f5e";

const prefetched = new Set<string>();
// Keeps the Image objects referenced until they finished loading.
const inFlight = new Set<HTMLImageElement>();

/**
 * Warms the browser cache with the tiles that will cover the map at `center`
 * and `zoom`, plus `levels - 1` zoom levels above it that an approach passes
 * just before. Per level the viewport plus `margin` tiles is fetched.
 */
export function prefetchTiles(
  map: Leaflet.Map,
  center: [number, number],
  zoom: number,
  levels = 1,
  margin = 1,
): number {
  const half = map.getSize().divideBy(2);
  let count = 0;
  for (let z = zoom; z > zoom - levels && z >= 0; z--) {
    const c = map.project(center, z);
    const min = c.subtract(half).divideBy(TILE_SIZE).floor();
    const max = c.add(half).divideBy(TILE_SIZE).floor();
    const n = 2 ** z;
    for (let x = min.x - margin; x <= max.x + margin; x++) {
      for (let y = min.y - margin; y <= max.y + margin; y++) {
        if (y < 0 || y >= n) continue;
        const url = TILE_URL.replace("{z}", String(z))
          .replace("{x}", String(((x % n) + n) % n))
          .replace("{y}", String(y));
        if (prefetched.has(url)) continue;
        prefetched.add(url);
        const img = new Image();
        img.onload = img.onerror = () => inFlight.delete(img);
        inFlight.add(img);
        img.src = url;
        count++;
      }
    }
  }
  return count;
}

/**
 * The flight `map.flyTo(target, targetZoom)` would take from the current
 * view: the length of its curve and `steps + 1` views evenly along it.
 * Mirrors Leaflet's own computation, see `flightCurve`.
 */
export function flightPath(
  map: Leaflet.Map,
  target: [number, number],
  targetZoom: number,
  steps = 0,
): { length: number; views: { center: [number, number]; zoom: number }[] } {
  const startZoom = map.getZoom();
  const from = map.project(map.getCenter(), startZoom);
  const to = map.project(target, startZoom);
  const size = map.getSize();
  const w0 = Math.max(size.x, size.y);
  const u1 = to.distanceTo(from) || 1;
  const curve = flightCurve(w0, w0 * map.getZoomScale(startZoom, targetZoom), u1);
  const views = [];
  for (let k = 0; k <= steps; k++) {
    const s = (curve.length * k) / Math.max(1, steps);
    const c = map.unproject(from.add(to.subtract(from).multiplyBy(curve.u(s) / u1)), startZoom);
    views.push({ center: [c.lat, c.lng] as [number, number], zoom: map.getScaleZoom(w0 / curve.w(s), startZoom) });
  }
  return { length: curve.length, views };
}

/**
 * Adds a coarse copy of the map below the main tiles: Leaflet always shows its
 * tiles from `maxNativeZoom`, scaled up. Where the sharp tiles are not loaded
 * yet (e.g. while flying), a blurry map shows through instead of grey.
 */
export function addBackgroundLayer(L: L, map: Leaflet.Map, maxNativeZoom: number): Leaflet.TileLayer {
  return L.tileLayer(TILE_URL, {
    maxNativeZoom: Math.min(10, Math.max(3, Math.round(maxNativeZoom))),
    maxZoom: 19,
    zIndex: 0,
    updateWhenIdle: false,
    keepBuffer: 2,
  }).addTo(map);
}
