import { describe, expect, it } from "vitest";
import { Geocoder, toSuggestion } from "../src/geocoder.js";

const at = (properties: object) => ({ geometry: { coordinates: [11.5, 48.1] as [number, number] }, properties });

describe("toSuggestion", () => {
  it("names a city by itself, with region and country as context", () => {
    expect(toSuggestion(at({ name: "Rom", state: "Latium", country: "Italien" }))).toEqual({
      name: "Rom",
      lat: 48.1,
      lng: 11.5,
      detail: "Latium, Italien",
    });
  });

  it("adds the city to places and addresses inside it", () => {
    expect(toSuggestion(at({ name: "Marienplatz", city: "München", country: "Deutschland" })).name).toBe(
      "Marienplatz, München",
    );
    expect(toSuggestion(at({ street: "Hauptstraße", housenumber: "5", city: "Berlin" })).name).toBe(
      "Hauptstraße 5, Berlin",
    );
  });

  it("does not repeat parts of the name in the context", () => {
    expect(toSuggestion(at({ name: "Berlin", state: "Berlin", country: "Deutschland" })).detail).toBe("Deutschland");
    expect(toSuggestion(at({ name: "Deutschland", country: "Deutschland" })).detail).toBeNull();
  });
});

describe("Geocoder timeout", () => {
  /** A Photon that answers after `ms`, but honours the abort signal like fetch does. */
  const slowPhoton = (ms: number) =>
    ((_url: unknown, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(Response.json({ features: [] })), ms);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(init.signal!.reason);
        });
      })) as unknown as typeof fetch;

  it("waits for a slow answer within the limit", async () => {
    await expect(new Geocoder("https://photon.test", slowPhoton(150), 1000).search("Rom")).resolves.toEqual([]);
  });

  it("gives up after the limit", async () => {
    await expect(new Geocoder("https://photon.test", slowPhoton(1000), 50).search("Rom")).rejects.toThrow();
  });
});
