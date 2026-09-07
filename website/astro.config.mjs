import { defineConfig, passthroughImageService } from "astro/config";

// Dev-only companion to the Vercel function in api/playground.ts: serves
// POST /api/playground in-process so `bun run dev` runs the real CLI.
function playgroundDevApi() {
  return {
    name: "playground-dev-api",
    configureServer(server) {
      server.middlewares.use("/api/playground", (req, res) => {
        void (async () => {
          try {
            const { default: playgroundHandler } = await server.ssrLoadModule(
              "/api/playground.ts",
            );
            await playgroundHandler(req, res);
          } catch (error) {
            if (res.headersSent) return;
            res.statusCode = 500;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({
                error:
                  error instanceof Error ? error.message : "playground failure",
              }),
            );
          }
        })();
      });
    },
  };
}

export default defineConfig({
  site: "https://atlante.sh",
  trailingSlash: "never",
  build: { format: "file" },
  image: { service: passthroughImageService() },
  vite: {
    plugins: [playgroundDevApi()],
  },
});
