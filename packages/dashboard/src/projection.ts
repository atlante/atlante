import { isAbsolute, relative, resolve } from "node:path";
import {
  bounded,
  isRecord,
  isSafePathInput,
  type RecordValue,
  stringValue,
} from "./dashboard-utils.js";
import {
  type AgentNode,
  type AttentionItem,
  cloneSnapshot,
  DASHBOARD_BOUNDS,
  type DashboardEvent,
  type DashboardSnapshot,
  dashboardId,
  type EventSummary,
  type EventSummaryKind,
  IdentityRegistry,
  type NodeStatus,
  type SessionNode,
  type TaskNode,
  type TaskPriority,
  type TaskStatus,
} from "./model.js";

export type { DashboardEvent } from "./model.js";
export type AllowedEventType = DashboardEvent["type"];

export type ProjectionOptions = {
  projectRoot: string;
  now?: number;
  bounds?: Partial<typeof DASHBOARD_BOUNDS>;
};

export type ProjectionResult = {
  accepted: boolean;
  snapshot: DashboardSnapshot;
};

const supported = new Set([
  "session.created",
  "session.updated",
  "session.deleted",
  "session.status",
  "session.idle",
  "message.part.updated",
  "todo.updated",
  "permission.updated",
  "permission.replied",
  "session.error",
  "file.edited",
  "session.diff",
  "command.executed",
]);

function idValue(value: unknown): string | undefined {
  const valueAsString = stringValue(value);
  return valueAsString;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const result = idValue(value);
    if (result) return result;
  }
  return undefined;
}

