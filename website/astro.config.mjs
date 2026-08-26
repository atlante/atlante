import { defineConfig, passthroughImageService } from "astro/config";

export default defineConfig({
  site: "https://atlante.sh",
  trailingSlash: "never",
  build: { format: "file" },
  image: { service: passthroughImageService() },
});
