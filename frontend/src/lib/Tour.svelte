<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { fade } from "svelte/transition";
  import type * as Leaflet from "leaflet";
  import { formatDay, formatDayTime, placeOf } from "./format";
  import { accentColor, createBaseMap, prefetchTiles, type L as LeafletNS } from "./map";
  import { buildStops, flightSeconds, type TourStop } from "./tour";
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
  const RING_CIRCUMFERENCE = 2 * Math.PI * 27;

  // The timeline does not change while the tour is open, so a snapshot is enough.
  const { stops, intervalMs, videoMaxSeconds, totalItems } = untrack(() => ({
    stops: buildStops(timeline.assets, timeline.tour.radiusMeters),
    intervalMs: timeline.tour.intervalSeconds * 1000,
    videoMaxSeconds: timeline.tour.videoMaxSeconds,
    totalItems: timeline.assets.length,
  }));
  /** Index of the first item of each stop within the whole tour. */
  const stopOffsets = stops.map((_, i) => stops.slice(0, i).reduce((n, s) => n + s.assets.length, 0));

  let mapEl: HTMLDivElement;
  let videoEl = $state<HTMLVideoElement>();
  let L: LeafletNS;
  let map: Leaflet.Map | undefined;
  let route: Leaflet.Polyline;
  let here: Leaflet.CircleMarker;

  let stopIdx = $state(-1);
  let itemIdx = $state(0);
  let showMedia = $state(false);
  /** Map pause after arriving at a place, before its first photo. */
  let arriving = $state(false);
  let paused = $state(false);
  let finished = $state(false);
  let soundBlocked = $state(false);
  let controlsVisible = $state(true);

  // Progress ring around the play button: a CSS animation for timed steps
  // (photo, map pause), the playback position for videos.
  let stepKey = $state(0);
  let stepMs = $state(0);
  let videoProgress = $state(0);

  /** Stop the map is currently zoomed to (-1 = overview). */
  let flownTo = -1;
  /** Bumped on every navigation; async steps of an outdated navigation stop themselves. */
  let run = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  /** The running timed step, kept so that pause/resume can continue it. */
  let step: { fn: () => void; remaining: number; startedAt: number } | null = null;
  let lastShown: TimelineAsset | null = null;
  let enteredFullscreen = false;
  let swipeX: number | null = null;

  const current = $derived(stopIdx >= 0 ? (stops[stopIdx]?.assets[itemIdx] ?? null) : null);
  const progress = $derived(stopIdx < 0 ? 0 : finished ? 1 : (stopOffsets[stopIdx]! + itemIdx + 1) / totalItems);
  const ringMode = $derived(
    finished || (!showMedia && !arriving) ? "none" : showMedia && current?.type === "video" ? "video" : "timed",
  );
  const media = (a: TimelineAsset, kind: "preview" | "video") => `${apiBase}/assets/${a.id}/${kind}`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function placeName(stop: TourStop, i: number): string {
    const named = stop.assets.find((a) => a.city || a.country);
    return named ? placeOf(named) : `Ort ${i + 1}`;
  }

  function overviewBounds() {
    return L.latLngBounds(stops.flatMap((s) => s.bounds));
  }

  /** Center and zoom the tour uses for a stop. */
  function stopView(i: number): { center: [number, number]; zoom: number } {
    const stop = stops[i]!;
    const zoom = Math.min(16, Math.max(13, map!.getBoundsZoom(L.latLngBounds(stop.bounds).pad(0.5))));
    return { center: stop.center, zoom };
  }

  /**
   * Preloads the tiles for the flight to stop `i`: its final view plus the
   * levels of the approach, and the highest point of the flight, where both
   * places are in view. Intermediate levels are still loaded by Leaflet on the
   * way, but the parts one actually looks at come from the cache.
   */
  function prefetchStop(i: number, from: [number, number] | null) {
    if (!map || !stops[i]) return;
    const { center, zoom } = stopView(i);
    prefetchTiles(map, center, zoom, 3);
    if (from) {
      const leg = L.latLngBounds([from, center]);
      const apex = map.getBoundsZoom(leg.pad(0.2));
      if (apex < zoom - 2) {
        const mid = leg.getCenter();
        prefetchTiles(map, [mid.lat, mid.lng], apex, 2);
      }
    }
  }

  async function flyToStop(i: number) {
    if (!map) return;
    const { center, zoom } = stopView(i);
    const from = map.getCenter();
    const duration = flightSeconds([from.lat, from.lng], center);
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
      m.flyTo(center, zoom, { duration });
    });
    flownTo = i;
    route.setLatLngs(stops.slice(0, i + 1).map((s) => s.center));
    here.setLatLng(center);
    // Plenty of time while this place is shown: warm up the next one.
    prefetchStop(i + 1, center);
  }

  function stopVideo() {
    videoEl?.pause();
  }

  function cancelStep() {
    clearTimeout(timer);
    step = null;
  }

  /** Runs `fn` after `ms`, pausable; restarts the progress ring. */
  function startTimed(ms: number, fn: () => void) {
    const my = run;
    step = { fn: () => my === run && fn(), remaining: ms, startedAt: Date.now() };
    stepMs = ms;
    stepKey++;
    if (!paused) timer = setTimeout(step.fn, ms);
  }

  /**
   * Shows item `i` of stop `s`, flying there first if needed. Arriving at a
   * new place moving forward pauses on the map before its first photo.
   */
  async function goTo(s: number, i: number, { arrive = true } = {}) {
    const my = ++run;
    cancelStep();
    stopVideo();
    finished = false;
    const travel = s !== flownTo;
    if (travel) {
      showMedia = false;
      arriving = false;
      await sleep(MEDIA_FADE_MS);
      if (my !== run) return;
      await flyToStop(s);
      if (my !== run) return;
    }
    stopIdx = s;
    itemIdx = i;
    if (travel && arrive && i === 0) {
      arriving = true;
      startTimed(intervalMs, () => showItem(my));
    } else {
      showItem(my);
    }
  }

  async function showItem(my: number) {
    arriving = false;
    showMedia = true;
    soundBlocked = false;
    videoProgress = 0;
    lastShown = current;
    preloadNext();
    await tick();
    if (my === run) startCurrent();
  }

  /** Starts the timer (photos) or playback (videos) for the current item. */
  function startCurrent() {
    if (!current) return;
    if (current.type === "video") {
      if (!paused) playVideo();
    } else {
      startTimed(intervalMs, next);
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
    const limit = videoMaxSeconds > 0 ? Math.min(videoMaxSeconds, v.duration || Infinity) : v.duration;
    if (limit > 0 && Number.isFinite(limit)) videoProgress = Math.min(1, v.currentTime / limit);
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
    if (arriving) {
      // Skip the rest of the map pause.
      const my = ++run;
      cancelStep();
      return void showItem(my);
    }
    if (itemIdx + 1 < stops[stopIdx]!.assets.length) return void goTo(stopIdx, itemIdx + 1);
    if (stopIdx + 1 < stops.length) return void goTo(stopIdx + 1, 0);
    finish();
  }

  function prev() {
    const back = { arrive: false };
    if (finished) return void goTo(stops.length - 1, stops.at(-1)!.assets.length - 1, back);
    if (itemIdx > 0 && !arriving) return void goTo(stopIdx, itemIdx - 1, back);
    if (stopIdx > 0) return void goTo(stopIdx - 1, stops[stopIdx - 1]!.assets.length - 1, back);
  }

  function finish() {
    ++run;
    cancelStep();
    stopVideo();
    showMedia = false;
    arriving = false;
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
      if (step) step.remaining -= Date.now() - step.startedAt;
      stopVideo();
    } else if (step) {
      step.startedAt = Date.now();
      timer = setTimeout(step.fn, Math.max(0, step.remaining));
    } else if (showMedia && current?.type === "video") {
      videoEl?.play().catch(() => {});
    }
  }

  function close() {
    ++run;
    cancelStep();
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
      const base = await createBaseMap(mapEl, {
        zoomControl: false,
        attributionControl: true,
        // Don't load tiles for every intermediate zoom level of a flight.
        tileOptions: { updateWhenZooming: false, keepBuffer: 4 },
      });
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
      prefetchStop(0, null);

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

<!-- Line icons after Lucide (ISC license), inlined to avoid a dependency. -->
{#snippet icon(name: "prev" | "next" | "play" | "pause" | "close" | "sound" | "restart")}
  <svg viewBox="0 0 24 24" aria-hidden="true" class="icon icon-{name}">
    {#if name === "prev"}
      <polygon points="19 20 9 12 19 4 19 20" /><line x1="5" x2="5" y1="19" y2="5" />
    {:else if name === "next"}
      <polygon points="5 4 15 12 5 20 5 4" /><line x1="19" x2="19" y1="5" y2="19" />
    {:else if name === "play"}
      <polygon points="7 4 20 12 7 20 7 4" />
    {:else if name === "pause"}
      <rect x="14" y="4" width="4" height="16" rx="1" /><rect x="6" y="4" width="4" height="16" rx="1" />
    {:else if name === "close"}
      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
    {:else if name === "sound"}
      <path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z" />
      <path d="M16 9a5 5 0 0 1 0 6" /><path d="M19.4 18.4a9 9 0 0 0 0-12.8" />
    {:else}
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
    {/if}
  </svg>
{/snippet}

<svelte:window onkeydown={onKey} />

<div
  class="tour"
  class:idle={!controlsVisible && !paused && !finished}
  class:paused
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

  {#if arriving && stops[stopIdx]}
    <div class="arrival" transition:fade={{ duration: MEDIA_FADE_MS }}>
      <span class="arrival-step">Ort {stopIdx + 1} von {stops.length}</span>
      <h2>{placeName(stops[stopIdx]!, stopIdx)}</h2>
      <span>{formatDay(stops[stopIdx]!.assets[0]!.localDateTime)}</span>
    </div>
  {/if}

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
            <button class="glass pill sound" onclick={unmute}>{@render icon("sound")} Ton an</button>
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
    {:else if arriving && stops[stopIdx]}
      <span>Ort {stopIdx + 1}/{stops.length} · {placeName(stops[stopIdx]!, stopIdx)}</span>
    {:else if !finished}
      <span>{stops.length} Orte · {totalItems} Medien</span>
    {/if}
  </div>

  {#if finished}
    <div class="end glass" transition:fade>
      <h2>Tour beendet</h2>
      <div class="end-actions">
        <button class="glass pill" onclick={restart}>{@render icon("restart")} Nochmal</button>
        <button class="glass pill" onclick={close}>Schließen</button>
      </div>
    </div>
  {/if}

  <button class="glass round close" onclick={close} aria-label="Tour schließen">{@render icon("close")}</button>

  <div class="controls glass">
    <div class="progress" aria-hidden="true"><div style="width: {progress * 100}%"></div></div>
    <button
      class="round"
      onclick={prev}
      aria-label="Zurück"
      disabled={(stopIdx <= 0 && (itemIdx === 0 || arriving)) && !finished}
    >
      {@render icon("prev")}
    </button>
    <button class="round play" onclick={togglePause} aria-label={paused ? "Weiter" : "Pause"}>
      <svg class="ring" viewBox="0 0 60 60" aria-hidden="true">
        <circle class="ring-track" cx="30" cy="30" r="27" />
        {#if ringMode === "timed"}
          {#key stepKey}
            <circle
              class="ring-fill timed"
              cx="30"
              cy="30"
              r="27"
              style="stroke-dasharray: {RING_CIRCUMFERENCE}; animation-duration: {stepMs}ms"
            />
          {/key}
        {:else if ringMode === "video"}
          <circle
            class="ring-fill"
            cx="30"
            cy="30"
            r="27"
            style="stroke-dasharray: {RING_CIRCUMFERENCE}; stroke-dashoffset: {RING_CIRCUMFERENCE * (1 - videoProgress)}"
          />
        {/if}
      </svg>
      {@render icon(paused ? "play" : "pause")}
    </button>
    <button class="round" onclick={next} aria-label="Nächstes" disabled={finished}>{@render icon("next")}</button>
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
    --glass: rgb(20 22 21 / 0.55);
    --glass-border: rgb(255 255 255 / 0.18);
  }

  .tour.idle {
    cursor: none;
  }

  .tour-map {
    position: absolute;
    inset: 0;
  }

  /* Keeps the white texts readable on light map tiles. */
  .shade {
    position: absolute;
    left: 0;
    right: 0;
    height: 120px;
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
    inset: 72px 16px 128px;
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
    border-radius: 10px;
    box-shadow: 0 12px 48px rgb(0 0 0 / 0.6);
    pointer-events: auto;
  }

  .arrival {
    position: absolute;
    z-index: 700;
    left: 50%;
    top: 22%;
    transform: translateX(-50%);
    text-align: center;
    text-shadow: 0 2px 12px rgb(0 0 0 / 0.8);
    pointer-events: none;
    width: max-content;
    max-width: 90vw;
  }

  .arrival h2 {
    margin: 4px 0;
    font-size: clamp(1.8rem, 5vw, 3rem);
    line-height: 1.1;
  }

  .arrival-step {
    font-size: 0.8rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.85;
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
    top: 14px;
    left: 16px;
    display: flex;
    flex-direction: column;
    max-width: calc(100% - 96px);
  }

  .top-left strong {
    font-size: 1rem;
  }

  /* Above the control bar so nothing overlaps. */
  .bottom-left {
    bottom: 104px;
    left: 16px;
  }

  .bottom-right {
    bottom: 104px;
    right: 16px;
    text-align: right;
    white-space: pre-line;
  }

  /* ---- Glass buttons ---- */
  .glass {
    background: var(--glass);
    border: 1px solid var(--glass-border);
    -webkit-backdrop-filter: blur(12px) saturate(140%);
    backdrop-filter: blur(12px) saturate(140%);
    box-shadow: 0 8px 32px rgb(0 0 0 / 0.35);
  }

  button {
    font: inherit;
    color: #fff;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition:
      background 0.15s,
      transform 0.1s,
      opacity 0.2s;
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  button:active:not(:disabled) {
    transform: scale(0.94);
  }

  button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .round {
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    padding: 0;
    border-radius: 50%;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 42px;
    padding: 0 18px;
    border-radius: 999px;
  }

  .glass:hover:not(:disabled),
  .controls .round:hover:not(:disabled):not(.play) {
    background: rgb(255 255 255 / 0.16);
  }

  .icon {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .icon-play,
  .icon-pause,
  .icon-prev polygon,
  .icon-next polygon {
    fill: currentColor;
  }

  .close {
    position: absolute;
    z-index: 800;
    top: 12px;
    right: 14px;
  }

  .controls {
    position: absolute;
    z-index: 800;
    left: 50%;
    bottom: max(20px, env(safe-area-inset-bottom));
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 14px;
    border-radius: 999px;
    overflow: hidden;
  }

  .controls .round {
    background: transparent;
    border: none;
  }

  .close,
  .controls {
    transition: opacity 0.3s;
  }

  .idle .close,
  .idle .controls {
    opacity: 0;
    pointer-events: none;
  }

  .progress {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 3px;
    background: rgb(255 255 255 / 0.12);
  }

  .progress div {
    height: 100%;
    background: var(--accent);
    transition: width 0.4s;
  }

  .controls .play {
    position: relative;
    width: 60px;
    height: 60px;
    background: var(--accent);
    color: var(--accent-contrast);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.35);
  }

  .play .icon {
    width: 24px;
    height: 24px;
  }

  .ring {
    position: absolute;
    inset: -4px;
    width: calc(100% + 8px);
    height: calc(100% + 8px);
    transform: rotate(-90deg);
    pointer-events: none;
  }

  .ring circle {
    fill: none;
    stroke-width: 3;
  }

  .ring-track {
    stroke: rgb(255 255 255 / 0.15);
  }

  .ring-fill {
    stroke: #fff;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.25s linear;
  }

  .ring-fill.timed {
    animation: ring-fill linear forwards;
  }

  .paused .ring-fill.timed {
    animation-play-state: paused;
  }

  @keyframes ring-fill {
    from {
      stroke-dashoffset: 169.646;
    }
    to {
      stroke-dashoffset: 0;
    }
  }

  .sound {
    position: absolute;
    top: 12px;
    right: 12px;
    pointer-events: auto;
  }

  .sound .icon {
    width: 18px;
    height: 18px;
  }

  .end {
    position: absolute;
    z-index: 700;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    padding: 24px 28px;
    border-radius: 18px;
    text-align: center;
  }

  .end h2 {
    margin: 0 0 16px;
  }

  .end-actions {
    display: flex;
    gap: 10px;
    justify-content: center;
  }

  .end .icon {
    width: 18px;
    height: 18px;
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
      inset: 92px 8px 136px;
    }

    .corner {
      font-size: 0.75rem;
    }

    .bottom-left,
    .bottom-right {
      bottom: 100px;
    }
  }
</style>
