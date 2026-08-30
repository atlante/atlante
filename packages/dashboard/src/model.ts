import { createHash } from "node:crypto";

export const DASHBOARD_BOUNDS = {
  maxAgents: 128,
  maxConfiguredAgents: 128,
  maxObservedAgents: 128,
  maxSkills: 128,
  maxSessions: 64,
  maxTasks: 128,
  maxEdges: 256,
  maxAttention: 128,
  maxEvents: 200,
  maxRelatedIds: 32,
  maxTodoItems: 128,
  maxTodoContentLength: 4_096,
  maxDiffFiles: 128,
  maxIdLength: 128,
  maxSafePathLength: 256,
  maxSafeMessageLength: 160,
  staleAfterMs: 30_000,
} as const;

export type ConnectionState = "connected" | "reconnecting" | "disconnected";
export type NodeStatus =
  | "configured"
  | "observed"
  | "unknown"
  | "stale"
  | "attention"
  | "error";
export type EvidenceSource =
  | "artifact-manifest"
  | "host-event"
  | "derived-relationship";

export type ArtifactSource = "available" | "missing" | "invalid";
export type RuntimeSource = "connected" | "unavailable";
export type WorkflowSource = "unavailable" | "explicit";

type DashboardNode = {
  id: string;
  label: string;
  status: NodeStatus;
  evidence: EvidenceSource;
  relatedIds: string[];
  lastActivityAt?: number;
};

export type AgentNode = DashboardNode & {
  kind: "agent";
  sourceIdentity: string;
  description: string;
};

export type SkillNode = DashboardNode & {
  kind: "skill";
  description: string;
};

export type SessionNode = DashboardNode & {
  kind: "session";
  activity: "active" | "idle" | "unknown";
};

export type TaskStatus =
  | "pending"
  | "in-progress"
  | "completed"
  | "cancelled"
  | "unknown";
export type TaskPriority = "low" | "medium" | "normal" | "high" | "unknown";

export type TaskNode = DashboardNode & {
  kind: "task";
  sessionId?: string;
  taskStatus: TaskStatus;
  priority: TaskPriority;
};

export type AttentionStatus = "pending" | "resolved";
export type AttentionKind = "permission" | "error";

export type AttentionItem = {
  id: string;
  kind: AttentionKind;
  status: AttentionStatus;
  evidence: "host-event";
  sessionId?: string;
  lastActivityAt: number;
};

export type RelationKind = "agent-session" | "session-task";

export type Relation = {
  id: string;
  from: string;
  to: string;
  kind: RelationKind;
  evidence: "derived-relationship";
};

export type EventSummaryKind =
  | "session"
  | "message.part.updated"
  | "task"
  | "permission"
  | "session.error"
  | "file.edited"
  | "session.diff"
  | "command.executed";

export type EventSummary = {
  id: string;
  kind: EventSummaryKind;
  summary: string;
  evidence: "host-event";
  timestamp: number;
  sessionId?: string;
  path?: string;
  count?: number;
  commandName?: string;
  files?: Array<{ path: string; count: number }>;
};

export type DashboardEventType =
  | "session.created"
  | "session.updated"
  | "session.deleted"
  | "session.status"
  | "session.idle"
  | "message.part.updated"
  | "todo.updated"
  | "permission.updated"
  | "permission.replied"
  | "session.error"
  | "file.edited"
  | "session.diff"
  | "command.executed";

type EventBase<Type extends DashboardEventType, Properties> = {
  directory: string;
  type: Type;
  properties: Properties;
};

type SessionProperties = { sessionId: string };
type SessionStatusProperties = SessionProperties & {
  status:
    | "busy"
    | "working"
    | "retry"
    | "idle"
    | "error"
    | "failed"
    | "unknown";
};
type MessagePartProperties = SessionProperties & {
  partType: "agent" | "subtask" | "tool";
  partId?: string;
  agentId?: string;
  taskId?: string;
};
type TodoItem = {
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
};
type TodoProperties = SessionProperties & { items: TodoItem[] };
type PermissionProperties = {
  permissionId: string;
  sessionId?: string;
  status: "pending" | "resolved" | "rejected";
};
type ErrorProperties = {
  sessionId?: string;
  kind: "timeout" | "network" | "provider" | "unknown";
};
type FileProperties = {
  path: string;
  count?: number;
  sessionId?: string;
};
type DiffFile = { path: string; count: number };
type DiffProperties = { files: DiffFile[]; sessionId?: string };
type CommandProperties = { commandName: string; sessionId?: string };

