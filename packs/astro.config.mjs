import { defineConfig, passthroughImageService } from "astro/config";

export default defineConfig({
  site: "https://packs.atlante.sh",
  trailingSlash: "never",
  // Inline all CSS: the stylesheets are tiny, and every render-blocking
  // request adds a full roundtrip before first paint.
  build: { format: "file", inlineStylesheets: "always" },
  image: { service: passthroughImageService() },
  redirects: { "/packs": "/" },
});
