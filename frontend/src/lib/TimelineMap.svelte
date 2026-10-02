<script lang="ts">
  import { onMount } from "svelte";
  import "leaflet/dist/leaflet.css";
  import "leaflet.markercluster/dist/MarkerCluster.css";
  import "leaflet.markercluster/dist/MarkerCluster.Default.css";
  import type { TimelineAsset } from "./types";

  let {
    assets,
    mediaBase,
    onselect,
  }: {
    assets: TimelineAsset[];
    mediaBase: string;
    onselect: (assetId: string) => void;
  } = $props();

  let container: HTMLDivElement;

  onMount(() => {
    let map: import("leaflet").Map | undefined;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      // markercluster is a classic plugin that extends the global L.
      (window as unknown as { L: typeof L }).L = L;
      await import("leaflet.markercluster");
      if (cancelled) return;

      const located = assets.filter((a) => a.lat !== null && a.lng !== null);
      map = L.map(container, { scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      const points = located.map((a) => L.latLng(a.lat!, a.lng!));
      const accent = getComputedStyle(container).getPropertyValue("--accent").trim() || "#2f6f5e";
      L.polyline(points, { color: accent, weight: 3, opacity: 0.7, dashArray: "6 6" }).addTo(map);

      const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 40 });
      for (const asset of located) {
        const icon = L.divIcon({
          className: "photo-marker",
          html: `<img src="${mediaBase}/assets/${asset.id}/thumbnail" alt="" loading="lazy" />`,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        });
        const marker = L.marker([asset.lat!, asset.lng!], { icon, title: asset.caption ?? "" });
        marker.on("click", () => onselect(asset.id));
        cluster.addLayer(marker);
      }
      map.addLayer(cluster);
      map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 13 });
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  });
</script>

<div class="map" bind:this={container} role="region" aria-label="Karte der Aufnahmeorte"></div>

<style>
  .map {
    height: min(60vh, 460px);
    border-radius: var(--radius);
    border: 1px solid var(--border);
    z-index: 0;
  }

  /* must beat Leaflet's ".leaflet-marker-pane img { width: auto }" */
  :global(.leaflet-container .leaflet-marker-pane .photo-marker img) {
    width: 40px;
    height: 40px;
    object-fit: cover;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
    background: #ccc;
  }

  /* Dark mode: OSM only offers light tiles, so the tile layer is inverted.
     Markers, route and clusters live in other panes and keep their colours. */
  @media (prefers-color-scheme: dark) {
    .map {
      background: #1b1d1c;
    }

    .map :global(.leaflet-tile-pane) {
      filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9) saturate(0.7);
    }

    .map :global(.leaflet-bar a) {
      background: var(--surface);
      color: var(--text);
      border-bottom-color: var(--border);
    }

    .map :global(.leaflet-bar) {
      border-color: var(--border);
    }

    .map :global(.leaflet-control-attribution) {
      background: rgb(29 32 31 / 0.8);
      color: var(--muted);
    }

    .map :global(.leaflet-control-attribution a) {
      color: var(--accent);
    }

    .map :global(.marker-cluster div) {
      color: #0d1f19;
    }

    .map :global(.photo-marker img) {
      border-color: var(--surface);
    }
  }
</style>
