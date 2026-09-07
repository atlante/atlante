const DEFAULT_MAX_BUILDS = 8;
const SESSION_TTL_MS = 30 * 60 * 1000;

type SessionState = {
  count: number;
  lastSeen: number;
};

const sessions = new Map<string, SessionState>();

// This is a conservative, process-local budget for honest browser sessions.
// It is not a deployment-wide abuse or rate-limit boundary; the hosting edge
// must provide that protection when the playground is exposed publicly.

function configuredMaxBuilds(): number {
  const configured = Number(process.env.PLAYGROUND_MAX_BUILDS);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_BUILDS;
}

export type SessionBudgetResult = {
  allowed: boolean;
  remaining: number;
};

export function consumeSessionBuild(
  sessionId: string,
  options: { now?: number; maxBuilds?: number } = {},
): SessionBudgetResult {
  const now = options.now ?? Date.now();
  const maxBuilds = Math.max(1, options.maxBuilds ?? configuredMaxBuilds());

  for (const [key, state] of sessions) {
    if (now - state.lastSeen > SESSION_TTL_MS) sessions.delete(key);
  }

  const current = sessions.get(sessionId);
  if (!current || now - current.lastSeen > SESSION_TTL_MS) {
    sessions.set(sessionId, { count: 1, lastSeen: now });
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
