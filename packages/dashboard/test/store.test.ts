import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createEmptySnapshot,
  type DashboardSnapshot,
  dashboardId,
} from "../src/model.js";
import { DashboardStore } from "../src/store.js";

const projectRoot = "/projects/demo";

function store(options?: ConstructorParameters<typeof DashboardStore>[1]) {
  return new DashboardStore(createEmptySnapshot({ name: "demo" }), {
    projectRoot,
    ...options,
  });
}

function session(id: string, _now: number) {
  return {
    directory: projectRoot,
    type: "session.created",
    properties: { sessionId: id },
  };
}

afterEach(() => vi.useRealTimers());

describe("DashboardStore", () => {
  test("evicts bounded collections by oldest activity and stable ID", () => {
    let currentTime = 100;
    const dashboard = store({
      bounds: { maxSessions: 2, maxEvents: 2 },
      clock: () => currentTime,
    });

    dashboard.apply(session("b", 100));
    dashboard.apply(session("a", 100));
    currentTime = 101;
    dashboard.apply(session("c", 101));

    expect(dashboard.getSnapshot().sessions.map(({ id }) => id)).toEqual([
      dashboardId("session", "a"),
      dashboardId("session", "c"),
    ]);
    expect(dashboard.getSnapshot().diagnostics.droppedEvents).toBe(1);
  });

  test("bounds events and notifies subscribers with snapshots", () => {
    let currentTime = 1;
    const dashboard = store({
      bounds: { maxEvents: 2 },
      clock: () => currentTime,
    });
    const snapshots: number[] = [];
    const unsubscribe = dashboard.subscribe((snapshot) => {
      snapshots.push(snapshot.recentEvents.length);
    });

    dashboard.apply(session("one", 1));
    currentTime = 2;
    dashboard.apply(session("two", 2));
    currentTime = 3;
    dashboard.apply(session("three", 3));
    unsubscribe();
    currentTime = 4;
    dashboard.apply(session("four", 4));

    expect(dashboard.getSnapshot().recentEvents).toHaveLength(2);
    expect(dashboard.getSnapshot().diagnostics.droppedEvents).toBe(2);
    expect(snapshots).toEqual([1, 2, 2]);
  });

  test("transitions through connected, reconnecting, disconnected, and stale", () => {
    vi.useFakeTimers();
    let currentTime = 1_000;
    const dashboard = store({ staleAfterMs: 100, clock: () => currentTime });

    dashboard.setConnection("connected", 1_000);
    expect(dashboard.getSnapshot()).toMatchObject({
      connection: "connected",
      stale: true,
      lastConnectedAt: 1_000,
      sources: { runtime: "connected" },
    });
    expect(dashboard.getSnapshot().lastSuccessfulEventAt).toBeUndefined();

    dashboard.apply(session("one", 1_000));
    dashboard.setConnection("reconnecting");
    expect(dashboard.getSnapshot()).toMatchObject({
      connection: "reconnecting",
      stale: true,
      sources: { runtime: "unavailable" },
    });
    expect(dashboard.getSnapshot().sessions[0]?.status).toBe("stale");

    dashboard.setConnection("disconnected");
    expect(dashboard.getSnapshot().connection).toBe("disconnected");

    dashboard.setConnection("connected", 2_000);
    expect(dashboard.getSnapshot()).toMatchObject({
      connection: "connected",
      stale: true,
      lastConnectedAt: 2_000,
    });
    expect(dashboard.getSnapshot().lastSuccessfulEventAt).toBe(1_000);

    currentTime = 2_001;
    expect(dashboard.apply(session("two", 2_001))).toBe(true);
    expect(dashboard.getSnapshot()).toMatchObject({
      stale: false,
      sources: { runtime: "connected" },
    });
    expect(
      dashboard
        .getSnapshot()
        .sessions.every(({ status }) => status === "observed"),
    ).toBe(true);
  });

  test("close is terminal and ignores later events, connections, and subscribers", () => {
    const dashboard = store();
    const snapshots: DashboardSnapshot[] = [];
    dashboard.subscribe((snapshot) => snapshots.push(snapshot));
    dashboard.close();
    const before = dashboard.getSnapshot();

    expect(dashboard.apply(session("late", 1_000))).toBe(false);
    dashboard.setConnection("connected", 2_000);

    expect(dashboard.getSnapshot()).toEqual(before);
    expect(snapshots).toHaveLength(1);
  });

  test("connection establishment does not refresh event freshness", () => {
    const currentTime = 1_000;
    const dashboard = store({ staleAfterMs: 100, clock: () => currentTime });
    dashboard.apply(session("one", 1_000));
    dashboard.setConnection("reconnecting", 1_100);
    dashboard.setConnection("connected", 2_000);

    expect(dashboard.getSnapshot()).toMatchObject({
      connection: "connected",
      stale: true,
      lastConnectedAt: 2_000,
      lastSuccessfulEventAt: 1_000,
      sources: { runtime: "connected" },
    });
  });

  test("stales accepted event state after reconnect without changing event time", () => {
    vi.useFakeTimers();
    let currentTime = 1_000;
    const dashboard = store({ staleAfterMs: 100, clock: () => currentTime });

    dashboard.setConnection("connected", 1_000);
    dashboard.apply(session("one", 1_000));
    dashboard.setConnection("reconnecting", 1_050);
    dashboard.setConnection("connected", 2_000);
    expect(dashboard.getSnapshot()).toMatchObject({
      stale: true,
      lastConnectedAt: 2_000,
      lastSuccessfulEventAt: 1_000,
    });

    currentTime = 2_001;
    dashboard.apply(session("two", 2_001));
    vi.advanceTimersByTime(99);
    expect(dashboard.getSnapshot().stale).toBe(false);
    vi.advanceTimersByTime(1);
    expect(dashboard.getSnapshot().stale).toBe(true);
  });

  test("preserves configured agents when observed-agent capacity is full", () => {
    const dashboard = new DashboardStore(
      createEmptySnapshot({
        name: "demo",
        agents: [
          {
            kind: "agent",
            id: "agent:configured",
            sourceIdentity: "configured",
            label: "configured",
            description: "Configured",
            status: "configured",
            evidence: "artifact-manifest",
            relatedIds: [],
          },
        ],
      }),
      {
        projectRoot,
        bounds: { maxConfiguredAgents: 1, maxObservedAgents: 1 },
        clock: () => 100,
      },
    );

    expect(
      dashboard.apply({
        directory: projectRoot,
        type: "message.part.updated",
        properties: { sessionId: "s1", partType: "agent", agentId: "observed" },
      }),
    ).toBe(true);
    expect(
      dashboard
        .getSnapshot()
        .agents.map(({ sourceIdentity }) => sourceIdentity),
    ).toEqual(["configured", "observed"]);
  });

  test("rejects raw event envelopes and nested SDK properties", () => {
    const dashboard = store();

    expect(
      dashboard.apply({
        directory: projectRoot,
        type: "session.created",
        properties: { info: { id: "raw" } },
      } as never),
    ).toBe(false);
    expect(
      dashboard.apply({
        directory: projectRoot,
        type: "message.part.updated",
        properties: {
          sessionId: "raw",
          partType: "agent",
          agentId: "raw",
          output: "RAW_OUTPUT",
        },
      } as never),
    ).toBe(false);
    expect(dashboard.getSnapshot().sessions).toEqual([]);
    expect(dashboard.getSnapshot().agents).toEqual([]);
  });
});
