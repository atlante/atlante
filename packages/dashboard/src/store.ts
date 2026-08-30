import {
  type ConnectionState,
  cloneSnapshot,
  DASHBOARD_BOUNDS,
  type DashboardSnapshot,
  dashboardId,
} from "./model.js";
import { applyDashboardEvent, type DashboardEvent } from "./projection.js";

export type DashboardStoreOptions = {
  projectRoot: string;
  staleAfterMs?: number;
  bounds?: Partial<typeof DASHBOARD_BOUNDS>;
  clock?: () => number;
};

export type StoreEvent = DashboardEvent;
export type SnapshotSubscriber = (snapshot: DashboardSnapshot) => void;
type SessionStatus = Extract<
  DashboardEvent,
  { type: "session.status" }
>["properties"]["status"];
type TodoItem = Extract<
  DashboardEvent,
  { type: "todo.updated" }
>["properties"]["items"][number];

export type ReconciledSession = {
  id: string;
  status?: SessionStatus;
  todos?: readonly TodoItem[];
};

export class DashboardStore {
  private snapshot: DashboardSnapshot;
  private readonly subscribers = new Set<SnapshotSubscriber>();
  private readonly projectRoot: string;
  private readonly staleAfterMs: number;
  private readonly bounds: DashboardStoreOptions["bounds"];
  private readonly clock: () => number;
  private staleTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(snapshot: DashboardSnapshot, options: DashboardStoreOptions) {
    this.snapshot = cloneSnapshot(snapshot);
    this.projectRoot = options.projectRoot;
    this.staleAfterMs = options.staleAfterMs ?? DASHBOARD_BOUNDS.staleAfterMs;
    this.bounds = options.bounds;
    this.clock = options.clock ?? Date.now;
  }

  getSnapshot(): DashboardSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  // fallow-ignore-next-line unused-class-member -- Called by OpenCodeObserver during bootstrap.
  setProject(name: string, branch?: string): void {
    if (this.closed) return;
    this.snapshot.project = {
      ...this.snapshot.project,
      name: name.slice(0, DASHBOARD_BOUNDS.maxSafeMessageLength),
      ...(branch === undefined
        ? {}
        : { branch: branch.slice(0, DASHBOARD_BOUNDS.maxSafeMessageLength) }),
    };
    this.notify();
  }

  // fallow-ignore-next-line unused-class-member -- Called by OpenCodeObserver for filtered events.
  recordDroppedEvent(): void {
    if (this.closed) return;
    this.snapshot.diagnostics.droppedEvents += 1;
    this.notify();
  }

  // fallow-ignore-next-line unused-class-member -- Called by OpenCodeObserver for invalid events.
  recordMalformedEvent(): void {
    if (this.closed) return;
    this.snapshot.diagnostics.malformedEvents += 1;
    this.notify();
  }

