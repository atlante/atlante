import { describe, expect, test } from "bun:test";
import { createStyler } from "../src/style.js";

describe("createStyler", () => {
  test("styles text on an interactive stream", () => {
    const styler = createStyler({ isTTY: true }, {});
    expect(styler.error("oops")).toBe("\x1b[31moops\x1b[0m");
    expect(styler.warning("careful")).toBe("\x1b[33mcareful\x1b[0m");
    expect(styler.success("done")).toBe("\x1b[32mdone\x1b[0m");
    expect(styler.dim("detail")).toBe("\x1b[90mdetail\x1b[0m");
  });

  test("keeps plain text on a non-interactive stream", () => {
    const styler = createStyler({ isTTY: false }, {});
    expect(styler.error("oops")).toBe("oops");
    expect(styler.warning("careful")).toBe("careful");
    expect(styler.success("done")).toBe("done");
    expect(styler.dim("detail")).toBe("detail");
  });

  test("keeps plain text when NO_COLOR is set", () => {
    const styler = createStyler({ isTTY: true }, { NO_COLOR: "1" });
    expect(styler.error("oops")).toBe("oops");
    expect(styler.dim("detail")).toBe("detail");
  });

  test("an empty NO_COLOR value does not opt out (no-color.org)", () => {
    const styler = createStyler({ isTTY: true }, { NO_COLOR: "" });
    expect(styler.dim("detail")).toBe("\x1b[90mdetail\x1b[0m");
  });

  test("gates on the injected stream, not the process streams", () => {
    // Even with both process streams looking interactive, a styler built for
    // a non-TTY stream stays plain: each output stream is styled by its own
    // gate (stderr-bound diagnostics must not light up because stdout is a
    // TTY, or vice versa).
    const stdout = process.stdout as unknown as { isTTY?: boolean };
    const stderr = process.stderr as unknown as { isTTY?: boolean };
    const previous = [stdout.isTTY, stderr.isTTY];
    Object.defineProperty(stdout, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(stderr, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });
    try {
      const styler = createStyler({ isTTY: false }, {});
      expect(styler.error("oops")).toBe("oops");
      expect(styler.success("done")).toBe("done");
      expect(styler.dim("detail")).toBe("detail");
    } finally {
      if (previous[0] === undefined) delete stdout.isTTY;
      else stdout.isTTY = previous[0];
      if (previous[1] === undefined) delete stderr.isTTY;
      else stderr.isTTY = previous[1];
    }
  });
});
