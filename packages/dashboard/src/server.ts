import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { DashboardSnapshot } from "./model.js";
import { DASHBOARD_FONT_PATHS } from "./web/assets.js";

const LOOPBACK_HOST = "127.0.0.1";
const AUTH_COOKIE = "atlante_dashboard_auth";
const DEFAULT_KEEP_ALIVE_MS = 15_000;
const MAX_KEEP_ALIVE_MS = 60_000;

export type DashboardAsset = {
  body: string | Uint8Array;
  contentType: string;
};

export type DashboardAssets = {
  shell: string;
  assets?: Readonly<Record<string, DashboardAsset>>;
};

export type DashboardAssetProvider = () => DashboardAssets;

export type DashboardServerStore = {
  getSnapshot(): DashboardSnapshot;
  subscribe(subscriber: (snapshot: DashboardSnapshot) => void): () => void;
  close(): void;
};

export type DashboardServerOptions = {
  store: DashboardServerStore;
  assets: DashboardAssets | DashboardAssetProvider;
  port?: number;
  keepAliveMs?: number;
};

export type DashboardServerHandle = {
  server: ReturnType<typeof createServer>;
  address: { host: string; port: number };
  url: string;
  close(): Promise<void>;
};

type SseClient = {
  response: ServerResponse;
};

type DashboardRoute =
  | { kind: "shell" }
  | { kind: "snapshot" }
  | { kind: "events" }
  | { kind: "asset"; asset?: DashboardAsset };

type RequestContext = {
  port: number;
  token: string;
  assets: ReadonlyMap<string, DashboardAsset>;
  shell: string;
  store: DashboardServerStore;
  clients: Set<SseClient>;
  closing: boolean;
  removeClient: (client: SseClient) => void;
  sendSnapshot: (client: SseClient, snapshot: DashboardSnapshot) => void;
};

function keepAliveInterval(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_KEEP_ALIVE_MS;
  }
  return Math.max(1, Math.min(MAX_KEEP_ALIVE_MS, Math.trunc(value)));
}

function isLoopbackAddress(address: string | undefined): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function allowedHost(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  const portSuffix = port === 80 ? "" : `:${port}`;
  return (
    host === `${LOOPBACK_HOST}${portSuffix}` ||
    host === `localhost${portSuffix}` ||
    host === `[::1]${portSuffix}`
  );
}

function isSameOriginRequest(request: IncomingMessage, port: number): boolean {
  if (!isLoopbackAddress(request.socket.remoteAddress)) return false;
  const host = request.headers.host;
  if (!allowedHost(host, port)) return false;

  const origin = request.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) return false;

  const fetchSite = request.headers["sec-fetch-site"];
  if (
    fetchSite !== undefined &&
    fetchSite !== "same-origin" &&
    fetchSite !== "none"
  ) {
    return false;
  }
  return true;
}

function requestPath(request: IncomingMessage):
  | {
      pathname: string;
      hasQuery: boolean;
    }
  | undefined {
  const rawPath = (request.url ?? "").split(/[?#]/, 1)[0] ?? "";
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return undefined;
  }
  if (
    decodedPath.includes("\0") ||
    decodedPath.includes("\\") ||
    decodedPath
      .split("/")
      .some((segment) => segment === "." || segment === "..")
  ) {
    return undefined;
  }
  try {
    const parsed = new URL(request.url ?? "", "http://127.0.0.1");
    return { pathname: parsed.pathname, hasQuery: parsed.search.length > 0 };
  } catch {
    return undefined;
  }
}

function writeText(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(body);
}

function unauthorized(response: ServerResponse): void {
  writeText(response, 401, "text/plain; charset=utf-8", "Unauthorized", {
    "Cache-Control": "no-store",
  });
}

function notFound(response: ServerResponse): void {
  writeText(response, 404, "text/plain; charset=utf-8", "Not found");
}

function forbidden(response: ServerResponse): void {
  writeText(response, 403, "text/plain; charset=utf-8", "Forbidden");
}

function methodNotAllowed(response: ServerResponse): void {
  writeText(response, 405, "text/plain; charset=utf-8", "Method not allowed", {
    Allow: "GET",
  });
}

function cookieValue(request: IncomingMessage): string | undefined {
  const header = request.headers.cookie;
  if (header === undefined) return undefined;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    const name = item.slice(0, separator).trim();
    if (name === AUTH_COOKIE) return item.slice(separator + 1).trim();
  }
  return undefined;
}

