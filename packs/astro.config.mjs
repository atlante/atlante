import { defineConfig, passthroughImageService } from "astro/config";

export default defineConfig({
  site: "https://packs.atlante.sh",
  trailingSlash: "never",
  build: { format: "file" },
  image: { service: passthroughImageService() },
  redirects: { "/packs": "/" },
});
