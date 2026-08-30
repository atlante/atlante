import { basename, isAbsolute, relative, resolve } from "node:path";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import {
  bounded,
  isRecord,
  isSafePathInput,
  type RecordValue,
  stringValue,
} from "./dashboard-utils.js";
import { DASHBOARD_BOUNDS, type DashboardEvent } from "./model.js";
import type { DashboardStore, ReconciledSession } from "./store.js";

export type OpenCodeProjectCheck = { matches: boolean };
export type OpenCodeSession = { id: string };
export type OpenCodeStatus = { type: string };
export type OpenCodeTodo = {
  id: string;
  status: string;
  priority: string;
  content: string;
};

/** The only host data exposed to the observer. It is not an SDK type. */
export type OpenCodeEventEnvelope = {
  directory: string;
  payload: unknown;
};

export interface OpenCodeSource {
  projectCurrent(directory: string): Promise<OpenCodeProjectCheck>;
  vcs(directory: string): Promise<{ branch?: string }>;
  sessions(directory: string): Promise<OpenCodeSession[]>;
  statuses(directory: string): Promise<Record<string, OpenCodeStatus>>;
  todos(directory: string, sessionId: string): Promise<OpenCodeTodo[]>;
  events(signal?: AbortSignal): Promise<AsyncIterable<OpenCodeEventEnvelope>>;
}

export type OpenCodeSdkReadClient = {
  project: Pick<OpencodeClient["project"], "current">;
  vcs: Pick<OpencodeClient["vcs"], "get">;
  session: Pick<OpencodeClient["session"], "list" | "status" | "todo">;
  global: Pick<OpencodeClient["global"], "event">;
};

export type OpenCodeSourceOptions = {
  baseUrl?: string;
  client?: OpenCodeSdkReadClient;
};

function comparablePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const prefix = normalized.match(/^[a-zA-Z]:/u)?.[0].toLowerCase() ?? "";
  const body = normalized.replace(/^[a-zA-Z]:/u, "");
  const parts: string[] = [];
  for (const part of body.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.at(-1) !== "..") parts.pop();
    else parts.push(part);
  }
  const result = `${prefix}${body.startsWith("/") ? "/" : ""}${parts.join("/")}`;
  return result.length > 1 ? result.replace(/\/$/u, "") : result;
}

function sameDirectory(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right);
}

function safeRelativePath(
  value: unknown,
  projectRoot: string,
): string | undefined {
  if (!isSafePathInput(value)) return undefined;

  const root = resolve(projectRoot);
  const absolute = resolve(root, value.replaceAll("\\", "/"));
  const relativeValue = relative(root, absolute).replaceAll("\\", "/");
  if (
    !relativeValue ||
    isAbsolute(relativeValue) ||
    relativeValue === ".." ||
    relativeValue.startsWith("../")
  )
    return undefined;
  return bounded(relativeValue, DASHBOARD_BOUNDS.maxSafePathLength);
}

function event(
  directory: string,
  type: DashboardEvent["type"],
  properties: DashboardEvent["properties"],
): DashboardEvent {
  return { directory, type, properties } as DashboardEvent;
}

function sessionId(value: unknown): string | undefined {
  return stringValue(value);
}

function statusType(
  value: unknown,
):
  | "busy"
  | "working"
  | "retry"
  | "idle"
  | "error"
  | "failed"
  | "unknown"
  | undefined {
  if (!isRecord(value)) return undefined;
  const type = value.type;
  return [
    "busy",
    "working",
    "retry",
    "idle",
    "error",
    "failed",
    "unknown",
  ].includes(type as string)
    ? (type as
        | "busy"
        | "working"
        | "retry"
        | "idle"
        | "error"
        | "failed"
        | "unknown")
    : undefined;
}

