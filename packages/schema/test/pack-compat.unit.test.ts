import { describe, expect, test } from "bun:test";
import { isPackHostCompatible } from "../src/eval.js";

// Issue #207 Task 5: pack `host` is compatibility metadata, project `host`
// is execution policy. Neutral suites run under either host; a declared
// host runs only under the matching project host.
describe("isPackHostCompatible", () => {
  test("host-neutral suites run under either host", () => {
    expect(isPackHostCompatible(undefined, "opencode")).toBe(true);
    expect(isPackHostCompatible(undefined, "claude-code")).toBe(true);
  });

  test("declared hosts match only themselves", () => {
    expect(isPackHostCompatible("opencode", "opencode")).toBe(true);
    expect(isPackHostCompatible("claude-code", "claude-code")).toBe(true);
  });

  test("mismatched hosts are incompatible", () => {
    expect(isPackHostCompatible("opencode", "claude-code")).toBe(false);
    expect(isPackHostCompatible("claude-code", "opencode")).toBe(false);
  });
});
