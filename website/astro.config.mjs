import { defineConfig, passthroughImageService } from "astro/config";

// Dev-only companion to the Vercel function in api/playground.ts: serves
// POST /api/playground in-process so `bun run dev` runs the real CLI.
function playgroundDevApi() {
  return {
    name: "playground-dev-api",
    configureServer(server) {
      server.middlewares.use("/api/playground", (req, res) => {
        void (async () => {
          const send = (status, payload) => {
            res.statusCode = status;
            res.setHeader(
              "content-type",
              "application/json; charset=utf-8",
            );
            res.end(JSON.stringify(payload));
          };
          if (req.method !== "POST") {
            send(405, { error: "method not allowed" });
            return;
          }
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          try {
            const { parsePlaygroundRequest, runPlaygroundStep } =
              await server.ssrLoadModule("/api/_lib/playground.ts");
            const { consumeSessionBuild } = await server.ssrLoadModule(
              "/api/_lib/session-budget.ts",
            );
            const parsed = parsePlaygroundRequest(
              JSON.parse(Buffer.concat(chunks).toString("utf8")),
            );
            if (!consumeSessionBuild(parsed.sessionId).allowed) {
              send(429, { error: "playground session build limit reached" });
              return;
            }
            send(200, await runPlaygroundStep(parsed));
          } catch (error) {
            send(400, {
              error:
                error instanceof Error ? error.message : "playground failure",
            });
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
