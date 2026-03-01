import { describe, expect, it } from "vitest";
import { haversineDistanceMeters } from "../../src/lib/math/geoToLocal";
import { wgs84ToGcj02 } from "../../src/lib/math/coordTransform";

describe("wgs84ToGcj02", () => {
  it("keeps coordinates unchanged outside China", () => {
    const original = { lon: -122.4194, lat: 37.7749 };
    const converted = wgs84ToGcj02(original.lon, original.lat);

    expect(converted.lon).toBeCloseTo(original.lon, 8);
    expect(converted.lat).toBeCloseTo(original.lat, 8);
  });

  it("applies expected offset in China", () => {
    const original = { lon: 120.309828, lat: 31.984715 };
    const converted = wgs84ToGcj02(original.lon, original.lat);
    const shiftMeters = haversineDistanceMeters(
      original.lat,
      original.lon,
      converted.lat,
      converted.lon
    );

    expect(shiftMeters).toBeGreaterThan(100);
    expect(shiftMeters).toBeLessThan(1000);
  });
});