function exactKeys(value: RecordValue, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function allowedKeys(value: RecordValue, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function nonEmptyString(value: unknown): value is string {
  return stringValue(value) !== undefined;
}

function optionalString(value: RecordValue, key: string): boolean {
  return !Object.hasOwn(value, key) || nonEmptyString(value[key]);
}

function hasSession(value: RecordValue): boolean {
  return nonEmptyString(value.sessionId);
}

function validSessionProperties(properties: RecordValue): boolean {
  return exactKeys(properties, ["sessionId"]) && hasSession(properties);
}

function validStatusProperties(properties: RecordValue): boolean {
  return (
    exactKeys(properties, ["sessionId", "status"]) &&
    hasSession(properties) &&
    ["busy", "working", "retry", "idle", "error", "failed", "unknown"].includes(
      properties.status as string,
    )
  );
}

function validMessageProperties(properties: RecordValue): boolean {
  if (
    !allowedKeys(properties, [
      "sessionId",
      "partType",
      "partId",
      "agentId",
      "taskId",
    ]) ||
    !hasSession(properties) ||
    !["agent", "subtask", "tool"].includes(properties.partType as string) ||
    !optionalString(properties, "partId") ||
    !optionalString(properties, "agentId") ||
    !optionalString(properties, "taskId")
  )
    return false;
  if (properties.partType === "agent")
    return nonEmptyString(properties.agentId);
  if (properties.partType === "subtask")
    return nonEmptyString(properties.taskId);
  return true;
}

function validTodoItem(value: unknown): boolean {
  if (!isRecord(value) || !allowedKeys(value, ["id", "status", "priority"]))
    return false;
  return (
    nonEmptyString(value.id) &&
    (value.status === undefined ||
      [
        "pending",
        "in_progress",
        "in-progress",
        "completed",
        "done",
        "cancelled",
        "canceled",
      ].includes(value.status as string)) &&
    (value.priority === undefined ||
      ["low", "medium", "normal", "high"].includes(value.priority as string))
  );
}

function validTodoProperties(properties: RecordValue): boolean {
  return (
    exactKeys(properties, ["sessionId", "items"]) &&
    hasSession(properties) &&
    Array.isArray(properties.items) &&
    properties.items.length <= DASHBOARD_BOUNDS.maxTodoItems &&
    properties.items.every(validTodoItem)
  );
}

function validPermissionProperties(properties: RecordValue): boolean {
  return (
    allowedKeys(properties, ["permissionId", "sessionId", "status"]) &&
    nonEmptyString(properties.permissionId) &&
    optionalString(properties, "sessionId") &&
    ["pending", "resolved", "rejected"].includes(properties.status as string)
  );
}

function validErrorProperties(properties: RecordValue): boolean {
  return (
    allowedKeys(properties, ["sessionId", "kind"]) &&
    optionalString(properties, "sessionId") &&
    ["timeout", "network", "provider", "unknown"].includes(
      properties.kind as string,
    )
  );
}

function validFileProperties(properties: RecordValue): boolean {
  return (
    allowedKeys(properties, ["path", "count", "sessionId"]) &&
    nonEmptyString(properties.path) &&
    optionalString(properties, "sessionId") &&
    (properties.count === undefined ||
      (typeof properties.count === "number" &&
        Number.isFinite(properties.count)))
  );
}

function validDiffFile(value: unknown): boolean {
  return (
    isRecord(value) &&
    exactKeys(value, ["count", "path"]) &&
    nonEmptyString(value.path) &&
    typeof value.count === "number" &&
    Number.isFinite(value.count)
  );
}

function validDiffProperties(properties: RecordValue): boolean {
  return (
    allowedKeys(properties, ["files", "sessionId"]) &&
    Array.isArray(properties.files) &&
    properties.files.length <= DASHBOARD_BOUNDS.maxDiffFiles &&
    optionalString(properties, "sessionId") &&
    properties.files.every(validDiffFile)
  );
}

function validCommandProperties(properties: RecordValue): boolean {
  return (
    allowedKeys(properties, ["commandName", "sessionId"]) &&
    nonEmptyString(properties.commandName) &&
    optionalString(properties, "sessionId")
  );
}

type EventValidator = (properties: RecordValue) => boolean;

const eventValidators: Record<string, EventValidator> = {
  "session.created": validSessionProperties,
  "session.updated": validSessionProperties,
  "session.deleted": validSessionProperties,
  "session.idle": validSessionProperties,
  "session.status": validStatusProperties,
  "message.part.updated": validMessageProperties,
  "todo.updated": validTodoProperties,
  "permission.updated": validPermissionProperties,
  "permission.replied": validPermissionProperties,
  "session.error": validErrorProperties,
  "file.edited": validFileProperties,
  "session.diff": validDiffProperties,
  "command.executed": validCommandProperties,
};

function dashboardEvent(event: unknown): DashboardEvent | undefined {
  if (
    !isRecord(event) ||
    !exactKeys(event, ["directory", "type", "properties"]) ||
    typeof event.directory !== "string" ||
    typeof event.type !== "string" ||
    !isRecord(event.properties)
  )
    return undefined;
  if (!supported.has(event.type)) return event as DashboardEvent;
  return eventValidators[event.type]?.(event.properties)
    ? (event as DashboardEvent)
    : undefined;
}

function normalizeComparablePath(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/");
  const output: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === ".." && output.at(-1) !== "..") output.pop();
    else output.push(part);
  }
  return `${path.startsWith("/") ? "/" : ""}${output.join("/")}` || ".";
}

function selectedDirectory(
  directory: unknown,
  projectRoot: string,
): boolean | undefined {
  if (typeof directory !== "string" || directory.length === 0) return undefined;
  return (
    normalizeComparablePath(directory).replace(/\/$/u, "") ===
    normalizeComparablePath(projectRoot).replace(/\/$/u, "")
  );
}

function relativePath(
  value: unknown,
  projectRoot: string,
  maximum: number,
): string | undefined {
  if (!isSafePathInput(value)) return undefined;
  const root = resolve(projectRoot);
  const absolute = resolve(root, value.replaceAll("\\", "/"));
  const relativePathValue = relative(root, absolute);
  if (
    !relativePathValue ||
    isAbsolute(relativePathValue) ||
    relativePathValue === ".." ||
    relativePathValue.startsWith(
      `..${process.platform === "win32" ? "\\" : "/"}`,
    )
  ) {
    return undefined;
  }
  const safePath = bounded(relativePathValue.replaceAll("\\", "/"), maximum);
  return safePath || undefined;
}

