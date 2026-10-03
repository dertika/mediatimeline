import { describe, expect, it, vi } from "vitest";
import { buildRoute, GeoPulseClient, simplify, type RoutePoint } from "../src/geopulse.js";

const at = (min: number) => new Date(Date.UTC(2026, 5, 1, 10, min)).toISOString();
const pt = (lat: number, lng: number, min: number) => ({ latitude: lat, longitude: lng, timestamp: at(min) });
const opts = { privacyRadiusMeters: 0, privacyPoints: [], toleranceMeters: 0 };

describe("simplify", () => {
  it("drops points on a straight line and keeps corners", () => {
    const line: RoutePoint[] = [
      [60, 5, 0],
      [60.001, 5, 1],
      [60.002, 5, 2],
      [60.002, 5.01, 3],
    ];
    expect(simplify(line, 5)).toEqual([line[0], line[2], line[3]]);
  });
});

describe("buildRoute", () => {
  const path = [[pt(60, 5, 0), pt(60.1, 5.1, 10), pt(60.2, 5.2, 20), pt(60.3, 5.3, 30), pt(60.4, 5.4, 40)]];

  it("keeps only points during trips, one leg per trip with its means of transport", () => {
    const trips = [
      { timestamp: at(0), tripDuration: 10 * 60, movementType: "CAR" },
      { timestamp: at(30), tripDuration: 10 * 60, movementType: "BOAT" },
    ];
    const legs = buildRoute(path, trips, opts);
    expect(legs.map((l) => l.mode)).toEqual(["CAR", "BOAT"]);
    expect(legs[0]!.points.map((p) => p[0])).toEqual([60, 60.1]);
    expect(legs[1]!.points.map((p) => p[0])).toEqual([60.3, 60.4]);
    expect(legs[0]!.points[0]![2]).toBe(Date.parse(at(0)) / 1000);
  });

  it("uses the whole path when GeoPulse has no trips", () => {
    const legs = buildRoute(path, [], opts);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.mode).toBe("UNKNOWN");
    expect(legs[0]!.points).toHaveLength(5);
  });

  it("leaves out points near the privacy places and splits the leg there", () => {
    const legs = buildRoute(path, [], {
      ...opts,
      privacyRadiusMeters: 2000,
      privacyPoints: [{ name: "Zuhause", lat: 60.2, lng: 5.2 }],
    });
    expect(legs.map((l) => l.points.map((p) => p[0]))).toEqual([
      [60, 60.1],
      [60.3, 60.4],
    ]);
  });

  it("keeps separate segments apart (no line across a recording gap)", () => {
    const legs = buildRoute([path[0]!.slice(0, 2), path[0]!.slice(3)], [], opts);
    expect(legs).toHaveLength(2);
  });

  it("simplifies harder until the route fits the point limit", () => {
    const zigzag = Array.from({ length: 400 }, (_, i) => pt(60 + i * 0.001, 5 + (i % 2) * 0.0005, i / 10));
    const legs = buildRoute([zigzag], [], { ...opts, toleranceMeters: 1, maxPoints: 100 });
    expect(legs[0]!.points.length).toBeLessThanOrEqual(100);
  });
});

describe("GeoPulseClient", () => {
  it("asks GeoPulse with the API key and reads both plain and enveloped answers", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      const body = u.includes("/gps/points/path")
        ? { status: "success", data: { segments: [[pt(60, 5, 0), pt(60.1, 5.1, 5)]] } }
        : { trips: [{ timestamp: at(0), tripDuration: 600, movementType: "TRAIN" }] };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const client = new GeoPulseClient("http://geopulse:8080", "secret", 60_000, fetchImpl as typeof fetch);
    const legs = await client.route(at(0), at(60), opts);
    expect(legs).toEqual([{ mode: "TRAIN", points: [[60, 5, Date.parse(at(0)) / 1000], [60.1, 5.1, Date.parse(at(5)) / 1000]] }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^http:\/\/geopulse:8080\/api\/v1\//);
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("secret");
    // Cached: no new requests.
    await client.route(at(0), at(60), opts);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails when GeoPulse answers with an error", async () => {
    const client = new GeoPulseClient("http://g", "k", 60_000, (async () => new Response("", { status: 401 })) as typeof fetch);
    await expect(client.route(at(0), at(1), opts)).rejects.toThrow("401");
  });
});