function normalizeTodoItems(
  directory: string,
  rawSessionId: unknown,
  rawItems: unknown,
): Extract<DashboardEvent, { type: "todo.updated" }> | undefined {
  const id = sessionId(rawSessionId);
  if (!id || !Array.isArray(rawItems)) return undefined;
  if (rawItems.length > DASHBOARD_BOUNDS.maxTodoItems) return undefined;
  const items = rawItems.map((value) => {
    if (!isRecord(value)) return undefined;
    const itemId = stringValue(value.id);
    const status = value.status;
    const priority = value.priority;
    const content = value.content;
    if (
      !itemId ||
      typeof content !== "string" ||
      content.length > DASHBOARD_BOUNDS.maxTodoContentLength ||
      ![
        "pending",
        "in_progress",
        "in-progress",
        "completed",
        "done",
        "cancelled",
        "canceled",
      ].includes(status as string) ||
      !["low", "medium", "normal", "high"].includes(priority as string)
    )
      return undefined;
    return {
      id: itemId,
      status,
      priority,
    };
  });
  if (items.some((item) => item === undefined)) return undefined;
  return event(directory, "todo.updated", {
    sessionId: id,
    items: items as Array<{
      id: string;
      status?:
        | "pending"
        | "in_progress"
        | "in-progress"
        | "completed"
        | "done"
        | "cancelled"
        | "canceled";
      priority?: "low" | "medium" | "normal" | "high";
    }>,
  }) as Extract<DashboardEvent, { type: "todo.updated" }>;
}

function errorKind(
  value: unknown,
): "timeout" | "network" | "provider" | "unknown" {
  const name = isRecord(value) ? value.name : undefined;
  if (name === "APIError") return "network";
  if (name === "MessageAbortedError") return "timeout";
  if (name === "ProviderAuthError" || name === "MessageOutputLengthError")
    return "provider";
  return "unknown";
}

function commandName(value: unknown): string {
  const name = stringValue(value);
  return name && /^[a-zA-Z0-9_./:@-]+$/u.test(name)
    ? bounded(name, 64)
    : "unknown";
}

type DecodeResult =
  | { kind: "event"; event: DashboardEvent }
  | { kind: "filtered" | "malformed" | "unknown" };

function decoded(eventValue: DashboardEvent | undefined): DecodeResult {
  return eventValue
    ? { kind: "event", event: eventValue }
    : { kind: "malformed" };
}

function normalizeSessionEvent(
  directory: string,
  type: string,
  properties: RecordValue,
): DashboardEvent | undefined {
  const info = isRecord(properties.info) ? properties.info : undefined;
  const id = sessionId(info?.id);
  if (!id) return undefined;
  return event(directory, type as never, { sessionId: id });
}

function normalizeStatusEvent(
  directory: string,
  properties: RecordValue,
): DashboardEvent | undefined {
  const id = sessionId(properties.sessionID);
  const status = statusType(properties.status);
  return id && status
    ? event(directory, "session.status", { sessionId: id, status })
    : undefined;
}

function normalizeIdleEvent(
  directory: string,
  properties: RecordValue,
): DashboardEvent | undefined {
  const id = sessionId(properties.sessionID);
  return id ? event(directory, "session.idle", { sessionId: id }) : undefined;
}

type PartNormalizer = (
  directory: string,
  session: string,
  partId: string,
  part: RecordValue,
) => DashboardEvent | undefined;

type PartEventInput = {
  session: string;
  partId: string;
  part: RecordValue;
  normalizer: PartNormalizer;
};

const partNormalizers: Record<string, PartNormalizer> = {
  agent: (directory, session, partId, part) => {
    const name = stringValue(part.name);
    return name
      ? event(directory, "message.part.updated", {
          sessionId: session,
          partId,
          partType: "agent",
          agentId: name,
        })
      : undefined;
  },
  subtask: (directory, session, partId, part) => {
    const agent = stringValue(part.agent);
    return agent
      ? event(directory, "message.part.updated", {
          sessionId: session,
          partId,
          partType: "subtask",
          taskId: agent,
        })
      : undefined;
  },
  tool: (directory, session, partId) =>
    event(directory, "message.part.updated", {
      sessionId: session,
      partId,
      partType: "tool",
    }),
};

function partEventInput(properties: RecordValue): PartEventInput | undefined {
  const part = properties.part;
  if (!isRecord(part)) return undefined;
  const session = sessionId(part?.sessionID);
  const partId = sessionId(part?.id);
  const partType = stringValue(part?.type);
  if (!session || !partId || !partType) return undefined;
  const normalizer = partNormalizers[partType];
  if (!normalizer) return undefined;
  return { session, partId, part, normalizer };
}

