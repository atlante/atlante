import type {
  AgentNode,
  DashboardSnapshot,
  EvidenceSource,
  NodeStatus,
  Relation,
  SessionNode,
  SkillNode,
  TaskNode,
} from "../model.js";
import { DASHBOARD_ASSET_PATHS } from "./assets.js";

export type DashboardFilter = "all" | "active" | "attention" | "configured";

export type ViewNodeKind = "harness" | "agent" | "skill" | "session" | "task";

export type ViewNode = {
  id: string;
  kind: ViewNodeKind;
  label: string;
  status: NodeStatus;
  evidence: EvidenceSource;
  relatedIds: string[];
  x: number;
  y: number;
  radius: number;
  description?: string;
  activity?: SessionNode["activity"];
  taskStatus?: TaskNode["taskStatus"];
  priority?: TaskNode["priority"];
  lastActivityAt?: number;
};

export type DashboardProjection = {
  nodes: ViewNode[];
  edges: Relation[];
  width: number;
  height: number;
};

export type RenderOptions = {
  width?: number;
  height?: number;
};

export type DashboardController = {
  update(snapshot: DashboardSnapshot): void;
  setTransportState(state: DashboardSnapshot["connection"]): void;
  destroy(): void;
};

export type SnapshotEventSource = {
  addEventListener(type: "snapshot", listener: (event: Event) => void): void;
  addEventListener(type: "error", listener: () => void): void;
  close(): void;
};

export type BootstrapOptions = RenderOptions & {
  initialSnapshot?: DashboardSnapshot;
  fetchSnapshot?: () => Promise<DashboardSnapshot>;
  eventSourceFactory?: (url: string) => SnapshotEventSource;
};

const kindLabels: Record<ViewNodeKind, string> = {
  harness: "project harness",
  agent: "agent",
  skill: "skill",
  session: "session",
  task: "task",
};
const statusLabels: Record<NodeStatus, string> = {
  configured: "Configured",
  observed: "Observed",
  unknown: "Unknown",
  stale: "Stale",
  attention: "Needs attention",
  error: "Error",
};
const filterLabels: Record<DashboardFilter, string> = {
  all: "All",
  active: "Active",
  attention: "Attention",
  configured: "Configured",
};
const outerControlHalfHeight = 36;

function nodeData(
  node: AgentNode | SkillNode | SessionNode | TaskNode,
): Omit<ViewNode, "x" | "y" | "radius"> {
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    status: node.status,
    evidence: node.evidence,
    relatedIds: [...node.relatedIds].sort(),
    ...(node.lastActivityAt === undefined
      ? {}
      : { lastActivityAt: node.lastActivityAt }),
    ...(node.kind === "agent" || node.kind === "skill"
      ? { description: node.description }
      : {}),
    ...(node.kind === "session" ? { activity: node.activity } : {}),
    ...(node.kind === "task"
      ? { taskStatus: node.taskStatus, priority: node.priority }
      : {}),
  };
}

function orbitPosition(
  index: number,
  count: number,
  radius: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(count, 1);
  return {
    x: Math.round((width / 2 + Math.cos(angle) * radius) * 100) / 100,
    y: Math.round((height / 2 + Math.sin(angle) * radius) * 100) / 100,
  };
}

function boundedOrbitRadius(
  radius: number,
  nodeRadius: number,
  width: number,
  height: number,
): number {
  return Math.max(
    0,
    Math.min(radius, Math.min(width, height) / 2 - nodeRadius),
  );
}