function nodeId(kind: string, sourceIdentity: string): string {
  return dashboardId(kind, sourceIdentity);
}

function agentRegistry(snapshot: DashboardSnapshot): IdentityRegistry {
  const registry = new IdentityRegistry();
  for (const agent of snapshot.agents) {
    const id = registry.seed("agent", agent.id, agent.sourceIdentity);
    if (id !== agent.id) {
      for (const edge of snapshot.edges) {
        if (edge.from === agent.id) edge.from = id;
        if (edge.to === agent.id) edge.to = id;
      }
      agent.id = id;
    }
  }
  return registry;
}

function sessionId(properties: RecordValue): string | undefined {
  return idValue(properties.sessionId);
}

function eventKind(type: string): EventSummaryKind {
  if (
    [
      "session.created",
      "session.updated",
      "session.deleted",
      "session.status",
      "session.idle",
    ].includes(type)
  ) {
    return "session";
  }
  if (type === "todo.updated") return "task";
  if (type.startsWith("permission.")) return "permission";
  return type as EventSummaryKind;
}

function statusForSession(value: unknown): NodeStatus {
  const status = isRecord(value) ? value.type : value;
  return status === "error" || status === "failed" ? "error" : "observed";
}

function taskStatus(value: unknown): TaskStatus {
  if (value === "pending") return "pending";
  if (value === "in_progress" || value === "in-progress") return "in-progress";
  if (value === "completed" || value === "done") return "completed";
  if (value === "cancelled" || value === "canceled") return "cancelled";
  return "unknown";
}

function taskPriority(value: unknown): TaskPriority {
  return value === "low" ||
    value === "medium" ||
    value === "normal" ||
    value === "high"
    ? value
    : "unknown";
}

function activityFor(value: unknown): SessionNode["activity"] {
  if (isRecord(value)) return activityFor(value.type);
  if (value === "idle") return "idle";
  if (value === "busy" || value === "working" || value === "retry")
    return "active";
  return "unknown";
}

function sessionNode(
  snapshot: DashboardSnapshot,
  id: string,
  now: number,
  status: NodeStatus,
  activity: SessionNode["activity"],
): SessionNode {
  const existing = snapshot.sessions.find(
    (session) => session.id === nodeId("session", id),
  );
  return {
    kind: "session",
    id: nodeId("session", id),
    label:
      existing?.label ??
      bounded(`Session ${id}`, DASHBOARD_BOUNDS.maxSafeMessageLength),
    status,
    evidence: "host-event",
    relatedIds: existing?.relatedIds ?? [],
    activity,
    lastActivityAt: now,
  };
}

function upsertSession(
  snapshot: DashboardSnapshot,
  id: string,
  now: number,
  status: NodeStatus = "observed",
  activity: SessionNode["activity"] = "unknown",
): void {
  const node = sessionNode(snapshot, id, now, status, activity);
  const index = snapshot.sessions.findIndex(
    ({ id: nodeId }) => nodeId === node.id,
  );
  if (index === -1) snapshot.sessions.push(node);
  else snapshot.sessions[index] = node;
}

function upsertTask(snapshot: DashboardSnapshot, node: TaskNode): void {
  const index = snapshot.tasks.findIndex(({ id }) => id === node.id);
  if (index === -1) snapshot.tasks.push(node);
  else snapshot.tasks[index] = { ...snapshot.tasks[index], ...node };
}

