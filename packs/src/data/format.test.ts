import { describe, expect, it } from "bun:test";
import {
  formatCount,
  formatDate,
  formatEvaluationCost,
  formatEvaluationDuration,
  formatEvaluationTokens,
  formatPassRate,
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

  it("renders missing metrics as zero", () => {
    expect(formatCount(null)).toBe("0");
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

describe("formatPassRate", () => {
  it("formats evaluated scenario rates as whole percentages", () => {
    expect(formatPassRate(1)).toBe("100%");
    expect(formatPassRate(0.5)).toBe("50%");
    expect(formatPassRate(1 / 3)).toBe("33%");
  });
});

describe("evaluation formatters", () => {
  it("formats mean durations and token counts for scenario results", () => {
    expect(formatEvaluationDuration(850)).toBe("850ms");
    expect(formatEvaluationDuration(69_830)).toBe("69.8s");
    expect(formatEvaluationTokens(45_409)).toBe("45.4k");
    expect(formatEvaluationTokens(null)).toBe("Not reported");
  });

  it("distinguishes included, reported, and unavailable costs", () => {
    expect(formatEvaluationCost(0)).toBe("Included");
    expect(formatEvaluationCost(0.001)).toBe("$0.0010");
    expect(formatEvaluationCost(1.2)).toBe("$1.20");
    expect(formatEvaluationCost(null)).toBe("Not reported");
  });
});
