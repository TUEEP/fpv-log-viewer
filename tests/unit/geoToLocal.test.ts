import { describe, expect, it } from "vitest";
import { toLocal3D } from "../../src/lib/math/geoToLocal";
import type { FlightPoint } from "../../src/types/flight";

const points: FlightPoint[] = [
  {
    index: 0,
    timestampMs: 0,
    date: "2026-02-13",
    time: "00:00:00.000",
    lat: 31.0,
    lon: 120.0,
    alt1: 10,
    alt2: 20,
    speedKmh: 0,
    voltageV: 0,
    currentA: 0,
    raw: {}
  },
  {
    index: 1,
    timestampMs: 500,
    date: "2026-02-13",
    time: "00:00:00.500",
    lat: 31.0001,
    lon: 120.0001,
    alt1: 15,
    alt2: 28,
    speedKmh: 0,
    voltageV: 0,
    currentA: 0,
    raw: {}
  }
];

describe("toLocal3D", () => {
  it("uses selected altitude mode and zScale", () => {
    const alt1Local = toLocal3D(points, "alt1", 2);
    const alt2Local = toLocal3D(points, "alt2", 2);

    expect(alt1Local[1].z).toBeCloseTo(10, 4);
    expect(alt2Local[1].z).toBeCloseTo(16, 4);
  });
});
