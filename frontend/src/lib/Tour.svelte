<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { fade } from "svelte/transition";
  import type * as Leaflet from "leaflet";
  import { formatDayTime, placeOf } from "./format";
  import { accentColor, createBaseMap, type L as LeafletNS } from "./map";
  import { buildStops, flightSeconds } from "./tour";
  import type { Timeline, TimelineAsset } from "./types";

  let {
    timeline,
    apiBase,
    onclose,
  }: {
    timeline: Timeline;
    apiBase: string;
    /** Called with the asset shown last, so the page can scroll to it. */
    onclose: (last: TimelineAsset | null) => void;
  } = $props();

  const OVERVIEW_MS = 2000;
  const MEDIA_FADE_MS = 350;
  const CONTROLS_HIDE_MS = 3000;

  // The timeline does not change while the tour is open, so a snapshot is enough.
  const { stops, intervalMs, videoMaxSeconds } = untrack(() => ({
    stops: buildStops(timeline.assets, timeline.tour.radiusMeters),
    intervalMs: timeline.tour.intervalSeconds * 1000,
    videoMaxSeconds: timeline.tour.videoMaxSeconds,
  }));

  let mapEl: HTMLDivElement;
  let videoEl = $state<HTMLVideoElement>();
  let L: LeafletNS;
  let map: Leaflet.Map | undefined;
  let route: Leaflet.Polyline;
  let here: Leaflet.CircleMarker;

  let stopIdx = $state(-1);
  let itemIdx = $state(0);
  let showMedia = $state(false);
  let paused = $state(false);
  let finished = $state(false);
  let soundBlocked = $state(false);
  let controlsVisible = $state(true);

  /** Stop the map is currently zoomed to (-1 = overview). */
  let flownTo = -1;
  /** Bumped on every navigation; async steps of an outdated navigation stop themselves. */
  let run = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let lastShown: TimelineAsset | null = null;
  let enteredFullscreen = false;
  let swipeX: number | null = null;

  const current = $derived(stopIdx >= 0 ? (stops[stopIdx]?.assets[itemIdx] ?? null) : null);
  const media = (a: TimelineAsset, kind: "preview" | "video") => `${apiBase}/assets/${a.id}/${kind}`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function overviewBounds() {
    return L.latLngBounds(stops.flatMap((s) => s.bounds));
  }

  async function flyToStop(i: number) {
    if (!map) return;
    const stop = stops[i]!;
    const zoom = Math.min(16, Math.max(13, map.getBoundsZoom(L.latLngBounds(stop.bounds).pad(0.5))));
    const from = map.getCenter();
    const duration = flightSeconds([from.lat, from.lng], stop.center);
    const m = map;
    // flyTo uses Leaflet's van Wijk curve: it only zooms out as far as the distance requires.
    await new Promise<void>((resolve) => {
      const fallback = setTimeout(done, duration * 1000 + 1000);
      function done() {
        clearTimeout(fallback);
        m.off("moveend", done);
        resolve();
      }
      m.once("moveend", done);
      m.flyTo(stop.center, zoom, { duration });
    });
    flownTo = i;
    route.setLatLngs(stops.slice(0, i + 1).map((s) => s.center));
    here.setLatLng(stop.center);
  }

  function stopVideo() {
    videoEl?.pause();
  }

  async function goTo(s: number, i: number) {
    const my = ++run;
    clearTimeout(timer);
    stopVideo();
    finished = false;
    if (s !== flownTo) {
      showMedia = false;
      await sleep(MEDIA_FADE_MS);
      if (my !== run) return;
      await flyToStop(s);
      if (my !== run) return;
    }
    stopIdx = s;
    itemIdx = i;
    showMedia = true;
    soundBlocked = false;
    lastShown = stops[s]!.assets[i]!;
    preloadNext();
    await tick();
    if (my === run) startCurrent();
  }

  /** Starts the timer (photos) or playback (videos) for the current item. */
  function startCurrent() {
    if (paused || !current) return;
    if (current.type === "video") {
      playVideo();
    } else {
      const my = run;
      timer = setTimeout(() => my === run && next(), intervalMs);
    }
  }

  function playVideo() {
    const v = videoEl;
    if (!v) return;
    v.muted = false;
    v.play().catch(() => {
      // Autoplay with sound refused: keep going muted and offer a button.
      v.muted = true;
      soundBlocked = true;
      v.play().catch(() => next());
    });
  }

  function onVideoTime(e: Event) {
    const v = e.currentTarget as HTMLVideoElement;
    if (videoMaxSeconds > 0 && v.currentTime >= videoMaxSeconds && !v.paused) next();
  }

  function unmute() {
    if (videoEl) videoEl.muted = false;
    soundBlocked = false;
  }

  function preloadNext() {
    const s = stops[stopIdx];
    const nextAsset = s?.assets[itemIdx + 1] ?? stops[stopIdx + 1]?.assets[0];
    if (nextAsset && nextAsset.type === "image") new Image().src = media(nextAsset, "preview");
  }

  function next() {
    if (finished) return;
    if (stopIdx < 0) return void goTo(0, 0);
    if (itemIdx + 1 < stops[stopIdx]!.assets.length) return void goTo(stopIdx, itemIdx + 1);
    if (stopIdx + 1 < stops.length) return void goTo(stopIdx + 1, 0);
    finish();
  }

  function prev() {
    if (finished) return void goTo(stops.length - 1, stops.at(-1)!.assets.length - 1);
    if (itemIdx > 0) return void goTo(stopIdx, itemIdx - 1);
    if (stopIdx > 0) return void goTo(stopIdx - 1, stops[stopIdx - 1]!.assets.length - 1);
  }

  function finish() {
    ++run;
    clearTimeout(timer);
    stopVideo();
    showMedia = false;
    finished = true;
    flownTo = -1;
    route.setLatLngs(stops.map((s) => s.center));
    map?.flyToBounds(overviewBounds(), { padding: [60, 60], duration: 2 });
  }

  function restart() {
    paused = false;
    goTo(0, 0);
  }

  function togglePause() {
    paused = !paused;
    if (paused) {
      clearTimeout(timer);
      stopVideo();
    } else if (!finished && showMedia) {
      if (current?.type === "video") videoEl?.play().catch(() => {});
      else startCurrent();
    }
  }

  function close() {
    ++run;
    clearTimeout(timer);
    stopVideo();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onclose(lastShown);
  }

  function poke() {
    controlsVisible = true;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (controlsVisible = false), CONTROLS_HIDE_MS);
  }

  function onKey(e: KeyboardEvent) {
    poke();
    if (e.key === "Escape") close();
    else if (e.key === " ") {
      e.preventDefault();
      togglePause();
    } else if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
  }

  function swipeStart(e: PointerEvent) {
    // Touch taps fire no pointermove, so they must reveal the controls too.
    poke();
    const target = e.target as Element;
    swipeX = e.pointerType === "mouse" || target.closest("button, video") ? null : e.clientX;
  }

  function swipeEnd(e: PointerEvent) {
    if (swipeX === null) return;
    const dx = e.clientX - swipeX;
    swipeX = null;
    if (Math.abs(dx) > 60) (dx < 0 ? next : prev)();
  }

  onMount(() => {
    let cancelled = false;
    const onFullscreen = () => {
      if (document.fullscreenElement) enteredFullscreen = true;
      else if (enteredFullscreen) close();
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    enteredFullscreen = !!document.fullscreenElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    poke();

    (async () => {
      const base = await createBaseMap(mapEl, { zoomControl: false, attributionControl: true });
      L = base.L;
      map = base.map;
      if (cancelled) return map.remove();
      const accent = accentColor(mapEl);
      for (const stop of stops) {
        L.circleMarker(stop.center, { radius: 5, color: accent, weight: 2, fillOpacity: 0.4 }).addTo(map);
      }
      route = L.polyline([], { color: accent, weight: 4, opacity: 0.8, dashArray: "8 8" }).addTo(map);
      here = L.circleMarker(stops[0]!.center, {
        radius: 10,
        color: "#fff",
        weight: 3,
        fillColor: accent,
        fillOpacity: 1,
        className: "tour-here",
      }).addTo(map);
      map.fitBounds(overviewBounds(), { padding: [60, 60], maxZoom: 13 });

      const my = ++run;
      await sleep(OVERVIEW_MS);
      if (my === run) goTo(0, 0);
    })();

    return () => {
      cancelled = true;
      ++run;
      clearTimeout(timer);
      clearTimeout(hideTimer);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.body.style.overflow = overflow;
      map?.remove();
    };
  });
</script>

<svelte:window onkeydown={onKey} />

<div
  class="tour"
  class:idle={!controlsVisible && !paused && !finished}
  role="dialog"
  tabindex="-1"
  aria-modal="true"
  aria-label="Tour: {timeline.title}"
  onpointermove={poke}
  onpointerdown={swipeStart}
  onpointerup={swipeEnd}
>
  <div class="tour-map" bind:this={mapEl}></div>
  <div class="shade top" aria-hidden="true"></div>
  <div class="shade bottom" aria-hidden="true"></div>

  {#if showMedia && current}
    <div class="veil" transition:fade={{ duration: MEDIA_FADE_MS }}></div>
    {#key current.id}
      <figure class="media" transition:fade={{ duration: MEDIA_FADE_MS }}>
        {#if current.type === "video"}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video
            bind:this={videoEl}
            src={media(current, "video")}
            poster={media(current, "preview")}
            playsinline
            controls
            onended={next}
            ontimeupdate={onVideoTime}
            onerror={next}
          ></video>
          {#if soundBlocked}
            <button class="sound" onclick={unmute}>🔊 Ton an</button>
          {/if}
        {:else}
          <img src={media(current, "preview")} alt={current.caption ?? ""} />
        {/if}
      </figure>
    {/key}
    <div class="corner bottom-left" transition:fade={{ duration: MEDIA_FADE_MS }}>{placeOf(current)}</div>
    {#if current.caption}
      <div class="corner bottom-right" transition:fade={{ duration: MEDIA_FADE_MS }}>{current.caption}</div>
    {/if}
  {/if}

  <div class="corner top-left">
    <strong>{timeline.title}</strong>
    {#if current && showMedia}
      <span>{formatDayTime(current.localDateTime)}</span>
      <span>Ort {stopIdx + 1}/{stops.length} · Foto {itemIdx + 1}/{stops[stopIdx]?.assets.length}</span>
    {:else if !finished}
      <span>{stops.length} Orte · {timeline.assets.length} Medien</span>
    {/if}
  </div>

  {#if finished}
    <div class="end" transition:fade>
      <h2>Tour beendet</h2>
      <div class="end-actions">
        <button onclick={restart}>↻ Nochmal</button>
        <button onclick={close}>Schließen</button>
      </div>
    </div>
  {/if}

  <div class="controls">
    <button onclick={prev} aria-label="Zurück" disabled={stopIdx <= 0 && itemIdx === 0 && !finished}>⏮</button>
    <button onclick={togglePause} aria-label={paused ? "Weiter" : "Pause"}>{paused ? "▶" : "⏸"}</button>
    <button onclick={next} aria-label="Nächstes" disabled={finished}>⏭</button>
    <button onclick={close} aria-label="Tour schließen">✕</button>
  </div>
</div>

<style>
  .tour {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: #111;
    color: #fff;
    touch-action: pan-y;
    user-select: none;
  }

  .tour.idle {
    cursor: none;
  }

  .tour-map {
    position: absolute;
    inset: 0;
  }

  /* Keeps the white corner texts readable on light map tiles. */
  .shade {
    position: absolute;
    left: 0;
    right: 0;
    height: 96px;
    z-index: 650;
    pointer-events: none;
  }

  .shade.top {
    top: 0;
    background: linear-gradient(rgb(0 0 0 / 0.5), transparent);
  }

  .shade.bottom {
    bottom: 0;
    background: linear-gradient(transparent, rgb(0 0 0 / 0.5));
  }

  .veil {
    position: absolute;
    inset: 0;
    z-index: 500;
    background: rgb(0 0 0 / 0.55);
    pointer-events: none;
  }

  .media {
    position: absolute;
    inset: 56px 16px 64px;
    z-index: 600;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .media img,
  .media video {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 8px;
    box-shadow: 0 8px 40px rgb(0 0 0 / 0.6);
    pointer-events: auto;
  }

  .sound {
    position: absolute;
    top: 12px;
    right: 12px;
    pointer-events: auto;
  }

  .corner {
    position: absolute;
    z-index: 700;
    font-size: 0.85rem;
    line-height: 1.4;
    text-shadow: 0 1px 3px rgb(0 0 0 / 0.9);
    pointer-events: none;
    max-width: 45%;
  }

  .top-left {
    top: 12px;
    left: 16px;
    display: flex;
    flex-direction: column;
    max-width: 70%;
  }

  .top-left strong {
    font-size: 1rem;
  }

  .bottom-left {
    bottom: 28px; /* clear of the map attribution */
    left: 16px;
  }

  .bottom-right {
    bottom: 28px; /* clear of the map attribution */
    right: 16px;
    text-align: right;
    white-space: pre-line;
  }

  .controls {
    position: absolute;
    z-index: 800;
    top: 10px;
    right: 12px;
    display: flex;
    gap: 6px;
    transition: opacity 0.3s;
  }

  .idle .controls {
    opacity: 0;
    pointer-events: none;
  }

  .controls button,
  .end button,
  .sound {
    background: rgb(0 0 0 / 0.55);
    color: #fff;
    border: 1px solid rgb(255 255 255 / 0.3);
    border-radius: 999px;
    min-width: 40px;
    height: 40px;
    font-size: 1rem;
  }

  .controls button:disabled {
    opacity: 0.35;
  }

  .end {
    position: absolute;
    z-index: 700;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    background: rgb(0 0 0 / 0.65);
    padding: 20px 28px;
    border-radius: 12px;
    text-align: center;
  }

  .end h2 {
    margin: 0 0 12px;
  }

  .end-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
  }

  .end button {
    padding: 0 16px;
  }

  :global(.tour-here) {
    animation: tour-pulse 1.6s ease-in-out infinite;
  }

  @keyframes -global-tour-pulse {
    50% {
      stroke-width: 8;
      stroke-opacity: 0.6;
    }
  }

  @media (max-width: 600px) {
    .media {
      inset: 92px 8px 72px;
    }

    .corner {
      font-size: 0.75rem;
    }
  }
</style>
