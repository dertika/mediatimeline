import type { Place } from "./store/db.js";

/** A search result: the place as it would be stored, plus context for the list. */
export interface PlaceSuggestion extends Place {
  /** E.g. "Bayern, Deutschland"; null when there is nothing to add. */
  detail: string | null;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    district?: string;
    county?: string;
    state?: string;
    country?: string;
  };
}

const MAX_CACHED = 200;

/** Turns a Photon feature into a short name ("Marienplatz, München") and its context. */
export function toSuggestion(feature: PhotonFeature): PlaceSuggestion {
  const p = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;
  const street = p.street ? [p.street, p.housenumber].filter(Boolean).join(" ") : null;
  const primary = p.name ?? street ?? p.city ?? p.country ?? "Unbenannter Ort";
  const locality = p.city ?? p.district ?? p.county;
  const name = locality && locality !== primary ? `${primary}, ${locality}` : primary;
  const detail = [...new Set([p.state, p.country])].filter((part) => part && !name.includes(part)).join(", ");
  return { name, lat, lng, detail: detail || null };
}

/**
 * Place search for the admin page, backed by a Photon server (OpenStreetMap
 * data, made for search-as-you-type). Results are cached in memory.
 */
export class Geocoder {
  private cache = new Map<string, PlaceSuggestion[]>();

  constructor(
    private url: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string, lang = "de"): Promise<PlaceSuggestion[]> {
    const key = `${lang}:${query.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const params = new URLSearchParams({ q: query, limit: "6", lang });
    const res = await this.fetchImpl(`${this.url}/api/?${params}`, {
      headers: { "user-agent": "mediatimeline (https://github.com/dertika/mediatimeline)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`geocoder answered ${res.status}`);
    const body = (await res.json()) as { features?: PhotonFeature[] };

    const seen = new Set<string>();
    const results = (body.features ?? []).map(toSuggestion).filter((s) => {
      const id = `${s.name}|${s.detail}`;
      return !seen.has(id) && seen.add(id);
    });

    if (this.cache.size >= MAX_CACHED) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, results);
    return results;
  }
}
