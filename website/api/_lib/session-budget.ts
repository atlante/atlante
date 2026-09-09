import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

const DEFAULT_MAX_BUILDS = 8;
const DEFAULT_MAX_SESSIONS = 10_000;
const SESSION_TTL_MS = 30 * 60 * 1000;
const SESSION_COOKIE = "atlante_playground";
const SESSION_SECRET =
  process.env.PLAYGROUND_SESSION_SECRET ?? randomBytes(32).toString("hex");

type SessionState = {
  count: number;
  lastSeen: number;
};

const sessions = new Map<string, SessionState>();

// This is a conservative, process-local budget for signed browser sessions.
// It is not a deployment-wide abuse or rate-limit boundary; the hosting edge
// must provide that protection when the playground is exposed publicly.

export type PlaygroundSessionIdentity = {
  key: string;
  fallbackKey?: string;
  setCookie: string;
};

function signSession(id: string): string {
  return createHmac("sha256", SESSION_SECRET).update(id).digest("base64url");
}

function validSession(id: string, signature: string): boolean {
  const expected = Buffer.from(signSession(id));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function readCookie(cookieHeader: string | undefined): string | null {
  const value = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!value) return null;

  const [id, signature, extra] = value.split(".");
  return id && signature && !extra && validSession(id, signature) ? id : null;
}

export function resolvePlaygroundSession(
  cookieHeader: string | undefined,
  clientAddress: string,
  secure = false,
): PlaygroundSessionIdentity {
  const id = readCookie(cookieHeader);
  const issuedId = id ?? randomUUID();
  const addressKey = `address:${clientAddress || "unknown"}`;
  const token = `${issuedId}.${signSession(issuedId)}`;
  return {
    key: id ? `session:${id}` : addressKey,
    fallbackKey: id ? addressKey : undefined,
    setCookie: `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_TTL_MS / 1000}; Path=/api/playground; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
  };
}

function configuredMaxBuilds(): number {
  const configured = Number(process.env.PLAYGROUND_MAX_BUILDS);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_BUILDS;
}

function configuredMaxSessions(): number {
  const configured = Number(process.env.PLAYGROUND_MAX_SESSIONS);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_SESSIONS;
}

function evictOldestSession(): void {
  let oldestState: SessionState | undefined;
  let oldestSeen = Number.POSITIVE_INFINITY;
  for (const state of new Set(sessions.values())) {
    if (state.lastSeen < oldestSeen) {
      oldestState = state;
      oldestSeen = state.lastSeen;
    }
  }
  if (!oldestState) return;
  for (const [key, state] of sessions) {
    if (state === oldestState) sessions.delete(key);
  }
}

export type SessionBudgetResult = {
  allowed: boolean;
  remaining: number;
};

export function consumeSessionBuild(
  sessionId: string,
  options: {
    now?: number;
    maxBuilds?: number;
    maxSessions?: number;
    fallbackKey?: string;
  } = {},
): SessionBudgetResult {
  const now = options.now ?? Date.now();
  const maxBuilds = Math.max(1, options.maxBuilds ?? configuredMaxBuilds());
  const maxSessions = Math.max(
    1,
    options.maxSessions ?? configuredMaxSessions(),
  );

  for (const [key, state] of sessions) {
    if (now - state.lastSeen > SESSION_TTL_MS) sessions.delete(key);
  }

  let current = sessions.get(sessionId);
  let currentKey = sessionId;
  if (!current && options.fallbackKey && options.fallbackKey !== sessionId) {
    current = sessions.get(options.fallbackKey);
    currentKey = options.fallbackKey;
  }

  if (current && now - current.lastSeen > SESSION_TTL_MS) {
    sessions.delete(currentKey);
    current = undefined;
  }

  if (!current) {
    if (new Set(sessions.values()).size >= maxSessions) evictOldestSession();
    const next = { count: 1, lastSeen: now };
    sessions.set(sessionId, next);
    return { allowed: true, remaining: Math.max(0, maxBuilds - 1) };
  }

  if (current.count >= maxBuilds) {
    current.lastSeen = now;
    return { allowed: false, remaining: 0 };
  }

  current.count += 1;
  current.lastSeen = now;
  return { allowed: true, remaining: Math.max(0, maxBuilds - current.count) };
}

export function resetSessionBuilds(): void {
  sessions.clear();
}
