import { describe, expect, it } from "vitest";
import { parseGps } from "../../src/lib/csv/parseGps";

describe("parseGps", () => {
  it("parses lat/lon with whitespace", () => {
    const result = parseGps("31.984715 120.309828");
    expect(result).toEqual({ lat: 31.984715, lon: 120.309828 });
  });

  it("returns null for invalid input", () => {
    expect(parseGps("")).toBeNull();
    expect(parseGps("abc 1")).toBeNull();
    expect(parseGps("91 120")).toBeNull();
  });
});
