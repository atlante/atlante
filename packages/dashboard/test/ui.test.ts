// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createEmptySnapshot, type DashboardSnapshot } from "../src/model.js";
import { DASHBOARD_ASSET_PATHS } from "../src/web/assets.js";
import {
  bootstrapDashboard,
  filterNodes,
  projectSnapshot,
  renderDashboard,
} from "../src/web/client.js";

const styles = readFileSync(
  resolve(process.cwd(), "packages/dashboard/src/web/styles.css"),
  "utf8",
);

const base = createEmptySnapshot({
  name: "demo",
  branch: "main",
  artifacts: "available",
  agents: [
    {
      kind: "agent",
      id: "agent:reviewer",
      sourceIdentity: "reviewer",
      label: "Reviewer",
      description: "Checks changes",
      status: "configured",
      evidence: "artifact-manifest",
      relatedIds: [],
    },
  ],
  skills: [
    {
      kind: "skill",
      id: "skill:review",
      label: "Review skill",
      description: "A configured skill",
      status: "configured",
      evidence: "artifact-manifest",
      relatedIds: [],
    },
  ],
});

function fixture(): DashboardSnapshot {
  return {
    ...structuredClone(base),
    sessions: [
      {
        kind: "session",
        id: "session:one",
        label: "Session one",
        status: "observed",
        evidence: "host-event",
        relatedIds: ["task:one"],
        activity: "active",
        lastActivityAt: 100,
      },
    ],
    tasks: [
      {
        kind: "task",
        id: "task:one",
        label: "Task one",
        status: "attention",
        evidence: "host-event",
        relatedIds: ["session:one"],
        sessionId: "session:one",
        taskStatus: "pending",
        priority: "high",
        lastActivityAt: 101,
      },
    ],
    edges: [
      {
        id: "edge:one",
        from: "session:one",
        to: "task:one",
        kind: "session-task",
        evidence: "derived-relationship",
      },
    ],
    attention: [
      {
        id: "attention:one",
        kind: "permission",
        status: "pending",
        evidence: "host-event",
        sessionId: "session:one",
        lastActivityAt: 102,
      },
    ],
    recentEvents: [
      {
        id: "event:one",
        kind: "file.edited",
        summary: "<img src=x onerror=alert(1)>",
        evidence: "host-event",
        timestamp: 102,
        path: "src/main.ts",
        count: 1,
      },
    ],
    sources: {
      artifacts: "available",
      runtime: "connected",
      workflows: "unavailable",
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("dashboard constellation projection", () => {
  test("produces stable radial coordinates and keeps workflow nodes unavailable", () => {
    const snapshot = fixture();
    const first = projectSnapshot(snapshot, { width: 900, height: 600 });
    const second = projectSnapshot(snapshot, { width: 900, height: 600 });

    expect(first.nodes).toEqual(second.nodes);
    expect(first.nodes.find((node) => node.kind === "harness")).toMatchObject({
      id: "harness:project",
      x: 450,
      y: 300,
    });
    expect(first.nodes.some((node) => node.kind === "workflow")).toBe(false);
    expect(first.edges).toEqual([
      expect.objectContaining({ from: "session:one", to: "task:one" }),
    ]);
  });

  test("classifies filters without inferring activity", () => {
    const nodes = projectSnapshot(fixture(), { width: 800, height: 500 }).nodes;

    expect(filterNodes(nodes, "all")).toHaveLength(5);
    expect(filterNodes(nodes, "configured").map((node) => node.id)).toEqual([
      "agent:reviewer",
      "skill:review",
    ]);
    expect(filterNodes(nodes, "active").map((node) => node.id)).toEqual([
      "session:one",
    ]);
    expect(filterNodes(nodes, "attention").map((node) => node.id)).toEqual([
      "task:one",
    ]);
  });

  test("keeps every narrow-layout node bound and edge endpoint inside the canvas", () => {
    const projection = projectSnapshot(fixture(), { width: 320, height: 360 });

    for (const node of projection.nodes) {
      expect(node.x - node.radius).toBeGreaterThanOrEqual(0);
      expect(node.x + node.radius).toBeLessThanOrEqual(projection.width);
      expect(node.y - node.radius).toBeGreaterThanOrEqual(0);
      expect(node.y + node.radius).toBeLessThanOrEqual(projection.height);
    }
    for (const edge of projection.edges) {
      const endpoints = projection.nodes.filter(
        (node) => node.id === edge.from || node.id === edge.to,
      );
      expect(endpoints).toHaveLength(2);
      for (const node of endpoints) {
        expect(node.x).toBeGreaterThanOrEqual(0);
        expect(node.x).toBeLessThanOrEqual(projection.width);
        expect(node.y).toBeGreaterThanOrEqual(0);
        expect(node.y).toBeLessThanOrEqual(projection.height);
      }
    }
  });

  test("keeps rendered controls contained for every node kind on a narrow stage", () => {
    const snapshot = fixture();
    snapshot.tasks[0].label = "a".repeat(160);

    for (const dimensions of [
      { width: 900, height: 600 },
      { width: 320, height: 360 },
    ]) {
      const projection = projectSnapshot(snapshot, dimensions);
      for (const node of projection.nodes) {
        const controlWidth = node.radius * 2;
        const controlHeight = node.kind === "harness" ? node.radius * 2 : 72;
        expect(node.x - controlWidth / 2).toBeGreaterThanOrEqual(0);
        expect(node.x + controlWidth / 2).toBeLessThanOrEqual(projection.width);
        expect(node.y - controlHeight / 2).toBeGreaterThanOrEqual(0);
        expect(node.y + controlHeight / 2).toBeLessThanOrEqual(
          projection.height,
        );
      }
    }
  });

  test("renders narrow-layout node coordinates inside one scaled stage", () => {
    const root = document.createElement("div");
    document.body.append(root);
    renderDashboard(root, fixture(), { width: 320, height: 360 });

    const stage = root.querySelector<HTMLElement>(".constellation-stage");
    expect(stage?.dataset).toMatchObject({ width: "320", height: "360" });
    for (const node of projectSnapshot(fixture(), {
      width: 320,
      height: 360,
    }).nodes) {
      const button = root.querySelector<HTMLElement>(
        `[data-node-id="${node.id}"]`,
      );
      expect(button?.parentElement).toBe(stage);
      expect(Number.parseFloat(button?.style.left ?? "NaN")).toBe(node.x);
      expect(Number.parseFloat(button?.style.top ?? "NaN")).toBe(node.y);
      expect(button?.style.getPropertyValue("--node-radius")).toBe(
        `${node.radius}px`,
      );
    }
  });

  test("bounds long node labels while retaining their full accessible name", () => {
    const longLabel = "a".repeat(160);
    const snapshot = fixture();
    snapshot.agents[0].label = longLabel;
    const root = document.createElement("div");
    document.body.append(root);
    renderDashboard(root, snapshot, { width: 320, height: 360 });

    const button = root.querySelector<HTMLButtonElement>(
      '[data-node-id="agent:reviewer"]',
    );
    expect(button?.title).toBe(longLabel);
    expect(button?.getAttribute("aria-label")).toContain(longLabel);
    expect(button?.querySelector(".node-label")?.textContent).toBe(longLabel);
    expect(styles).toContain("height: 72px");
    expect(styles).toContain("white-space: nowrap");
    expect(styles).toContain("text-overflow: ellipsis");
  });
});

describe("dashboard DOM", () => {
  test("renders safe text, selection, keyboard focus, filters, links, and live updates", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const controller = renderDashboard(root, fixture(), {
      width: 900,
      height: 600,
    });

    expect(root.textContent).toContain("demo");
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(root.querySelector("img")).toBeNull();
    expect(
      root.querySelectorAll("form, input, textarea, [data-mutation]"),
    ).toHaveLength(0);
    expect(root.querySelector('a[href="/atlante.jsonc"]')).not.toBeNull();
    expect(root.querySelector('a[href="/.atlante/artifacts/"]')).not.toBeNull();

    const node = root.querySelector<HTMLButtonElement>(
      '[data-node-id="session:one"]',
    );
    expect(node?.tabIndex).toBe(0);
    node?.focus();
    node?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(root.querySelector("[data-inspector]")?.textContent).toContain(
      "Session one",
    );

    root.querySelector<HTMLButtonElement>('[data-filter="attention"]')?.click();
    expect(
      root
        .querySelector('[data-node-id="session:one"]')
        ?.hasAttribute("hidden"),
    ).toBe(true);
    expect(
      root.querySelector('[data-node-id="task:one"]')?.hasAttribute("hidden"),
    ).toBe(false);

    const updated = fixture();
    updated.sessions[0].label = "Updated session";
    controller.update(updated);
    expect(root.querySelector("[aria-live='polite']")?.textContent).toContain(
      "Snapshot updated",
    );
    expect(root.querySelector("[data-inspector]")?.textContent).toContain(
      "Updated session",
    );
  });

  test.each([
    ["disconnected", true, "Disconnected"],
    ["reconnecting", false, "Reconnecting"],
    ["connected", false, "Live"],
    ["connected", true, "Connected, stale"],
  ] as const)("shows the %s connection state", (connection, stale, label) => {
    const root = document.createElement("div");
    document.body.append(root);
    renderDashboard(root, { ...fixture(), connection, stale });
    expect(root.classList.contains(`state-${connection}`)).toBe(true);
    expect(root.querySelector("[data-connection]")?.textContent).toContain(
      label,
    );
  });

  test("shows retained last activity in the selected node inspector", () => {
    const root = document.createElement("div");
    document.body.append(root);
    renderDashboard(root, fixture());

    root
      .querySelector<HTMLButtonElement>('[data-node-id="session:one"]')
      ?.click();

    const inspector = root.querySelector("[data-inspector]");
    expect(inspector?.textContent).toContain("Last activity:");
    expect(inspector?.textContent).not.toContain("100");
  });

  test("shows stale and invalid artifact states without inventing nodes", () => {
    const root = document.createElement("div");
    document.body.append(root);
    renderDashboard(root, {
      ...fixture(),
      connection: "disconnected",
      stale: true,
      agents: [],
      skills: [],
      sources: { ...fixture().sources, artifacts: "invalid" },
    });
    expect(root.classList.contains("state-stale")).toBe(true);
    expect(root.classList.contains("state-artifacts-invalid")).toBe(true);
    expect(root.textContent).toContain("Artifacts invalid");
    expect(root.textContent).toContain("Workflows unavailable");
    expect(root.querySelectorAll("[data-node-id]")).toHaveLength(3);
  });

  test("bootstraps from same-origin snapshot and the named snapshot SSE event", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const listeners = new Map<string, (event?: Event) => void>();
    const source = {
      addEventListener(type: string, listener: (event?: Event) => void) {
        listeners.set(type, listener);
      },
      close: vi.fn(),
    };
    const controller = bootstrapDashboard(root, {
      fetchSnapshot: async () => fixture(),
      eventSourceFactory: (url) => {
        expect(url).toBe(DASHBOARD_ASSET_PATHS.events);
        return source;
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(root.textContent).toContain("Session one");
    const next = fixture();
    next.project.name = "next project";
    const snapshotListener = listeners.get("snapshot");
    expect(snapshotListener).toBeDefined();
    snapshotListener?.({ data: JSON.stringify(next) } as MessageEvent);
    expect(root.textContent).toContain("next project");
    controller.destroy();
    expect(source.close).toHaveBeenCalledOnce();
  });

  test("fails closed to stale unknown activity when SSE errors before replacement data", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const listeners = new Map<string, (event?: Event) => void>();
    const source = {
      addEventListener(type: string, listener: (event?: Event) => void) {
        listeners.set(type, listener);
      },
      close: vi.fn(),
    };
    const controller = bootstrapDashboard(root, {
      fetchSnapshot: async () => fixture(),
      eventSourceFactory: () => source,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(root.querySelector('[data-status="observed"]')).not.toBeNull();
    listeners.get("error")?.();

    expect(root.classList.contains("state-reconnecting")).toBe(true);
    expect(root.classList.contains("state-stale")).toBe(true);
    expect(root.querySelector("[data-connection]")?.textContent).toContain(
      "Stale event context",
    );
    expect(
      root
        .querySelector('[data-node-id="session:one"]')
        ?.getAttribute("data-status"),
    ).toBe("unknown");
    expect(root.querySelector('[data-status="observed"]')).toBeNull();
    controller.destroy();
  });

  test("keeps the browser surface aligned with the brand motion and responsive conventions", () => {
    expect(styles).toContain("var(--ds-bg)");
    expect(styles).toContain("stroke-width: 1.35");
    expect(styles).toContain("@media (max-width: 900px)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("transition: none !important");
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/,
    );
    expect(styles).toContain(".state-connected.state-stale .connection-label");
    const root = document.createElement("div");
    document.body.append(root);
    renderDashboard(root, fixture());
    expect(root.querySelector(".dashboard-layout")).not.toBeNull();
    expect(root.querySelector(".side-panel")).not.toBeNull();
  });
});