function normalizePartEvent(
  directory: string,
  properties: RecordValue,
): DashboardEvent | undefined {
  const input = partEventInput(properties);
  return input
    ? input.normalizer(directory, input.session, input.partId, input.part)
    : undefined;
}

function normalizePermissionEvent(
  directory: string,
  type: "permission.updated" | "permission.replied",
  properties: RecordValue,
): DashboardEvent | undefined {
  const permissionId = sessionId(
    type === "permission.updated" ? properties.id : properties.permissionID,
  );
  const id = sessionId(properties.sessionID);
  return permissionId
    ? event(directory, type, {
        permissionId,
        ...(id ? { sessionId: id } : {}),
        status: type === "permission.updated" ? "pending" : "resolved",
      })
    : undefined;
}

function normalizeDiffEvent(
  directory: string,
  projectRoot: string,
  properties: RecordValue,
): DashboardEvent | undefined {
  const id = sessionId(properties.sessionID);
  const diffs = properties.diff;
  if (
    !id ||
    !Array.isArray(diffs) ||
    diffs.length > DASHBOARD_BOUNDS.maxDiffFiles
  )
    return undefined;
  const files = diffs.map((value) => {
    if (!isRecord(value)) return undefined;
    const path = safeRelativePath(value.file, projectRoot);
    const additions = value.additions;
    const deletions = value.deletions;
    if (
      !path ||
      typeof additions !== "number" ||
      !Number.isFinite(additions) ||
      typeof deletions !== "number" ||
      !Number.isFinite(deletions)
    )
      return undefined;
    return {
      path,
      count: Math.max(0, Math.min(10_000, Math.trunc(additions + deletions))),
    };
  });
  return files.every((file) => file !== undefined)
    ? event(directory, "session.diff", {
        sessionId: id,
        files: files as Array<{ path: string; count: number }>,
      })
    : undefined;
}

type PayloadNormalizer = (
  directory: string,
  projectRoot: string,
  properties: RecordValue,
) => DashboardEvent | undefined;

const payloadNormalizers: Record<string, PayloadNormalizer> = {
  "session.created": (directory, _projectRoot, properties) =>
    normalizeSessionEvent(directory, "session.created", properties),
  "session.updated": (directory, _projectRoot, properties) =>
    normalizeSessionEvent(directory, "session.updated", properties),
  "session.deleted": (directory, _projectRoot, properties) =>
    normalizeSessionEvent(directory, "session.deleted", properties),
  "session.status": (directory, _projectRoot, properties) =>
    normalizeStatusEvent(directory, properties),
  "session.idle": (directory, _projectRoot, properties) =>
    normalizeIdleEvent(directory, properties),
  "message.part.updated": (directory, _projectRoot, properties) =>
    normalizePartEvent(directory, properties),
  "todo.updated": (directory, _projectRoot, properties) =>
    normalizeTodoItems(directory, properties.sessionID, properties.todos),
  "permission.updated": (directory, _projectRoot, properties) =>
    normalizePermissionEvent(directory, "permission.updated", properties),
  "permission.replied": (directory, _projectRoot, properties) =>
    normalizePermissionEvent(directory, "permission.replied", properties),
  "session.error": (directory, _projectRoot, properties) => {
    const id = sessionId(properties.sessionID);
    return event(directory, "session.error", {
      ...(id ? { sessionId: id } : {}),
      kind: errorKind(properties.error),
    });
  },
  "file.edited": (directory, projectRoot, properties) => {
    const path = safeRelativePath(properties.file, projectRoot);
    return path ? event(directory, "file.edited", { path }) : undefined;
  },
  "session.diff": (directory, projectRoot, properties) =>
    normalizeDiffEvent(directory, projectRoot, properties),
  "command.executed": (directory, _projectRoot, properties) => {
    const id = sessionId(properties.sessionID);
    const name = stringValue(properties.name);
    return name
      ? event(directory, "command.executed", {
          commandName: commandName(name),
          ...(id ? { sessionId: id } : {}),
        })
      : undefined;
  },
};

