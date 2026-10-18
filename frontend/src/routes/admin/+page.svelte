<script lang="ts">
  import { adminFetch, reloadForLogin } from "$lib/adminFetch";
  import ShareEditor from "$lib/ShareEditor.svelte";
  import { formatRange } from "$lib/format";
  import type { AdminAlbum, ShareDto } from "$lib/types";
  import { CHANGELOG_URL, VERSION } from "$lib/version";

  let albums = $state<AdminAlbum[]>([]);
  let user = $state<{ name: string; geopulse?: boolean; via?: "header" | "oidc" } | null>(null);
  let status = $state<"loading" | "ready" | "unauthorized" | "error">("loading");
  /** Set by the server when the admin page can also sign in with OpenID Connect. */
  let loginUrl = $state<string | null>(null);
  /** Result of a sign-in that went wrong, from ?login=… of the return address. */
  const loginResult = new URLSearchParams(location.search).get("login");
  let query = $state("");
  let onlyShared = $state(false);
  let creating = $state<string | null>(null);
  /** Albums whose links are shown. Albums with links start collapsed, so the list stays short. */
  let expanded = $state<Record<string, boolean>>({});

  async function load() {
    status = "loading";
    try {
      const [meRes, albumsRes] = await Promise.all([adminFetch("/api/admin/me"), adminFetch("/api/admin/immich/albums")]);
      if (meRes.status === 401 || meRes.status === 403) {
        const body = await meRes.json().catch(() => null);
        loginUrl = typeof body?.login === "string" ? body.login : null;
        status = "unauthorized";
        // Behind Authelia, a reload leads to the login (an expired session lands here as a 401).
        if (!loginUrl) reloadForLogin();
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

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.assign("/admin");
  }

  async function createShare(album: AdminAlbum) {
    creating = album.id;
    try {
      const res = await adminFetch("/api/admin/shares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ albumId: album.id }),
      });
      if (res.ok) {
        album.shares.push(await res.json());
        expanded[album.id] = true; // show the new link
      }
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
    await adminFetch("/api/admin/cache/clear", { method: "POST" });
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
    {#if user}
      <span class="muted who">
        Angemeldet als <strong>{user.name}</strong>
        {#if user.via === "oidc"}<button onclick={logout}>Abmelden</button>{/if}
      </span>
    {/if}
  </header>

  {#if status === "loading"}
    <p class="muted">Lade Alben …</p>
  {:else if status === "unauthorized" && loginUrl}
    <section class="login">
      <h2>Anmelden</h2>
      {#if loginResult === "forbidden"}
        <p class="error">Dieses Konto darf die Verwaltung nicht nutzen.</p>
      {:else if loginResult === "failed"}
        <p class="error">Die Anmeldung hat nicht geklappt. Bitte noch einmal versuchen.</p>
      {:else}
        <p class="muted">Die Verwaltung ist nur für angemeldete Administratoren.</p>
      {/if}
      <a class="button primary" href="{loginUrl}?return=/admin">Mit OpenID Connect anmelden</a>
    </section>
  {:else if status === "unauthorized"}
    <p class="error">Kein Zugriff. Bitte über Authelia anmelden.</p>
    <button onclick={() => location.reload()}>Neu laden</button>
  {:else if status === "error"}
    <p class="error">Alben konnten nicht geladen werden. Ist Immich erreichbar und der API-Key gültig? Oder ist die Verbindung unterbrochen?</p>
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
          <div class="actions">
          {#if album.shares.length}
            <button
              class="links-toggle"
              aria-expanded={!!expanded[album.id]}
              aria-controls="links-{album.id}"
              title={expanded[album.id] ? "Links ausblenden" : "Links anzeigen"}
              onclick={() => (expanded[album.id] = !expanded[album.id])}
            >
              <span class="chevron" aria-hidden="true">{expanded[album.id] ? "▾" : "▸"}</span>
              {album.shares.length === 1 ? "1 Link" : `${album.shares.length} Links`}
            </button>
          {/if}
          <button class="primary" disabled={creating === album.id} onclick={() => createShare(album)}>
            {album.shares.length ? "Weiteren Link erstellen" : "Freigeben"}
          </button>
          </div>
        </div>
        {#if expanded[album.id]}
          <div class="links" id="links-{album.id}">
            {#each album.shares as share (share.id)}
              <ShareEditor
                {share}
                geopulse={user?.geopulse ?? false}
                onchange={(updated) => replaceShare(album, updated)}
                ondelete={(id) => removeShare(album, id)}
              />
            {/each}
          </div>
        {/if}
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

  .who {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .login {
    max-width: 420px;
    margin: 32px auto;
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
  }

  .login h2,
  .login p {
    margin: 0;
  }

  .login .button {
    display: inline-block;
    padding: 8px 16px;
    border-radius: 8px;
    text-decoration: none;
    background: var(--accent);
    color: var(--accent-contrast);
    font-weight: 600;
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
    flex-wrap: wrap;
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

  .links {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .links-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 0.875rem;
    color: var(--accent);
    border-color: var(--accent);
  }

  .links-toggle .chevron {
    font-size: 0.8em;
  }

  .info {
    /* The basis lets the buttons wrap below the title on narrow screens instead of squeezing it. */
    flex: 1 1 10rem;
    min-width: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  @media (max-width: 600px) {
    .actions {
      margin-left: 0;
      width: 100%;
    }
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