function upsertObservedAgent(
  snapshot: DashboardSnapshot,
  id: string,
  now: number,
  registry: IdentityRegistry,
): AgentNode {
  const boundedLabel = bounded(id, DASHBOARD_BOUNDS.maxSafeMessageLength);
  const existing = snapshot.agents.find((agent) => agent.sourceIdentity === id);
  if (existing) {
    existing.status = "observed";
    existing.lastActivityAt = now;
    return existing;
  }
  const agent: AgentNode = {
    kind: "agent",
    id: registry.register("agent", id),
    sourceIdentity: id,
    label: boundedLabel,
    description: "Observed host agent",
    status: "observed",
    evidence: "host-event",
    relatedIds: [],
    lastActivityAt: now,
  };
  snapshot.agents.push(agent);
  return agent;
}

function upsertAttention(
  snapshot: DashboardSnapshot,
  item: AttentionItem,
): void {
  const index = snapshot.attention.findIndex(({ id }) => id === item.id);
  if (index === -1) snapshot.attention.push(item);
  else snapshot.attention[index] = item;
}

function addRelation(
  snapshot: DashboardSnapshot,
  from: string,
  to: string,
  kind: "agent-session" | "session-task",
): void {
  const id = nodeId("edge", `${kind}\0${from}\0${to}`);
  if (snapshot.edges.some((edge) => edge.id === id)) return;
  snapshot.edges.push({
    id,
    from,
    to,
    kind,
    evidence: "derived-relationship",
  });
}

function summary(
  type: string,
  properties: RecordValue,
  now: number,
  details: Partial<EventSummary> = {},
): EventSummary {
  const session = firstString(properties.sessionId);
  const kind = eventKind(type);
  const identity = firstString(
    properties.id,
    properties.permissionId,
    properties.sessionId,
  );
  const event: EventSummary = {
    id: nodeId("event", `${kind}\0${identity ?? "event"}\0${now}`),
    kind,
    summary: details.summary ?? `${kind} observed`,
    evidence: "host-event",
    timestamp: now,
    ...(session ? { sessionId: nodeId("session", session) } : {}),
    ...details,
  };
  event.summary = bounded(event.summary, DASHBOARD_BOUNDS.maxSafeMessageLength);
  return event;
}

function recordEvent(
  snapshot: DashboardSnapshot,
  event: EventSummary,
  bounds: ProjectionOptions["bounds"],
): void {
  snapshot.recentEvents.unshift(event);
  const maximum = bounds?.maxEvents ?? DASHBOARD_BOUNDS.maxEvents;
  if (snapshot.recentEvents.length <= maximum) return;
  snapshot.recentEvents.length = maximum;
  snapshot.diagnostics.droppedEvents += 1;
}

function trimByActivity<T extends { id: string; lastActivityAt?: number }>(
  values: T[],
  maximum: number,
): void {
  if (values.length <= maximum) return;
  values.sort(
    (left, right) =>
      (left.lastActivityAt ?? 0) - (right.lastActivityAt ?? 0) ||
      left.id.localeCompare(right.id),
  );
  values.splice(0, values.length - maximum);
}

function maximum(
  bounds: ProjectionOptions["bounds"],
  key: keyof typeof DASHBOARD_BOUNDS,
): number {
  return Math.max(0, bounds?.[key] ?? DASHBOARD_BOUNDS[key]);
}

function trimActivityCollections(
  snapshot: DashboardSnapshot,
  bounds: ProjectionOptions["bounds"],
): void {
  trimByActivity(snapshot.sessions, maximum(bounds, "maxSessions"));
  trimByActivity(snapshot.tasks, maximum(bounds, "maxTasks"));
  trimByActivity(snapshot.attention, maximum(bounds, "maxAttention"));
  trimByActivity(snapshot.skills, maximum(bounds, "maxSkills"));
}