export function projectSnapshot(
  snapshot: DashboardSnapshot,
  options: RenderOptions = {},
): DashboardProjection {
  const width = options.width ?? 900;
  const height = options.height ?? 600;
  const nodes: ViewNode[] = [
    {
      id: "harness:project",
      kind: "harness",
      label: snapshot.project.name,
      status:
        snapshot.connection === "connected" && !snapshot.stale
          ? "observed"
          : snapshot.stale
            ? "stale"
            : "unknown",
      evidence: "derived-relationship",
      relatedIds: [],
      x: width / 2,
      y: height / 2,
      radius: Math.min(56, width / 2, height / 2),
      description: "Selected Atlante project and OpenCode harness",
    },
  ];
  const collections: Array<{
    kind: ViewNodeKind;
    values: Array<AgentNode | SkillNode | SessionNode | TaskNode>;
    radius: number;
    nodeRadius: number;
  }> = [
    {
      kind: "agent",
      values: [...snapshot.agents],
      radius: boundedOrbitRadius(
        Math.min(width, height) * 0.22,
        40,
        width,
        height,
      ),
      nodeRadius: Math.min(40, width / 2, height / 2),
    },
    {
      kind: "skill",
      values: [...snapshot.skills],
      radius: boundedOrbitRadius(
        Math.min(width, height) * 0.33,
        36,
        width,
        height,
      ),
      nodeRadius: Math.min(36, width / 2, height / 2),
    },
    {
      kind: "session",
      values: [...snapshot.sessions],
      radius: boundedOrbitRadius(
        Math.min(width, height) * 0.41,
        38,
        width,
        height,
      ),
      nodeRadius: Math.min(38, width / 2, height / 2),
    },
    {
      kind: "task",
      values: [...snapshot.tasks],
      radius: boundedOrbitRadius(
        Math.min(width, height) * 0.48,
        outerControlHalfHeight,
        width,
        height,
      ),
      nodeRadius: Math.min(34, width / 2, height / 2),
    },
  ];

  for (const collection of collections) {
    const values = collection.values.sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    values.forEach((value, index) => {
      const position = orbitPosition(
        index,
        values.length,
        collection.radius,
        width,
        height,
      );
      nodes.push({
        ...nodeData(value),
        kind: collection.kind,
        ...position,
        radius: collection.nodeRadius,
      });
    });
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: snapshot.edges.filter(
      (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to),
    ),
    width,
    height,
  };
}

export function filterNodes(
  nodes: ViewNode[],
  filter: DashboardFilter,
): ViewNode[] {
  if (filter === "all") return nodes;
  return nodes.filter((node) => {
    if (node.kind === "harness") return false;
    if (filter === "configured") return node.status === "configured";
    if (filter === "attention") {
      return node.status === "attention" || node.status === "error";
    }
    return (
      node.status === "observed" &&
      (node.kind !== "session" || node.activity === "active")
    );
  });
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag);
  if (className) value.className = className;
  return value;
}

function text(
  tag: keyof HTMLElementTagNameMap,
  value: string,
  className?: string,
): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

function fixedSourceHref(path: string): string | undefined {
  if (path === "atlante.jsonc") return "/atlante.jsonc";
  if (path === ".atlante/artifacts/") return "/.atlante/artifacts/";
  return undefined;
}

function formatTime(timestamp: number | undefined): string {
  if (timestamp === undefined || !Number.isFinite(timestamp))
    return "No event yet";
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function connectionLabel(
  connection: DashboardSnapshot["connection"],
  stale: boolean,
): string {
  if (connection === "connected" && !stale) return "Live";
  if (connection === "connected" && stale) return "Connected, stale";
  if (connection === "reconnecting") return "Reconnecting";
  return "Disconnected";
}

function markBrowserSnapshotStale(
  snapshot: DashboardSnapshot,
): DashboardSnapshot {
  const markUnknown = <T extends { status: NodeStatus }>(nodes: T[]): T[] =>
    nodes.map((node) =>
      node.status === "observed" ? { ...node, status: "unknown" } : node,
    );
  return {
    ...snapshot,
    stale: true,
    agents: markUnknown(snapshot.agents),
    skills: markUnknown(snapshot.skills),
    sessions: markUnknown(snapshot.sessions),
    tasks: markUnknown(snapshot.tasks),
  };
}

function renderCenterSymbol(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("aria-hidden", "true");
  const circle = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "circle",
  );
  circle.setAttribute("class", "outline");
  circle.setAttribute("cx", "60");
  circle.setAttribute("cy", "60");
  circle.setAttribute("r", "43");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("class", "line");
  path.setAttribute("d", "M35 70 50 57 67 69 83 41");
  svg.append(circle, path);
  return svg;
}

function renderStatus(node: ViewNode): HTMLElement {
  const status = element("span", `node-status status-${node.status}`);
  status.append(
    text("span", "", "status-mark"),
    text("span", statusLabels[node.status], "status-label"),
  );
  return status;
}