function normalizePayload(
  directory: string,
  projectRoot: string,
  type: string,
  properties: RecordValue,
): DecodeResult {
  const normalizer = payloadNormalizers[type];
  return normalizer
    ? decoded(normalizer(directory, projectRoot, properties))
    : { kind: "unknown" };
}

function decodeEvent(envelope: unknown, projectRoot: string): DecodeResult {
  if (!isRecord(envelope) || typeof envelope.directory !== "string")
    return { kind: "malformed" };
  if (!sameDirectory(envelope.directory, projectRoot))
    return { kind: "filtered" };
  if (!isRecord(envelope.payload)) return { kind: "malformed" };
  const type = envelope.payload.type;
  const properties = envelope.payload.properties;
  if (typeof type !== "string" || !isRecord(properties))
    return { kind: "malformed" };
  return normalizePayload(envelope.directory, projectRoot, type, properties);
}

/** Convert one canonical SDK envelope without allowing its payload through. */
export function normalizeOpenCodeEvent(
  envelope: OpenCodeEventEnvelope,
  projectRoot: string,
): DashboardEvent | undefined {
  const result = decodeEvent(envelope, projectRoot);
  return result.kind === "event" ? result.event : undefined;
}

async function responseData<T>(request: Promise<{ data?: T }>): Promise<T> {
  const response = await request;
  if (response.data === undefined) throw new Error("OpenCode read unavailable");
  return response.data;
}

export function createOpenCodeSource(
  options: OpenCodeSourceOptions,
): OpenCodeSource {
  if (!options.client && !options.baseUrl)
    throw new Error("OpenCode URL is required");
  const client =
    options.client ?? createOpencodeClient({ baseUrl: options.baseUrl });

  return {
    async projectCurrent(directory) {
      const project = await responseData(
        client.project.current({ query: { directory } }),
      );
      return { matches: sameDirectory(project.worktree, directory) };
    },
    async vcs(directory) {
      const value = await responseData(
        client.vcs.get({ query: { directory } }),
      );
      return { branch: stringValue(value.branch) };
    },
    async sessions(directory) {
      const sessions = await responseData(
        client.session.list({ query: { directory } }),
      );
      return sessions.flatMap((session) =>
        stringValue(session.id) ? [{ id: session.id }] : [],
      );
    },
    async statuses(directory) {
      const statuses = await responseData(
        client.session.status({ query: { directory } }),
      );
      return Object.fromEntries(
        Object.entries(statuses).flatMap(([id, status]) =>
          isRecord(status) && typeof status.type === "string"
            ? [[id, { type: status.type }]]
            : [],
        ),
      );
    },
    async todos(directory, id) {
      const todos = await responseData(
        client.session.todo({ path: { id }, query: { directory } }),
      );
      return todos.flatMap((todo) =>
        typeof todo.id === "string" &&
        typeof todo.status === "string" &&
        typeof todo.priority === "string" &&
        typeof todo.content === "string"
          ? [
              {
                id: todo.id,
                status: todo.status,
                priority: todo.priority,
                content: todo.content,
              },
            ]
          : [],
      );
    },
    async events(signal) {
      const eventOptions = {
        ...(signal ? { signal } : {}),
        sseDefaultRetryDelay: 0,
        sseMaxRetryAttempts: 1,
        sseMaxRetryDelay: 0,
        sseSleepFn: async () => {},
      };
      const result = await client.global.event(eventOptions);
      return result.stream as AsyncIterable<OpenCodeEventEnvelope>;
    },
  };
}

export type ObserverError = {
  phase: "bootstrap" | "subscription" | "reconciliation" | "stream";
  attempt: number;
};

export type OpenCodeObserverOptions = {
  projectRoot: string;
  store: DashboardStore;
  source: OpenCodeSource;
  sessionId?: string;
  maxRetries?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  onError?: (error: ObserverError) => void;
};

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolvePromise = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise() };
}

const CLOSED = Symbol("observer closed");

type AttemptState = { phase: ObserverError["phase"] };

