import { describe, expect, it } from "bun:test";
import { playgroundFallback } from "./playground-fallback";

describe("playground fallback", () => {
  it("does not fabricate generated files when the live build is unavailable", () => {
    expect(Array.isArray(playgroundFallback.files)).toBe(true);
    for (const file of playgroundFallback.files) {
      expect(typeof file.path).toBe("string");
      expect(typeof file.content).toBe("string");
    }
  });
});
