import { request } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { loadDashboardBrandAssets } from "../src/brand-assets.js";
import { createEmptySnapshot } from "../src/model.js";
import { type DashboardAssets, startDashboardServer } from "../src/server.js";
import { DashboardStore } from "../src/store.js";
import { DASHBOARD_ASSET_PATHS } from "../src/web/assets.js";

const projectRoot = "/projects/demo";
const forbidden = {
  prompt: "FORBIDDEN_PROMPT_TEXT",
  response: "FORBIDDEN_RESPONSE_TEXT",
  tool: "FORBIDDEN_TOOL_ARGUMENT_TEXT",
  permission: "FORBIDDEN_PERMISSION_METADATA_TEXT",
};

const assets: DashboardAssets = {
  shell: '<!doctype html><script src="/assets/app.js"></script>',
  assets: {
    ...loadDashboardBrandAssets(),
    "/assets/app.js": {
      body: "console.log('dashboard');",
      contentType: "text/javascript; charset=utf-8",
    },
    "/assets/app.css": {
      body: "body { color: black; }",
      contentType: "text/css; charset=utf-8",
    },
  },
};

function createStore() {
  return new DashboardStore(createEmptySnapshot({ name: "demo" }), {
    projectRoot,
  });
}

function httpRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = request(url, options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function cookieFrom(response: {
  headers: Record<string, string | string[] | undefined>;
}) {
  const setCookie = response.headers["set-cookie"];
  expect(setCookie).toBeDefined();
  return (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(
    ";",
    1,
  )[0];
}

async function shellAndCookie(url: string) {
  const shell = await httpRequest(url);
  const cookie = cookieFrom(shell);
  expect(cookie).toBeDefined();
  return { shell, cookie: cookie as string };
}

describe("dashboard loopback server", () => {
  const handles: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(handles.splice(0).map((handle) => handle.close()));
  });

  test("serves a tokenless shell, issues a strict HttpOnly cookie, and serves allowlisted assets", async () => {
    const store = createStore();
    const handle = await startDashboardServer({ store, assets, port: 0 });
    handles.push(handle);

    const { shell, cookie } = await shellAndCookie(handle.url);
    const asset = await httpRequest(`${handle.url}/assets/app.js`);
    const font = await httpRequest(
      `${handle.url}/fonts/bodonimoda/bodoni-moda-latin.woff2`,
    );

    expect(shell.status).toBe(200);
    expect(shell.headers["cache-control"]).toBe("no-store");
    expect(shell.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(shell.headers["set-cookie"]?.toString()).toMatch(
      /HttpOnly; SameSite=Strict; Path=\/$/,
    );
    expect(shell.body).toBe(assets.shell);
    expect(shell.body).not.toContain(cookie.split("=", 2)[1] as string);
    expect(handle.url).not.toContain(cookie.split("=", 2)[1] as string);
    expect(asset).toMatchObject({
      status: 200,
      body: assets.assets?.["/assets/app.js"]?.body,
      headers: { "content-type": "text/javascript; charset=utf-8" },
    });
    expect(font).toMatchObject({
      status: 200,
      headers: { "content-type": "font/woff2" },
    });
    expect(font.body.length).toBeGreaterThan(0);
  });

  test("serves every font URL referenced by the canonical token stylesheet", async () => {
    const store = createStore();
    const handle = await startDashboardServer({ store, assets, port: 0 });
    handles.push(handle);

    const tokenStylesheet = await httpRequest(
      `${handle.url}${DASHBOARD_ASSET_PATHS.tokens}`,
    );
    const css = tokenStylesheet.body;
    const fontUrls = [...css.matchAll(/url\(["']?([^"']+)["']?\)/g)].map(
      ([, url]) => url,
    );

    expect(tokenStylesheet.status).toBe(200);
    expect(fontUrls).toHaveLength(4);
    for (const fontUrl of fontUrls) {
      const resolved = new URL(
        fontUrl as string,
        `${handle.url}${DASHBOARD_ASSET_PATHS.tokens}`,
      );
      const font = await httpRequest(resolved.href);
      expect(font.status).toBe(200);
      expect(font.headers["content-type"]).toBe("font/woff2");
    }

    const rejected = await httpRequest(
      `${handle.url}/fonts/not-allowlisted.woff2`,
    );
    expect(rejected.status).toBe(404);
  });

  test("protects snapshot and SSE with the cookie and uses exact content types", async () => {
    const store = createStore();
    const handle = await startDashboardServer({ store, assets, port: 0 });
    handles.push(handle);
    const { cookie } = await shellAndCookie(handle.url);

    const unauthorized = await httpRequest(`${handle.url}/api/snapshot`);
    const wrongCookie = await httpRequest(`${handle.url}/api/snapshot`, {
      headers: { cookie: "atlante_dashboard_auth=wrong" },
    });
    const unauthorizedEvents = await httpRequest(`${handle.url}/api/events`);
    const wrongCookieEvents = await httpRequest(`${handle.url}/api/events`, {
      headers: { cookie: "atlante_dashboard_auth=wrong" },
    });
    const snapshot = await httpRequest(`${handle.url}/api/snapshot`, {
      headers: { cookie },
    });

    expect(unauthorized).toMatchObject({ status: 401, body: "Unauthorized" });
    expect(wrongCookie).toMatchObject({ status: 401, body: "Unauthorized" });
    expect(unauthorizedEvents).toMatchObject({
      status: 401,
      body: "Unauthorized",
    });
    expect(wrongCookieEvents).toMatchObject({
      status: 401,
      body: "Unauthorized",
    });
    expect(snapshot.status).toBe(200);
    expect(snapshot.headers["content-type"]).toBe(
      "application/json; charset=utf-8",
    );
    expect(JSON.parse(snapshot.body)).toEqual(store.getSnapshot());
    for (const value of Object.values(forbidden)) {
      expect(snapshot.body).not.toContain(value);
      expect(unauthorized.body).not.toContain(value);
      expect(wrongCookie.body).not.toContain(value);
      expect(unauthorizedEvents.body).not.toContain(value);
      expect(wrongCookieEvents.body).not.toContain(value);
    }
  });

  test("rejects cross-origin requests, wrong routes, methods, and traversal", async () => {
    const store = createStore();
    const handle = await startDashboardServer({ store, assets, port: 0 });
    handles.push(handle);
    const { cookie } = await shellAndCookie(handle.url);
    const headers = { cookie };

    const cases = await Promise.all([
      httpRequest(`${handle.url}/api/snapshot`, { method: "POST", headers }),
      httpRequest(`${handle.url}/api/nope`, { headers }),
      httpRequest(`${handle.url}/assets/missing.js`),
      httpRequest(`${handle.url}/assets/../package.json`),
      httpRequest(`${handle.url}/assets/%2e%2e/package.json`),
      httpRequest(`${handle.url}/fonts/unapproved.woff2`),
      httpRequest(`${handle.url}/api/snapshot`, {
        headers: { ...headers, origin: "http://evil.test" },
      }),
    ]);

    expect(cases.map(({ status }) => status)).toEqual([
      405, 404, 404, 404, 404, 404, 403,
    ]);
    expect(cases.every(({ body }) => !body.includes(projectRoot))).toBe(true);
  });

  test("sends an initial SSE snapshot, fans out updates, and sends bounded keepalives", async () => {
    const store = createStore();
    const handle = await startDashboardServer({
      store,
      assets,
      port: 0,
      keepAliveMs: 20,
    });
    handles.push(handle);
    const { cookie } = await shellAndCookie(handle.url);
    const response = await new Promise<{
      response: import("node:http").IncomingMessage;
      request: ReturnType<typeof request>;
    }>((resolve, reject) => {
      const sseRequest = request(
        `${handle.url}/api/events`,
        { headers: { cookie, accept: "text/event-stream" } },
        (sseResponse) =>
          resolve({ response: sseResponse, request: sseRequest }),
      );
      sseRequest.on("error", reject);
      sseRequest.end();
    });
    const chunks: string[] = [];
    response.response.setEncoding("utf8");
    response.response.on("data", (chunk) => chunks.push(chunk));

    await new Promise<void>((resolve) => {
      const check = () => {
        if (chunks.join("").includes('"schemaVersion":1')) resolve();
        else setTimeout(check, 1);
      };
      check();
    });
    expect(response.response.statusCode).toBe(200);
    expect(response.response.headers["content-type"]).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(chunks.join("")).toContain("event: snapshot\n");

    store.apply({
      directory: projectRoot,
      type: "session.created",
      properties: { sessionId: "session-1" },
    });
    await new Promise<void>((resolve) => {
      const check = () => {
        if (chunks.join("").includes('"id":"session:')) resolve();
        else setTimeout(check, 1);
      };
      check();
    });
    expect(chunks.join("")).toContain("event: snapshot\n");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(chunks.join("")).toContain(": keepalive\n\n");
    for (const value of Object.values(forbidden)) {
      expect(chunks.join("")).not.toContain(value);
    }
    response.request.destroy();
  });

  test("removes disconnected clients and closes the store and streams cleanly", async () => {
    const store = createStore();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });
    const handle = await startDashboardServer({
      store,
      assets,
      port: 0,
      keepAliveMs: 10,
    });
    handles.push(handle);
    const { cookie } = await shellAndCookie(handle.url);
    const sseResponse = new Promise<import("node:http").IncomingMessage>(
      (resolve, reject) => {
        const sseRequest = request(
          `${handle.url}/api/events`,
          { headers: { cookie } },
          resolve,
        );
        sseRequest.on("error", reject);
        sseRequest.end();
      },
    );
    const response = await sseResponse;
    response.resume();
    const responseClosed = new Promise<void>((resolve) =>
      response.once("close", resolve),
    );
    const sseRequest = request(`${handle.url}/api/events`, {
      headers: { cookie },
    });
    const closed = new Promise<void>((resolve, reject) => {
      sseRequest.once("error", (error) => {
        if ((error as NodeJS.ErrnoException).code === "ECONNRESET") resolve();
        else reject(error);
      });
      sseRequest.once("close", resolve);
    });
    sseRequest.end();
    await new Promise((resolve) => setTimeout(resolve, 10));
    sseRequest.destroy();
    await closed;

    await handle.close();
    const before = notifications;
    expect(store.getSnapshot()).toMatchObject({
      connection: "disconnected",
      stale: true,
      sources: { runtime: "unavailable" },
    });
    store.apply({
      directory: projectRoot,
      type: "session.created",
      properties: { sessionId: "after-close" },
    });
    expect(notifications).toBe(before);
    await expect(httpRequest(handle.url)).rejects.toBeDefined();
    await responseClosed;
  });
});