export class OpenCodeObserver {
  readonly done: Promise<void>;
  private readonly options: Required<
    Pick<
      OpenCodeObserverOptions,
      "maxRetries" | "retryBaseMs" | "retryMaxMs" | "sleep"
    >
  > &
    OpenCodeObserverOptions;
  private readonly finished = deferred();
  private readonly ready = deferred();
  private readonly abortController = new AbortController();
  private activeIterator: AsyncIterator<OpenCodeEventEnvelope> | undefined;
  private closeWaiter = deferred();
  private started = false;
  private closed = false;
  private runPromise: Promise<void> | undefined;
  private closePromise: Promise<void> | undefined;
  private iteratorClosePromise: Promise<void> | undefined;

  constructor(options: OpenCodeObserverOptions) {
    this.options = {
      ...options,
      maxRetries: options.maxRetries ?? 3,
      retryBaseMs: options.retryBaseMs ?? 250,
      retryMaxMs: options.retryMaxMs ?? 4_000,
      sleep:
        options.sleep ??
        ((milliseconds, signal) =>
          new Promise((resolve) => {
            if (signal?.aborted) {
              resolve();
              return;
            }
            let timer: ReturnType<typeof setTimeout> | undefined;
            const finish = () => {
              if (timer !== undefined) clearTimeout(timer);
              signal?.removeEventListener("abort", finish);
              resolve();
            };
            timer = setTimeout(finish, milliseconds);
            if (typeof timer === "object" && "unref" in timer) timer.unref();
            signal?.addEventListener("abort", finish, { once: true });
          })),
    };
    this.done = this.finished.promise;
  }

  start(): Promise<void> {
    if (this.closed) {
      this.ready.resolve();
      return this.ready.promise;
    }
    if (!this.started) {
      this.started = true;
      this.runPromise = this.run();
    }
    return this.ready.promise;
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.abortController.abort();
    this.closeWaiter.resolve();
    this.options.store.close();
    this.closePromise = (async () => {
      await this.closeIterator();
      await this.runPromise;
      await this.closeIterator();
      this.ready.resolve();
      this.finished.resolve();
    })();
    return this.closePromise;
  }

  private async untilClosed<T>(
    promise: Promise<T>,
  ): Promise<T | typeof CLOSED> {
    if (this.closed) return CLOSED;
    return (await Promise.race([
      promise,
      this.closeWaiter.promise.then(() => CLOSED),
    ])) as T | typeof CLOSED;
  }

  private async run(): Promise<void> {
    let attempt = 0;
    try {
      while (!this.closed) {
        if (!(await this.runAttempt(attempt))) break;
        attempt += 1;
      }
    } finally {
      await this.closeIterator();
      this.ready.resolve();
      this.finished.resolve();
    }
  }

  private async runAttempt(attempt: number): Promise<boolean> {
    const state: AttemptState = { phase: "bootstrap" };
    try {
      return await this.connectAttempt(state);
    } catch {
      return this.handleAttemptFailure(state.phase, attempt);
    }
  }

  private async connectAttempt(state: AttemptState): Promise<boolean> {
    if ((await this.bootstrap()) === CLOSED || this.closed) return false;
    this.options.store.setConnection("reconnecting");
    state.phase = "subscription";
    const stream = await this.untilClosed(
      this.options.source.events(this.abortController.signal),
    );
    if (stream === CLOSED) return false;
    this.activeIterator = stream[Symbol.asyncIterator]();
    if (this.closed) return false;

    // Transport freshness starts at iterator establishment, not at a
    // reconciliation or synthetic event.
    this.options.store.setConnection("connected");
    state.phase = "reconciliation";
    if ((await this.reconcile()) === CLOSED) return false;
    this.ready.resolve();
    state.phase = "stream";
    await this.consume();
    if (this.closed) return false;
    throw new Error("OpenCode event stream ended");
  }

  private async handleAttemptFailure(
    phase: ObserverError["phase"],
    attempt: number,
  ): Promise<boolean> {
    await this.closeIterator();
    if (this.closed) return false;
    this.options.onError?.({ phase, attempt });
    if (attempt >= this.options.maxRetries) {
      this.options.store.setConnection("disconnected");
      this.ready.resolve();
      return false;
    }
    this.options.store.setConnection("reconnecting");
    return this.waitForRetry(attempt);
  }

