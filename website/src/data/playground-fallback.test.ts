import { describe, expect, it } from "bun:test";
import { playgroundFallback } from "./playground-fallback";

describe("playground fallback", () => {
  it("does not fabricate generated files when the live build is unavailable", () => {
    expect(playgroundFallback.files).toEqual([]);
  });
});
