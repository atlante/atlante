import { describe, expect, test, vi } from "vitest";
import { createEmptySnapshot } from "../src/model.js";
import {
  createOpenCodeSource,
  normalizeOpenCodeEvent,
  type OpenCodeEventEnvelope,
  OpenCodeObserver,
  type OpenCodeSource,
} from "../src/opencode.js";
import { DashboardStore } from "../src/store.js";

const projectRoot = "/projects/demo";

function store() {
  return new DashboardStore(createEmptySnapshot({ name: "demo" }), {
    projectRoot,
    staleAfterMs: 1_000,
  });
}

function envelope(
  type: string,
  properties: Record<string, unknown>,
  directory = projectRoot,
): OpenCodeEventEnvelope {
  return { directory, payload: { type, properties } };
}

function sourceWith(
  overrides: Partial<OpenCodeSource> = {},
): OpenCodeSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    projectCurrent: async () => {
      calls.push("project.current");
      return { matches: true };
    },
    vcs: async () => {
      calls.push("vcs.get");
      return { branch: "main" };
    },
    sessions: async () => {
      calls.push("session.list");
      return [{ id: "s1" }];
    },
    statuses: async () => {
      calls.push("session.status");
      return { s1: { type: "busy" } };
    },
    todos: async (_directory, sessionId) => {
      calls.push(`session.todo:${sessionId}`);
      return [];
    },
    events: async () => {
      calls.push("global.event");
      return (async function* () {})();
    },
    ...overrides,
  };
}

async function runObserver(
  source: OpenCodeSource,
  options: Partial<ConstructorParameters<typeof OpenCodeObserver>[0]> = {},
) {
  const dashboard = store();
  const observer = new OpenCodeObserver({
    projectRoot,
    store: dashboard,
    source,
    maxRetries: 0,
    ...options,
  });
  await observer.start();
  await observer.done;
  return { dashboard, observer };
}

