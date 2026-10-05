<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { fade } from "svelte/transition";
  import type * as Leaflet from "leaflet";
  import { dayKey, formatDay, formatDayTime, placeOf } from "./format";
  import { keepScreenOn } from "./keepAwake";
  import { accentColor, addBackgroundLayer, createBaseMap, flightPath, prefetchTiles, type L as LeafletNS } from "./map";
  import type { MediaUrl } from "./media";
  import { nearestAhead, stopLegs } from "./route";
  import { buildStops, dayNumber, flightDuration, withTrip, type TourStop } from "./tour";
  import type { Timeline, TimelineAsset } from "./types";

  let {
    timeline,
    media,
    startAt = null,
    direct = false,
    onprogress,
    onshow,
    dayOrigin,
    onclose,
  }: {
    timeline: Timeline;
    media: MediaUrl;
    /** Continue a tour that was left off here instead of starting from the beginning. */
    startAt?: { stop: number; item: number } | null;
    /** Open right at `startAt`'s photo: no overview, no flight, no place or day card first. */
    direct?: boolean;
    /** Reports where the tour is, or null once it has been watched to the end. */
    onprogress?: (position: { stop: number; item: number; label: string } | null) => void;
    /** Called with each photo or video as it is shown. */
    onshow?: (assetId: string) => void;
    /** Local date-time of the trip's first medium, when the tour covers only part of it: days count from there. */
    dayOrigin?: string;
    /** Called when the tour ends or is closed. */
    onclose: () => void;
  } = $props();

  const OVERVIEW_MS = 2000;
  /** Final overview of the whole route before the tour closes itself. */
  const END_OVERVIEW_MS = 3000;
  const MEDIA_FADE_MS = 350;
  const CONTROLS_HIDE_MS = 3000;
  const RING_CIRCUMFERENCE = 2 * Math.PI * 27;

  // The timeline does not change while the tour is open, so a snapshot is enough.
  const { stops, intervalMs, videoMaxSeconds, totalItems } = untrack(() => ({
    stops: withTrip(buildStops(timeline.assets, timeline.tour.radiusMeters), timeline.trip),
    intervalMs: timeline.tour.intervalSeconds * 1000,
    videoMaxSeconds: timeline.tour.videoMaxSeconds,
    totalItems: timeline.assets.length,
  }));
  /** The recorded way to each stop (GeoPulse), or null where it is drawn as a straight line. */
  const legs = untrack(() => stopLegs(stops, timeline.route));
  const hasRoute = legs.some((l) => l !== null);

  /** The route up to stop `i`: the recorded way where there is one, else straight from stop to stop. */
  function trailTo(i: number): [number, number][] {
    const out: [number, number][] = [];
    for (let k = 0; k <= i && k < stops.length; k++) {
      if (k > 0 && legs[k]) out.push(...legs[k]!);
      out.push(stops[k]!.center);
    }
    return out;
  }

  /** Places with photos; the start and end of the trip don't count. */
  const placeCount = stops.filter((s) => !s.waypoint).length;
  /** 1-based number of the place at stop `i`. */
  const placeNumber = (i: number) => stops.slice(0, i + 1).filter((s) => !s.waypoint).length;
  /** Index of the first item of each stop within the whole tour. */
  const stopOffsets = stops.map((_, i) => stops.slice(0, i).reduce((n, s) => n + s.assets.length, 0));

  let tourEl: HTMLDivElement;
  let mapEl: HTMLDivElement;
  let videoEl = $state<HTMLVideoElement>();
  let L: LeafletNS;
  let map: Leaflet.Map | undefined;
  let route: Leaflet.Polyline;
  let here: Leaflet.CircleMarker;
  /** Renderer of the route and the markers, redrawn on every frame of a flight. */
  let renderer: Leaflet.SVG;

  let stopIdx = $state(-1);
  let itemIdx = $state(0);
  let showMedia = $state(false);
  /** Map pause after arriving at a place, before its first photo. */
  let arriving = $state(false);
  /** Day badge on the arrival card when the place also starts a new day. */
  let arrivalDay = $state<number | null>(null);
  /** "Tag N" card before the first medium of a new day within a place. */
  let dayCard = $state<number | null>(null);
  /** Keeps the map dimmed between photo and day card, so it does not flash up in between. */
  let dimmed = $state(false);
  let paused = $state(false);
  /** Last step: flying out to the overview, then the tour closes itself. */
  let ending = $state(false);
  let soundBlocked = $state(false);
  let controlsVisible = $state(true);

  // Progress ring around the play button: a CSS animation for timed steps
  // (photo, map pause), the playback position for videos.
  let stepKey = $state(0);
  let stepMs = $state(0);
  let videoProgress = $state(0);

  /** Stop the map is currently zoomed to (-1 = overview). */
  let flownTo = -1;
  let flying = false;
  /** Places already passed while flying on to the next one; the marker draws the route from there. */
  let flightTrail: [number, number][] | null = null;
  /** The recorded way of the current flight, followed by the marker; null for a straight flight. */
  let flightWay: [number, number][] | null = null;
  let flightWayIdx = 0;
  /** Bumped on every navigation; async steps of an outdated navigation stop themselves. */
  let run = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  /** The running timed step, kept so that pause/resume can continue it. */
  let step: { fn: () => void; remaining: number; startedAt: number } | null = null;
  let enteredFullscreen = false;
  /** Calendar day (YYYY-MM-DD) of the last medium shown. */
  let shownDay: string | null = null;
  let swipeX: number | null = null;

  const current = $derived(stopIdx >= 0 ? (stops[stopIdx]?.assets[itemIdx] ?? null) : null);
  const waypoint = $derived(stopIdx >= 0 ? (stops[stopIdx]?.waypoint ?? null) : null);
  const progress = $derived(
    stopIdx < 0 || waypoint === "start"
      ? 0
      : ending || waypoint === "end"
        ? 1
        : (stopOffsets[stopIdx]! + itemIdx + 1) / totalItems,
  );
  const ringMode = $derived(
    ending || (!showMedia && !arriving && dayCard === null) ? "none" : showMedia && current?.type === "video" ? "video" : "timed",
  );
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // The first stop may be the start of the trip, which has no photos.
  const firstLocal = untrack(() => dayOrigin) ?? stops.find((s) => s.assets.length > 0)?.assets[0]?.localDateTime ?? "";
  const dayOf = (a: TimelineAsset) => dayNumber(firstLocal, a.localDateTime);

  // Remember the position for resuming after the page was reloaded or the tour closed.
  $effect(() => {
    if (stopIdx < 0 || ending) return;
    const kind = stops[stopIdx]?.waypoint;
    const label = kind === "start" ? "Start" : kind === "end" ? "Ziel" : `Ort ${placeNumber(stopIdx)} von ${placeCount}`;
    untrack(() => onprogress?.({ stop: stopIdx, item: itemIdx, label }));
  });

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
    // The start or end of the trip is a single point: show the town around it.
    const zoom = stop.waypoint ? 12 : Math.min(16, Math.max(13, map!.getBoundsZoom(L.latLngBounds(stop.bounds).pad(0.5))));
    return { center: stop.center, zoom };
  }

  /**
   * Preloads the tiles for the flight from the current view to stop `i`:
   * the final view with the levels of the approach, and every view along
   * the flight at the zoom level Leaflet will load there. The map then stays
   * sharp while flying instead of showing the coarse background.
   */
  function prefetchFlight(i: number) {
    if (!map || !stops[i]) return;
    const { center, zoom } = stopView(i);
    prefetchTiles(map, center, zoom, 3);
    for (const view of flightPath(map, center, zoom, 40).views) {
      prefetchTiles(map, view.center, Math.min(19, Math.max(0, Math.round(view.zoom))), 1, 0);
    }
  }

  async function flyToStop(i: number) {
    if (!map) return;
    const { center, zoom } = stopView(i);
    const m = map;
    // flyTo uses Leaflet's van Wijk curve: it only zooms out as far as the distance requires.
    // Longer curves get more time, so that long legs don't rush past.
    const duration = flightDuration(flightPath(m, center, zoom).length);
    if (flownTo >= 0 && i > flownTo) {
      flightTrail = trailTo(flownTo);
      const ahead = trailTo(i).slice(flightTrail.length);
      flightWay = legs.slice(flownTo + 1, i + 1).some((l) => l !== null) ? ahead : null;
      flightWayIdx = 0;
    } else {
      route.setLatLngs(trailTo(i));
      here.setLatLng(center);
    }
    flying = true;
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
    flying = false;
    flightTrail = null;
    flightWay = null;
    flownTo = i;
    route.setLatLngs(trailTo(i));
    here.setLatLng(center);
    // Plenty of time while this place is shown: warm up the next flight.
    prefetchFlight(i + 1);
  }

  /** Runs on every frame of a flight. */
  function onFlightFrame() {
    if (!flying || !map) return;
    if (flightTrail && flightWay) {
      // Along the recorded way: the marker sits where the way passes the map center.
      const c = map.getCenter();
      flightWayIdx = nearestAhead(flightWay, [c.lat, c.lng], flightWayIdx);
      here.setLatLng(flightWay[flightWayIdx]!);
      route.setLatLngs([...flightTrail, ...flightWay.slice(0, flightWayIdx + 1)]);
    } else if (flightTrail) {
      const c = map.getCenter();
      here.setLatLng(c);
      route.setLatLngs([...flightTrail, [c.lat, c.lng]]);
    }
    // While zooming, Leaflet only scales the vector layer and redraws it at
    // the end, so the marker would grow to fill the screen; redraw it now.
    (renderer as unknown as { _reset(): void })._reset();
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
   * new place moving forward pauses on the map before its first photo; a new
   * day within a place moving forward shows a day card first.
   */
  async function goTo(s: number, i: number, { arrive = true } = {}) {
    const my = ++run;
    cancelStep();
    stopVideo();
    ending = false;
    dayCard = null;
    dimmed = false;
    const travel = s !== flownTo;
    if (travel) {
      showMedia = false;
      arriving = false;
      await sleep(MEDIA_FADE_MS);
      if (my !== run) return;
      await flyToStop(s);
      if (my !== run) return;
    }
    if (stops[s]!.waypoint) {
      // Start or end of the trip: only the place, no photos.
      stopIdx = s;
      itemIdx = 0;
      arrivalDay = null;
      arriving = true;
      startTimed(intervalMs, forward);
      return;
    }
    const target = stops[s]!.assets[i]!;
    const newDay = shownDay === null || dayKey(target.localDateTime) !== shownDay;
    if (travel && arrive && i === 0) {
      stopIdx = s;
      itemIdx = i;
      arrivalDay = newDay ? dayOf(target) : null;
      arriving = true;
      startTimed(intervalMs, () => endCard(my));
    } else if (arrive && newDay) {
      // The photo fades out completely before the day card fades in.
      dimmed = true;
      showMedia = false;
      await sleep(MEDIA_FADE_MS);
      if (my !== run) return;
      stopIdx = s;
      itemIdx = i;
      dayCard = dayOf(target);
      startTimed(intervalMs, () => endCard(my));
    } else {
      stopIdx = s;
      itemIdx = i;
      showItem(my);
    }
  }

  /** Fades the place or day card out before the next photo fades in; the map stays dimmed. */
  async function endCard(my: number) {
    dimmed = true;
    arriving = false;
    dayCard = null;
    // A little longer than the fade, so that it has surely finished.
    await sleep(MEDIA_FADE_MS + 50);
    if (my === run) showItem(my);
  }

  async function showItem(my: number) {
    arriving = false;
    dayCard = null;
    shownDay = dayKey(stops[stopIdx]!.assets[itemIdx]!.localDateTime);
    showMedia = true;
    onshow?.(stops[stopIdx]!.assets[itemIdx]!.id);
    dimmed = false;
    soundBlocked = false;
    videoProgress = 0;
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

  /** On to the next stop, or the end of the tour after the last one. */
  function forward() {
    arriving = false;
    if (stopIdx + 1 < stops.length) goTo(stopIdx + 1, 0);
    else finish();
  }

  function next() {
    if (ending) return;
    if (stopIdx < 0) return void goTo(0, 0);
    if (waypoint) return forward();
    if (arriving || dayCard !== null) {
      // Skip the rest of the map pause or day card.
      const my = ++run;
      cancelStep();
      return void endCard(my);
    }
    if (itemIdx + 1 < stops[stopIdx]!.assets.length) return void goTo(stopIdx, itemIdx + 1);
    if (stopIdx + 1 < stops.length) return void goTo(stopIdx + 1, 0);
    finish();
  }

  function prev() {
    const back = { arrive: false };
    if (ending) return;
    if (itemIdx > 0 && !arriving) return void goTo(stopIdx, itemIdx - 1, back);
    if (stopIdx > 0) return void goTo(stopIdx - 1, Math.max(0, stops[stopIdx - 1]!.assets.length - 1), back);
  }

  /** Shows the whole route once more, then closes the tour by itself. */
  function finish() {
    ++run;
    cancelStep();
    stopVideo();
    showMedia = false;
    arriving = false;
    dayCard = null;
    dimmed = false;
    ending = true;
    onprogress?.(null);
    flownTo = -1;
    route.setLatLngs(trailTo(stops.length - 1));
    if (map) {
      flying = true;
      map.once("moveend", () => (flying = false));
      map.flyToBounds(overviewBounds(), { padding: [60, 60], duration: 2 });
    }
    // Not pausable: the tour is over, only the closing animation remains.
    const my = run;
    timer = setTimeout(() => my === run && close(), END_OVERVIEW_MS);
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
    onclose();
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
    swipeX = e.pointerType === "mouse" || target.closest("button") ? null : e.clientX;
  }

  function swipeEnd(e: PointerEvent) {
    if (swipeX === null) return;
    const dx = e.clientX - swipeX;
    swipeX = null;
    if (Math.abs(dx) > 60) (dx < 0 ? next : prev)();
  }

  onMount(() => {
    let cancelled = false;
    const releaseScreen = keepScreenOn(tourEl);
    /** When the page was last hidden, e.g. because the phone was locked. */
    let hiddenAt = 0;
    const pause = () => !paused && !ending && togglePause();
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        pause();
      } else {
        poke();
      }
    };
    const onFullscreen = () => {
      if (document.fullscreenElement) enteredFullscreen = true;
      else if (enteredFullscreen) {
        // Locking the phone also leaves fullscreen: then pause instead of closing.
        setTimeout(() => {
          if (cancelled) return;
          if (document.hidden || Date.now() - hiddenAt < 1000) pause();
          else close();
        }, 300);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    enteredFullscreen = !!document.fullscreenElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    poke();

    (async () => {
      const base = await createBaseMap(mapEl, {
        zoomControl: false,
        attributionControl: true,
        // Only the tour moves the map; swipes switch photos instead.
        dragging: false,
        touchZoom: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        // Leaflet's mobile default (updateWhenIdle) loads no tiles at all while
        // flying, which leaves the map grey on iPhone/iPad; keep loading.
        tileOptions: { updateWhenIdle: false, updateWhenZooming: true, updateInterval: 100, keepBuffer: 4 },
      });
      L = base.L;
      map = base.map;
      if (cancelled) return map.remove();
      const accent = accentColor(mapEl);
      renderer = L.svg({ padding: 0.3 });
      map.on("move", onFlightFrame);
      for (const stop of stops) {
        // Start and end of the trip: a hollow ring, places with photos: a filled dot.
        const style = stop.waypoint
          ? { radius: 7, weight: 3, fillColor: "#fff", fillOpacity: 1 }
          : { radius: 5, weight: 2, fillOpacity: 0.4 };
        L.circleMarker(stop.center, { renderer, color: accent, ...style }).addTo(map);
      }
      // A recorded route is drawn solid, straight lines between the stops dashed.
      route = L.polyline([], { renderer, color: accent, weight: 4, opacity: 0.8, dashArray: hasRoute ? undefined : "8 8" }).addTo(map);
      here = L.circleMarker(stops[0]!.center, {
        renderer,
        radius: 10,
        color: "#fff",
        weight: 3,
        fillColor: accent,
        fillOpacity: 1,
        className: "tour-here",
      }).addTo(map);
      map.fitBounds(overviewBounds(), { padding: [60, 60], maxZoom: 13 });
      // Coarse map under everything, so zooming out never shows grey.
      addBackgroundLayer(L, map, map.getZoom());
      prefetchFlight(startAt && stops[startAt.stop] ? startAt.stop : 0);

      const resume = startAt && stops[startAt.stop] ? startAt : null;
      const item = resume && Math.min(resume.item, Math.max(0, stops[resume.stop]!.assets.length - 1));
      if (resume && direct) {
        // Started from a photo of the timeline: already there, show it at once.
        const { center, zoom } = stopView(resume.stop);
        map.setView(center, zoom, { animate: false });
        flownTo = resume.stop;
        route.setLatLngs(trailTo(resume.stop));
        here.setLatLng(center);
        prefetchFlight(resume.stop + 1);
        goTo(resume.stop, item!, { arrive: false });
        return;
      }
      const my = ++run;
      await sleep(OVERVIEW_MS);
      if (my !== run) return;
      if (resume) goTo(resume.stop, item!);
      else goTo(0, 0);
    })();

    return () => {
      cancelled = true;
      ++run;
      clearTimeout(timer);
      clearTimeout(hideTimer);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("visibilitychange", onVisibility);
      releaseScreen();
      document.body.style.overflow = overflow;
      map?.remove();
    };
  });
</script>

<!-- Line icons after Lucide (ISC license), inlined to avoid a dependency. -->
{#snippet icon(name: "prev" | "next" | "play" | "pause" | "close" | "sound")}
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
    {:else}
      <path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z" />
      <path d="M16 9a5 5 0 0 1 0 6" /><path d="M19.4 18.4a9 9 0 0 0 0-12.8" />
    {/if}
  </svg>
{/snippet}

<svelte:window onkeydown={onKey} />

<div
  bind:this={tourEl}
  class="tour"
  class:idle={!controlsVisible && !paused}
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
    {@const stop = stops[stopIdx]!}
    <div class="arrival" transition:fade={{ duration: MEDIA_FADE_MS }}>
      {#if stop.waypoint}
        <span class="arrival-step">{stop.waypoint === "start" ? "Start der Reise" : "Ziel der Reise"}</span>
        <h2>{stop.name}</h2>
      {:else}
        {#if arrivalDay !== null}<span class="day-badge">Tag {arrivalDay}</span>{/if}
        <span class="arrival-step">Ort {placeNumber(stopIdx)} von {placeCount}</span>
        <h2>{placeName(stop, placeNumber(stopIdx) - 1)}</h2>
        <span>{formatDay(stop.assets[0]!.localDateTime)}</span>
      {/if}
    </div>
  {/if}

  {#if showMedia || arriving || dayCard !== null || dimmed}
    <div class="veil" transition:fade={{ duration: MEDIA_FADE_MS }}></div>
  {/if}

  {#if dayCard !== null && current}
    <div class="arrival day" transition:fade={{ duration: MEDIA_FADE_MS }}>
      <h2>Tag {dayCard}</h2>
      <span>{formatDay(current.localDateTime)}</span>
    </div>
  {/if}

  {#if showMedia && current}
    {#key current.id}
      <figure class="media" transition:fade|global={{ duration: MEDIA_FADE_MS }}>
        {#if current.type === "video"}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video
            bind:this={videoEl}
            src={media(current, "video")}
            poster={media(current, "preview")}
            playsinline
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
    {#if current && (showMedia || dayCard !== null || dimmed)}
      <span>{formatDayTime(current.localDateTime)}</span>
      <span>Tag {dayOf(current)} · Ort {placeNumber(stopIdx)}/{placeCount} · Foto {itemIdx + 1}/{stops[stopIdx]?.assets.length}</span>
    {:else if arriving && current}
      <span>Tag {dayOf(current)} · Ort {placeNumber(stopIdx)}/{placeCount} · {placeName(stops[stopIdx]!, placeNumber(stopIdx) - 1)}</span>
    {:else if arriving && waypoint}
      <span>{waypoint === "start" ? "Start" : "Ziel"} · {stops[stopIdx]!.name}</span>
    {:else}
      <span>{placeCount} Orte · {totalItems} Medien</span>
    {/if}
  </div>


  <button class="glass round close" onclick={close} aria-label="Tour schließen">{@render icon("close")}</button>

  <div class="controls glass">
    <div class="progress" aria-hidden="true"><div style="width: {progress * 100}%"></div></div>
    <button
      class="round"
      onclick={prev}
      aria-label="Zurück"
      disabled={ending || (stopIdx <= 0 && (itemIdx === 0 || arriving))}
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
    <button class="round" onclick={next} aria-label="Nächstes" disabled={ending}>{@render icon("next")}</button>
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

  /* Above the map center, where the current place's marker sits. */
  .arrival.day {
    top: 26%;
  }

  .arrival.day h2 {
    font-size: clamp(2.4rem, 8vw, 4.5rem);
  }

  .day-badge {
    display: inline-block;
    margin-bottom: 10px;
    padding: 4px 14px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-contrast);
    font-weight: 600;
    text-shadow: none;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.35);
  }

  .day-badge + .arrival-step {
    display: block;
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
