import { describe, expect, it } from "bun:test";
import {
  formatCount,
  formatDate,
  formatShortSyncTime,
  formatSyncTime,
} from "./format";

describe("formatCount", () => {
  it("formats large counts in k", () => {
    expect(formatCount(12840)).toBe("12.8k");
    expect(formatCount(9210)).toBe("9.21k");
    expect(formatCount(4880)).toBe("4.88k");
    expect(formatCount(2710)).toBe("2.71k");
    expect(formatCount(999)).toBe("999");
  });

  it("renders missing metrics as an em dash", () => {
    expect(formatCount(null)).toBe("—");
    expect(formatCount(0)).toBe("0");
  });
});

describe("formatDate", () => {
  it("formats ISO dates in UTC", () => {
    expect(formatDate("2026-09-09T22:31:00.000Z")).toBe("Sep 9, 2026");
    expect(formatDate(null)).toBe("—");
  });
});

describe("formatSyncTime", () => {
  it("labels the synchronization time with UTC", () => {
    expect(formatSyncTime("2026-09-10T14:32:00.000Z")).toBe(
      "Sep 10, 2026 at 14:32 UTC",
    );
  });
});

describe("formatShortSyncTime", () => {
  it("writes the numeric date first", () => {
    expect(formatShortSyncTime("2026-09-10T14:32:00.000Z")).toBe(
      "10/09/26 at 14:32 UTC",
    );
  });
});
