import { describe, expect, it } from "bun:test";
import { getScrollBehavior, isDocumentEnd } from "./scroll";

describe("generated file scrolling", () => {
  it("uses immediate scrolling when reduced motion is preferred", () => {
    expect(getScrollBehavior(true)).toBe("auto");
  });

  it("keeps smooth scrolling for normal motion", () => {
    expect(getScrollBehavior(false)).toBe("smooth");
  });

  it("recognizes the document-end boundary", () => {
    expect(isDocumentEnd(1200, 800, 2000)).toBe(true);
    expect(isDocumentEnd(1198.5, 800, 2000)).toBe(true);
    expect(isDocumentEnd(1190, 800, 2000)).toBe(false);
  });
});