function matchesToken(candidate: string | undefined, token: string): boolean {
  const expected = Buffer.from(token, "utf8");
  const received = Buffer.from(candidate ?? "", "utf8");
  const comparable = Buffer.alloc(expected.length);
  received.copy(comparable, 0, 0, expected.length);
  return (
    timingSafeEqual(expected, comparable) && received.length === expected.length
  );
}

function isAssetRoute(pathname: string): boolean {
  if (
    DASHBOARD_FONT_PATHS.includes(
      pathname as (typeof DASHBOARD_FONT_PATHS)[number],
    )
  ) {
    return true;
  }
  if (!pathname.startsWith("/assets/") || pathname.includes("\\")) {
    return false;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (decoded !== pathname || decoded.includes("\0")) return false;
  return pathname
    .slice("/assets/".length)
    .split("/")
    .every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );
}

function resolveAssets(input: DashboardAssets | DashboardAssetProvider): {
  shell: string;
  assets: ReadonlyMap<string, DashboardAsset>;
} {
  const resolved = typeof input === "function" ? input() : input;
  const assets = new Map<string, DashboardAsset>();
  for (const [path, asset] of Object.entries(resolved.assets ?? {})) {
    if (isAssetRoute(path)) assets.set(path, asset);
  }
  return { shell: resolved.shell, assets };
}