function renderNode(
  node: ViewNode,
  projection: DashboardProjection,
  selectedId: string | undefined,
  onSelect: (id: string) => void,
): HTMLButtonElement {
  const button = element("button", `constellation-node node-${node.kind}`);
  button.type = "button";
  button.dataset.nodeId = node.id;
  button.dataset.status = node.status;
  button.style.left = `${node.x}px`;
  button.style.top = `${node.y}px`;
  button.style.setProperty("--node-radius", `${node.radius}px`);
  button.title = node.label;
  button.setAttribute(
    "aria-label",
    `${node.label}, ${statusLabels[node.status]} ${kindLabels[node.kind]}`,
  );
  button.setAttribute("aria-pressed", String(selectedId === node.id));
  if (selectedId === node.id) button.classList.add("is-selected");
  button.append(
    node.kind === "harness"
      ? renderCenterSymbol()
      : text("span", "", "node-shape"),
    text("span", node.label, "node-label"),
    renderStatus(node),
  );
  const select = () => onSelect(node.id);
  button.addEventListener("click", select);
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  });
  // Keep the projection dimensions close to the renderer for future viewports.
  button.dataset.viewport = `${projection.width}x${projection.height}`;
  return button;
}

function renderEdges(
  projection: DashboardProjection,
  visibleIds: Set<string>,
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("constellation-edges");
  svg.setAttribute("viewBox", `0 0 ${projection.width} ${projection.height}`);
  svg.setAttribute("aria-hidden", "true");
  const nodes = new Map(projection.nodes.map((node) => [node.id, node]));
  for (const edge of projection.edges) {
    if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) continue;
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) continue;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.classList.add("constellation-edge");
    line.dataset.edgeId = edge.id;
    line.dataset.evidence = edge.evidence;
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(to.x));
    line.setAttribute("y2", String(to.y));
    svg.append(line);
  }
  return svg;
}

function renderInspector(
  parent: HTMLElement,
  node: ViewNode | undefined,
): void {
  const inspector = element("aside", "inspector");
  inspector.dataset.inspector = "true";
  inspector.setAttribute("aria-labelledby", "inspector-title");
  inspector.append(text("p", "Selected signal", "eyebrow"));
  const heading = text("h2", "Inspector", "panel-title");
  heading.id = "inspector-title";
  inspector.append(heading);
  if (!node) {
    inspector.append(
      text(
        "p",
        "Select a node to inspect its evidence and safe metadata.",
        "empty-state",
      ),
    );
    parent.append(inspector);
    return;
  }
  const title = text("h3", node.label, "inspector-name");
  inspector.append(title, renderStatus(node));
  inspector.append(
    text(
      "p",
      `${kindLabels[node.kind]} | Evidence: ${node.evidence}`,
      "inspector-meta",
    ),
  );
  if (node.description)
    inspector.append(text("p", node.description, "inspector-description"));
  if (node.activity)
    inspector.append(text("p", `Activity: ${node.activity}`, "inspector-meta"));
  if (node.lastActivityAt !== undefined)
    inspector.append(
      text(
        "p",
        `Last activity: ${formatTime(node.lastActivityAt)}`,
        "inspector-meta",
      ),
    );
  if (node.taskStatus)
    inspector.append(
      text(
        "p",
        `Task: ${node.taskStatus} | Priority: ${node.priority}`,
        "inspector-meta",
      ),
    );
  const related =
    node.relatedIds.length > 0 ? node.relatedIds.join(", ") : "None";
  inspector.append(text("p", `Related IDs: ${related}`, "inspector-meta"));
  parent.append(inspector);
}

function renderSources(parent: HTMLElement, snapshot: DashboardSnapshot): void {
  const sources = element("section", "source-panel");
  sources.append(
    text("p", "Configuration", "eyebrow"),
    text("h2", "Sources", "panel-title"),
  );
  const links = element("div", "source-links");
  for (const [label, path] of [
    ["Configuration", snapshot.project.links.configuration],
    ["Artifacts", snapshot.project.links.artifacts],
  ] as const) {
    const href = fixedSourceHref(path);
    if (!href) continue;
    const link = element("a");
    link.href = href;
    link.textContent = `${label}: ${path}`;
    links.append(link);
  }
  sources.append(links);
  parent.append(sources);
}

function renderActivity(
  parent: HTMLElement,
  snapshot: DashboardSnapshot,
): void {
  const activity = element("section", "activity-panel");
  activity.dataset.activity = "true";
  activity.append(
    text("p", "Current signal", "eyebrow"),
    text("h2", "Recent activity", "panel-title"),
  );
  const list = element("ol", "event-list");
  if (snapshot.recentEvents.length === 0) {
    list.append(
      text("li", "No accepted events in this session.", "empty-state"),
    );
  } else {
    for (const event of snapshot.recentEvents) {
      const item = element("li", "event-item");
      item.append(
        text("time", formatTime(event.timestamp), "event-time"),
        text("strong", event.summary, "event-summary"),
        text(
          "span",
          event.path
            ? `${event.path}${event.count === undefined ? "" : ` | ${event.count}`}`
            : event.kind,
          "event-detail",
        ),
      );
      list.append(item);
    }
  }
  activity.append(list);
  parent.append(activity);
}

