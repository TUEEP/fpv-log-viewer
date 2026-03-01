import { describe, expect, it } from "vitest";
import { normalizeHeaders } from "../../src/lib/csv/normalizeHeaders";

describe("normalizeHeaders", () => {
  it("adds index suffix for duplicate headers", () => {
    const headers = ["Date", "Alt(m)", "GPS", "Alt(m)", "Alt(m)"];
    const normalized = normalizeHeaders(headers);

    expect(normalized).toEqual(["Date", "Alt(m)", "GPS", "Alt(m)#2", "Alt(m)#3"]);
  });
});