function trimAgents(
  snapshot: DashboardSnapshot,
  bounds: ProjectionOptions["bounds"],
): number {
  const configured = snapshot.agents.filter(
    (agent) => agent.evidence === "artifact-manifest",
  );
  const observed = snapshot.agents.filter(
    (agent) => agent.evidence !== "artifact-manifest",
  );
  const configuredMaximum = Math.max(
    0,
    bounds?.maxConfiguredAgents ??
      bounds?.maxAgents ??
      DASHBOARD_BOUNDS.maxConfiguredAgents,
  );
  const observedMaximum = Math.max(
    0,
    bounds?.maxObservedAgents ??
      (bounds?.maxAgents === undefined
        ? DASHBOARD_BOUNDS.maxObservedAgents
        : bounds.maxAgents - configured.length),
  );
  trimByActivity(configured, configuredMaximum);
  trimByActivity(observed, observedMaximum);
  const previousLength = snapshot.agents.length;
  snapshot.agents = [...configured, ...observed];
  return previousLength - snapshot.agents.length;
}

function removeOrphanedTasks(snapshot: DashboardSnapshot): number {
  const sessionIds = new Set(snapshot.sessions.map(({ id }) => id));
  const previousLength = snapshot.tasks.length;
  snapshot.tasks = snapshot.tasks.filter(
    (task) => !task.sessionId || sessionIds.has(task.sessionId),
  );
  return previousLength - snapshot.tasks.length;
}

function trimEdges(
  snapshot: DashboardSnapshot,
  bounds: ProjectionOptions["bounds"],
): number {
  const nodeIds = new Set([
    ...snapshot.agents.map(({ id }) => id),
    ...snapshot.skills.map(({ id }) => id),
    ...snapshot.sessions.map(({ id }) => id),
    ...snapshot.tasks.map(({ id }) => id),
  ]);
  const previousLength = snapshot.edges.length;
  snapshot.edges = snapshot.edges.filter(
    (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to),
  );
  const orphaned = previousLength - snapshot.edges.length;
  const afterOrphanRemoval = snapshot.edges.length;
  trimByActivity(snapshot.edges, maximum(bounds, "maxEdges"));
  return orphaned + afterOrphanRemoval - snapshot.edges.length;
}

function rebuildRelatedIds(
  snapshot: DashboardSnapshot,
  bounds: ProjectionOptions["bounds"],
): void {
  const nodes = [
    ...snapshot.agents,
    ...snapshot.skills,
    ...snapshot.sessions,
    ...snapshot.tasks,
  ];
  for (const node of nodes) node.relatedIds = [];
  const nodeIds = new Set(nodes.map(({ id }) => id));
  const relatedByNode = new Map<string, Set<string>>();
  for (const edge of snapshot.edges) {
    if (!relatedByNode.has(edge.from)) relatedByNode.set(edge.from, new Set());
    relatedByNode.get(edge.from)?.add(edge.to);
    if (!nodeIds.has(edge.to)) continue;
    if (!relatedByNode.has(edge.to)) relatedByNode.set(edge.to, new Set());
    relatedByNode.get(edge.to)?.add(edge.from);
  }
  const maximumRelatedIds = maximum(bounds, "maxRelatedIds");
  for (const node of nodes) {
    node.relatedIds = [...(relatedByNode.get(node.id) ?? [])]
      .sort((left, right) => left.localeCompare(right))
      .slice(0, maximumRelatedIds);
  }
}

function trimRecentEvents(
  snapshot: DashboardSnapshot,
  bounds: ProjectionOptions["bounds"],
): number {
  const maximumEvents = maximum(bounds, "maxEvents");
  if (snapshot.recentEvents.length <= maximumEvents) return 0;
  const removed = snapshot.recentEvents.length - maximumEvents;
  snapshot.recentEvents.length = maximumEvents;
  return removed;
}

function trim(
  snapshot: DashboardSnapshot,
  bounds: ProjectionOptions["bounds"],
): void {
  const beforeSkills = snapshot.skills.length;
  trimActivityCollections(snapshot, bounds);
  const trimmedAgents = trimAgents(snapshot, bounds);
  const trimmedSkills = beforeSkills - snapshot.skills.length;
  const orphanedTasks = removeOrphanedTasks(snapshot);
  const trimmedEdges = trimEdges(snapshot, bounds);
  rebuildRelatedIds(snapshot, bounds);
  const trimmedEvents = trimRecentEvents(snapshot, bounds);
  snapshot.diagnostics.droppedEvents +=
    trimmedAgents +
    trimmedSkills +
    orphanedTasks +
    trimmedEdges +
    trimmedEvents;
}

