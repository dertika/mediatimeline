<script lang="ts">
  import PlaceInput from "./PlaceInput.svelte";
  import { formatDateTime } from "./format";
  import type { Place, ShareDto } from "./types";

  let {
    share,
    geopulse = false,
    onchange,
    ondelete,
  }: {
    share: ShareDto;
    /** GeoPulse is configured on the server: offer the recorded route. */
    geopulse?: boolean;
    onchange: (updated: ShareDto) => void;
    ondelete: (id: number) => void;
  } = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);
  let copied = $state(false);
  let newPassword = $state("");
  let editingPassword = $state(false);

  // datetime-local works in the browser's zone without offset.
  function toLocalInput(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function patch(body: Record<string, unknown>) {
    busy = true;
    error = null;
    try {
      const res = await fetch(`/api/admin/shares/${share.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      onchange(await res.json());
      return true;
    } catch {
      error = "Speichern fehlgeschlagen.";
      return false;
    } finally {
      busy = false;
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(share.url);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  const RADIUS_OPTIONS = [250, 500, 1000, 2000, 5000, 10000];
  const formatRadius = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);

  /** Saves a whole-number setting; out-of-range input resets the field. */
  async function setNumber(
    field: "tourIntervalSeconds" | "tourVideoMaxSeconds",
    min: number,
    max: number,
    event: Event,
  ) {
    const input = event.currentTarget as HTMLInputElement;
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < min || value > max) {
      input.value = String(share[field]);
      error = `Bitte eine ganze Zahl zwischen ${min} und ${max} eingeben.`;
      return;
    }
    await patch({ [field]: value });
  }

  /** Changing the start of a round trip moves its end along. */
  function setTripStart(place: Place | null) {
    patch(share.tripEndSameAsStart ? { tripStart: place, tripEnd: place } : { tripStart: place });
  }

  function setRoundTrip(event: Event) {
    const roundTrip = (event.currentTarget as HTMLInputElement).checked;
    patch(roundTrip ? { tripEndSameAsStart: true, tripEnd: share.tripStart } : { tripEndSameAsStart: false });
  }

  async function setExpiry(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    await patch({ expiresAt: value ? new Date(value).toISOString() : null });
  }

  async function savePassword(event: SubmitEvent) {
    event.preventDefault();
    if (await patch({ password: newPassword })) {
      newPassword = "";
      editingPassword = false;
    }
  }

  async function remove() {
    if (!confirm("Diesen Link wirklich widerrufen? Er funktioniert danach nicht mehr.")) return;
    busy = true;
    const res = await fetch(`/api/admin/shares/${share.id}`, { method: "DELETE" });
    busy = false;
    if (res.ok) ondelete(share.id);
    else error = "Löschen fehlgeschlagen.";
  }

  const status = $derived(
    !share.enabled
      ? { label: "deaktiviert", cls: "off" }
      : share.expired
        ? { label: "abgelaufen", cls: "off" }
        : share.expiresAt
          ? { label: `aktiv bis ${formatDateTime(share.expiresAt)}`, cls: "on" }
          : { label: "aktiv", cls: "on" },
  );
</script>

<div class="share" class:inactive={status.cls === "off"}>
  <div class="row">
    <span class="badge {status.cls}">{status.label}</span>
    {#if share.hasPassword}<span class="badge">🔒 Passwort</span>{/if}
    <input class="url" type="text" readonly value={share.url} aria-label="Link" onfocus={(e) => e.currentTarget.select()} />
    <button onclick={copy}>{copied ? "Kopiert ✓" : "Kopieren"}</button>
    <a href={share.url} target="_blank" rel="noopener">Öffnen</a>
  </div>

  <div class="grid">
    <label class="check">
      <input type="checkbox" checked={share.enabled} disabled={busy} onchange={(e) => patch({ enabled: e.currentTarget.checked })} />
      Link aktiv
    </label>

    <label>
      Titel (optional)
      <input
        type="text"
        value={share.titleOverride ?? ""}
        placeholder="Albumname verwenden"
        disabled={busy}
        onchange={(e) => patch({ titleOverride: e.currentTarget.value })}
      />
    </label>

    <label>
      Ablaufdatum (optional)
      <span class="inline">
        <input type="datetime-local" value={toLocalInput(share.expiresAt)} disabled={busy} onchange={setExpiry} />
        {#if share.expiresAt}<button disabled={busy} onclick={() => patch({ expiresAt: null })}>Entfernen</button>{/if}
      </span>
    </label>

    <label>
      Bildunterschrift
      <select value={share.captionSource} disabled={busy} onchange={(e) => patch({ captionSource: e.currentTarget.value })}>
        <option value="description">Beschreibung</option>
        <option value="firstComment">Erster Kommentar</option>
        <option value="descriptionOrFirstComment">Beschreibung, sonst 1. Kommentar</option>
        <option value="none">Keine</option>
      </select>
    </label>

    <label class="check">
      <input
        type="checkbox"
        checked={share.showComments}
        disabled={busy}
        onchange={(e) => patch({ showComments: e.currentTarget.checked })}
      />
      Alle Kommentare anzeigen (mit Namen)
    </label>

    <fieldset class="tour">
      <legend>Tour</legend>
      <label>
        Wartezeit pro Foto (s)
        <input
          type="number"
          min="2"
          max="60"
          value={share.tourIntervalSeconds}
          disabled={busy}
          onchange={(e) => setNumber("tourIntervalSeconds", 2, 60, e)}
        />
      </label>
      <label>
        Max. Videolänge (s, 0 = ganz)
        <input
          type="number"
          min="0"
          max="600"
          value={share.tourVideoMaxSeconds}
          disabled={busy}
          onchange={(e) => setNumber("tourVideoMaxSeconds", 0, 600, e)}
        />
      </label>
      <label>
        Radius für einen Ort
        <select
          value={share.tourRadiusMeters}
          disabled={busy}
          onchange={(e) => patch({ tourRadiusMeters: Number(e.currentTarget.value) })}
        >
          {#each RADIUS_OPTIONS.includes(share.tourRadiusMeters) ? RADIUS_OPTIONS : [...RADIUS_OPTIONS, share.tourRadiusMeters].sort((a, b) => a - b) as m (m)}
            <option value={m}>{formatRadius(m)}</option>
          {/each}
        </select>
      </label>
    </fieldset>

    <fieldset class="trip">
      <legend>Reiseroute (optional)</legend>
      <PlaceInput label="Start" value={share.tripStart} disabled={busy} onchange={setTripStart} />
      <div class="trip-end">
        {#if !share.tripEndSameAsStart}
          <PlaceInput label="Ziel" value={share.tripEnd} disabled={busy} onchange={(p) => patch({ tripEnd: p })} />
        {:else}
          <span>Ziel</span>
          <span class="muted">wie der Start</span>
        {/if}
        <label class="check">
          <input type="checkbox" checked={share.tripEndSameAsStart} disabled={busy} onchange={setRoundTrip} />
          Ziel = Start (Rundreise)
        </label>
      </div>
      <p class="hint muted">
        Start und Ziel erscheinen auf der Karte und in der Tour, ohne Fotos. Sie sind für alle mit dem Link sichtbar:
        Wer die eigene Adresse nicht zeigen möchte, wählt nur den Ort.
      </p>
      {#if geopulse}
        <label class="check">
          <input
            type="checkbox"
            checked={share.showRoute}
            disabled={busy}
            onchange={(e) => patch({ showRoute: e.currentTarget.checked })}
          />
          Echte Route aus GeoPulse zeigen
        </label>
        <p class="hint muted">
          Statt gerader Linien zeigen Karte und Tour die aufgezeichnete Strecke zwischen dem ersten und letzten Foto,
          nach Verkehrsmittel eingefärbt. Rund um Start und Ziel wird sie abgeschnitten.
        </p>
      {/if}
    </fieldset>

    <div class="password">
      Passwort (optional)
      {#if share.hasPassword && !editingPassword}
        <span class="inline">
          <button disabled={busy} onclick={() => (editingPassword = true)}>Ändern</button>
          <button disabled={busy} onclick={() => patch({ password: null })}>Entfernen</button>
        </span>
      {:else}
        <form class="inline" onsubmit={savePassword}>
          <input type="password" bind:value={newPassword} placeholder="Neues Passwort" autocomplete="new-password" required />
          <button class="primary" disabled={busy || !newPassword}>Setzen</button>
          {#if editingPassword}<button type="button" onclick={() => (editingPassword = false)}>Abbrechen</button>{/if}
        </form>
      {/if}
    </div>
  </div>

  <div class="row footer">
    <span class="muted">Erstellt {formatDateTime(share.createdAt)}{share.createdBy ? ` von ${share.createdBy}` : ""}</span>
    <button class="danger" disabled={busy} onclick={remove}>Link widerrufen</button>
  </div>
  {#if error}<p class="error">{error}</p>{/if}
</div>

<style>
  .share {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .share.inactive {
    opacity: 0.75;
  }

  .row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  .url {
    flex: 1 1 260px;
    min-width: 0;
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
    font-size: 0.9rem;
  }

  .grid label,
  .password {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .grid label.check {
    flex-direction: row;
    align-items: center;
  }

  .tour {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px 12px;
    margin: 0;
  }

  .trip {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px 12px;
    margin: 0;
  }

  .trip legend {
    padding: 0 4px;
    color: var(--muted);
  }

  .trip-end {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .trip-end label.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }

  .hint {
    grid-column: 1 / -1;
    margin: 0;
    font-size: 0.8rem;
  }

  .tour legend {
    padding: 0 4px;
    color: var(--muted);
  }

  input[type="number"] {
    font: inherit;
    color: inherit;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 8px;
    padding: 6px 10px;
  }

  select {
    width: 100%;
    font: inherit;
    color: inherit;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 8px;
    padding: 6px 10px;
  }

  .inline {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .inline input {
    flex: 1 1 140px;
    min-width: 0;
  }

  .badge {
    font-size: 0.75rem;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--border);
  }

  .badge.on {
    border-color: var(--accent);
    color: var(--accent);
  }

  .badge.off {
    color: var(--muted);
  }

  .footer {
    justify-content: space-between;
    font-size: 0.8rem;
  }
</style>
