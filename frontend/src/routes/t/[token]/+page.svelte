<script lang="ts">
  import { page } from "$app/state";
  import TimelineView from "$lib/TimelineView.svelte";
  import { apiMedia } from "$lib/media";
  import type { Timeline } from "$lib/types";

  type State =
    | { kind: "loading" }
    | { kind: "ready"; timeline: Timeline }
    | { kind: "password"; title: string | null }
    | { kind: "expired" }
    | { kind: "notfound" }
    | { kind: "error" };

  const token = page.params.token!;
  const apiBase = `/api/public/timeline/${encodeURIComponent(token)}`;
  const media = apiMedia(apiBase);

  let view = $state<State>({ kind: "loading" });
  let password = $state("");
  let unlockError = $state<string | null>(null);
  let unlocking = $state(false);

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
  <TimelineView timeline={view.timeline} {media} />
{/if}

<style>
  .unlock {
    display: flex;
    gap: 8px;
    justify-content: center;
    margin-top: 16px;
  }
</style>
