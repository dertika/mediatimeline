<script lang="ts">
  import ShareEditor from "$lib/ShareEditor.svelte";
  import { formatRange } from "$lib/format";
  import type { AdminAlbum, ShareDto } from "$lib/types";
  import { CHANGELOG_URL, VERSION } from "$lib/version";

  let albums = $state<AdminAlbum[]>([]);
  let user = $state<{ name: string } | null>(null);
  let status = $state<"loading" | "ready" | "unauthorized" | "error">("loading");
  let query = $state("");
  let onlyShared = $state(false);
  let creating = $state<string | null>(null);

  async function load() {
    status = "loading";
    try {
      const [meRes, albumsRes] = await Promise.all([fetch("/api/admin/me"), fetch("/api/admin/immich/albums")]);
      if (meRes.status === 401 || meRes.status === 403) {
        status = "unauthorized";
        return;
      }
      if (!albumsRes.ok) throw new Error(String(albumsRes.status));
      user = await meRes.json();
      albums = await albumsRes.json();
      status = "ready";
    } catch {
      status = "error";
    }
  }

  async function createShare(album: AdminAlbum) {
    creating = album.id;
    try {
      const res = await fetch("/api/admin/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ albumId: album.id }),
      });
      if (res.ok) album.shares.push(await res.json());
    } finally {
      creating = null;
    }
  }

  function replaceShare(album: AdminAlbum, updated: ShareDto) {
    album.shares = album.shares.map((s) => (s.id === updated.id ? updated : s));
  }

  function removeShare(album: AdminAlbum, id: number) {
    album.shares = album.shares.filter((s) => s.id !== id);
  }

  async function clearCache() {
    await fetch("/api/admin/cache/clear", { method: "POST" });
  }

  const visible = $derived(
    albums.filter(
      (a) =>
        (!onlyShared || a.shares.length > 0) &&
        a.albumName.toLowerCase().includes(query.trim().toLowerCase()),
    ),
  );

  load();
</script>

<svelte:head><title>Verwaltung · mediatimeline</title></svelte:head>

<main class="admin">
  <header>
    <div>
      <h1>mediatimeline</h1>
      <p class="muted">Alben aus Immich auswählen und als öffentliche Timeline teilen.</p>
    </div>
    {#if user}<span class="muted">Angemeldet als <strong>{user.name}</strong></span>{/if}
  </header>

  {#if status === "loading"}
    <p class="muted">Lade Alben …</p>
  {:else if status === "unauthorized"}
    <p class="error">Kein Zugriff. Bitte über Authelia anmelden.</p>
    <button onclick={() => location.reload()}>Neu laden</button>
  {:else if status === "error"}
    <p class="error">Alben konnten nicht geladen werden. Ist Immich erreichbar und der API-Key gültig?</p>
    <button onclick={load}>Erneut versuchen</button>
  {:else}
    <div class="toolbar">
      <input type="text" bind:value={query} placeholder="Album suchen …" aria-label="Album suchen" />
      <label><input type="checkbox" bind:checked={onlyShared} /> nur freigegebene</label>
      <button onclick={clearCache} title="Neue Fotos aus Immich sofort anzeigen">Cache leeren</button>
    </div>

    {#each visible as album (album.id)}
      <article class="album">
        <div class="album-head">
          {#if album.thumbnailAssetId}
            <img src="/api/admin/immich/assets/{album.thumbnailAssetId}/thumbnail" alt="" loading="lazy" />
          {:else}
            <div class="placeholder"></div>
          {/if}
          <div class="info">
            <h2>{album.albumName}</h2>
            <p class="muted">
              {album.assetCount} Medien{formatRange(album.startDate, album.endDate) ? ` · ${formatRange(album.startDate, album.endDate)}` : ""}
            </p>
          </div>
          <button class="primary" disabled={creating === album.id} onclick={() => createShare(album)}>
            {album.shares.length ? "Weiteren Link erstellen" : "Freigeben"}
          </button>
        </div>
        {#each album.shares as share (share.id)}
          <ShareEditor
            {share}
            onchange={(updated) => replaceShare(album, updated)}
            ondelete={(id) => removeShare(album, id)}
          />
        {/each}
      </article>
    {:else}
      <p class="muted">Keine Alben gefunden.</p>
    {/each}
  {/if}

  <footer class="muted">mediatimeline · <a href={CHANGELOG_URL}>v{VERSION}</a></footer>
</main>

<style>
  .admin {
    max-width: 1000px;
    margin: 0 auto;
    padding: 24px 16px 48px;
  }

  footer {
    margin-top: 48px;
    text-align: center;
    font-size: 0.8rem;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }

  header h1 {
    margin: 0;
  }

  header p {
    margin: 4px 0 0;
  }

  .toolbar {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }

  .toolbar input[type="text"] {
    flex: 1 1 220px;
  }

  .album {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px;
    margin-bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .album-head {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .album-head img,
  .placeholder {
    width: 64px;
    height: 64px;
    border-radius: 8px;
    object-fit: cover;
    background: var(--border);
    flex: none;
  }

  .info {
    flex: 1;
    min-width: 0;
  }

  .info h2 {
    font-size: 1.05rem;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .info p {
    margin: 2px 0 0;
    font-size: 0.875rem;
  }
</style>
