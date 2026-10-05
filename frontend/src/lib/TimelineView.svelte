<script lang="ts">
  import { onMount, tick, untrack, type Component, type Snippet } from "svelte";
  import { fly } from "svelte/transition";
  import Comments from "./Comments.svelte";
  import TimelineMap from "./TimelineMap.svelte";
  import { dayKey, formatDay, formatRange, formatTime, placeOf } from "./format";
  import type { MediaUrl } from "./media";
  import { preloadFull, progressive } from "./progressive";
  import { loadSeen, newAssetIds, saveSeen } from "./seenMedia";
  import { fotoParam, photoLink, shareLink } from "./share";
  import { buildStops, estimateTourSeconds, findInStops, remainingStops, withTrip } from "./tour";
  import { loadPosition, savePosition, type TourPosition } from "./tourProgress";
  import type { Timeline, TimelineAsset } from "./types";
  import { CHANGELOG_URL, VERSION } from "./version";

  let {
    timeline,
    media,
    footer,
  }: {
    timeline: Timeline;
    media: MediaUrl;
    /** Replaces the default footer line. */
    footer?: Snippet;
  } = $props();

  const located = $derived(timeline.assets.filter((a) => a.lat !== null));

  const tourStops = $derived(withTrip(buildStops(timeline.assets, timeline.tour.radiusMeters), timeline.trip));
  /** Set per link: a click on a photo starts the tour there; the gallery moves to the ⛶ button. */
  const photoTour = $derived(!!timeline.tour.fromPhoto && located.length > 0);
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  /** "ca. 2 Min." with non-breaking spaces, so it never wraps apart. */
  const minutes = (seconds: number) => `ca.\u00a0${Math.max(1, Math.round(seconds / 60))}\u00a0Min.`;

  /** Rough tour length in seconds from the given stop and item on. */
  function tourSeconds(from = { stop: 0, item: 0 }) {
    const rest = remainingStops(tourStops, from);
    const days = new Set(rest.flatMap((s) => s.assets).map((a) => dayKey(a.localDateTime))).size;
    return estimateTourSeconds(rest, days, timeline.tour);
  }

  /** "6 Orte · 3 Tage · ca. 2 Min." for the tour button. */
  const tourSummary = $derived.by(() => {
    const places = tourStops.filter((s) => !s.waypoint).length;
    const days = new Set(timeline.assets.map((a) => dayKey(a.localDateTime))).size;
    return `${n(places, "Ort", "Orte")} · ${n(days, "Tag", "Tage")} · ${minutes(tourSeconds())}`;
  });

  function groupByDay(assets: TimelineAsset[]) {
    const groups: { day: string; label: string; assets: TimelineAsset[] }[] = [];
    for (const asset of assets) {
      const day = dayKey(asset.localDateTime);
      if (groups.at(-1)?.day !== day) groups.push({ day, label: formatDay(asset.localDateTime), assets: [] });
      groups.at(-1)!.assets.push(asset);
    }
    return groups;
  }

  function scrollToAsset(id: string, behavior: ScrollBehavior = "smooth") {
    const el = document.getElementById(`asset-${id}`);
    if (!el) return;
    const asset = timeline.assets.find((a) => a.id === id);
    if (asset) preloadFull(media(asset, "preview")).catch(() => {});
    // A long smooth scroll would start loading every photo on the way:
    // jump to one screen before the target, then glide the rest.
    const offset = el.getBoundingClientRect().top - window.innerHeight / 2;
    if (behavior === "smooth" && Math.abs(offset) > 2 * window.innerHeight) {
      window.scrollBy({ top: offset - Math.sign(offset) * window.innerHeight, behavior: "instant" });
    }
    el.scrollIntoView({ behavior, block: "center" });
  }

  // A link to a single photo (?foto=<id>) opens the timeline at that photo.
  onMount(async () => {
    const id = fotoParam();
    if (!id || !timeline.assets.some((a) => a.id === id)) return;
    await tick();
    scrollToAsset(id, "instant");
  });

  /** Photos seen on this link (page path) in this browser; on the first visit all count as seen. */
  const seenId = location.pathname;
  // Taken once when the page loads: new photos keep their badge until it is loaded again.
  const { seen, isNew } = untrack(() => {
    const stored = loadSeen(seenId);
    const seen = stored ?? new Set(timeline.assets.map((a) => a.id));
    if (!stored) saveSeen(seenId, seen, timeline.assets);
    return { seen, isNew: new Set(newAssetIds(timeline.assets, stored)) };
  });
  /** New ones not looked at yet, counted by the hint at the bottom. */
  let unseen = $state(new Set(isNew));
  /** How long a new photo must be in view to count as seen, so scrolling past doesn't. */
  const SEEN_AFTER_MS = 800;

  /** "3 neue Fotos", "1 neues Video", "2 neue Medien". */
  function newCount(items: TimelineAsset[]) {
    const videos = items.filter((a) => a.type === "video").length;
    if (videos === 0) return n(items.length, "neues Foto", "neue Fotos");
    if (videos === items.length) return n(items.length, "neues Video", "neue Videos");
    return n(items.length, "neues Medium", "neue Medien");
  }

  /** The new photos not seen yet, as a tour of their own. */
  const newAssets = $derived(timeline.assets.filter((a) => unseen.has(a.id)));
  const newLabel = $derived(newCount(newAssets));
  const newTourStops = $derived(buildStops(newAssets, timeline.tour.radiusMeters));
  /** "3 neue Fotos · 2 Orte · ca. 1 Min." for the tour of the new photos. */
  const newTourSummary = $derived.by(() => {
    const days = new Set(newAssets.map((a) => dayKey(a.localDateTime))).size;
    const seconds = estimateTourSeconds(newTourStops, days, timeline.tour);
    return `${newCount(newAssets)} · ${n(newTourStops.length, "Ort", "Orte")} · ${minutes(seconds)}`;
  });

  function markSeen(ids: string[]) {
    const fresh = ids.filter((id) => unseen.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) seen.add(id);
    unseen = new Set([...unseen].filter((id) => !fresh.includes(id)));
    saveSeen(seenId, seen, timeline.assets);
  }

  /** Jumps to the next new photo below the middle of the screen, else to the first one. */
  function nextNew() {
    const ids = timeline.assets.filter((a) => unseen.has(a.id)).map((a) => a.id);
    const middle = window.innerHeight / 2;
    const top = (id: string) => document.getElementById(`asset-${id}`)?.getBoundingClientRect().top ?? -Infinity;
    const id = ids.find((id) => top(id) > middle) ?? ids[0];
    if (!id) return;
    scrollToAsset(id);
    markSeen([id]);
  }

  /** Marks a new photo as seen once at least half of it stayed in view for a moment. */
  function watchSeen(node: HTMLElement, id: string) {
    if (!unseen.has(id)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        clearTimeout(timer);
        if (entry?.isIntersecting) timer = setTimeout(() => (markSeen([id]), observer.disconnect()), SEEN_AFTER_MS);
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return {
      destroy() {
        clearTimeout(timer);
        observer.disconnect();
      },
    };
  }

  // The tour (map animation + player) is only loaded when started.
  type TourProps = {
    timeline: Timeline;
    media: MediaUrl;
    startAt?: { stop: number; item: number } | null;
    direct?: boolean;
    onprogress?: (position: Omit<TourPosition, "savedAt"> | null) => void;
    onshow?: (assetId: string) => void;
    dayOrigin?: string;
    onclose: () => void;
  };
  let Tour = $state<Component<TourProps> | null>(null);
  /** Where the tour was left off on this link (page path), if it was not watched to the end. */
  const progressId = location.pathname;
  let saved = $state(loadPosition(progressId));
  /** "Ab Ort 3 von 6 · noch ca. 1 Min." for the resume button. */
  const resumeSummary = $derived(saved && `Ab ${saved.label} · noch ${minutes(tourSeconds(saved))}`);
  let startAt = $state<{ stop: number; item: number } | null>(null);
  /** Started from a photo: the tour opens right at it. */
  let direct = $state(false);
  /** The tour of the new photos only: just those, without the trip's start and end, frozen at its start. */
  let newTour = $state<Timeline | null>(null);

  function onTourProgress(position: Omit<TourPosition, "savedAt"> | null) {
    saved = position && { ...position, savedAt: Date.now() };
    savePosition(progressId, saved);
  }
  /** Scroll position when the tour started; the page returns there afterwards. */
  let tourScrollY = 0;

  async function startTour(fromBeginning = false, onlyNew = false, at: { stop: number; item: number } | null = null) {
    newTour = onlyNew ? { ...timeline, assets: newAssets, trip: undefined } : null;
    startAt = at ?? (fromBeginning || onlyNew ? null : saved);
    direct = at !== null;
    tourScrollY = window.scrollY;
    // Request fullscreen while the click still counts as a user gesture.
    await document.documentElement.requestFullscreen?.().catch(() => {});
    Tour = (await import("./Tour.svelte")).default;
  }

  function closeTour() {
    Tour = null;
    newTour = null;
    // Leaving fullscreen can move the page; stay where the tour was started.
    const restore = () => window.scrollTo({ top: tourScrollY, behavior: "instant" });
    requestAnimationFrame(restore);
    setTimeout(restore, 300);
  }

  function onPhotoClick(asset: TimelineAsset) {
    const at = photoTour ? findInStops(tourStops, asset.id) : null;
    if (at) startTour(false, false, at);
    else openFullscreen(asset);
  }

  async function openFullscreen(asset: TimelineAsset) {
    const { openGallery } = await import("./gallery");
    // Leaving the gallery jumps to the photo that was shown last.
    await openGallery(timeline.assets, timeline.assets.indexOf(asset), media, timeline.title, (last) =>
      scrollToAsset(last.id, "instant"),
    );
  }

  // When the first comment already is the caption, don't repeat it in the list.
  const extraComments = (asset: TimelineAsset) =>
    timeline.captionSource === "firstComment" ||
    (timeline.captionSource === "descriptionOrFirstComment" && asset.caption === asset.comments[0]?.text)
      ? asset.comments.slice(1)
      : asset.comments;
</script>

<main class="timeline" class:has-new={unseen.size > 0}>
  <header>
    <h1>{timeline.title}</h1>
    {#if formatRange(timeline.startDate, timeline.endDate)}
      <p class="muted">{formatRange(timeline.startDate, timeline.endDate)} · {timeline.assets.length} Medien</p>
    {/if}
    {#if timeline.description}<p class="description">{timeline.description}</p>{/if}
    <Comments comments={timeline.albumComments} />
  </header>

  {#if located.length > 0}
    <button class="start-tour" onclick={() => startTour(true)}>
      <span class="start-tour-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><polygon points="7 4 20 12 7 20 7 4" /></svg>
      </span>
      <span class="start-tour-text">
        <span class="start-tour-title">Tour starten</span>
        <span class="start-tour-meta">{tourSummary}</span>
      </span>
      <svg class="start-tour-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
    </button>
    {#if saved}
      <!-- Two sibling buttons: a button may not contain another one. -->
      <div class="resume-tour">
        <button class="start-tour" onclick={() => startTour()}>
          <span class="start-tour-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><polygon points="7 4 20 12 7 20 7 4" /></svg>
          </span>
          <span class="start-tour-text">
            <span class="start-tour-title">Tour fortsetzen</span>
            <span class="start-tour-meta">{resumeSummary}</span>
          </span>
        </button>
        <button class="resume-dismiss" onclick={() => onTourProgress(null)} aria-label="Fortsetzen verwerfen">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
        </button>
      </div>
    {/if}
    {#if newTourStops.length > 0}
      <button class="start-tour" onclick={() => startTour(true, true)}>
        <span class="start-tour-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><polygon points="7 4 20 12 7 20 7 4" /></svg>
        </span>
        <span class="start-tour-text">
          <span class="start-tour-title">Neue Fotos als Tour</span>
          <span class="start-tour-meta">{newTourSummary}</span>
        </span>
        <svg class="start-tour-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
      </button>
    {/if}
    <TimelineMap assets={timeline.assets} trip={timeline.trip} route={timeline.route} {media} onselect={scrollToAsset} />
  {/if}

  {#each groupByDay(timeline.assets) as group (group.day)}
    <section>
      <h2 class="day">{group.label}</h2>
      {#each group.assets as asset (asset.id)}
        <figure id="asset-{asset.id}" use:watchSeen={asset.id}>
          {#if isNew.has(asset.id)}<span class="new-badge">Neu</span>{/if}
          {#if asset.type === "video"}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video
              controls
              preload="none"
              playsinline
              poster={media(asset, "thumbnail")}
              use:progressive={{ full: media(asset, "preview"), attr: "poster" }}
              src={media(asset, "video")}
              width={asset.width}
              height={asset.height}
            ></video>
            <button class="fullscreen" onclick={() => openFullscreen(asset)} aria-label="Im Vollbild öffnen">⛶</button>
          {:else}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
            <img
              class:tour-click={photoTour}
              onclick={() => onPhotoClick(asset)}
              src={media(asset, "thumbnail")}
              use:progressive={{ full: media(asset, "preview") }}
              alt={asset.caption ?? ""}
              loading="lazy"
              decoding="async"
              width={asset.width}
              height={asset.height}
            />
            {#if photoTour}
              <button class="fullscreen" onclick={() => openFullscreen(asset)} aria-label="Im Vollbild öffnen">⛶</button>
            {/if}
          {/if}
          <figcaption>
            {#if asset.caption}<span class="caption">{asset.caption}</span>{/if}
            <span class="meta">
              <span>{formatTime(asset.localDateTime)}{placeOf(asset) ? ` · ${placeOf(asset)}` : ""}</span>
              <button class="share" onclick={() => shareLink(photoLink(asset.id), timeline.title)} aria-label="Link zu diesem Foto teilen" title="Link teilen">
                <!-- Lucide "share-2" (ISC license) -->
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4" /><path d="m15.4 6.5-6.8 4" /></svg>
              </button>
            </span>
            <Comments comments={extraComments(asset)} />
          </figcaption>
        </figure>
      {/each}
    </section>
  {/each}

  <footer class="muted">{#if footer}{@render footer()}{:else}Erstellt mit mediatimeline · <a href={CHANGELOG_URL}>v{VERSION}</a>{/if}</footer>
</main>
{#if unseen.size > 0 && !Tour}
  <!-- Two sibling buttons, like the resume card. -->
  <div class="new-media" transition:fly={{ y: 40, duration: 250 }}>
    <button class="new-media-next" onclick={nextNew}>
      <span class="new-media-count">{newLabel}</span>
      <span class="new-media-action">Zum nächsten</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></svg>
    </button>
    <button class="new-media-dismiss" onclick={() => markSeen([...unseen])} aria-label="Hinweis auf neue Fotos ausblenden">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
    </button>
  </div>
{/if}
{#if Tour}
  {#if newTour}
    <!-- Seen as soon as shown; days still count from the trip's first day; no resume position. -->
    <Tour
      timeline={newTour}
      {media}
      dayOrigin={timeline.assets[0]?.localDateTime}
      onshow={(id) => markSeen([id])}
      onclose={closeTour}
    />
  {:else}
    <Tour {timeline} {media} {startAt} {direct} onprogress={onTourProgress} onclose={closeTour} />
  {/if}
{/if}

<style>
  /* Full-width card: what the tour covers, and roughly how long it takes. */
  .start-tour {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    margin: 4px 0 14px;
    padding: 14px 16px;
    border: 0;
    border-radius: 16px;
    background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 72%, black));
    color: var(--accent-contrast);
    box-shadow: 0 8px 24px color-mix(in srgb, var(--accent) 35%, transparent);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      transform 0.15s,
      box-shadow 0.15s;
  }

  .start-tour:hover {
    transform: translateY(-1px);
    box-shadow: 0 12px 28px color-mix(in srgb, var(--accent) 45%, transparent);
  }

  .start-tour:active {
    transform: scale(0.99);
  }

  .start-tour:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  .start-tour-icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.2);
  }

  .start-tour-icon svg {
    width: 20px;
    height: 20px;
    margin-left: 3px;
    fill: currentColor;
  }

  .start-tour-text {
    flex: 1;
    min-width: 0;
  }

  .start-tour-title {
    display: block;
    font-weight: 700;
    font-size: 1.05rem;
  }

  .start-tour-meta {
    display: block;
    font-size: 0.85rem;
    opacity: 0.85;
  }

  .resume-tour {
    position: relative;
  }

  /* Room for the dismiss button where the start card has its chevron. */
  .resume-tour .start-tour {
    padding-right: 60px;
  }

  .resume-dismiss {
    position: absolute;
    top: 50%;
    right: 10px;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    margin-top: -18px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.18);
    color: var(--accent-contrast);
    cursor: pointer;
  }

  .resume-dismiss:hover {
    background: rgb(255 255 255 / 0.3);
  }

  .resume-dismiss:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .resume-dismiss svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
  }

  .start-tour-chevron {
    flex: none;
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .timeline {
    max-width: var(--content);
    margin: 0 auto;
    padding: 24px 16px 48px;
  }

  /* Keep the footer clear of the hint on new photos. */
  .timeline.has-new {
    padding-bottom: 112px;
  }

  .new-badge {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 1;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-contrast);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
    pointer-events: none;
  }

  /* Floating hint at the bottom: how many photos are new, tap to jump to the next. */
  .new-media {
    position: fixed;
    left: 50%;
    bottom: calc(16px + env(safe-area-inset-bottom));
    z-index: 900;
    display: flex;
    align-items: center;
    max-width: calc(100vw - 32px);
    transform: translateX(-50%);
    border-radius: 999px;
    background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 72%, black));
    color: var(--accent-contrast);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.3);
  }

  .new-media button {
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .new-media button:focus-visible {
    outline: 2px solid var(--accent-contrast);
    outline-offset: -4px;
  }

  .new-media-next {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 12px 6px 12px 20px;
    white-space: nowrap;
  }

  .new-media-count {
    font-weight: 700;
  }

  .new-media-action {
    opacity: 0.85;
  }

  .new-media-action::before {
    content: "· ";
  }

  /* Small phones: the arrow alone says where the button goes. */
  @media (max-width: 380px) {
    .new-media-action {
      display: none;
    }
  }

  .new-media svg {
    flex: none;
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .new-media-dismiss {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    margin: 0 6px 0 2px;
    padding: 0;
    border-radius: 50%;
  }

  .new-media-dismiss:hover {
    background: rgb(255 255 255 / 0.18) !important;
  }

  header h1 {
    font-size: clamp(1.8rem, 5vw, 2.6rem);
    margin: 8px 0 4px;
  }

  header p {
    margin: 4px 0;
  }

  header {
    margin-bottom: 20px;
  }

  .description {
    white-space: pre-line;
  }

  .day {
    position: sticky;
    top: 0;
    z-index: 1;
    margin: 32px 0 12px;
    padding: 8px 0;
    font-size: 1.1rem;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
  }

  figure {
    position: relative;
    margin: 0 0 28px;
    border-radius: var(--radius);
  }

  img {
    cursor: zoom-in;
  }

  img.tour-click {
    cursor: pointer;
  }

  /* The small thumbnail shows blurred until the large version has loaded;
     the clip keeps the blur inside the rounded corners. */
  img {
    clip-path: inset(0 round var(--radius));
    transition: filter 0.3s;
  }

  img:not([data-loaded]) {
    filter: blur(6px);
  }

  .fullscreen {
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 2px 8px;
    font-size: 1.1rem;
    background: rgb(0 0 0 / 0.5);
    color: #fff;
    border: none;
  }

  img,
  video {
    display: block;
    width: 100%;
    height: auto;
    max-height: 85vh;
    object-fit: contain;
    border-radius: var(--radius);
    background: var(--surface);
  }

  figcaption {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 2px 0;
  }

  .caption {
    white-space: pre-line;
  }

  .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--muted);
    font-size: 0.875rem;
  }

  .share {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    margin: -6px -6px -6px 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }

  .share:hover,
  .share:focus-visible {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
  }

  .share svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  footer {
    text-align: center;
    font-size: 0.8rem;
    margin-top: 48px;
  }
</style>
