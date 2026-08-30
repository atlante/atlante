export const DASHBOARD_ASSET_PATHS = {
  shell: "/",
  script: "/assets/app.js",
  styles: "/assets/app.css",
  tokens: "/assets/atlante-tokens.css",
  fonts: {
    bodoniModa: "/fonts/bodonimoda/bodoni-moda-latin.woff2",
    sourceSerif: "/fonts/sourceserif4/source-serif-4-latin.woff2",
    sourceSans: "/fonts/sourcesans3/source-sans-3-latin.woff2",
    jetBrainsMono: "/fonts/jetbrainsmono/jetbrains-mono-latin.woff2",
  },
  snapshot: "/api/snapshot",
  events: "/api/events",
} as const;

export type DashboardFontPath =
  (typeof DASHBOARD_ASSET_PATHS.fonts)[keyof typeof DASHBOARD_ASSET_PATHS.fonts];

export type DashboardAssetPath =
  | Exclude<
      (typeof DASHBOARD_ASSET_PATHS)[keyof typeof DASHBOARD_ASSET_PATHS],
      (typeof DASHBOARD_ASSET_PATHS)["fonts"]
    >
  | DashboardFontPath;

export const DASHBOARD_FONT_PATHS: readonly DashboardFontPath[] = Object.values(
  DASHBOARD_ASSET_PATHS.fonts,
);
