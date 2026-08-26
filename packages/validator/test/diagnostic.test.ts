import { describe, expect, test } from "vitest";
import {
  error,
  escapeJsonPointerSegment,
  formatDiagnostic,
  hasErrors,
  sortDiagnostics,
  warning,
} from "../src/index.js";

describe("diagnostics", () => {
  test("escapes JSON Pointer segments", () => {
    expect(escapeJsonPointerSegment("a~/b")).toBe("a~0~1b");
  });

  test("formats diagnostics with optional source, location, and pointer", () => {
    expect(
      formatDiagnostic(
        error("invalid", "bad", {
          source: "config.jsonc",
          location: { line: 2, column: 3 },
          path: "/agents/reviewer",
        }),
      ),
    ).toBe("error [invalid]: bad\nat: config.jsonc:2:3 /agents/reviewer");
    expect(formatDiagnostic(warning("notice", "fine", { pointer: "/x" }))).toBe(
      "warning [notice]: fine\nat: /x",
    );
    expect(formatDiagnostic(error("plain", "message"))).toBe(
      "error [plain]: message",
    );
  });

  test("prefers the canonical path over the compatibility pointer", () => {
    expect(
      formatDiagnostic(
        error("invalid", "bad", {
          path: "/canonical",
          pointer: "/legacy",
        }),
      ),
    ).toBe("error [invalid]: bad\nat: /canonical");
  });

  test("detects errors and sorts by stable diagnostic identity", () => {
    const diagnostics = [
      warning("z", "later", { source: "b", path: "/z" }),
      error("a", "first", { source: "a", path: "/a" }),
      warning("a", "same source", { source: "a", path: "/a" }),
    ];

    expect(hasErrors(diagnostics)).toBe(true);
    expect(sortDiagnostics(diagnostics)).toEqual([
      diagnostics[1],
      diagnostics[2],
      diagnostics[0],
    ]);
    expect(hasErrors([warning("notice", "fine")])).toBe(false);
  });

  test("sorts pointer-only diagnostics after path-bearing diagnostics", () => {
    const pathDiagnostic = warning("same", "message", { path: "/a" });
    const pointerDiagnostic = warning("same", "message", {
      pointer: "/b",
    });

    expect(sortDiagnostics([pointerDiagnostic, pathDiagnostic])).toEqual([
      pathDiagnostic,
      pointerDiagnostic,
    ]);
  });

  test("orders diagnostics by location before code and message", () => {
    const laterLine = error("a", "same", {
      source: "config.jsonc",
      path: "/value",
      location: { line: 3, column: 1 },
    });
    const laterColumn = error("a", "same", {
      source: "config.jsonc",
      path: "/value",
      location: { line: 2, column: 4 },
    });
    const earlier = error("z", "same", {
      source: "config.jsonc",
      path: "/value",
      location: { line: 2, column: 3 },
    });

    expect(sortDiagnostics([laterLine, laterColumn, earlier])).toEqual([
      earlier,
      laterColumn,
      laterLine,
    ]);
  });

  test("sorts missing source and location before authored metadata", () => {
    const authored = warning("a", "authored", {
      source: "config.jsonc",
      path: "/value",
      location: { line: 1, column: 1 },
    });
    const sourceOnly = warning("z", "source", { source: "config.jsonc" });
    const plain = warning("z", "plain");

    expect(sortDiagnostics([authored, sourceOnly, plain])).toEqual([
      plain,
      sourceOnly,
      authored,
    ]);
  });
});