function malformed(snapshot: DashboardSnapshot): ProjectionResult {
  snapshot.diagnostics.malformedEvents += 1;
  return { accepted: false, snapshot };
}

function dropped(snapshot: DashboardSnapshot): ProjectionResult {
  snapshot.diagnostics.droppedEvents += 1;
  return { accepted: false, snapshot };
}

type MutationResult = {
  status: "accepted" | "malformed" | "dropped";
  details?: Partial<EventSummary>;
};

function accepted(details?: Partial<EventSummary>): MutationResult {
  return { status: "accepted", details };
}

function mutationMalformed(): MutationResult {
  return { status: "malformed" };
}

function mutationDropped(): MutationResult {
  return { status: "dropped" };
}

function sessionMutation(
  type: string,
  snapshot: DashboardSnapshot,
  properties: RecordValue,
  now: number,
): MutationResult {
  const session = sessionId(properties);
  if (!session) return mutationMalformed();
  const sessionNodeId = nodeId("session", session);
  if (type === "session.deleted") {
    snapshot.sessions = snapshot.sessions.filter(
      ({ id }) => id !== sessionNodeId,
    );
    snapshot.tasks = snapshot.tasks.filter(
      (task) => task.sessionId !== sessionNodeId,
    );
    snapshot.edges = snapshot.edges.filter(
      (edge) => edge.from !== sessionNodeId && edge.to !== sessionNodeId,
    );
    return accepted();
  }
  if (type === "session.status") {
    upsertSession(
      snapshot,
      session,
      now,
      statusForSession(properties.status),
      activityFor(properties.status),
    );
    return accepted();
  }
  upsertSession(
    snapshot,
    session,
    now,
    "observed",
    type === "session.idle" ? "idle" : "unknown",
  );
  return accepted();
}

function messageMutation(
  snapshot: DashboardSnapshot,
  properties: RecordValue,
  now: number,
  registry: IdentityRegistry,
): MutationResult {
  const partType = stringValue(properties.partType);
  const partSession = sessionId(properties);
  if (
    !partType ||
    !partSession ||
    !["agent", "subtask", "tool"].includes(partType)
  ) {
    return mutationMalformed();
  }
  upsertSession(snapshot, partSession, now, "observed", "active");
  if (partType === "agent") {
    const agentId = firstString(properties.agentId);
    if (agentId) {
      const agent = upsertObservedAgent(snapshot, agentId, now, registry);
      addRelation(
        snapshot,
        nodeId("session", partSession),
        agent.id,
        "agent-session",
      );
    }
  } else if (partType === "subtask" && idValue(properties.taskId)) {
    const taskId = idValue(properties.taskId);
    if (!taskId) return mutationMalformed();
    const task: TaskNode = {
      kind: "task",
      id: nodeId("task", taskId),
      label: bounded(`Task ${taskId}`, DASHBOARD_BOUNDS.maxSafeMessageLength),
      status: "observed",
      evidence: "host-event",
      relatedIds: [nodeId("session", partSession)],
      sessionId: nodeId("session", partSession),
      taskStatus: "in-progress",
      priority: "unknown",
      lastActivityAt: now,
    };
    upsertTask(snapshot, task);
    addRelation(
      snapshot,
      nodeId("session", partSession),
      task.id,
      "session-task",
    );
  }
  return accepted();
}

