import { describe, expect, it } from "vitest";
import { nearestAhead, routeBetween, routeModes, stopLegs } from "./route";
import type { TourStop } from "./tour";
import type { RouteLeg, TimelineAsset } from "./types";

const t = (h: number) => Date.UTC(2026, 5, 1) / 1000 + h * 3600;
const iso = (h: number) => new Date(t(h) * 1000).toISOString();
const route: RouteLeg[] = [
  { mode: "CAR", points: [[60, 5, t(10)], [60.5, 5.5, t(11)]] },
  { mode: "BOAT", points: [[61, 6, t(14)], [61.5, 6.5, t(15)]] },
  { mode: "WALK", points: [[62, 7, t(16)], [62.1, 7.1, t(17)]] },
];

const stop = (hours: number[], waypoint?: "start" | "end"): TourStop => ({
  center: [0, 0],
  bounds: [[0, 0], [0, 0]],
  assets: hours.map((h) => ({ id: String(h), takenAt: iso(h) }) as TimelineAsset),
  waypoint,
});

describe("route", () => {
  it("lists each means of transport once for the legend", () => {
    expect(routeModes(route).map((m) => m.label)).toEqual(["Auto", "Schiff", "zu Fuß"]);
    expect(routeModes([{ mode: "SPACESHIP", points: [] }])[0]!.label).toBe("Unterwegs");
  });

  it("takes the points between two moments across legs", () => {
    expect(routeBetween(route, t(10.5), t(14.5))).toEqual([
      [60.5, 5.5],
      [61, 6],
    ]);
  });

  it("finds the way between consecutive stops with photos only", () => {
    const stops = [stop([], "start"), stop([9, 10]), stop([13, 15.5]), stop([], "end")];
    const legs = stopLegs(stops, route);
    expect(legs[0]).toBeNull();
    expect(legs[1]).toBeNull();
    expect(legs[2]).toEqual([
      [60, 5],
      [60.5, 5.5],
    ]);
    expect(legs[3]).toBeNull();
    expect(stopLegs(stops, null).every((l) => l === null)).toBe(true);
  });

  it("follows the path forwards to the point nearest to the map center", () => {
    const path: [number, number][] = [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 1.1],
    ];
    expect(nearestAhead(path, [0, 1.08])).toBe(3);
    expect(nearestAhead(path, [0, 0.9], 0)).toBe(1);
    expect(nearestAhead(path, [0, 0], 2)).toBe(3);
  });
});