function snapshotFrame(snapshot: DashboardSnapshot): string {
  return `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
}

function serverPort(server: ReturnType<typeof createServer>): number {
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
}

function routeFor(
  pathname: string,
  assets: ReadonlyMap<string, DashboardAsset>,
): DashboardRoute | undefined {
  if (pathname === "/") return { kind: "shell" };
  if (pathname === "/api/snapshot") return { kind: "snapshot" };
  if (pathname === "/api/events") return { kind: "events" };
  const asset = assets.get(pathname);
  if (asset !== undefined || isAssetRoute(pathname)) {
    return { kind: "asset", asset };
  }
  return undefined;
}

function requiresAuthentication(route: DashboardRoute): boolean {
  return route.kind === "snapshot" || route.kind === "events";
}

function isAuthorized(
  request: IncomingMessage,
  route: DashboardRoute,
  parsed: { hasQuery: boolean },
  token: string,
): boolean {
  return (
    !requiresAuthentication(route) ||
    (!parsed.hasQuery && matchesToken(cookieValue(request), token))
  );
}

function serveShell(response: ServerResponse, context: RequestContext): void {
  writeText(response, 200, "text/html; charset=utf-8", context.shell, {
    "Cache-Control": "no-store",
    "Set-Cookie": `${AUTH_COOKIE}=${context.token}; HttpOnly; SameSite=Strict; Path=/`,
  });
}

function serveSnapshot(
  response: ServerResponse,
  context: RequestContext,
): void {
  writeText(
    response,
    200,
    "application/json; charset=utf-8",
    JSON.stringify(context.store.getSnapshot()),
    { "Cache-Control": "no-store" },
  );
}

function serveEvents(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Content-Type-Options": "nosniff",
  });
  const client: SseClient = { response };
  const remove = () => context.removeClient(client);
  response.on("close", remove);
  response.on("error", remove);
  request.on("aborted", remove);
  context.clients.add(client);
  context.sendSnapshot(client, context.store.getSnapshot());
}

function serveAsset(
  response: ServerResponse,
  asset: DashboardAsset | undefined,
): void {
  if (asset === undefined) {
    notFound(response);
    return;
  }
  response.writeHead(200, {
    "Content-Type": asset.contentType,
    "X-Content-Type-Options": "nosniff",
  });
  response.end(asset.body);
}

function serveRoute(
  request: IncomingMessage,
  response: ServerResponse,
  route: DashboardRoute,
  context: RequestContext,
): void {
  if (route.kind === "shell") {
    serveShell(response, context);
    return;
  }
  if (route.kind === "snapshot") {
    serveSnapshot(response, context);
    return;
  }
  if (route.kind === "events") {
    serveEvents(request, response, context);
    return;
  }
  serveAsset(response, route.asset);
}

function handleDashboardRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): void {
  if (!isSameOriginRequest(request, context.port)) {
    forbidden(response);
    return;
  }
  const parsed = requestPath(request);
  if (parsed === undefined) {
    notFound(response);
    return;
  }
  const route = routeFor(parsed.pathname, context.assets);
  if (route === undefined) {
    notFound(response);
    return;
  }
  if (request.method !== "GET") {
    methodNotAllowed(response);
    return;
  }
  if (!isAuthorized(request, route, parsed, context.token)) {
    unauthorized(response);
    return;
  }
  serveRoute(request, response, route, context);
}

export async function startDashboardServer(
  options: DashboardServerOptions,
): Promise<DashboardServerHandle> {
  const resolvedAssets = resolveAssets(options.assets);
  const token = randomBytes(32).toString("hex");
  const clients = new Set<SseClient>();
  let closing = false;
  let keepAliveTimer: ReturnType<typeof setInterval> | undefined;

  const removeClient = (client: SseClient): void => {
    if (!clients.delete(client)) return;
  };

  const sendSnapshot = (
    client: SseClient,
    snapshot: DashboardSnapshot,
  ): void => {
    if (closing || client.response.destroyed || client.response.writableEnded) {
      return;
    }
    try {
      client.response.write(snapshotFrame(snapshot));
    } catch {
      removeClient(client);
      client.response.destroy();
    }
  };

  const broadcast = (snapshot: DashboardSnapshot): void => {
    if (closing) return;
    for (const client of clients) sendSnapshot(client, snapshot);
  };

  const storeUnsubscribe = options.store.subscribe(broadcast);
  const httpServer = createServer((request, response) => {
    handleDashboardRequest(request, response, {
      port: serverPort(httpServer),
      token,
      assets: resolvedAssets.assets,
      shell: resolvedAssets.shell,
      store: options.store,
      clients,
      closing,
      removeClient,
      sendSnapshot,
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        httpServer.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        httpServer.off("error", onError);
        resolve();
      };
      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      httpServer.listen(options.port ?? 0, LOOPBACK_HOST);
    });
  } catch (error) {
    storeUnsubscribe();
    throw error;
  }

  const address = httpServer.address();
  if (typeof address !== "object" || address === null) {
    storeUnsubscribe();
    httpServer.close();
    throw new Error("Dashboard server did not expose a loopback address");
  }
  const port = address.port;
  const interval = keepAliveInterval(options.keepAliveMs);
  keepAliveTimer = setInterval(() => {
    if (closing) return;
    for (const client of clients) {
      if (client.response.destroyed || client.response.writableEnded) {
        removeClient(client);
        continue;
      }
      try {
        client.response.write(": keepalive\n\n");
      } catch {
        removeClient(client);
        client.response.destroy();
      }
    }
  }, interval);
  if (typeof keepAliveTimer === "object" && "unref" in keepAliveTimer) {
    keepAliveTimer.unref();
  }

  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closePromise !== undefined) return closePromise;
    closing = true;
    if (keepAliveTimer !== undefined) clearInterval(keepAliveTimer);
    keepAliveTimer = undefined;
    options.store.close();
    storeUnsubscribe();
    for (const client of clients) {
      removeClient(client);
      client.response.end();
    }
    clients.clear();
    closePromise = new Promise<void>((resolve) => {
      if (!httpServer.listening) {
        resolve();
        return;
      }
      httpServer.close(() => resolve());
    });
    return closePromise;
  };

  return {
    server: httpServer,
    address: { host: LOOPBACK_HOST, port },
    url: `http://${LOOPBACK_HOST}:${port}`,
    close,
  };
}
