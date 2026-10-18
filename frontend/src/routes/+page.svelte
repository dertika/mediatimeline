<script lang="ts">
  import { formatRange } from "$lib/format";
  import { forgetVisit, formatAgo, loadVisited } from "$lib/visited";

  /** What the server says about a link: still valid, behind a password, or gone. */
  type Info =
    | { state: "loading" }
    | { state: "ok"; title: string; startDate: string | null; endDate: string | null; cover: string | null }
    | { state: "password"; title: string }
    | { state: "gone" }
    /** The server could not be asked (offline, error): the card stays as remembered. */
    | { state: "unknown" };

  const initial = loadVisited();
  let visited = $state(initial);
  let info = $state<Record<string, Info>>({});
  const now = new Date();

  const base = (token: string) => `/api/public/timeline/${encodeURIComponent(token)}`;

  async function check(token: string) {
    info[token] = { state: "loading" };
    try {
      const res = await fetch(`${base(token)}/status`);
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      info[token] = body.state === "expired" || body.state === "notfound" ? { state: "gone" } : body;
    } catch {
      info[token] = { state: "unknown" };
    }
  }

  /** Asks about the remembered links, a few at a time. */
  async function checkAll(tokens: string[]) {
    const queue = [...tokens];
    await Promise.all(
      Array.from({ length: Math.min(6, queue.length) }, async () => {
        for (let token = queue.shift(); token; token = queue.shift()) await check(token);
      }),
    );
  }

  function forget(token: string) {
    visited = forgetVisit(token);
  }

  checkAll(initial.map((v) => v.token));
</script>

<svelte:head><title>mediatimeline</title></svelte:head>

{#if visited.length === 0}
  <main class="center">
    <h1>mediatimeline</h1>
    <p class="muted">Öffentliche Foto-Timelines aus Immich. Zum Ansehen wird ein geteilter Link benötigt.</p>
  </main>
{:else}
  <main class="home">
    <h1>Deine Timelines</h1>
    <p class="muted">Diese Timelines hast du auf diesem Gerät schon geöffnet.</p>
    <ul class="cards">
      {#each visited as v (v.token)}
        {@const i = info[v.token] ?? { state: "loading" }}
        {@const title = i.state === "ok" || i.state === "password" ? i.title : v.title}
        <li class="card" class:gone={i.state === "gone"}>
          {#if i.state === "gone"}
            <div class="cover placeholder" aria-hidden="true"></div>
            <div class="text">
              <strong>{title}</strong>
              <span class="muted">nicht mehr verfügbar</span>
            </div>
          {:else}
            <a class="open" href="/t/{encodeURIComponent(v.token)}">
              {#if i.state === "ok" && i.cover}
                <img class="cover" src="{base(v.token)}/assets/{encodeURIComponent(i.cover)}/thumbnail" alt="" loading="lazy" />
              {:else}
                <div class="cover placeholder" aria-hidden="true">{i.state === "password" ? "🔒" : ""}</div>
              {/if}
              <div class="text">
                <strong>{title}</strong>
                {#if i.state === "ok" && formatRange(i.startDate, i.endDate)}
                  <span class="muted">{formatRange(i.startDate, i.endDate)}</span>
                {:else if i.state === "password"}
                  <span class="muted">passwortgeschützt</span>
                {/if}
                <span class="muted small">zuletzt geöffnet {formatAgo(v.lastVisit, now)}</span>
              </div>
            </a>
          {/if}
          <button class="forget" aria-label="„{title}“ aus der Liste entfernen" title="Aus der Liste entfernen" onclick={() => forget(v.token)}>✕</button>
        </li>
      {/each}
    </ul>
  </main>
{/if}

<style>
  .home {
    max-width: 640px;
    margin: 0 auto;
    padding: 32px 16px 48px;
  }

  h1 {
    margin: 0 0 4px;
  }

  .cards {
    list-style: none;
    margin: 20px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .card {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px;
  }

  .card.gone {
    opacity: 0.6;
  }

  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    color: inherit;
    text-decoration: none;
  }

  .cover {
    width: 72px;
    height: 72px;
    border-radius: 8px;
    object-fit: cover;
    flex: none;
    background: var(--border);
  }

  .placeholder {
    display: grid;
    place-items: center;
    font-size: 1.4rem;
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .text strong {
    overflow-wrap: anywhere;
  }

  .small {
    font-size: 0.8rem;
  }

  .forget {
    flex: none;
    align-self: flex-start;
    border: 0;
    background: transparent;
    color: var(--muted);
    /* a finger-sized target without making the card taller */
    margin: -6px -6px 0 0;
    padding: 12px;
    font-size: 1rem;
    line-height: 1;
  }
</style>