  private async waitForRetry(attempt: number): Promise<boolean> {
    const delay = Math.min(
      this.options.retryMaxMs,
      this.options.retryBaseMs * 2 ** attempt,
    );
    return (
      (await this.untilClosed(
        this.options.sleep(delay, this.abortController.signal),
      )) !== CLOSED
    );
  }

  private async bootstrap(): Promise<typeof CLOSED | undefined> {
    const project = await this.untilClosed(
      this.options.source.projectCurrent(this.options.projectRoot),
    );
    if (project === CLOSED) return CLOSED;
    if (!project.matches) throw new Error("OpenCode project mismatch");
    const vcs = await this.untilClosed(
      this.options.source.vcs(this.options.projectRoot),
    );
    if (vcs === CLOSED) return CLOSED;
    this.options.store.setProject(
      basename(this.options.projectRoot),
      vcs.branch,
    );
  }

  private async closeIterator(): Promise<void> {
    const iterator = this.activeIterator;
    this.activeIterator = undefined;
    if (iterator?.return && !this.iteratorClosePromise) {
      this.iteratorClosePromise = Promise.resolve()
        .then(() => iterator.return?.())
        .then(
          () => {},
          () => {},
        );
    }
    const closing = this.iteratorClosePromise;
    if (!closing) return;
    await closing;
    if (this.iteratorClosePromise === closing)
      this.iteratorClosePromise = undefined;
  }

  private async reconcile(): Promise<typeof CLOSED | undefined> {
    const sessions = await this.untilClosed(
      this.options.source.sessions(this.options.projectRoot),
    );
    if (sessions === CLOSED) return CLOSED;
    const selected = sessions.filter(
      ({ id }) => !this.options.sessionId || id === this.options.sessionId,
    );
    const statuses = await this.untilClosed(
      this.options.source.statuses(this.options.projectRoot),
    );
    if (statuses === CLOSED) return CLOSED;
    const reconciled: ReconciledSession[] = [];
    for (const session of selected) {
      const result = await this.reconcileSession(session, statuses);
      if (result === CLOSED) return CLOSED;
      reconciled.push(result);
    }
    this.options.store.reconcileRuntime(reconciled);
  }

  private async reconcileSession(
    session: OpenCodeSession,
    statuses: Record<string, OpenCodeStatus>,
  ): Promise<ReconciledSession | typeof CLOSED> {
    const todos = await this.untilClosed(
      this.options.source.todos(this.options.projectRoot, session.id),
    );
    if (todos === CLOSED) return CLOSED;
    const todoEvent = normalizeTodoItems(
      this.options.projectRoot,
      session.id,
      todos,
    );
    if (!todoEvent) this.options.store.recordMalformedEvent();
    const normalizedStatus = statusType(statuses[session.id]);
    return {
      id: session.id,
      ...(normalizedStatus ? { status: normalizedStatus } : {}),
      ...(todoEvent ? { todos: todoEvent.properties.items } : {}),
    };
  }

  private async consume(): Promise<void> {
    const iterator = this.activeIterator;
    if (!iterator) throw new Error("OpenCode event stream unavailable");
    while (!this.closed) {
      const result = await Promise.race([
        iterator.next(),
        this.closeWaiter.promise.then(() => ({ done: true, value: undefined })),
      ]);
      if (this.closed || result.done) return;
      this.consumeEvent(result.value);
    }
  }

  private consumeEvent(value: unknown): void {
    const decoded = decodeEvent(value, this.options.projectRoot);
    if (decoded.kind === "event") {
      const session = (decoded.event.properties as { sessionId?: string })
        .sessionId;
      if (
        this.options.sessionId &&
        session &&
        session !== this.options.sessionId
      ) {
        this.options.store.recordDroppedEvent();
        return;
      }
      this.options.store.apply(decoded.event);
    } else if (decoded.kind === "malformed") {
      this.options.store.recordMalformedEvent();
    } else if (decoded.kind === "unknown") {
      this.options.store.recordDroppedEvent();
    }
  }
}
