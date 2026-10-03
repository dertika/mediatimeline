<script lang="ts">
  import type { Component, Snippet } from "svelte";
  import Comments from "./Comments.svelte";
  import TimelineMap from "./TimelineMap.svelte";
  import { dayKey, formatDay, formatRange, formatTime, placeOf } from "./format";
  import type { MediaUrl } from "./media";
  import { buildStops, estimateTourSeconds } from "./tour";
  import type { Timeline, TimelineAsset } from "./types";

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

  let highlighted = $state<string | null>(null);
  const located = $derived(timeline.assets.filter((a) => a.lat !== null));

  /** "6 Orte · 3 Tage · ca. 2 Min." for the tour button. */
  const tourSummary = $derived.by(() => {
    const stops = buildStops(timeline.assets, timeline.tour.radiusMeters);
    const days = new Set(timeline.assets.map((a) => dayKey(a.localDateTime))).size;
    const minutes = Math.max(1, Math.round(estimateTourSeconds(stops, days, timeline.tour) / 60));
    const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
    return `${n(stops.length, "Ort", "Orte")} · ${n(days, "Tag", "Tage")} · ca. ${minutes} Min.`;
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
    document.getElementById(`asset-${id}`)?.scrollIntoView({ behavior, block: "center" });
    highlighted = id;
    setTimeout(() => (highlighted = highlighted === id ? null : highlighted), 2000);
  }

  // The tour (map animation + player) is only loaded when started.
  let Tour = $state<Component<{ timeline: Timeline; media: MediaUrl; onclose: () => void }> | null>(null);
  /** Scroll position when the tour started; the page returns there afterwards. */
  let tourScrollY = 0;

  async function startTour() {
    tourScrollY = window.scrollY;
    // Request fullscreen while the click still counts as a user gesture.
    await document.documentElement.requestFullscreen?.().catch(() => {});
    Tour = (await import("./Tour.svelte")).default;
  }

  function closeTour() {
    Tour = null;
    // Leaving fullscreen can move the page; stay where the tour was started.
    const restore = () => window.scrollTo({ top: tourScrollY, behavior: "instant" });
    requestAnimationFrame(restore);
    setTimeout(restore, 300);
  }

  async function openFullscreen(asset: TimelineAsset) {
    const { openGallery } = await import("./gallery");
    // Leaving the gallery jumps to the photo that was shown last.
    await openGallery(timeline.assets, timeline.assets.indexOf(asset), media, (last) =>
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

<main class="timeline">
  <header>
    <h1>{timeline.title}</h1>
    {#if formatRange(timeline.startDate, timeline.endDate)}
      <p class="muted">{formatRange(timeline.startDate, timeline.endDate)} · {timeline.assets.length} Medien</p>
    {/if}
    {#if timeline.description}<p class="description">{timeline.description}</p>{/if}
    <Comments comments={timeline.albumComments} />
  </header>

  {#if located.length > 0}
    <button class="start-tour" onclick={startTour}>
      <span class="start-tour-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><polygon points="7 4 20 12 7 20 7 4" /></svg>
      </span>
      <span class="start-tour-text">
        <span class="start-tour-title">Tour starten</span>
        <span class="start-tour-meta">{tourSummary}</span>
      </span>
      <svg class="start-tour-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
    </button>
    <TimelineMap assets={timeline.assets} {media} onselect={scrollToAsset} />
  {/if}

  {#each groupByDay(timeline.assets) as group (group.day)}
    <section>
      <h2 class="day">{group.label}</h2>
      {#each group.assets as asset (asset.id)}
        <figure id="asset-{asset.id}" class:highlighted={highlighted === asset.id}>
          {#if asset.type === "video"}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video
              controls
              preload="metadata"
              playsinline
              poster={media(asset, "preview")}
              src={media(asset, "video")}
              width={asset.width}
              height={asset.height}
            ></video>
            <button class="fullscreen" onclick={() => openFullscreen(asset)} aria-label="Im Vollbild öffnen">⛶</button>
          {:else}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
            <img
              onclick={() => openFullscreen(asset)}
              src={media(asset, "preview")}
              srcset="{media(asset, 'thumbnail')} 250w, {media(asset, 'preview')} 1440w"
              sizes="(max-width: 900px) 100vw, 880px"
              alt={asset.caption ?? ""}
              loading="lazy"
              decoding="async"
              width={asset.width}
              height={asset.height}
            />
          {/if}
          <figcaption>
            {#if asset.caption}<span class="caption">{asset.caption}</span>{/if}
            <span class="meta">{formatTime(asset.localDateTime)}{placeOf(asset) ? ` · ${placeOf(asset)}` : ""}</span>
            <Comments comments={extraComments(asset)} />
          </figcaption>
        </figure>
      {/each}
    </section>
  {/each}

  <footer class="muted">{#if footer}{@render footer()}{:else}Erstellt mit mediatimeline{/if}</footer>
</main>
{#if Tour}
  <Tour {timeline} {media} onclose={closeTour} />
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
    background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #0b3d30));
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
    transition: box-shadow 0.3s;
  }

  img {
    cursor: zoom-in;
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

  figure.highlighted {
    box-shadow: 0 0 0 3px var(--accent);
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
    color: var(--muted);
    font-size: 0.875rem;
  }

  footer {
    text-align: center;
    font-size: 0.8rem;
    margin-top: 48px;
  }
</style>