function renderAttention(
  parent: HTMLElement,
  snapshot: DashboardSnapshot,
): void {
  const panel = element("section", "attention-panel");
  panel.append(
    text("p", "Operator attention", "eyebrow"),
    text("h2", "Attention", "panel-title"),
  );
  const list = element("ul", "attention-list");
  const pending = snapshot.attention.filter(
    (item) => item.status === "pending",
  );
  if (pending.length === 0) {
    list.append(text("li", "No pending attention items.", "empty-state"));
  } else {
    for (const item of pending) {
      const entry = element("li", "attention-item");
      entry.append(
        text(
          "span",
          item.kind === "permission" ? "Permission" : "Session error",
          "attention-kind",
        ),
        text("span", "Pending", "attention-status"),
        item.sessionId
          ? text("span", `Session: ${item.sessionId}`, "attention-detail")
          : text("span", "Project signal", "attention-detail"),
      );
      list.append(entry);
    }
  }
  panel.append(list);
  parent.append(panel);
}

function applyShellState(
  root: HTMLElement,
  snapshot: DashboardSnapshot,
  connection: DashboardSnapshot["connection"],
): boolean {
  const invalidArtifacts = snapshot.sources.artifacts === "invalid";
  const observedCount = snapshot.sessions.length + snapshot.tasks.length;
  root.className = [
    "dashboard-shell",
    `state-${connection}`,
    ...(snapshot.stale ? ["state-stale"] : []),
    ...(invalidArtifacts ? ["state-artifacts-invalid", "state-error"] : []),
    ...(snapshot.sources.artifacts === "missing"
      ? ["state-artifacts-missing"]
      : []),
    ...(observedCount === 0 ? ["state-empty"] : []),
  ].join(" ");
  root.dataset.state = invalidArtifacts ? "error" : connection;
  root.replaceChildren();
  return invalidArtifacts;
}

function renderConnectionHeader(
  root: HTMLElement,
  snapshot: DashboardSnapshot,
  connection: DashboardSnapshot["connection"],
): void {
  const header = element("header", "connection-bar");
  const heading = element("div", "connection-heading");
  heading.append(
    text("p", "Atlante / live dashboard", "eyebrow"),
    text("h1", snapshot.project.name, "project-name"),
    text(
      "p",
      snapshot.project.branch
        ? `Branch: ${snapshot.project.branch}`
        : "Branch unavailable",
      "branch",
    ),
  );
  const connectionStatus = element("div", "connection-status");
  connectionStatus.dataset.connection = "true";
  connectionStatus.append(
    text(
      "span",
      connectionLabel(connection, snapshot.stale),
      "connection-label",
    ),
    text(
      "span",
      snapshot.stale
        ? "Stale event context"
        : `Last event: ${formatTime(snapshot.lastSuccessfulEventAt)}`,
      "connection-detail",
    ),
  );
  header.append(heading, connectionStatus);
  root.append(header);
}

function renderFilterBar(
  main: HTMLElement,
  filter: DashboardFilter,
  onFilter: (filter: DashboardFilter) => void,
): void {
  const filterBar = element("nav", "filter-bar");
  filterBar.setAttribute("aria-label", "Node visibility");
  for (const current of ["all", "active", "attention", "configured"] as const) {
    const button = element("button", "filter-button");
    button.type = "button";
    button.dataset.filter = current;
    button.textContent = filterLabels[current];
    button.setAttribute("aria-pressed", String(filter === current));
    if (filter === current) button.classList.add("is-selected");
    button.addEventListener("click", () => onFilter(current));
    filterBar.append(button);
  }
  main.append(filterBar);
}