describe("normalizeOpenCodeEvent", () => {
  test.each([
    [
      envelope("session.created", { info: { id: "s1", title: "RAW_TITLE" } }),
      { type: "session.created", properties: { sessionId: "s1" } },
    ],
    [
      envelope("session.updated", { info: { id: "s1", title: "RAW_TITLE" } }),
      { type: "session.updated", properties: { sessionId: "s1" } },
    ],
    [
      envelope("session.deleted", { info: { id: "s1", title: "RAW_TITLE" } }),
      { type: "session.deleted", properties: { sessionId: "s1" } },
    ],
    [
      envelope("session.status", {
        sessionID: "s1",
        status: { type: "retry", message: "RAW_RETRY" },
      }),
      {
        type: "session.status",
        properties: { sessionId: "s1", status: "retry" },
      },
    ],
    [
      envelope("session.idle", { sessionID: "s1" }),
      { type: "session.idle", properties: { sessionId: "s1" } },
    ],
    [
      envelope("message.part.updated", {
        part: {
          id: "p1",
          sessionID: "s1",
          type: "agent",
          name: "reviewer",
          source: { value: "RAW_SOURCE" },
        },
      }),
      {
        type: "message.part.updated",
        properties: {
          sessionId: "s1",
          partId: "p1",
          partType: "agent",
          agentId: "reviewer",
        },
      },
    ],
    [
      envelope("message.part.updated", {
        part: {
          id: "p2",
          sessionID: "s1",
          type: "subtask",
          agent: "researcher",
          prompt: "RAW_PROMPT",
          description: "RAW_DESCRIPTION",
        },
      }),
      {
        type: "message.part.updated",
        properties: {
          sessionId: "s1",
          partId: "p2",
          partType: "subtask",
          taskId: "researcher",
        },
      },
    ],
    [
      envelope("message.part.updated", {
        part: {
          id: "p3",
          sessionID: "s1",
          type: "tool",
          tool: "read",
          state: { status: "completed", output: "RAW_OUTPUT", input: {} },
        },
      }),
      {
        type: "message.part.updated",
        properties: { sessionId: "s1", partId: "p3", partType: "tool" },
      },
    ],
    [
      envelope("todo.updated", {
        sessionID: "s1",
        todos: [
          {
            id: "t1",
            status: "in_progress",
            priority: "medium",
            content: "RAW_TODO_CONTENT",
          },
        ],
      }),
      {
        type: "todo.updated",
        properties: {
          sessionId: "s1",
          items: [{ id: "t1", status: "in_progress", priority: "medium" }],
        },
      },
    ],
    [
      envelope("permission.updated", {
        id: "p1",
        sessionID: "s1",
        title: "RAW_PERMISSION_TITLE",
        metadata: { secret: "RAW_PERMISSION_METADATA" },
      }),
      {
        type: "permission.updated",
        properties: { permissionId: "p1", sessionId: "s1", status: "pending" },
      },
    ],
    [
      envelope("permission.replied", {
        permissionID: "p1",
        sessionID: "s1",
        response: "reject",
      }),
      {
        type: "permission.replied",
        properties: { permissionId: "p1", sessionId: "s1", status: "resolved" },
      },
    ],
    [
      envelope("session.error", {
        error: {
          name: "ProviderAuthError",
          data: { message: "RAW_PROVIDER_ERROR" },
        },
      }),
      { type: "session.error", properties: { kind: "provider" } },
    ],
    [
      envelope("file.edited", { file: "src/index.ts" }),
      { type: "file.edited", properties: { path: "src/index.ts" } },
    ],
    [
      envelope("session.diff", {
        sessionID: "s1",
        diff: [
          {
            file: "src/index.ts",
            before: "RAW_BEFORE",
            after: "RAW_AFTER",
            additions: 3,
            deletions: 2,
          },
        ],
      }),
      {
        type: "session.diff",
        properties: {
          sessionId: "s1",
          files: [{ path: "src/index.ts", count: 5 }],
        },
      },
    ],
    [
      envelope("command.executed", {
        name: "test",
        sessionID: "s1",
        arguments: "RAW_COMMAND_ARGUMENTS",
      }),
      {
        type: "command.executed",
        properties: { commandName: "test", sessionId: "s1" },
      },
    ],
  ])("converts canonical %s", (input, expected) => {
    expect(normalizeOpenCodeEvent(input, projectRoot)).toEqual({
      directory: projectRoot,
      ...expected,
    });
    expect(
      JSON.stringify(normalizeOpenCodeEvent(input, projectRoot)),
    ).not.toMatch(
      /RAW_(TITLE|RETRY|SOURCE|PROMPT|DESCRIPTION|OUTPUT|TODO_CONTENT|PERMISSION_TITLE|PERMISSION_METADATA|PROVIDER_ERROR|BEFORE|AFTER|COMMAND_ARGUMENTS)/u,
    );
  });

  test("accepts a session error without sessionID or error name", () => {
    expect(
      normalizeOpenCodeEvent(
        envelope("session.error", { error: { data: { message: "RAW" } } }),
        projectRoot,
      ),
    ).toEqual({
      directory: projectRoot,
      type: "session.error",
      properties: { kind: "unknown" },
    });
  });

  test("preserves complete canonical agent and subtask identities", () => {
    const prefix = "x".repeat(200);
    const agentA = `${prefix}-agent-a`;
    const agentB = `${prefix}-agent-b`;
    const taskA = `${prefix}-subtask-a`;
    const taskB = `${prefix}-subtask-b`;

    expect(
      normalizeOpenCodeEvent(
        envelope("message.part.updated", {
          part: {
            id: "agent-a",
            sessionID: "s1",
            type: "agent",
            name: agentA,
          },
        }),
        projectRoot,
      ),
    ).toMatchObject({ properties: { agentId: agentA } });
    expect(
      normalizeOpenCodeEvent(
        envelope("message.part.updated", {
          part: {
            id: "agent-b",
            sessionID: "s1",
            type: "agent",
            name: agentB,
          },
        }),
        projectRoot,
      ),
    ).toMatchObject({ properties: { agentId: agentB } });
    expect(
      normalizeOpenCodeEvent(
        envelope("message.part.updated", {
          part: {
            id: "task-a",
            sessionID: "s1",
            type: "subtask",
            agent: taskA,
          },
        }),
        projectRoot,
      ),
    ).toMatchObject({ properties: { taskId: taskA } });
    expect(
      normalizeOpenCodeEvent(
        envelope("message.part.updated", {
          part: {
            id: "task-b",
            sessionID: "s1",
            type: "subtask",
            agent: taskB,
          },
        }),
        projectRoot,
      ),
    ).toMatchObject({ properties: { taskId: taskB } });
  });

  test("filters another project before conversion and rejects unknown or malformed events", () => {
    expect(
      normalizeOpenCodeEvent(
        envelope(
          "session.created",
          { info: { id: "other" } },
          "/projects/other",
        ),
        projectRoot,
      ),
    ).toBeUndefined();
    expect(
      normalizeOpenCodeEvent(
        envelope("unknown.event", { prompt: "RAW_PROMPT" }),
        projectRoot,
      ),
    ).toBeUndefined();
    expect(
      normalizeOpenCodeEvent(
        {
          directory: projectRoot,
          payload: { type: "session.created", properties: {} },
        },
        projectRoot,
      ),
    ).toBeUndefined();
  });

  test("rejects unsafe paths and oversized todo input", () => {
    expect(
      normalizeOpenCodeEvent(
        envelope("file.edited", { file: "../../outside.txt" }),
        projectRoot,
      ),
    ).toBeUndefined();
    expect(
      normalizeOpenCodeEvent(
        envelope("session.diff", {
          sessionID: "s1",
          diff: [{ file: "C:\\outside.txt", additions: 1, deletions: 0 }],
        }),
        projectRoot,
      ),
    ).toBeUndefined();
    expect(
      normalizeOpenCodeEvent(
        envelope("todo.updated", {
          sessionID: "s1",
          todos: [
            {
              id: "t1",
              status: "pending",
              priority: "medium",
              content: "x".repeat(4_097),
            },
          ],
        }),
        projectRoot,
      ),
    ).toBeUndefined();
  });
});

