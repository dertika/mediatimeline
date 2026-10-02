<script lang="ts">
  import { base } from "$app/paths";
  import TimelineView from "$lib/TimelineView.svelte";
  import { staticMedia } from "$lib/media";
  import type { Timeline } from "$lib/types";

  // Only the GitHub Pages build ships the demo data (see site/).
  const enabled = import.meta.env.VITE_DEMO === "1";
  const dataBase = `${base}/demo-data`;
  const media = staticMedia(`${dataBase}/media`);

  let timeline = $state<Timeline | null>(null);
  let failed = $state(false);

  async function load() {
    try {
      const res = await fetch(`${dataBase}/timeline.json`);
      if (!res.ok) throw new Error(String(res.status));
      timeline = await res.json();
      document.title = `${timeline!.title} · mediatimeline Demo`;
    } catch {
      failed = true;
    }
  }

  if (enabled) load();
</script>

{#if !enabled || failed}
  <main class="center">
    <h1>Nicht gefunden</h1>
    <p class="muted">Die Demo gibt es nur auf der Projektseite von mediatimeline.</p>
  </main>
{:else if !timeline}
  <main class="center"><p class="muted">Lade Demo …</p></main>
{:else}
  <div class="demo-bar">
    <a href="{base}/">← mediatimeline</a>
    <span>Demo mit freien Fotos von Wikimedia Commons</span>
  </div>
  <TimelineView {timeline} {media}>
    {#snippet footer()}
      Demo von <a href="{base}/">mediatimeline</a> · Fotos:
      <a href="{base}/#bildnachweise">Bildnachweise</a> · Karte © OpenStreetMap
    {/snippet}
  </TimelineView>
{/if}

<style>
  .demo-bar {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    padding: 8px 16px;
    font-size: 0.85rem;
    background: var(--accent);
    color: var(--accent-contrast);
  }

  .demo-bar a {
    color: inherit;
    font-weight: 600;
    text-decoration: none;
  }
</style>
