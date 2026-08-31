export type Theme = "light" | "dark";

export interface ThemeControl {
  setAttribute(name: string, value: string): void;
  addEventListener?(type: string, listener: () => void): void;
}

export interface ThemeMeta {
  content: string;
}

export interface ThemeDocument {
  documentElement: { dataset: Record<string, string | undefined> };
  querySelectorAll(selector: string): Iterable<ThemeControl>;
  querySelector(selector: string): ThemeMeta | null;
}

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const THEME_STORAGE_KEY = "atlante-theme";

export function getInitialTheme(
  storedTheme: string | null,
  prefersDark: boolean,
): Theme {
  if (storedTheme === "dark" || storedTheme === "light") return storedTheme;
  return prefersDark ? "dark" : "light";
}

function syncTheme(document: ThemeDocument, theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const label =
    theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme";
  for (const control of document.querySelectorAll(
    "[data-theme-toggle], [data-theme-toggle-footer]",
  )) {
    control.setAttribute("aria-label", label);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#112135" : "#F4ECE4";
}

export function createThemeController(
  document: ThemeDocument,
  storage: ThemeStorage | null,
  initialTheme: Theme | null,
  prefersDark = false,
) {
  let theme =
    initialTheme ??
    getInitialTheme(
      (() => {
        try {
          return storage?.getItem(THEME_STORAGE_KEY) ?? null;
        } catch {
          return null;
        }
      })(),
      prefersDark,
    );

  const toggle = (): Theme => {
    theme = theme === "dark" ? "light" : "dark";
    syncTheme(document, theme);
    try {
      storage?.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage is optional; the theme still applies for this page load.
    }
    return theme;
  };

  return {
    get theme(): Theme {
      return theme;
    },
    initialize(): Theme {
      syncTheme(document, theme);
      return theme;
    },
    toggle,
    bind(): void {
      for (const control of document.querySelectorAll(
        "[data-theme-toggle], [data-theme-toggle-footer]",
      )) {
        control.addEventListener?.("click", toggle);
      }
    },
  };
}