describe("OpenCodeObserver", () => {
  test("reconciles only after the stream is established", async () => {
    const source = sourceWith({
      events: async () => {
        source.calls.push("global.event");
        return (async function* () {
          yield envelope("session.status", {
            sessionID: "s1",
            status: { type: "idle" },
          });
        })();
      },
    });
    const { dashboard } = await runObserver(source);

    expect(source.calls).toEqual([
      "project.current",
      "vcs.get",
      "global.event",
      "session.list",
      "session.status",
      "session.todo:s1",
    ]);
    expect(dashboard.getSnapshot()).toMatchObject({
      connection: "disconnected",
      project: { name: "demo", branch: "main" },
      sessions: [{ id: expect.stringMatching(/^session:/u), activity: "idle" }],
    });
    expect(dashboard.getSnapshot().lastSuccessfulEventAt).toEqual(
      expect.any(Number),
    );
  });

  test("applies distinct long canonical agent and subtask identities", async () => {
    const prefix = "x".repeat(200);
    const agentNames = [`${prefix}-agent-a`, `${prefix}-agent-b`];
    const taskAgents = [`${prefix}-subtask-a`, `${prefix}-subtask-b`];
    const source = sourceWith({
      events: async () =>
        (async function* () {
          for (const [index, name] of agentNames.entries()) {
            yield envelope("message.part.updated", {
              part: {
                id: `agent-${index}`,
                sessionID: "s1",
                type: "agent",
                name,
              },
            });
          }
          for (const [index, agent] of taskAgents.entries()) {
            yield envelope("message.part.updated", {
              part: {
                id: `task-${index}`,
                sessionID: "s1",
                type: "subtask",
                agent,
              },
            });
          }
        })(),
    });

    const { dashboard } = await runObserver(source);
    const snapshot = dashboard.getSnapshot();
    const agents = snapshot.agents;
    const tasks = snapshot.tasks;
    const agentIds = new Set(agents.map(({ id }) => id));
    const taskIds = new Set(tasks.map(({ id }) => id));

    expect(agents.map(({ sourceIdentity }) => sourceIdentity)).toEqual(
      expect.arrayContaining(agentNames),
    );
    expect(agentIds).toHaveLength(agentNames.length);
    expect(tasks).toHaveLength(taskAgents.length);
    expect(taskIds).toHaveLength(taskAgents.length);
    expect(
      snapshot.edges.filter(({ kind }) => kind === "agent-session"),
    ).toHaveLength(agentNames.length);
    expect(
      snapshot.edges.filter(({ kind }) => kind === "session-task"),
    ).toHaveLength(taskAgents.length);
    expect(
      snapshot.edges
        .filter(({ kind }) => kind === "session-task")
        .map(({ to }) => to),
    ).toEqual(expect.arrayContaining([...taskIds]));
  });

  test("converges sessions, todos, and edges to each reconciliation response", async () => {
    let sessionListCall = 0;
    let todoCall = 0;
    const source = sourceWith({
      sessions: async () => {
        sessionListCall += 1;
        source.calls.push("session.list");
        return sessionListCall === 1
          ? [{ id: "s1" }, { id: "s2" }]
          : [{ id: "s2" }];
      },
      statuses: async () => ({ s1: { type: "busy" }, s2: { type: "idle" } }),
      todos: async (_directory, sessionId) => {
        todoCall += 1;
        source.calls.push(`session.todo:${sessionId}`);
        return todoCall === 1
          ? [{ id: "t1", status: "pending", priority: "high", content: "one" }]
          : todoCall === 2
            ? [{ id: "t2", status: "pending", priority: "low", content: "two" }]
            : [];
      },
      events: async () => {
        return (async function* () {})();
      },
    });

    const { dashboard } = await runObserver(source, {
      maxRetries: 1,
      sleep: async () => {},
    });
    const snapshot = dashboard.getSnapshot();

    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0]?.label).toBe("Session s2");
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.edges).toEqual([]);
  });

  test("removes session-bound tasks when reconciliation returns no sessions", async () => {
    let sessionListCall = 0;
    const source = sourceWith({
      sessions: async () => {
        sessionListCall += 1;
        return sessionListCall === 1 ? [{ id: "s1" }] : [];
      },
      todos: async () => [
        { id: "t1", status: "pending", priority: "high", content: "one" },
      ],
      events: async () => (async function* () {})(),
    });

    const { dashboard } = await runObserver(source, {
      maxRetries: 1,
      sleep: async () => {},
    });
    const snapshot = dashboard.getSnapshot();

    expect(snapshot.sessions).toEqual([]);
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.edges).toEqual([]);
  });

  test("does not expose connected or event freshness before stream establishment", async () => {
    const states: Array<{
      connection: string;
      lastSuccessfulEventAt?: number;
    }> = [];
    const source = sourceWith({
      events: async () => {
        source.calls.push("global.event");
        return (async function* () {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        })();
      },
    });
    const dashboard = store();
    dashboard.subscribe((snapshot) => {
      if (snapshot.connection === "connected") {
        states.push({
          connection: snapshot.connection,
          lastSuccessfulEventAt: snapshot.lastSuccessfulEventAt,
        });
        expect(source.calls).toContain("global.event");
      }
    });
    const observer = new OpenCodeObserver({
      projectRoot,
      store: dashboard,
      source,
      maxRetries: 0,
    });

    await observer.start();
    await observer.done;

    expect(states).toHaveLength(2);
    expect(
      states.every(
        ({ lastSuccessfulEventAt }) => lastSuccessfulEventAt === undefined,
      ),
    ).toBe(true);
  });

  test("keeps stream events ordered after reconciliation and filters sessions", async () => {
    let release: (() => void) | undefined;
    const source = sourceWith({
      sessions: async () => {
        source.calls.push("session.list");
        return [{ id: "s1" }, { id: "s2" }];
      },
      events: async () => {
        source.calls.push("global.event");
        return (async function* () {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          yield envelope("session.created", { info: { id: "s1" } });
          yield envelope("session.created", { info: { id: "s2" } });
          yield envelope(
            "session.created",
            { info: { id: "other" } },
            "/projects/other",
          );
        })();
      },
    });
    const dashboard = store();
    const observer = new OpenCodeObserver({
      projectRoot,
      store: dashboard,
      source,
      maxRetries: 0,
      sessionId: "s1",
    });

    await observer.start();
    expect(dashboard.getSnapshot().connection).toBe("connected");
    release?.();
    await observer.done;

    expect(dashboard.getSnapshot().sessions).toHaveLength(1);
    expect(dashboard.getSnapshot().lastSuccessfulEventAt).toBeDefined();
  });

  test("reconnects with bounded injectable backoff and separates freshness", async () => {
    let attempt = 0;
    const sleeps: number[] = [];
    const source = sourceWith({
      events: async () => {
        source.calls.push(`global.event:${attempt}`);
        attempt += 1;
        if (attempt === 1) {
          return (async function* () {
            yield envelope("session.created", { info: { id: "s1" } });
            throw new Error("RAW_STREAM_ERROR");
          })();
        }
        return (async function* () {
          yield envelope("session.idle", { sessionID: "s1" });
        })();
      },
    });
    const { dashboard } = await runObserver(source, {
      maxRetries: 1,
      retryBaseMs: 10,
      retryMaxMs: 10,
      sleep: async (ms) => sleeps.push(ms),
      onError: vi.fn(),
    });

    expect(sleeps).toEqual([10]);
    expect(source.calls).toContain("global.event:1");
    expect(dashboard.getSnapshot()).toMatchObject({
      connection: "disconnected",
      lastConnectedAt: expect.any(Number),
      lastSuccessfulEventAt: expect.any(Number),
    });
  });

  test("reports an endpoint rejection without advertising a connection", async () => {
    const onError = vi.fn();
    const source = sourceWith({
      events: async () => {
        source.calls.push("global.event");
        throw new Error("RAW_ENDPOINT_ERROR");
      },
    });

    const { dashboard } = await runObserver(source, { onError });

    expect(onError).toHaveBeenCalledWith({ phase: "subscription", attempt: 0 });
    expect(dashboard.getSnapshot().connection).toBe("disconnected");
    expect(dashboard.getSnapshot()).not.toHaveProperty("lastConnectedAt");
    expect(dashboard.getSnapshot()).not.toHaveProperty("lastSuccessfulEventAt");
  });

  test("records malformed and unknown events without leaking raw fields", async () => {
    const source = sourceWith({
      events: async () =>
        (async function* () {
          yield envelope("unknown.event", { output: "RAW_OUTPUT" });
          yield {
            directory: projectRoot,
            payload: { type: "file.edited", properties: {} },
          };
        })(),
    });
    const { dashboard } = await runObserver(source);
    const snapshot = dashboard.getSnapshot();

    expect(snapshot.diagnostics).toMatchObject({
      droppedEvents: 1,
      malformedEvents: 1,
    });
    expect(JSON.stringify(snapshot)).not.toContain("RAW_OUTPUT");
  });

  test("waits for an active iterator to finish returning before close completes", async () => {
    let returned = false;
    let releaseReturn: (() => void) | undefined;
    const source = sourceWith({
      events: async () => {
        const iterator: AsyncIterator<OpenCodeEventEnvelope> = {
          next: () => new Promise(() => {}),
          return: async () => {
            await new Promise<void>((resolve) => {
              releaseReturn = () => {
                returned = true;
                resolve();
              };
            });
            return { done: true, value: undefined };
          },
        };
        return { [Symbol.asyncIterator]: () => iterator };
      },
    });
    const dashboard = store();
    const observer = new OpenCodeObserver({
      projectRoot,
      store: dashboard,
      source,
      maxRetries: 0,
    });

    await observer.start();
    let closeSettled = false;
    let doneSettled = false;
    void observer.done.then(() => {
      doneSettled = true;
    });
    const closing = observer.close().then(() => {
      closeSettled = true;
    });
    expect(closeSettled).toBe(false);
    expect(doneSettled).toBe(false);
    expect(returned).toBe(false);
    await Promise.resolve();
    releaseReturn?.();
    await closing;
    await observer.done;
    expect(returned).toBe(true);
    expect(dashboard.getSnapshot().connection).toBe("disconnected");
    expect(
      dashboard.apply({
        directory: projectRoot,
        type: "session.created",
        properties: { sessionId: "late" },
      }),
    ).toBe(false);
  });

  test("close releases reconciliation and completes only after the run exits", async () => {
    let releaseSessions: (() => void) | undefined;
    let sessionsStarted: (() => void) | undefined;
    const sessionsReady = new Promise<void>((resolve) => {
      sessionsStarted = resolve;
    });
    const source = sourceWith({
      sessions: async () => {
        sessionsStarted?.();
        await new Promise<void>((resolve) => {
          releaseSessions = resolve;
        });
        return [{ id: "s1" }];
      },
    });
    const dashboard = store();
    const observer = new OpenCodeObserver({
      projectRoot,
      store: dashboard,
      source,
      maxRetries: 0,
    });

    void observer.start();
    await sessionsReady;
    let done = false;
    void observer.done.then(() => {
      done = true;
    });
    const closing = observer.close();
    await Promise.resolve();
    expect(done).toBe(false);
    releaseSessions?.();
    await closing;
    await observer.done;
    expect(done).toBe(true);
  });

  test("close releases an injected retry backoff", async () => {
    let releaseSleep: (() => void) | undefined;
    let sleepStarted: (() => void) | undefined;
    const sleepReady = new Promise<void>((resolve) => {
      sleepStarted = resolve;
    });
    const source = sourceWith({
      events: async () => {
        throw new Error("RAW_STREAM_ERROR");
      },
    });
    const observer = new OpenCodeObserver({
      projectRoot,
      store: store(),
      source,
      maxRetries: 1,
      retryBaseMs: 10_000,
      sleep: async () => {
        sleepStarted?.();
        await new Promise<void>((resolve) => {
          releaseSleep = resolve;
        });
      },
    });

    void observer.start();
    await sleepReady;
    let done = false;
    void observer.done.then(() => {
      done = true;
    });
    const closing = observer.close();
    await Promise.resolve();
    expect(done).toBe(false);
    await closing;
    await observer.done;
    releaseSleep?.();
  });
});