function renderConstellation(
  snapshot: DashboardSnapshot,
  projection: DashboardProjection,
  visibleIds: Set<string>,
  selectedId: string | undefined,
  onSelect: (id: string) => void,
  invalidArtifacts: boolean,
): HTMLElement {
  const layout = element("div", "dashboard-layout");
  const constellationPanel = element("section", "constellation-panel");
  constellationPanel.setAttribute("aria-labelledby", "constellation-title");
  constellationPanel.append(text("p", "Observed topology", "eyebrow"));
  const constellationHeading = text("h2", "Constellation", "panel-title");
  constellationHeading.id = "constellation-title";
  constellationPanel.append(constellationHeading);
  const workflowNotice = text(
    "p",
    "Workflows unavailable: no explicit workflow identity is present in v0.1 artifacts.",
    "workflow-notice",
  );
  workflowNotice.dataset.workflowState = snapshot.sources.workflows;
  constellationPanel.append(workflowNotice);
  if (snapshot.sources.artifacts !== "available") {
    constellationPanel.append(
      text(
        "p",
        snapshot.sources.artifacts === "invalid"
          ? "Artifacts invalid: configured nodes are unavailable."
          : "Artifacts missing: configured nodes are unavailable.",
        "source-warning",
      ),
    );
  }
  const canvas = element("div", "constellation-canvas");
  canvas.style.setProperty("--canvas-width", `${projection.width}px`);
  canvas.style.setProperty("--canvas-height", `${projection.height}px`);
  const stage = element("div", "constellation-stage");
  stage.dataset.width = String(projection.width);
  stage.dataset.height = String(projection.height);
  stage.append(renderEdges(projection, visibleIds));
  for (const node of projection.nodes) {
    const button = renderNode(node, projection, selectedId, onSelect);
    if (!visibleIds.has(node.id)) button.hidden = true;
    stage.append(button);
  }
  canvas.append(stage);
  constellationPanel.append(canvas);
  if (projection.nodes.length === 1) {
    constellationPanel.append(
      text(
        "p",
        invalidArtifacts
          ? "Artifacts invalid: no configured nodes were added."
          : "No observed agents, sessions, or tasks yet.",
        "empty-state",
      ),
    );
  }
  const legend = element("p", "constellation-legend");
  legend.append(
    text("span", "Line: derived relationship", "legend-item"),
    text("span", "Status: text and shape", "legend-item"),
  );
  constellationPanel.append(legend);
  layout.append(constellationPanel);
  return layout;
}

function renderSidePanel(
  snapshot: DashboardSnapshot,
  selectedNode: ViewNode | undefined,
): HTMLElement {
  const side = element("div", "side-panel");
  renderInspector(side, selectedNode);
  renderSources(side, snapshot);
  renderActivity(side, snapshot);
  renderAttention(side, snapshot);
  return side;
}

function renderLiveRegion(
  root: HTMLElement,
  snapshot: DashboardSnapshot,
  visibleCount: number,
): void {
  const live = text(
    "p",
    `Snapshot updated: ${snapshot.project.name}. ${visibleCount} nodes visible.`,
    "live-region",
  );
  live.setAttribute("aria-live", "polite");
  live.setAttribute("role", "status");
  root.append(live);
}

function fitCanvas(canvas: HTMLElement): void {
  const stage = canvas.querySelector<HTMLElement>(".constellation-stage");
  if (!stage) return;
  const width = canvas.clientWidth || canvas.getBoundingClientRect().width;
  const height = canvas.clientHeight || canvas.getBoundingClientRect().height;
  const logicalWidth = Number(stage.dataset.width);
  const logicalHeight = Number(stage.dataset.height);
  const scale =
    width > 0 && height > 0 && logicalWidth > 0 && logicalHeight > 0
      ? Math.min(width / logicalWidth, height / logicalHeight, 1)
      : 1;
  stage.style.setProperty("--canvas-scale", String(scale));
}

function renderDashboardContent(
  root: HTMLElement,
  snapshot: DashboardSnapshot,
  options: RenderOptions,
  filter: DashboardFilter,
  selectedId: string | undefined,
  transportState: DashboardSnapshot["connection"],
  onFilter: (filter: DashboardFilter) => void,
  onSelect: (id: string) => void,
): void {
  const projection = projectSnapshot(snapshot, options);
  const visibleNodes = filterNodes(projection.nodes, filter);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  visibleIds.add("harness:project");
  const selectedNode = projection.nodes.find((node) => node.id === selectedId);
  const invalidArtifacts = applyShellState(root, snapshot, transportState);
  renderConnectionHeader(root, snapshot, transportState);
  const main = element("main", "dashboard-main");
  main.id = "dashboard-main";
  renderFilterBar(main, filter, onFilter);
  const layout = renderConstellation(
    snapshot,
    projection,
    visibleIds,
    selectedId,
    onSelect,
    invalidArtifacts,
  );
  layout.append(renderSidePanel(snapshot, selectedNode));
  main.append(layout);
  root.append(main);
  renderLiveRegion(root, snapshot, visibleNodes.length);
}