function todoMutation(
  snapshot: DashboardSnapshot,
  properties: RecordValue,
  now: number,
  options: ProjectionOptions,
): MutationResult {
  const session = sessionId(properties);
  if (!session || !Array.isArray(properties.items)) return mutationMalformed();
  const maximumItems =
    options.bounds?.maxTodoItems ?? DASHBOARD_BOUNDS.maxTodoItems;
  if (properties.items.length > maximumItems) return mutationDropped();
  const todos = properties.items.map((todo) => {
    if (!isRecord(todo)) return undefined;
    const todoId = idValue(todo.id);
    return todoId ? { todo, todoId } : undefined;
  });
  if (todos.some((todo) => !todo)) return mutationMalformed();
  upsertSession(snapshot, session, now, "observed", "active");
  for (const parsed of todos) {
    if (!parsed) return mutationMalformed();
    const { todo, todoId } = parsed;
    const task: TaskNode = {
      kind: "task",
      id: nodeId("task", todoId),
      label: bounded(`Task ${todoId}`, DASHBOARD_BOUNDS.maxSafeMessageLength),
      status: "observed",
      evidence: "host-event",
      relatedIds: [nodeId("session", session)],
      sessionId: nodeId("session", session),
      taskStatus: taskStatus(todo.status),
      priority: taskPriority(todo.priority),
      lastActivityAt: now,
    };
    upsertTask(snapshot, task);
    addRelation(snapshot, nodeId("session", session), task.id, "session-task");
  }
  return accepted();
}

function permissionMutation(
  snapshot: DashboardSnapshot,
  properties: RecordValue,
  now: number,
  resolvedByReply: boolean,
): MutationResult {
  const permission = idValue(properties.permissionId);
  if (!permission) return mutationMalformed();
  const session = sessionId(properties);
  const resolved =
    resolvedByReply ||
    properties.status === "resolved" ||
    properties.status === "rejected";
  upsertAttention(snapshot, {
    id: nodeId("attention", `permission\0${permission}`),
    kind: "permission",
    status: resolved ? "resolved" : "pending",
    evidence: "host-event",
    ...(session ? { sessionId: nodeId("session", session) } : {}),
    lastActivityAt: now,
  });
  return accepted();
}

function errorMutation(
  snapshot: DashboardSnapshot,
  properties: RecordValue,
  now: number,
): MutationResult {
  const session = sessionId(properties);
  const kind = properties.kind as string;
  const attentionId = nodeId("attention", `error\0${session ?? "project"}`);
  upsertAttention(snapshot, {
    id: attentionId,
    kind: "error",
    status: "pending",
    evidence: "host-event",
    ...(session ? { sessionId: nodeId("session", session) } : {}),
    lastActivityAt: now,
  });
  if (session) upsertSession(snapshot, session, now, "error", "unknown");
  return accepted({ summary: `Session error: ${kind}` });
}

function fileMutation(
  snapshot: DashboardSnapshot,
  properties: RecordValue,
  now: number,
  options: ProjectionOptions,
): MutationResult {
  const path = relativePath(
    properties.path,
    options.projectRoot,
    options.bounds?.maxSafePathLength ?? DASHBOARD_BOUNDS.maxSafePathLength,
  );
  if (!path) return mutationDropped();
  const count =
    typeof properties.count === "number" && Number.isFinite(properties.count)
      ? Math.max(1, Math.min(10_000, Math.trunc(properties.count)))
      : 1;
  const session = sessionId(properties);
  if (session) upsertSession(snapshot, session, now, "observed", "active");
  return accepted({ summary: `File edited: ${path}`, path, count });
}

function diffMutation(
  snapshot: DashboardSnapshot,
  properties: RecordValue,
  now: number,
  options: ProjectionOptions,
): MutationResult {
  if (!Array.isArray(properties.files)) return mutationMalformed();
  const maximumFiles =
    options.bounds?.maxDiffFiles ?? DASHBOARD_BOUNDS.maxDiffFiles;
  if (properties.files.length > maximumFiles) return mutationDropped();
  const files = properties.files.map((file) => {
    if (!isRecord(file)) return undefined;
    const path = relativePath(
      file.path,
      options.projectRoot,
      options.bounds?.maxSafePathLength ?? DASHBOARD_BOUNDS.maxSafePathLength,
    );
    if (
      !path ||
      typeof file.count !== "number" ||
      !Number.isFinite(file.count)
    ) {
      return undefined;
    }
    return {
      path,
      count: Math.max(0, Math.min(10_000, Math.trunc(file.count))),
    };
  });
  if (files.some((file) => !file)) return mutationDropped();
  const safeFiles = files.filter(
    (file): file is { path: string; count: number } => file !== undefined,
  );
  const count = safeFiles.length;
  const session = sessionId(properties);
  if (session) upsertSession(snapshot, session, now, "observed", "active");
  return accepted({
    summary: `Session diff: ${count} files`,
    count,
    files: safeFiles,
  });
}

