<script lang="ts">
  import { tick } from "svelte";
  import type { Place } from "./types";

  interface Suggestion extends Place {
    detail: string | null;
  }

  let {
    label,
    value,
    disabled = false,
    onchange,
  }: {
    label: string;
    value: Place | null;
    disabled?: boolean;
    onchange: (place: Place | null) => void;
  } = $props();

  const id = `place-${Math.random().toString(36).slice(2, 9)}`;
  const DEBOUNCE_MS = 250;

  let query = $state("");
  let results = $state<Suggestion[]>([]);
  let active = $state(-1);
  let open = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let editing = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let input = $state<HTMLInputElement>();

  const showInput = $derived(!value || editing);

  async function search(q: string) {
    controller?.abort();
    controller = new AbortController();
    loading = true;
    error = null;
    try {
      const res = await fetch(`/api/admin/geocode?q=${encodeURIComponent(q)}`, { signal: controller.signal });
      if (!res.ok) throw new Error(String(res.status));
      results = await res.json();
      active = results.length > 0 ? 0 : -1;
      open = true;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      results = [];
      error = "Die Ortssuche ist gerade nicht erreichbar.";
    } finally {
      loading = false;
    }
  }

  function onInput() {
    clearTimeout(timer);
    const q = query.trim();
    if (q.length < 2) {
      controller?.abort();
      results = [];
      open = false;
      return;
    }
    timer = setTimeout(() => search(q), DEBOUNCE_MS);
  }

  function choose(s: Suggestion) {
    onchange({ name: s.name, lat: s.lat, lng: s.lng });
    query = "";
    results = [];
    open = false;
    editing = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      open = false;
      if (editing && !query) editing = false;
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = (active + 1) % results.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = (active - 1 + results.length) % results.length;
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(results[active]!);
    }
  }

  async function edit() {
    editing = true;
    await tick();
    input?.focus();
  }
</script>

<div class="place">
  <span class="label" id="{id}-label">{label}</span>
  {#if showInput}
    <div class="combo">
      <input
        bind:this={input}
        bind:value={query}
        type="text"
        role="combobox"
        aria-labelledby="{id}-label"
        aria-expanded={open}
        aria-controls="{id}-list"
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        placeholder="Ort oder Adresse eingeben …"
        autocomplete="off"
        {disabled}
        oninput={onInput}
        onkeydown={onKeydown}
        onfocus={() => (open = results.length > 0)}
        onblur={() => setTimeout(() => (open = false), 150)}
      />
      {#if loading}<span class="spinner" aria-hidden="true"></span>{/if}
      {#if open}
        <ul class="list" id="{id}-list" role="listbox">
          {#each results as s, i (i)}
            <li
              id="{id}-{i}"
              role="option"
              aria-selected={i === active}
              class:active={i === active}
              onmousedown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              onmouseenter={() => (active = i)}
            >
              <span class="name">{s.name}</span>
              {#if s.detail}<span class="detail">{s.detail}</span>{/if}
            </li>
          {:else}
            <li class="empty">Kein Ort gefunden.</li>
          {/each}
        </ul>
      {/if}
    </div>
    {#if editing}<button type="button" class="link" onclick={() => (editing = false)}>Abbrechen</button>{/if}
    {#if error}<span class="error">{error}</span>{/if}
  {:else if value}
    <span class="chosen">
      <span class="pin" aria-hidden="true">●</span>
      <span class="chosen-name">{value.name}</span>
      <button type="button" {disabled} onclick={edit}>Ändern</button>
      <button type="button" {disabled} onclick={() => onchange(null)} aria-label="{label} entfernen">Entfernen</button>
    </span>
  {/if}
</div>

<style>
  .place {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .combo {
    position: relative;
  }

  input {
    width: 100%;
    font: inherit;
    color: inherit;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 8px;
    padding: 6px 30px 6px 10px;
  }

  .spinner {
    position: absolute;
    right: 10px;
    top: 50%;
    width: 12px;
    height: 12px;
    margin-top: -6px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .list {
    position: absolute;
    z-index: 20;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.15);
    max-height: 260px;
    overflow-y: auto;
  }

  .list li {
    display: flex;
    flex-direction: column;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
  }

  .list li.active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  .list li.empty {
    color: var(--muted);
    cursor: default;
  }

  .name {
    font-weight: 600;
  }

  .detail {
    font-size: 0.8rem;
    color: var(--muted);
  }

  .chosen {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .pin {
    color: var(--accent);
  }

  .chosen-name {
    flex: 1 1 auto;
    font-weight: 600;
  }

  .link {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 0.8rem;
    text-decoration: underline;
  }

  .error {
    color: var(--danger);
    font-size: 0.8rem;
  }
</style>