export function renderDashboard(
  root: HTMLElement,
  snapshot: DashboardSnapshot,
  options: RenderOptions = {},
): DashboardController {
  let current = snapshot;
  let filter: DashboardFilter = "all";
  let selectedId: string | undefined;
  let transportState = snapshot.connection;
  let destroyed = false;
  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver((entries) => {
          for (const entry of entries) fitCanvas(entry.target as HTMLElement);
        });

  const fit = (): void => {
    const canvas = root.querySelector<HTMLElement>(".constellation-canvas");
    if (!canvas) return;
    fitCanvas(canvas);
    resizeObserver?.observe(canvas);
  };

  const render = (): void => {
    if (destroyed) return;
    const projection = projectSnapshot(current, options);
    if (
      selectedId &&
      !projection.nodes.some((node) => node.id === selectedId)
    ) {
      selectedId = undefined;
    }
    renderDashboardContent(
      root,
      current,
      options,
      filter,
      selectedId,
      transportState,
      (nextFilter) => {
        filter = nextFilter;
        render();
      },
      (id) => {
        selectedId = id;
        render();
        for (const node of root.querySelectorAll<HTMLElement>(
          "[data-node-id]",
        )) {
          if (node.dataset.nodeId === id) {
            node.focus();
            break;
          }
        }
      },
    );
    fit();
  };
  render();
  return {
    update(next) {
      current = next;
      transportState = next.connection;
      render();
    },
    setTransportState(state) {
      if (state !== "connected") current = markBrowserSnapshotStale(current);
      transportState = state;
      render();
    },
    destroy() {
      destroyed = true;
      resizeObserver?.disconnect();
      root.replaceChildren();
    },
  };
}

function fallbackSnapshot(): DashboardSnapshot {
  return {
    schemaVersion: 1,
    connection: "disconnected",
    stale: true,
    project: {
      name: "Atlante dashboard",
      links: {
        configuration: "atlante.jsonc",
        artifacts: ".atlante/artifacts/",
      },
    },
    agents: [],
    skills: [],
    workflows: [],
    sessions: [],
    tasks: [],
    edges: [],
    attention: [],
    recentEvents: [],
    sources: {
      artifacts: "missing",
      runtime: "unavailable",
      workflows: "unavailable",
    },
    diagnostics: { droppedEvents: 0, malformedEvents: 0 },
  };
}

export function bootstrapDashboard(
  root: HTMLElement,
  options: BootstrapOptions = {},
): DashboardController {
  const controller = renderDashboard(
    root,
    options.initialSnapshot ?? fallbackSnapshot(),
    options,
  );
  let source: SnapshotEventSource | undefined;
  let closed = false;
  const fetchSnapshot =
    options.fetchSnapshot ??
    (() =>
      fetch(DASHBOARD_ASSET_PATHS.snapshot, {
        credentials: "same-origin",
      }).then((response) => {
        if (!response.ok) throw new Error("snapshot unavailable");
        return response.json() as Promise<DashboardSnapshot>;
      }));
  const eventSourceFactory =
    options.eventSourceFactory ?? ((url) => new EventSource(url));

  void fetchSnapshot()
    .then((snapshot) => {
      if (closed) return;
      controller.update(snapshot);
      source = eventSourceFactory(DASHBOARD_ASSET_PATHS.events);
      source.addEventListener("snapshot", (event) => {
        try {
          controller.update(
            JSON.parse((event as MessageEvent).data) as DashboardSnapshot,
          );
        } catch {
          controller.setTransportState("reconnecting");
        }
      });
      source.addEventListener("error", () =>
        controller.setTransportState("reconnecting"),
      );
    })
    .catch(() => {
      if (!closed) controller.setTransportState("disconnected");
    });
  return {
    update: controller.update,
    setTransportState: controller.setTransportState,
    destroy() {
      closed = true;
      source?.close();
      controller.destroy();
    },
  };
}

if (typeof document !== "undefined") {
  const root = document.querySelector<HTMLElement>("[data-dashboard]");
  if (root) bootstrapDashboard(root);
}