  subscribe(subscriber: SnapshotSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  apply(event: StoreEvent): boolean {
    if (this.closed) return false;
    return this.applyEvent(event, true, true);
  }

  // fallow-ignore-next-line unused-class-member -- Called by OpenCodeObserver during reconciliation.
  reconcileRuntime(sessions: readonly ReconciledSession[]): void {
    if (this.closed) return;
    const sessionIds = new Set(
      sessions.map(({ id }) => dashboardId("session", id)),
    );
    const todoTaskIds = new Map<string, Set<string>>();
    for (const session of sessions) {
      if (session.todos === undefined) continue;
      todoTaskIds.set(
        dashboardId("session", session.id),
        new Set(session.todos.map(({ id }) => dashboardId("task", id))),
      );
    }
    this.snapshot.sessions = this.snapshot.sessions.filter(({ id }) =>
      sessionIds.has(id),
    );
    this.snapshot.tasks = this.snapshot.tasks.filter((task) => {
      if (!task.sessionId) return true;
      if (!sessionIds.has(task.sessionId)) return false;
      const currentTodoTaskIds = todoTaskIds.get(task.sessionId);
      return (
        currentTodoTaskIds === undefined || currentTodoTaskIds.has(task.id)
      );
    });
    this.pruneEdges();

    for (const session of sessions) {
      this.applyReconciliationEvent({
        directory: this.projectRoot,
        type: "session.created",
        properties: { sessionId: session.id },
      });
      if (session.todos !== undefined) {
        this.applyReconciliationEvent({
          directory: this.projectRoot,
          type: "todo.updated",
          properties: { sessionId: session.id, items: [...session.todos] },
        });
      }
      if (session.status !== undefined) {
        this.applyReconciliationEvent({
          directory: this.projectRoot,
          type: "session.status",
          properties: { sessionId: session.id, status: session.status },
        });
      }
    }
    this.pruneEdges();
    this.notify();
  }

  private applyEvent(
    event: StoreEvent,
    refreshEventState: boolean,
    notifySubscriber: boolean,
  ): boolean {
    const now = this.clock();
    const result = applyDashboardEvent(this.snapshot, event, {
      projectRoot: this.projectRoot,
      now,
      bounds: this.bounds,
    });
    this.snapshot = result.snapshot;
    if (result.accepted && refreshEventState) {
      this.snapshot.connection = "connected";
      this.snapshot.stale = false;
      this.snapshot.sources.runtime = "connected";
      this.snapshot.lastSuccessfulEventAt = now;
      this.refreshObservedState();
      this.scheduleStaleTimer();
    }
    if (notifySubscriber) this.notify();
    return result.accepted;
  }

  private applyReconciliationEvent(event: StoreEvent): void {
    const recentEvents = this.snapshot.recentEvents;
    const diagnostics = this.snapshot.diagnostics;
    const accepted = this.applyEvent(event, false, false);
    if (!accepted) return;
    this.snapshot.recentEvents = recentEvents;
    this.snapshot.diagnostics = diagnostics;
  }

  private pruneEdges(): void {
    const nodeIds = new Set([
      ...this.snapshot.agents.map(({ id }) => id),
      ...this.snapshot.skills.map(({ id }) => id),
      ...this.snapshot.sessions.map(({ id }) => id),
      ...this.snapshot.tasks.map(({ id }) => id),
    ]);
    this.snapshot.edges = this.snapshot.edges.filter(
      (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to),
    );
  }

  setConnection(
    connection: ConnectionState,
    connectionTime = this.clock(),
  ): void {
    if (this.closed) return;
    this.snapshot.connection = connection;
    if (connection === "connected") {
      this.snapshot.sources.runtime = "connected";
      this.snapshot.lastConnectedAt = connectionTime;
      if (
        !this.snapshot.stale &&
        this.snapshot.lastSuccessfulEventAt !== undefined
      ) {
        this.scheduleStaleTimer();
      }
    } else {
      this.markStale();
      this.snapshot.sources.runtime = "unavailable";
      this.clearStaleTimer();
    }
    this.notify();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearStaleTimer();
    this.snapshot.connection = "disconnected";
    this.snapshot.sources.runtime = "unavailable";
    this.markStale();
    this.notify();
    this.subscribers.clear();
  }

  private scheduleStaleTimer(): void {
    this.clearStaleTimer();
    this.staleTimer = setTimeout(() => {
      this.staleTimer = undefined;
      if (!this.closed && this.snapshot.connection === "connected") {
        this.markStale();
        this.snapshot.sources.runtime = "unavailable";
        this.notify();
      }
    }, this.staleAfterMs);
    if (typeof this.staleTimer === "object" && "unref" in this.staleTimer) {
      this.staleTimer.unref();
    }
  }

  private clearStaleTimer(): void {
    if (this.staleTimer !== undefined) clearTimeout(this.staleTimer);
    this.staleTimer = undefined;
  }

  private markStale(): void {
    this.snapshot.stale = true;
    for (const session of this.snapshot.sessions) {
      if (session.status === "observed") session.status = "stale";
    }
    for (const task of this.snapshot.tasks) {
      if (task.status === "observed") task.status = "stale";
    }
    for (const agent of this.snapshot.agents) {
      if (agent.status === "observed") agent.status = "stale";
    }
  }

  private refreshObservedState(): void {
    for (const node of [
      ...this.snapshot.agents,
      ...this.snapshot.sessions,
      ...this.snapshot.tasks,
    ]) {
      if (node.status === "stale") node.status = "observed";
    }
  }

  private notify(): void {
    if (this.closed && this.subscribers.size === 0) return;
    for (const subscriber of this.subscribers) subscriber(this.getSnapshot());
  }
}