describe("createOpenCodeSource", () => {
  test("passes bounded SSE retry options while preserving cancellation", async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    const stream = (async function* () {})();
    const client = {
      global: {
        event: vi.fn(async (options: Record<string, unknown>) => {
          capturedOptions = options;
          return { stream };
        }),
      },
    } as never;
    const source = createOpenCodeSource({ client });
    const controller = new AbortController();

    await source.events(controller.signal);

    expect(capturedOptions).toEqual({
      signal: controller.signal,
      sseDefaultRetryDelay: 0,
      sseMaxRetryAttempts: 1,
      sseMaxRetryDelay: 0,
      sseSleepFn: expect.any(Function),
    });
  });

  test("closes a failed adapter stream without adding another retry layer", async () => {
    let streamClosed = false;
    const stream: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            throw new Error("stream failed");
          },
          return: async () => {
            streamClosed = true;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const event = vi.fn(async () => ({ stream }));
    const client = {
      project: {
        current: async () => ({ data: { worktree: projectRoot } }),
      },
      vcs: {
        get: async () => ({ data: { branch: "main" } }),
      },
      session: {
        list: async () => ({ data: [] }),
        status: async () => ({ data: {} }),
        todo: async () => ({ data: [] }),
      },
      global: { event },
    } as never;
    const dashboard = store();
    const observer = new OpenCodeObserver({
      projectRoot,
      store: dashboard,
      source: createOpenCodeSource({ client }),
      maxRetries: 0,
    });

    await observer.start();
    await observer.done;

    expect(event).toHaveBeenCalledTimes(1);
    expect(streamClosed).toBe(true);
    expect(dashboard.getSnapshot().connection).toBe("disconnected");
  });

  test("uses only the six approved SDK read endpoints", async () => {
    const calls: string[] = [];
    const stream = (async function* () {})();
    const client = {
      project: {
        current: vi.fn(async () => {
          calls.push("project.current");
          return { data: { worktree: projectRoot } };
        }),
      },
      vcs: {
        get: vi.fn(async () => {
          calls.push("vcs.get");
          return { data: { branch: "main" } };
        }),
      },
      session: {
        list: vi.fn(async () => {
          calls.push("session.list");
          return { data: [{ id: "s1" }] };
        }),
        status: vi.fn(async () => {
          calls.push("session.status");
          return { data: { s1: { type: "idle" } } };
        }),
        todo: vi.fn(async () => {
          calls.push("session.todo");
          return {
            data: [
              {
                id: "t1",
                status: "pending",
                priority: "medium",
                content: "safe",
              },
            ],
          };
        }),
      },
      global: {
        event: vi.fn(async () => {
          calls.push("global.event");
          return { stream };
        }),
      },
    } as never;
    const source = createOpenCodeSource({ client });

    await source.projectCurrent(projectRoot);
    await source.vcs(projectRoot);
    await source.sessions(projectRoot);
    await source.statuses(projectRoot);
    await source.todos(projectRoot, "s1");
    await source.events();

    expect(calls).toEqual([
      "project.current",
      "vcs.get",
      "session.list",
      "session.status",
      "session.todo",
      "global.event",
    ]);
    expect(await source.statuses(projectRoot)).toEqual({
      s1: { type: "idle" },
    });
  });
});
