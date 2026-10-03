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
  const path = [[pt(60, 5, 0), pt(60.1, 5.1, 5)]];
  const trips = [{ timestamp: at(0), tripDuration: 600, movementType: "TRAIN" }];
  const expected = [{ mode: "TRAIN", points: [[60, 5, Date.parse(at(0)) / 1000], [60.1, 5.1, Date.parse(at(5)) / 1000]] }];

  /** Fake GeoPulse that only knows one API variant. */
  function fakeGeoPulse(variant: "v1" | "v2") {
    return vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const p = url.pathname;
      if (variant === "v1" && p === "/api/gps/path" && url.searchParams.has("startTime")) {
        return Response.json({ status: "success", data: { segments: path } });
      }
      if (variant === "v1" && p === "/api/streaming-timeline" && url.searchParams.has("endTime")) {
        return Response.json({ status: "success", data: { trips } });
      }
      if (variant === "v2" && p === "/api/v1/gps/points/path" && url.searchParams.has("from")) {
        return Response.json({ segments: path });
      }
      if (variant === "v2" && p === "/api/v1/timeline" && url.searchParams.has("to")) return Response.json({ trips });
      return new Response("not found", { status: 404 });
    });
  }

  it("reads the released 1.x API (enveloped answers) with the API key", async () => {
    const fetchImpl = fakeGeoPulse("v1");
    const client = new GeoPulseClient("http://geopulse:8080", "secret", 60_000, fetchImpl as typeof fetch);
    expect(await client.route(at(0), at(60), opts)).toEqual(expected);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("secret");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Cached: no new requests.
    await client.route(at(0), at(60), opts);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to the v2 API on 404 and keeps using it", async () => {
    const fetchImpl = fakeGeoPulse("v2");
    const client = new GeoPulseClient("http://geopulse:8080", "secret", 60_000, fetchImpl as typeof fetch);
    expect(await client.route(at(0), at(60), opts)).toEqual(expected);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    await client.route(at(1), at(60), opts);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(String(fetchImpl.mock.calls[5]![0])).toContain("/api/v1/");
  });

  it("explains a wrong URL when neither API exists there", async () => {
    const client = new GeoPulseClient("http://g", "k", 60_000, (async () => new Response("", { status: 404 })) as typeof fetch);
    await expect(client.route(at(0), at(1), opts)).rejects.toThrow("neither API v1 nor v2");
  });

  it("reports other errors without trying the other API", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 401 }));
    const client = new GeoPulseClient("http://g", "k", 60_000, fetchImpl as typeof fetch);
    await expect(client.route(at(0), at(1), opts)).rejects.toThrow("401");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