type DashboardEventProperties = {
  "session.created": SessionProperties;
  "session.updated": SessionProperties;
  "session.deleted": SessionProperties;
  "session.idle": SessionProperties;
  "session.status": SessionStatusProperties;
  "message.part.updated": MessagePartProperties;
  "todo.updated": TodoProperties;
  "permission.updated": PermissionProperties;
  "permission.replied": PermissionProperties;
  "session.error": ErrorProperties;
  "file.edited": FileProperties;
  "session.diff": DiffProperties;
  "command.executed": CommandProperties;
};

export type DashboardEvent = {
  [Type in DashboardEventType]: EventBase<Type, DashboardEventProperties[Type]>;
}[DashboardEventType];

export type DashboardSnapshot = {
  schemaVersion: 1;
  connection: ConnectionState;
  stale: boolean;
  lastConnectedAt?: number;
  lastSuccessfulEventAt?: number;
  project: {
    name: string;
    branch?: string;
    links: {
      configuration: "atlante.jsonc";
      artifacts: ".atlante/artifacts/";
    };
  };
  agents: AgentNode[];
  skills: SkillNode[];
  workflows: [];
  sessions: SessionNode[];
  tasks: TaskNode[];
  edges: Relation[];
  attention: AttentionItem[];
  recentEvents: EventSummary[];
  sources: {
    artifacts: ArtifactSource;
    runtime: RuntimeSource;
    workflows: WorkflowSource;
  };
  diagnostics: {
    droppedEvents: number;
    malformedEvents: number;
  };
};

export type SnapshotOptions = {
  name: string;
  branch?: string;
  artifacts?: ArtifactSource;
  agents?: AgentNode[];
  skills?: SkillNode[];
};

export function dashboardId(kind: string, sourceIdentity: string): string {
  const digest = createHash("sha256").update(sourceIdentity).digest("hex");
  return `${kind}:${digest}`.slice(0, DASHBOARD_BOUNDS.maxIdLength);
}

export class IdentityRegistry {
  private readonly ids = new Map<string, string>();
  private readonly sources = new Map<string, string>();

  register(kind: string, sourceIdentity: string): string {
    const sourceKey = `${kind}\0${sourceIdentity}`;
    const known = this.ids.get(sourceKey);
    if (known) return known;

    let id = dashboardId(kind, sourceIdentity);
    let collision = 0;
    while (this.sources.has(id) && this.sources.get(id) !== sourceKey) {
      collision += 1;
      id = dashboardId(kind, `${sourceIdentity}\0collision:${collision}`);
    }
    this.ids.set(sourceKey, id);
    this.sources.set(id, sourceKey);
    return id;
  }

  seed(kind: string, id: string, sourceIdentity: string): string {
    const sourceKey = `${kind}\0${sourceIdentity}`;
    const existingSource = this.sources.get(id);
    if (existingSource && existingSource !== sourceKey) {
      let collision = 0;
      let replacement = dashboardId(
        kind,
        `${sourceIdentity}\0collision:${collision}`,
      );
      while (this.sources.has(replacement)) {
        collision += 1;
        replacement = dashboardId(
          kind,
          `${sourceIdentity}\0collision:${collision}`,
        );
      }
      id = replacement;
    }
    this.ids.set(sourceKey, id);
    this.sources.set(id, sourceKey);
    return id;
  }
}

export function createEmptySnapshot(
  options: SnapshotOptions,
): DashboardSnapshot {
  return {
    schemaVersion: 1,
    connection: "disconnected",
    stale: true,
    project: {
      name: options.name,
      ...(options.branch === undefined ? {} : { branch: options.branch }),
      links: {
        configuration: "atlante.jsonc",
        artifacts: ".atlante/artifacts/",
      },
    },
    agents: options.agents ?? [],
    skills: options.skills ?? [],
    workflows: [],
    sessions: [],
    tasks: [],
    edges: [],
    attention: [],
    recentEvents: [],
    sources: {
      artifacts: options.artifacts ?? "missing",
      runtime: "unavailable",
      workflows: "unavailable",
    },
    diagnostics: {
      droppedEvents: 0,
      malformedEvents: 0,
    },
  };
}

export function cloneSnapshot(snapshot: DashboardSnapshot): DashboardSnapshot {
  return structuredClone(snapshot);
}
