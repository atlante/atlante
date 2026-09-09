import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type PlaygroundRequest,
  parsePlaygroundRequest,
  runPlaygroundStep,
} from "./_lib/playground.js";
import {
  consumeSessionBuild,
  resolvePlaygroundSession,
} from "./_lib/session-budget.js";

const MAX_BODY_BYTES = 256 * 1024;

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== "string") return true;
  const forwarded = request.headers["x-forwarded-host"];
  const host = typeof forwarded === "string" ? forwarded : request.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function clientAddress(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return request.socket.remoteAddress ?? "unknown";
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const send = (status: number, payload: unknown, setCookie?: string): void => {
    response.statusCode = status;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    if (setCookie) response.setHeader("set-cookie", setCookie);
    response.end(JSON.stringify(payload));
  };

  if (request.method !== "POST") {
    send(405, { error: "method not allowed" });
    return;
  }
  if (!sameOrigin(request)) {
    send(403, { error: "cross-origin requests are not allowed" });
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse((await readBody(request)).toString("utf8"));
  } catch {
    send(400, { error: "invalid JSON body" });
    return;
  }

  let parsed: PlaygroundRequest;
  try {
    parsed = parsePlaygroundRequest(raw);
  } catch (error) {
    send(400, {
      error: error instanceof Error ? error.message : "invalid request",
    });
    return;
  }

  const session = resolvePlaygroundSession(
    request.headers.cookie,
    clientAddress(request),
    request.headers["x-forwarded-proto"] === "https",
  );
  const budget = consumeSessionBuild(session.key, {
    fallbackKey: session.fallbackKey,
  });
  if (!budget.allowed) {
    send(
      429,
      { error: "playground session build limit reached" },
      session.setCookie,
    );
    return;
  }

  try {
    send(200, await runPlaygroundStep(parsed), session.setCookie);
  } catch (error) {
    send(500, {
      error: error instanceof Error ? error.message : "playground failure",
    });
  }
}
