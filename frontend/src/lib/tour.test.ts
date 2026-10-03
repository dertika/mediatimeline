import { describe, expect, it } from "vitest";
import { buildStops, dayNumber, distanceMeters, estimateTourSeconds, flightCurve, flightDuration, remainingStops, withTrip } from "./tour";
import type { TimelineAsset } from "./types";

let seq = 0;
const asset = (lat: number | null, lng: number | null, id = `a${++seq}`): TimelineAsset => ({
  id,
  type: "image",
  takenAt: "",
  localDateTime: "",
  caption: null,
  comments: [],
  lat,
  lng,
  width: null,
  height: null,
  city: null,
  country: null,
});
const ids = (stops: ReturnType<typeof buildStops>) => stops.map((s) => s.assets.map((a) => a.id));

// Bergen harbour and a spot ~400 m away; Oslo ~300 km away.
const BERGEN: [number, number] = [60.3975, 5.3245];
const BERGEN_NEAR: [number, number] = [60.3985, 5.3315];
const OSLO: [number, number] = [59.9139, 10.7522];

describe("distanceMeters", () => {
  it("measures great-circle distances", () => {
    expect(distanceMeters(BERGEN, BERGEN)).toBe(0);
    expect(distanceMeters(BERGEN, BERGEN_NEAR)).toBeGreaterThan(300);
    expect(distanceMeters(BERGEN, BERGEN_NEAR)).toBeLessThan(500);
    expect(distanceMeters(BERGEN, OSLO) / 1000).toBeCloseTo(305, -1);
  });
});

describe("buildStops", () => {
  it("returns no stops without located photos", () => {
    expect(buildStops([], 1000)).toEqual([]);
    expect(buildStops([asset(null, null)], 1000)).toEqual([]);
  });

  it("groups consecutive photos within the radius", () => {
    const stops = buildStops(
      [asset(...BERGEN, "b1"), asset(...BERGEN_NEAR, "b2"), asset(...OSLO, "o1")],
      1000,
    );
    expect(ids(stops)).toEqual([["b1", "b2"], ["o1"]]);
    expect(stops[0]!.center[0]).toBeCloseTo((BERGEN[0] + BERGEN_NEAR[0]) / 2, 6);
    expect(stops[0]!.bounds).toEqual([
      [BERGEN[0], BERGEN[1]],
      [BERGEN_NEAR[0], BERGEN_NEAR[1]],
    ]);
  });

  it("splits nearby photos when the radius is small", () => {
    const stops = buildStops([asset(...BERGEN, "b1"), asset(...BERGEN_NEAR, "b2")], 250);
    expect(ids(stops)).toEqual([["b1"], ["b2"]]);
  });

  it("keeps photos without GPS with the current stop, leading ones with the first", () => {
    const stops = buildStops(
      [
        asset(null, null, "x0"),
        asset(...BERGEN, "b1"),
        asset(null, null, "x1"),
        asset(...OSLO, "o1"),
        asset(null, null, "x2"),
      ],
      1000,
    );
    expect(ids(stops)).toEqual([
      ["x0", "b1", "x1"],
      ["o1", "x2"],
    ]);
  });

  it("treats returning to an earlier place as a new stop", () => {
    const stops = buildStops([asset(...BERGEN, "b1"), asset(...OSLO, "o1"), asset(...BERGEN, "b2")], 1000);
    expect(ids(stops)).toEqual([["b1"], ["o1"], ["b2"]]);
  });
});

describe("flightCurve", () => {
  const W = 1280;
  it("starts at the origin and ends at the target", () => {
    const c = flightCurve(W, W / 8, 50_000);
    expect(c.u(0)).toBeCloseTo(0, 6);
    expect(c.w(0)).toBeCloseTo(W, 6);
    expect(c.u(c.length) / 50_000).toBeCloseTo(1, 6);
    expect(c.w(c.length) / (W / 8)).toBeCloseTo(1, 6);
  });
  it("zooms out in between on long legs", () => {
    const c = flightCurve(W, W, 100_000);
    expect(c.w(c.length / 2)).toBeGreaterThan(20 * W);
  });
});

