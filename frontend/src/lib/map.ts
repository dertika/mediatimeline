import "leaflet/dist/leaflet.css";
import "./map.css";
import type * as Leaflet from "leaflet";

export type L = typeof Leaflet;

/**
 * Loads Leaflet (and optionally markercluster) and creates a map with the
 * OSM tile layer and the shared styling, including dark mode.
 */
export async function createBaseMap(
  container: HTMLElement,
  options: Leaflet.MapOptions & { cluster?: boolean } = {},
): Promise<{ L: L; map: Leaflet.Map }> {
  const { cluster, ...mapOptions } = options;
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
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  return { L, map };
}

/** Accent colour from the CSS tokens (light/dark aware). */
export const accentColor = (el: Element) =>
  getComputedStyle(el).getPropertyValue("--accent").trim() || "#2f6f5e";
