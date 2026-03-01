import { describe, expect, it } from "vitest";
import { advancePlaybackIndex, stepIndex } from "../../src/lib/playback/playbackEngine";
import type { FlightPoint } from "../../src/types/flight";

function createPoint(index: number, timestampMs: number): FlightPoint {
  return {
    index,
    timestampMs,
    date: "2026-02-13",
    time: "14:09:28.000",
    lat: 0,
    lon: 0,
    alt1: 0,
    alt2: 0,
    speedKmh: 0,
    voltageV: 0,
    currentA: 0,
    raw: {}
  };
}

describe("playbackEngine", () => {
  it("steps index with boundary clamp", () => {
    expect(stepIndex(0, -1, 10)).toBe(0);
    expect(stepIndex(5, 2, 10)).toBe(7);
    expect(stepIndex(9, 1, 10)).toBe(9);
  });

  it("advances index by elapsed timestamp", () => {
    const points = [createPoint(0, 0), createPoint(1, 500), createPoint(2, 1000), createPoint(3, 1500)];
    expect(advancePlaybackIndex(points, 0, 510, 1)).toBe(1);
    expect(advancePlaybackIndex(points, 1, 500, 2)).toBe(3);
  });
});