describe("flightDuration", () => {
  // Same zoom at both ends, 1.16 m per pixel (zoom 16 in Norway).
  const seconds = (km: number) => flightDuration(flightCurve(1280, 1280, (km * 1000) / 1.16).length);
  it("takes longer for longer legs, within 1.5–8 s", () => {
    expect(seconds(0.5)).toBe(1.5);
    expect(seconds(10)).toBeGreaterThan(2.5);
    expect(seconds(100)).toBeGreaterThan(5);
    expect(seconds(100)).toBeGreaterThan(seconds(10));
    expect(seconds(20_000)).toBe(8);
  });
});

describe("dayNumber", () => {
  const first = "2026-06-01T09:00:00.000Z";
  it("counts calendar days from the first medium", () => {
    expect(dayNumber(first, "2026-06-01T23:59:00.000Z")).toBe(1);
    expect(dayNumber(first, "2026-06-02T00:01:00.000Z")).toBe(2);
  });
  it("keeps gaps between days", () => {
    expect(dayNumber(first, "2026-06-04T12:00:00.000Z")).toBe(4);
  });
  it("crosses month boundaries", () => {
    expect(dayNumber("2026-05-31T18:00:00.000Z", "2026-06-01T08:00:00.000Z")).toBe(2);
  });
});

describe("estimateTourSeconds", () => {
  const tour = { intervalSeconds: 5, radiusMeters: 1000, videoMaxSeconds: 10 };
  it("adds overview, flights, map pauses, media and day cards", () => {
    const stops = buildStops([asset(...BERGEN), asset(...BERGEN), { ...asset(...OSLO), type: "video" }], 1000);
    // 2 + 2 × (4 + 5) + (5 + 5 + 10) + 1 × 5 + 3
    expect(estimateTourSeconds(stops, 2, tour)).toBe(48);
  });
  it("assumes 20 s for videos played to the end", () => {
    const stops = buildStops([{ ...asset(...BERGEN), type: "video" }], 1000);
    expect(estimateTourSeconds(stops, 1, { ...tour, videoMaxSeconds: 0 })).toBe(2 + 9 + 20 + 3);
  });
});

describe("remainingStops", () => {
  const stops = buildStops([asset(...BERGEN, "b1"), asset(...BERGEN, "b2"), asset(...OSLO, "o")], 1000);
  it("drops earlier stops and the items already seen", () => {
    expect(remainingStops(stops, { stop: 0, item: 1 }).map((s) => s.assets.map((a) => a.id))).toEqual([["b2"], ["o"]]);
    expect(remainingStops(stops, { stop: 1, item: 0 }).map((s) => s.assets.map((a) => a.id))).toEqual([["o"]]);
  });
  it("makes the estimate shrink as the tour goes on", () => {
    const tour = { intervalSeconds: 5, radiusMeters: 1000, videoMaxSeconds: 10 };
    const full = estimateTourSeconds(stops, 1, tour);
    expect(estimateTourSeconds(remainingStops(stops, { stop: 0, item: 0 }), 1, tour)).toBe(full);
    expect(estimateTourSeconds(remainingStops(stops, { stop: 1, item: 0 }), 1, tour)).toBe(full - 9 - 10);
  });
});

describe("withTrip", () => {
  const stops = buildStops([asset(...BERGEN, "b"), asset(...OSLO, "o")], 1000);
  it("adds start and end as stops without photos", () => {
    const all = withTrip(stops, { start: { name: "Hamburg", lat: 53.55, lng: 10 }, end: { name: "Kiel", lat: 54.32, lng: 10.13 } });
    expect(all.map((s) => s.waypoint ?? s.assets[0]!.id)).toEqual(["start", "b", "o", "end"]);
    expect(all[0]).toMatchObject({ name: "Hamburg", center: [53.55, 10], assets: [] });
  });
  it("leaves the stops alone without a trip", () => {
    expect(withTrip(stops, undefined)).toEqual(stops);
    expect(withTrip(stops, { start: null, end: null })).toEqual(stops);
  });
});
