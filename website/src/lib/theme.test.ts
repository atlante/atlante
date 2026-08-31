import { describe, expect, it } from "vitest";
import {
  createThemeController,
  getInitialTheme,
  type ThemeDocument,
} from "./theme";

function createDocument() {
  const controls = [
    {
      attributes: new Map<string, string>(),
      listeners: new Map<string, () => void>(),
      setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
      },
      addEventListener(name: string, listener: () => void) {
        this.listeners.set(name, listener);
      },
    },
    {
      attributes: new Map<string, string>(),
      listeners: new Map<string, () => void>(),
      setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
      },
      addEventListener(name: string, listener: () => void) {
        this.listeners.set(name, listener);
      },
    },
  ];
  const meta = { content: "" };
  const document: ThemeDocument = {
    documentElement: { dataset: {} },
    querySelectorAll: () => controls,
    querySelector: () => meta,
  };
  return { document, controls, meta };
}

describe("theme synchronization", () => {
  it("chooses one initial state from persistence or system preference", () => {
    expect(getInitialTheme("dark", false)).toBe("dark");
    expect(getInitialTheme(null, true)).toBe("dark");
    expect(getInitialTheme(null, false)).toBe("light");

    const { document } = createDocument();
    const storage = {
      getItem: () => "dark",
      setItem: () => {},
    };
    expect(createThemeController(document, storage, null).initialize()).toBe(
      "dark",
    );
  });

  it("keeps both controls, persistence, labels, and theme color in sync", () => {
    const { document, controls, meta } = createDocument();
    const storage = {
      values: new Map<string, string>(),
      getItem(key: string) {
        return this.values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        this.values.set(key, value);
      },
    };
    const controller = createThemeController(document, storage, "light");

    expect(controller.initialize()).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(
      controls.every(
        (control) =>
          control.attributes.get("aria-label") === "Switch to the dark theme",
      ),
    ).toBe(true);
    expect(meta.content).toBe("#F4ECE4");

    controller.bind();
    controls[0].listeners.get("click")?.();
    expect(controller.theme).toBe("dark");
    controls[1].listeners.get("click")?.();
    expect(controller.toggle()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(storage.values.get("atlante-theme")).toBe("dark");
    expect(
      controls.every(
        (control) =>
          control.attributes.get("aria-label") === "Switch to the light theme",
      ),
    ).toBe(true);
    expect(meta.content).toBe("#112135");
  });
});