function commandMutation(
  snapshot: DashboardSnapshot,
  properties: RecordValue,
  now: number,
): MutationResult {
  const commandName = firstString(properties.commandName);
  const safeCommandName =
    commandName && /^[a-zA-Z0-9_./:@-]+$/u.test(commandName)
      ? bounded(commandName, 64)
      : "unknown";
  const session = sessionId(properties);
  if (session) upsertSession(snapshot, session, now, "observed", "active");
  return accepted({
    summary: `Command executed: ${safeCommandName}`,
    commandName: safeCommandName,
  });
}

type EventHandler = (
  snapshot: DashboardSnapshot,
  properties: RecordValue,
  now: number,
  options: ProjectionOptions,
) => MutationResult;

const handlers: Record<string, EventHandler> = {
  "session.created": (snapshot, properties, now) =>
    sessionMutation("session.created", snapshot, properties, now),
  "session.updated": (snapshot, properties, now) =>
    sessionMutation("session.updated", snapshot, properties, now),
  "session.deleted": (snapshot, properties, now) =>
    sessionMutation("session.deleted", snapshot, properties, now),
  "session.status": (snapshot, properties, now) =>
    sessionMutation("session.status", snapshot, properties, now),
  "session.idle": (snapshot, properties, now) =>
    sessionMutation("session.idle", snapshot, properties, now),
  "message.part.updated": (snapshot, properties, now) =>
    messageMutation(snapshot, properties, now, agentRegistry(snapshot)),
  "todo.updated": (snapshot, properties, now, options) =>
    todoMutation(snapshot, properties, now, options),
  "permission.updated": (snapshot, properties, now) =>
    permissionMutation(snapshot, properties, now, false),
  "permission.replied": (snapshot, properties, now) =>
    permissionMutation(snapshot, properties, now, true),
  "session.error": (snapshot, properties, now) =>
    errorMutation(snapshot, properties, now),
  "file.edited": (snapshot, properties, now, options) =>
    fileMutation(snapshot, properties, now, options),
  "session.diff": (snapshot, properties, now, options) =>
    diffMutation(snapshot, properties, now, options),
  "command.executed": (snapshot, properties, now) =>
    commandMutation(snapshot, properties, now),
};

export function applyDashboardEvent(
  source: DashboardSnapshot,
  event: DashboardEvent,
  options: ProjectionOptions,
): ProjectionResult {
  const snapshot = cloneSnapshot(source);
  const minimalEvent = dashboardEvent(event);
  if (!minimalEvent) return malformed(snapshot);
  const matches = selectedDirectory(
    minimalEvent.directory,
    options.projectRoot,
  );
  if (matches === undefined) return malformed(snapshot);
  if (!matches) return dropped(snapshot);
  if (!supported.has(minimalEvent.type)) {
    return dropped(snapshot);
  }
  const type = minimalEvent.type;
  const properties = minimalEvent.properties as unknown as RecordValue;
  const now = options.now ?? Date.now();
  const mutation = handlers[type]?.(snapshot, properties, now, options);
  if (!mutation || mutation.status === "dropped") return dropped(snapshot);
  if (mutation.status === "malformed") return malformed(snapshot);
  recordEvent(
    snapshot,
    summary(type, properties, now, mutation.details),
    options.bounds,
  );
  trim(snapshot, options.bounds);
  return { accepted: true, snapshot };
}
