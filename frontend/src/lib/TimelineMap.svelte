<script lang="ts">
  import { onMount } from "svelte";
  import { accentColor, createBaseMap } from "./map";
  import type { MediaUrl } from "./media";
  import { modeStyle, routeModes } from "./route";
  import type { Place, RouteLeg, TimelineAsset, Trip } from "./types";

  let {
    assets,
    trip,
    route,
    media,
    onselect,
  }: {
    assets: TimelineAsset[];
    /** Start and end of the trip, joined to the route. */
    trip?: Trip;
    /** The recorded route from GeoPulse; drawn instead of straight lines between the photos. */
    route?: RouteLeg[] | null;
    media: MediaUrl;
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

      const at = (p: Place) => L.latLng(p.lat, p.lng);
      const start = trip?.start ?? null;
      const end = trip?.end ?? null;
      const points = [
        ...(start ? [at(start)] : []),
        ...located.map((a) => L.latLng(a.lat!, a.lng!)),
        ...(end ? [at(end)] : []),
      ];
      const dashed = { color: accentColor(container), weight: 3, opacity: 0.7, dashArray: "6 6" };
      if (route?.length) {
        // The recorded way, coloured by means of transport. Start and end of
        // the trip are cut off for privacy, so they stay joined by a dashed line.
        for (const leg of route) {
          const { color } = modeStyle(leg.mode);
          const latLngs = leg.points.map(([lat, lng]) => L.latLng(lat, lng));
          L.polyline(latLngs, { color, weight: 4, opacity: 0.85, ...(leg.mode === "FLIGHT" ? { dashArray: "2 8" } : {}) }).addTo(map);
          points.push(...latLngs);
        }
        const first = route[0]!.points[0]!;
        const last = route.at(-1)!.points.at(-1)!;
        if (start) L.polyline([at(start), L.latLng(first[0], first[1])], dashed).addTo(map);
        if (end) L.polyline([L.latLng(last[0], last[1]), at(end)], dashed).addTo(map);

        const legend = new L.Control({ position: "bottomleft" });
        legend.onAdd = () => {
          const el = L.DomUtil.create("div", "route-legend");
          el.innerHTML = routeModes(route)
            .map((m) => `<span><i style="background:${m.color}"></i>${m.label}</span>`)
            .join("");
          return el;
        };
        legend.addTo(map);
      } else {
        L.polyline(points, dashed).addTo(map);
      }

      const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 40, chunkedLoading: true });
      for (const asset of located) {
        const icon = L.divIcon({
          className: "photo-marker",
          html: `<img src="${media(asset, "thumbnail")}" alt="" loading="lazy" />`,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        });
        const marker = L.marker([asset.lat!, asset.lng!], { icon, title: asset.caption ?? "" });
        marker.on("click", () => onselect(asset.id));
        cluster.addLayer(marker);
      }
      map.addLayer(cluster);

      const roundTrip = start && end && at(start).equals(at(end));
      const tripMarker = (place: Place, label: string) =>
        L.marker(at(place), {
          icon: L.divIcon({ className: "trip-marker", html: `<span>${label}</span>`, iconSize: [0, 0] }),
          title: place.name,
          zIndexOffset: 1000,
        }).addTo(map!);
      if (start) tripMarker(start, roundTrip ? "Start &amp; Ziel" : "Start");
      if (end && !roundTrip) tripMarker(end, "Ziel");
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
  .map :global(.route-legend) {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    max-width: 220px;
    padding: 4px 8px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    color: var(--text);
    font-size: 0.75rem;
    line-height: 1.4;
  }

  .map :global(.route-legend i) {
    display: inline-block;
    width: 14px;
    height: 4px;
    margin-right: 5px;
    border-radius: 2px;
    vertical-align: middle;
  }

  .map {
    height: min(60vh, 460px);
    border-radius: var(--radius);
    border: 1px solid var(--border);
    z-index: 0;
  }
</style>
