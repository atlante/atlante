import {
  type DashboardMonitorHandle,
  type DashboardMonitorOptions,
  startDashboardMonitor,
} from "@atlante/dashboard";
import { type Command, InvalidArgumentError } from "commander";

const DEFAULT_OPENCODE_URL = "http://127.0.0.1:4096";
const DEFAULT_DASHBOARD_PORT = 0;
export type DashboardSignal = "SIGINT" | "SIGTERM";
export type DashboardSignalHandler = () => void;
export type DashboardStartup = (
  options: DashboardMonitorOptions,
) => Promise<DashboardMonitorHandle>;

export type DashboardCommandDependencies = {
  start?: DashboardStartup;
  print?: (url: string) => void;
  onSignal?: (
    signal: DashboardSignal,
    handler: DashboardSignalHandler,
  ) => () => void;
};

function parseOpenCodeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error();
    }
  } catch {
    throw new InvalidArgumentError("must be a valid HTTP(S) URL");
  }
  return value;
}

function parsePort(value: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new InvalidArgumentError("must be an integer from 0 to 65535");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new InvalidArgumentError("must be an integer from 0 to 65535");
  }
  return port;
}

function processSignal(
  signal: DashboardSignal,
  handler: DashboardSignalHandler,
): () => void {
  process.once(signal, handler);
  return () => process.removeListener(signal, handler);
}

export function registerDashboard(
  program: Command,
  dependencies: DashboardCommandDependencies = {},
): void {
  const start = dependencies.start ?? startDashboardMonitor;
  const print = dependencies.print ?? console.log;
  const onSignal = dependencies.onSignal ?? processSignal;

  program
    .command("dashboard")
    .argument(
      "[project-directory]",
      "project directory to monitor",
      process.cwd(),
    )
    .option(
      "--opencode-url <url>",
      "OpenCode HTTP(S) URL",
      parseOpenCodeUrl,
      DEFAULT_OPENCODE_URL,
    )
    .option(
      "--port <port>",
      "loopback port from 0 to 65535",
      parsePort,
      DEFAULT_DASHBOARD_PORT,
    )
    .description("start the local OpenCode dashboard")
    .action(
      async (
        projectRoot: string,
        options: { opencodeUrl: string; port: number },
      ) => {
        const monitor = await start({
          projectRoot,
          opencodeUrl: options.opencodeUrl,
          port: options.port,
        });
        print(monitor.url);

        let cleanupPromise: Promise<void> | undefined;
        const cleanup = (): Promise<void> => {
          if (cleanupPromise !== undefined) return cleanupPromise;
          cleanupPromise = monitor.close();
          return cleanupPromise;
        };
        const removals = (["SIGINT", "SIGTERM"] as const).map((signal) =>
          onSignal(signal, () => {
            void cleanup();
          }),
        );

        try {
          await monitor.lifetime;
        } finally {
          await cleanup();
          for (const remove of removals) remove();
        }
      },
    );
}
