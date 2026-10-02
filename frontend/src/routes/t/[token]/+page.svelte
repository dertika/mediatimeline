<script lang="ts">
  import { page } from "$app/state";
  import Comments from "$lib/Comments.svelte";
  import TimelineMap from "$lib/TimelineMap.svelte";
  import { dayKey, formatDay, formatRange, formatTime, placeOf } from "$lib/format";
  import type { Timeline, TimelineAsset } from "$lib/types";
  import type { Component } from "svelte";

  type State =
    | { kind: "loading" }
    | { kind: "ready"; timeline: Timeline }
    | { kind: "password"; title: string | null }
    | { kind: "expired" }
    | { kind: "notfound" }
    | { kind: "error" };

  const token = page.params.token!;
  const apiBase = `/api/public/timeline/${encodeURIComponent(token)}`;

  let view = $state<State>({ kind: "loading" });
  let password = $state("");
  let unlockError = $state<string | null>(null);
  let unlocking = $state(false);
  let highlighted = $state<string | null>(null);

  async function load() {
    try {
      const res = await fetch(apiBase);
      if (res.ok) view = { kind: "ready", timeline: await res.json() };
      else if (res.status === 401) view = { kind: "password", title: (await res.json()).title ?? null };
      else if (res.status === 410) view = { kind: "expired" };
      else if (res.status === 404) view = { kind: "notfound" };
      else view = { kind: "error" };
    } catch {
      view = { kind: "error" };
    }
  }

  async function unlock(event: SubmitEvent) {
    event.preventDefault();
    unlocking = true;
    unlockError = null;
    try {
      const res = await fetch(`${apiBase}/unlock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        password = "";
        await load();
      } else if (res.status === 429) {
        unlockError = "Zu viele Versuche. Bitte später erneut probieren.";
      } else {
        unlockError = "Das Passwort ist leider falsch.";
      }
    } finally {
      unlocking = false;
    }
  }

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
  let Tour = $state<Component<{ timeline: Timeline; apiBase: string; onclose: () => void }> | null>(null);
  /** Scroll position when the tour started; the page returns there afterwards. */
  let tourScrollY = 0;

  async function startTour() {
    tourScrollY = window.scrollY;
    // Request fullscreen while the click still counts as a user gesture.
    await document.documentElement.requestFullscreen?.().catch(() => {});
    Tour = (await import("$lib/Tour.svelte")).default;
  }

  function closeTour() {
    Tour = null;
    // Leaving fullscreen can move the page; stay where the tour was started.
    const restore = () => window.scrollTo({ top: tourScrollY, behavior: "instant" });
    requestAnimationFrame(restore);
    setTimeout(restore, 300);
  }

  async function openFullscreen(timeline: Timeline, asset: TimelineAsset) {
    const { openGallery } = await import("$lib/gallery");
    // Leaving the gallery jumps to the photo that was shown last.
    await openGallery(timeline.assets, timeline.assets.indexOf(asset), apiBase, (last) =>
      scrollToAsset(last.id, "instant"),
    );
  }

  // When the first comment already is the caption, don't repeat it in the list.
  const extraComments = (timeline: Timeline, asset: TimelineAsset) =>
    timeline.captionSource === "firstComment" ||
    (timeline.captionSource === "descriptionOrFirstComment" && asset.caption === asset.comments[0]?.text)
      ? asset.comments.slice(1)
      : asset.comments;

  $effect(() => {
    document.title = view.kind === "ready" ? `${view.timeline.title} · mediatimeline` : "mediatimeline";
  });

  load();
</script>

{#if view.kind === "loading"}
  <main class="center"><p class="muted">Lade Timeline …</p></main>
{:else if view.kind === "password"}
  <main class="center">
    <h1>{view.title ?? "Geschützte Timeline"}</h1>
    <p class="muted">Diese Timeline ist passwortgeschützt.</p>
    <form class="unlock" onsubmit={unlock}>
      <input type="password" bind:value={password} placeholder="Passwort" aria-label="Passwort" required />
      <button class="primary" disabled={unlocking}>Öffnen</button>
    </form>
    {#if unlockError}<p class="error" role="alert">{unlockError}</p>{/if}
  </main>
{:else if view.kind === "expired"}
  <main class="center">
    <h1>Link abgelaufen</h1>
    <p class="muted">Dieser Link ist nicht mehr gültig.</p>
  </main>
{:else if view.kind === "notfound"}
  <main class="center">
    <h1>Nicht gefunden</h1>
    <p class="muted">Diese Timeline existiert nicht oder wurde nicht freigegeben.</p>
  </main>
{:else if view.kind === "error"}
  <main class="center">
    <h1>Fehler</h1>
    <p class="muted">Die Timeline konnte gerade nicht geladen werden.</p>
    <button onclick={load}>Erneut versuchen</button>
  </main>
{:else}
  {@const timeline = view.timeline}
  {@const located = timeline.assets.filter((a) => a.lat !== null)}
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
      <button class="primary start-tour" onclick={startTour}>▶ Tour starten</button>
      <TimelineMap assets={timeline.assets} mediaBase={apiBase} onselect={scrollToAsset} />
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
                poster="{apiBase}/assets/{asset.id}/preview"
                src="{apiBase}/assets/{asset.id}/video"
                width={asset.width}
                height={asset.height}
              ></video>
              <button class="fullscreen" onclick={() => openFullscreen(timeline, asset)} aria-label="Im Vollbild öffnen">⛶</button>
            {:else}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
              <img
                onclick={() => openFullscreen(timeline, asset)}
                src="{apiBase}/assets/{asset.id}/preview"
                srcset="{apiBase}/assets/{asset.id}/thumbnail 250w, {apiBase}/assets/{asset.id}/preview 1440w"
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
              <Comments comments={extraComments(timeline, asset)} />
            </figcaption>
          </figure>
        {/each}
      </section>
    {/each}

    <footer class="muted">Erstellt mit mediatimeline</footer>
  </main>
  {#if Tour}
    <Tour {timeline} {apiBase} onclose={closeTour} />
  {/if}
{/if}

<style>
  .start-tour {
    margin: 0 0 12px;
    padding: 8px 16px;
    font-weight: 600;
  }

  .unlock {
    display: flex;
    gap: 8px;
    justify-content: center;
    margin-top: 16px;
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
