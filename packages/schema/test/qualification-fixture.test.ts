import { expect, test } from "vitest";
import { isNonNegative, isPositive } from "./qualification-fixture";

test("kills a boundary mutation", () => {
  expect(isPositive(0)).toBe(false);
});

test("covers a surviving mutation without asserting its boundary", () => {
  expect(isNonNegative(1)).toBe(true);
});

test("keeps the fixture's no-coverage function out of the suite", () => {
  expect(true).toBe(true);
});
