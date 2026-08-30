import { describe, expect, test } from "vitest";
import {
  createEmptySnapshot,
  DASHBOARD_BOUNDS,
  type DashboardEvent,
  dashboardId,
  IdentityRegistry,
} from "../src/model.js";
import { applyDashboardEvent } from "../src/projection.js";

const projectRoot = "/projects/demo";

function event<T extends DashboardEvent["type"]>(
  type: T,
  properties: Extract<DashboardEvent, { type: T }>["properties"],
): Extract<DashboardEvent, { type: T }> {
  return {
    directory: projectRoot,
    type,
    properties,
  } as Extract<DashboardEvent, { type: T }>;
}

function baseSnapshot() {
  return createEmptySnapshot({
    name: "demo",
    agents: [
      {
        id: "agent:configured",
        sourceIdentity: "reviewer",
        label: "reviewer",
        description: "Reviews changes",
        status: "configured",
        evidence: "artifact-manifest",
        relatedIds: [],
      },
    ],
  });
}

describe("applyDashboardEvent", () => {
  test("disambiguates a registry collision without truncating source identity", () => {
    const registry = new IdentityRegistry();
    const first = registry.seed("agent", "agent:collision", "first");
    const second = registry.seed("agent", "agent:collision", "second");

    expect(second).not.toBe(first);
    expect(second.length).toBeLessThanOrEqual(128);
    expect(registry.register("agent", "second")).toBe(second);
  });

  test.each([
    ["session.created", { sessionId: "s1" }, "session"],
    ["session.updated", { sessionId: "s1" }, "session"],
    ["session.status", { sessionId: "s1", status: "busy" }, "session"],
    ["session.idle", { sessionId: "s1" }, "session"],
    [
      "message.part.updated",
      { sessionId: "s1", partId: "p1", partType: "agent", agentId: "reviewer" },
      "message.part.updated",
    ],
    [
      "todo.updated",
      {
        sessionId: "s1",
        items: [{ id: "t1", status: "pending", priority: "high" }],
      },
      "task",
    ],
    [
      "permission.updated",
      { sessionId: "s1", permissionId: "p1", status: "pending" },
      "permission",
    ],
    [
      "permission.replied",
      { sessionId: "s1", permissionId: "p1", status: "resolved" },
      "permission",
    ],
    ["session.error", { kind: "provider" }, "session.error"],
    [
      "file.edited",
      { sessionId: "s1", path: "src/index.ts", count: 2 },
      "file.edited",
    ],
    [
      "session.diff",
      {
        sessionId: "s1",
        files: [
          { path: "a.ts", count: 1 },
          { path: "b.ts", count: 2 },
        ],
      },
      "session.diff",
    ],
    [
      "command.executed",
      { sessionId: "s1", commandName: "test" },
      "command.executed",
    ],
  ] as const)("supports %s", (type, properties, expectedKind) => {
    const result = applyDashboardEvent(
      baseSnapshot(),
      event(type, properties),
      {
        projectRoot,
        now: 100,
      },
    );

    expect(result.accepted).toBe(true);
    expect(result.snapshot.recentEvents[0]?.kind).toBe(expectedKind);
    expect(result.snapshot.diagnostics).toEqual({
      droppedEvents: 0,
      malformedEvents: 0,
    });
  });

  test("projects canonical lifecycle IDs and deletes the session", () => {
    const created = applyDashboardEvent(
      baseSnapshot(),
      event("session.created", { sessionId: "s1" }),
      { projectRoot, now: 100 },
    );
    const deleted = applyDashboardEvent(
      created.snapshot,
      event("session.deleted", { sessionId: "s1" }),
      { projectRoot, now: 101 },
    );

    expect(created.snapshot.sessions).toHaveLength(1);
    expect(deleted.accepted).toBe(true);
    expect(deleted.snapshot.sessions).toEqual([]);
  });

  test("uses the canonical agent part name and diff array count", () => {
    const result = applyDashboardEvent(
      baseSnapshot(),
      event("message.part.updated", {
        sessionId: "s1",
        partId: "p1",
        partType: "agent",
        agentId: "reviewer",
      }),
      { projectRoot, now: 100 },
    );
    const diff = applyDashboardEvent(
      result.snapshot,
      event("session.diff", {
        sessionId: "s1",
        files: [
          { path: "a.ts", count: 1 },
          { path: "b.ts", count: 2 },
        ],
      }),
      { projectRoot, now: 101 },
    );

    expect(
      result.snapshot.agents.some(({ label }) => label === "reviewer"),
    ).toBe(true);
    expect(diff.snapshot.recentEvents[0]).toMatchObject({
      count: 2,
      files: [
        { path: "a.ts", count: 1 },
        { path: "b.ts", count: 2 },
      ],
    });
  });

  test("accepts project-level errors and safely classifies canonical error names", () => {
    const result = applyDashboardEvent(
      baseSnapshot(),
      event("session.error", { kind: "provider" }),
      { projectRoot, now: 100 },
    );

    expect(result.accepted).toBe(true);
    expect(result.snapshot.attention).toMatchObject([
      { kind: "error", status: "pending" },
    ]);
    expect(result.snapshot.recentEvents[0]?.summary).toBe(
      "Session error: provider",
    );
    expect(JSON.stringify(result.snapshot)).not.toContain(
      "FORBIDDEN_ERROR_TEXT",
    );
  });

  test("classifies a canonical session error without retaining its raw name", () => {
    const result = applyDashboardEvent(
      baseSnapshot(),
      event("session.error", {
        sessionId: "s1",
        kind: "timeout",
      }),
      { projectRoot, now: 100 },
    );

    expect(result.snapshot.sessions[0]?.status).toBe("error");
    expect(result.snapshot.recentEvents[0]?.summary).toBe(
      "Session error: timeout",
    );
    expect(JSON.stringify(result.snapshot)).not.toContain(
      "FORBIDDEN_ERROR_TEXT",
    );
  });

  test("rejects raw SDK payload envelopes at the projection boundary", () => {
    const result = applyDashboardEvent(
      baseSnapshot(),
      {
        directory: projectRoot,
        payload: {
          type: "session.created",
          properties: { info: { id: "s1" } },
        },
      } as unknown as DashboardEvent,
      { projectRoot, now: 100 },
    );

    expect(result.accepted).toBe(false);
    expect(result.snapshot.sessions).toEqual([]);
    expect(result.snapshot.diagnostics.malformedEvents).toBe(1);
  });

  test("rejects raw SDK-shaped properties and extra safe-looking fields", () => {
    const rawPart = applyDashboardEvent(
      baseSnapshot(),
      event("message.part.updated", {
        sessionId: "s1",
        partType: "agent",
        agentId: "reviewer",
        part: {
          id: "p1",
          type: "agent",
          name: "reviewer",
          output: "RAW_OUTPUT",
        },
      } as never),
      { projectRoot, now: 100 },
    );
    const rawCommand = applyDashboardEvent(
      baseSnapshot(),
      event("command.executed", {
        sessionId: "s1",
        commandName: "test",
        output: "RAW_OUTPUT",
      } as never),
      { projectRoot, now: 100 },
    );

    expect(rawPart.accepted).toBe(false);
    expect(rawCommand.accepted).toBe(false);
    expect(rawPart.snapshot.diagnostics.malformedEvents).toBe(1);
    expect(rawCommand.snapshot.diagnostics.malformedEvents).toBe(1);
  });

  test("filters events from another selected project", () => {
    const before = baseSnapshot();

    const result = applyDashboardEvent(
      before,
      {
        ...event("session.created", { sessionId: "other" }),
        directory: "/projects/other",
      },
      { projectRoot, now: 100 },
    );

    expect(result.accepted).toBe(false);
    expect(result.snapshot.sessions).toEqual([]);
    expect(result.snapshot.diagnostics.droppedEvents).toBe(1);
    expect(result.snapshot.diagnostics.malformedEvents).toBe(0);
  });

  test("rejects escaping paths without changing existing state", () => {
    const before = baseSnapshot();

    const result = applyDashboardEvent(
      before,
      event("file.edited", { path: "../../secret.txt", count: 1 }),
      { projectRoot, now: 100 },
    );

    expect(result.accepted).toBe(false);
    expect(result.snapshot.recentEvents).toEqual([]);
    expect(result.snapshot.diagnostics.droppedEvents).toBe(1);
  });

  test("drops unknown and malformed events while retaining prior state", () => {
    const before = applyDashboardEvent(
      baseSnapshot(),
      event("session.created", { sessionId: "s1" }),
      { projectRoot, now: 100 },
    ).snapshot;

    const unknown = applyDashboardEvent(
      before,
      {
        directory: projectRoot,
        type: "message.part.deleted",
        properties: {},
      } as never,
      { projectRoot, now: 101 },
    );
    const malformed = applyDashboardEvent(
      unknown.snapshot,
      { directory: projectRoot, type: "session.created", properties: {} },
      { projectRoot, now: 102 },
    );

    expect(unknown.accepted).toBe(false);
    expect(unknown.snapshot.sessions).toHaveLength(1);
    expect(unknown.snapshot.diagnostics.droppedEvents).toBe(1);
    expect(malformed.accepted).toBe(false);
    expect(malformed.snapshot.sessions).toHaveLength(1);
    expect(malformed.snapshot.diagnostics.malformedEvents).toBe(1);
  });

  test.each([
    [
      "extra keys",
      {
        directory: projectRoot,
        type: "session.created",
        properties: { sessionId: "s1", title: "ignored" },
      },
      "malformed",
    ],
    [
      "missing keys",
      { directory: projectRoot, type: "session.created", properties: {} },
      "malformed",
    ],
    [
      "invalid enum values",
      {
        directory: projectRoot,
        type: "session.status",
        properties: { sessionId: "s1", status: "running" },
      },
      "malformed",
    ],
    [
      "oversized collections",
      {
        directory: projectRoot,
        type: "todo.updated",
        properties: {
          sessionId: "s1",
          items: Array.from(
            { length: DASHBOARD_BOUNDS.maxTodoItems + 1 },
            (_) => ({ id: "todo" }),
          ),
        },
      },
      "malformed",
    ],
    [
      "unknown event types",
      {
        directory: projectRoot,
        type: "session.renamed",
        properties: { name: "ignored" },
      },
      "dropped",
    ],
  ] as const)(
    "classifies %s without changing prior state",
    (_, input, outcome) => {
      const before = applyDashboardEvent(
        baseSnapshot(),
        event("session.created", { sessionId: "existing" }),
        { projectRoot, now: 100 },
      ).snapshot;
      const result = applyDashboardEvent(before, input as never, {
        projectRoot,
        now: 101,
      });

      expect(result.accepted).toBe(false);
      expect(result.snapshot.sessions).toEqual(before.sessions);
      expect(result.snapshot.recentEvents).toEqual(before.recentEvents);
      expect(result.snapshot.diagnostics).toEqual({
        droppedEvents: outcome === "dropped" ? 1 : 0,
        malformedEvents: outcome === "malformed" ? 1 : 0,
      });
    },
  );

  test("does not retain prompt, output, argument, or permission metadata", () => {
    const result = applyDashboardEvent(
      baseSnapshot(),
      event("command.executed", { sessionId: "s1", commandName: "test" }),
      { projectRoot, now: 100 },
    );
    const serialized = JSON.stringify(result.snapshot);

    expect(serialized).not.toContain("FORBIDDEN_COMMAND_ARGUMENTS");
    expect(serialized).not.toContain("FORBIDDEN_RESPONSE");
    expect(serialized).not.toContain("FORBIDDEN_PROMPT");
    expect(serialized).not.toContain("FORBIDDEN_PERMISSION_METADATA");
  });

  test("rejects a partially malformed todo update atomically", () => {
    const result = applyDashboardEvent(
      baseSnapshot(),
      event("todo.updated", {
        sessionId: "s1",
        items: [{ id: "valid" }, { status: "pending" }],
      }),
      { projectRoot, now: 100 },
    );

    expect(result.accepted).toBe(false);
    expect(result.snapshot.tasks).toEqual([]);
    expect(result.snapshot.diagnostics.malformedEvents).toBe(1);
    expect(JSON.stringify(result.snapshot)).not.toContain(
      "FORBIDDEN_TODO_CONTENT",
    );
  });

  test("never infers workflow activity from runtime events", () => {
    const result = applyDashboardEvent(
      baseSnapshot(),
      event("session.created", { sessionId: "workflow-session" }),
      { projectRoot, now: 100 },
    );

    expect(result.snapshot.workflows).toEqual([]);
    expect(result.snapshot.sources.workflows).toBe("unavailable");
    expect(JSON.stringify(result.snapshot)).toContain("workflow-session");
  });

  test.each([
    "C:\\other\\secret.txt",
    "C:relative\\secret.txt",
    "\\rooted\\secret.txt",
    "\\\\server\\share\\secret.txt",
    "//server/share/secret.txt",
    "\\\\.\\pipe\\secret",
    "\\\\?\\C:\\secret.txt",
    "../../secret.txt",
    "..\\..\\secret.txt",
  ])("rejects unsafe cross-platform path %s", (path) => {
    const result = applyDashboardEvent(
      baseSnapshot(),
      event("file.edited", { path }),
      { projectRoot, now: 100 },
    );

    expect(result.accepted).toBe(false);
    expect(result.snapshot.recentEvents).toEqual([]);
  });

  test("bounds observed agents, edges, related IDs, and todo input", () => {
    let snapshot = baseSnapshot();
    for (let index = 0; index < 5; index += 1) {
      const result = applyDashboardEvent(
        snapshot,
        event("message.part.updated", {
          sessionId: `s${index}`,
          partId: `p${index}`,
          partType: "agent",
          agentId: `agent-${index}`,
        }),
        {
          projectRoot,
          now: index,
          bounds: {
            maxAgents: 2,
            maxSessions: 2,
            maxEdges: 2,
            maxRelatedIds: 1,
          },
        },
      );
      snapshot = result.snapshot;
    }
    const oversizedTodo = applyDashboardEvent(
      snapshot,
      event("todo.updated", {
        sessionId: "s1",
        items: Array.from({ length: 5 }, (_, index) => ({ id: `t${index}` })),
      }),
      {
        projectRoot,
        now: 10,
        bounds: { maxTodoItems: 2 },
      },
    );

    expect(snapshot.agents.length).toBeLessThanOrEqual(2);
    expect(snapshot.sessions.length).toBeLessThanOrEqual(2);
    expect(snapshot.edges.length).toBeLessThanOrEqual(2);
    expect(
      snapshot.agents.every(({ relatedIds }) => relatedIds.length <= 1),
    ).toBe(true);
    expect(oversizedTodo.accepted).toBe(false);
    expect(oversizedTodo.snapshot.diagnostics.droppedEvents).toBeGreaterThan(0);
  });

  test("bounds tasks, attention, and recent events", () => {
    let snapshot = baseSnapshot();
    for (let index = 0; index < 4; index += 1) {
      snapshot = applyDashboardEvent(
        snapshot,
        event("todo.updated", {
          sessionId: "s1",
          items: [{ id: `t${index}`, status: "pending" }],
        }),
        {
          projectRoot,
          now: index,
          bounds: { maxTasks: 2, maxEvents: 2 },
        },
      ).snapshot;
    }
    for (let index = 0; index < 4; index += 1) {
      snapshot = applyDashboardEvent(
        snapshot,
        event("permission.updated", {
          permissionId: `p${index}`,
          status: "pending",
        }),
        {
          projectRoot,
          now: index + 10,
          bounds: { maxAttention: 2, maxEvents: 2 },
        },
      ).snapshot;
    }

    expect(snapshot.tasks).toHaveLength(2);
    expect(snapshot.attention).toHaveLength(2);
    expect(snapshot.recentEvents).toHaveLength(2);
  });

  test("prunes with stable ties, separate agent quotas, orphan removal, and rebuilt relations", () => {
    const configured = baseSnapshot();
    let snapshot = applyDashboardEvent(
      configured,
      event("message.part.updated", {
        sessionId: "s1",
        partId: "p1",
        partType: "agent",
        agentId: "observed-one",
      }),
      {
        projectRoot,
        now: 100,
        bounds: {
          maxConfiguredAgents: 1,
          maxObservedAgents: 1,
          maxSessions: 2,
          maxTasks: 2,
          maxEdges: 2,
          maxRelatedIds: 1,
        },
      },
    ).snapshot;
    snapshot = applyDashboardEvent(
      snapshot,
      event("todo.updated", {
        sessionId: "s1",
        items: [{ id: "task-one", status: "pending" }],
      }),
      {
        projectRoot,
        now: 100,
        bounds: {
          maxConfiguredAgents: 1,
          maxObservedAgents: 1,
          maxSessions: 2,
          maxTasks: 2,
          maxEdges: 2,
          maxRelatedIds: 1,
        },
      },
    ).snapshot;
    snapshot = applyDashboardEvent(
      snapshot,
      event("message.part.updated", {
        sessionId: "s2",
        partId: "p2",
        partType: "agent",
        agentId: "observed-two",
      }),
      {
        projectRoot,
        now: 101,
        bounds: {
          maxConfiguredAgents: 1,
          maxObservedAgents: 1,
          maxSessions: 1,
          maxTasks: 2,
          maxEdges: 2,
          maxRelatedIds: 1,
        },
      },
    ).snapshot;

    expect(snapshot.agents.map(({ sourceIdentity }) => sourceIdentity)).toEqual(
      ["reviewer", "observed-two"],
    );
    expect(snapshot.sessions.map(({ id }) => id)).toEqual([
      dashboardId("session", "s2"),
    ]);
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.edges).toHaveLength(1);
    expect(snapshot.edges[0]).toMatchObject({
      from: dashboardId("session", "s2"),
      to: dashboardId("agent", "observed-two"),
    });
    expect(snapshot.sessions[0]?.relatedIds).toEqual([
      dashboardId("agent", "observed-two"),
    ]);
    expect(
      snapshot.agents.every(({ relatedIds }) => relatedIds.length <= 1),
    ).toBe(true);

    const retained = ["a", "b", "c"].reduce(
      (current, next) =>
        applyDashboardEvent(
          current,
          event("session.created", { sessionId: next }),
          { projectRoot, now: 200, bounds: { maxSessions: 2 } },
        ).snapshot,
      createEmptySnapshot({ name: "demo" }),
    );
    const expected = ["a", "b", "c"]
      .map((id) => dashboardId("session", id))
      .sort((left, right) => left.localeCompare(right))
      .slice(1);
    expect(retained.sessions.map(({ id }) => id)).toEqual(expected);
  });

  test("prunes relationships when a session endpoint disappears", () => {
    const created = applyDashboardEvent(
      baseSnapshot(),
      event("message.part.updated", {
        sessionId: "s1",
        partId: "p1",
        partType: "agent",
        agentId: "runtime-agent",
      }),
      { projectRoot, now: 100 },
    );
    const deleted = applyDashboardEvent(
      created.snapshot,
      event("session.deleted", { sessionId: "s1" }),
      { projectRoot, now: 101 },
    );

    expect(deleted.snapshot.sessions).toEqual([]);
    expect(deleted.snapshot.edges).toEqual([]);
    expect(deleted.snapshot.agents[0]?.relatedIds).toEqual([]);
  });

  test("rejects oversized todo content before creating a task", () => {
    const result = applyDashboardEvent(
      baseSnapshot(),
      event("todo.updated", {
        sessionId: "s1",
        items: [{ id: "t1", content: "x".repeat(20) }],
      } as never),
      { projectRoot, now: 100, bounds: { maxTodoContentLength: 10 } },
    );

    expect(result.accepted).toBe(false);
    expect(result.snapshot.tasks).toEqual([]);
    expect(result.snapshot.diagnostics.malformedEvents).toBe(1);
  });

  test("does not merge long identities that share a bounded prefix", () => {
    const prefix = "x".repeat(200);
    const first = applyDashboardEvent(
      baseSnapshot(),
      event("message.part.updated", {
        sessionId: "s1",
        partId: "p1",
        partType: "agent",
        agentId: `${prefix}-a`,
      }),
      { projectRoot, now: 100 },
    );
    const second = applyDashboardEvent(
      first.snapshot,
      event("message.part.updated", {
        sessionId: "s1",
        partId: "p2",
        partType: "agent",
        agentId: `${prefix}-b`,
      }),
      { projectRoot, now: 101 },
    );

    expect(
      second.snapshot.agents.filter(({ status }) => status === "observed"),
    ).toHaveLength(2);
    expect(new Set(second.snapshot.agents.map(({ id }) => id)).size).toBe(
      second.snapshot.agents.length,
    );
    expect(
      second.snapshot.agents.every(
        ({ id, label }) => id.length <= 128 && label.length <= 160,
      ),
    ).toBe(true);
  });

  test("matches configured agents by full source identity, never by label", () => {
    const prefix = "x".repeat(200);
    const result = applyDashboardEvent(
      createEmptySnapshot({
        name: "demo",
        agents: [
          {
            id: "agent:configured",
            sourceIdentity: `${prefix}-configured`,
            label: prefix.slice(0, 160),
            description: "Configured",
            status: "configured",
            evidence: "artifact-manifest",
            relatedIds: [],
          },
        ],
      }),
      event("message.part.updated", {
        sessionId: "s1",
        partType: "agent",
        agentId: `${prefix}-observed`,
      }),
      { projectRoot, now: 100 },
    );

    expect(result.snapshot.agents).toHaveLength(2);
    expect(
      result.snapshot.agents.map(({ sourceIdentity }) => sourceIdentity),
    ).toEqual(
      expect.arrayContaining([`${prefix}-configured`, `${prefix}-observed`]),
    );
  });

  test("retains bounded safe summaries for canonical diff files", () => {
    const result = applyDashboardEvent(
      baseSnapshot(),
      event("session.diff", {
        sessionId: "s1",
        files: [
          { path: "src/a.ts", count: 3 },
          { path: "src/b.ts", count: 1 },
        ],
      }),
      { projectRoot, now: 100 },
    );

    expect(result.snapshot.recentEvents[0]).toMatchObject({
      count: 2,
      files: [
        { path: "src/a.ts", count: 3 },
        { path: "src/b.ts", count: 1 },
      ],
    });
  });

  test("supports medium todo priority", () => {
    const result = applyDashboardEvent(
      baseSnapshot(),
      event("todo.updated", {
        sessionId: "s1",
        items: [{ id: "t1", status: "pending", priority: "medium" }],
      }),
      { projectRoot, now: 100 },
    );

    expect(result.snapshot.tasks[0]?.priority).toBe("medium");
  });

  test("never retains a relation to an unretained part endpoint", () => {
    const result = applyDashboardEvent(
      baseSnapshot(),
      event("message.part.updated", {
        sessionId: "s1",
        partId: "p1",
        partType: "tool",
      }),
      { projectRoot, now: 100 },
    );

    const retained = new Set(
      [
        ...result.snapshot.agents,
        ...result.snapshot.sessions,
        ...result.snapshot.tasks,
      ].map(({ id }) => id),
    );
    expect(
      result.snapshot.edges.every(
        ({ from, to }) => retained.has(from) && retained.has(to),
      ),
    ).toBe(true);
    expect(
      result.snapshot.edges.some(({ kind }) => kind === "part-session"),
    ).toBe(false);
  });
});
