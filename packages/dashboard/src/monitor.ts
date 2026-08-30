import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { projectArtifacts } from "./artifacts.js";
import { loadDashboardBrandAssets } from "./brand-assets.js";
import { createEmptySnapshot } from "./model.js";
import { createOpenCodeSource, OpenCodeObserver } from "./opencode.js";
import {
  type DashboardAsset,
  type DashboardAssets,
  startDashboardServer,
} from "./server.js";
import { DashboardStore } from "./store.js";
import { DASHBOARD_ASSET_PATHS } from "./web/assets.js";

export type DashboardMonitorOptions = {
  projectRoot: string;
  opencodeUrl: string;
  port: number;
};

export type DashboardMonitorHandle = {
  address: { host: string; port: number };
  url: string;
  lifetime: Promise<void>;
  close(): Promise<void>;
};

export type DashboardMonitorDependencies = {
  buildClient?: () => Promise<string>;
};

async function buildDashboardClient(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [fileURLToPath(new URL("./web/client.ts", import.meta.url))],
    target: "browser",
  });
  if (!result.success) throw new Error(result.logs.join("\n"));
  const output = result.outputs[0];
  if (!output) throw new Error("Dashboard browser bundle is empty");
  return output.text();
}

async function dashboardAssets(
  buildClient: () => Promise<string>,
): Promise<DashboardAssets> {
  const [shell, styles, script] = await Promise.all([
    readFile(new URL("./web/index.html", import.meta.url), "utf8"),
    readFile(new URL("./web/styles.css", import.meta.url), "utf8"),
    buildClient(),
  ]);
  const assets: Record<string, DashboardAsset> = {
    ...loadDashboardBrandAssets(),
    [DASHBOARD_ASSET_PATHS.script]: {
      body: script,
      contentType: "text/javascript; charset=utf-8",
    },
    [DASHBOARD_ASSET_PATHS.styles]: {
      body: styles,
      contentType: "text/css; charset=utf-8",
    },
  };
  return { shell, assets };
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolvePromise = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise() };
}

export async function startDashboardMonitor(
  options: DashboardMonitorOptions,
  dependencies: DashboardMonitorDependencies = {},
): Promise<DashboardMonitorHandle> {
  const projectRoot = resolve(options.projectRoot);
  const artifacts = projectArtifacts(projectRoot);
  const store = new DashboardStore(
    createEmptySnapshot({
      name: basename(projectRoot) || "project",
      artifacts: artifacts.status,
      agents: artifacts.agents,
      skills: artifacts.skills,
    }),
    { projectRoot },
  );
  const assets = await dashboardAssets(
    dependencies.buildClient ?? buildDashboardClient,
  );
  const observer = new OpenCodeObserver({
    projectRoot,
    store,
    source: createOpenCodeSource({ baseUrl: options.opencodeUrl }),
  });
  const server = await startDashboardServer({
    store,
    assets,
    port: options.port,
  });
  const finished = deferred();
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closePromise !== undefined) return closePromise;
    closePromise = (async () => {
      try {
        await observer.close();
      } finally {
        await server.close();
        finished.resolve();
      }
    })();
    return closePromise;
  };

  void observer.start().catch(() => {
    void close();
  });

  return {
    address: server.address,
    url: server.url,
    lifetime: finished.promise,
    close,
  };
}
