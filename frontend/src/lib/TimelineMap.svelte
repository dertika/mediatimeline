<script lang="ts">
  import { onMount } from "svelte";
  import { accentColor, createBaseMap } from "./map";
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
      const base = await createBaseMap(container, { scrollWheelZoom: false, cluster: true });
      const { L } = base;
      map = base.map;
      if (cancelled) return map.remove();

      const located = assets.filter((a) => a.lat !== null && a.lng !== null);

      const points = located.map((a) => L.latLng(a.lat!, a.lng!));
      L.polyline(points, { color: accentColor(container), weight: 3, opacity: 0.7, dashArray: "6 6" }).addTo(map);

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
</style>
