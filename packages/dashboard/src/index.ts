export type { ArtifactProjection } from "./artifacts.js";
export { projectArtifacts } from "./artifacts.js";
export { loadDashboardBrandAssets } from "./brand-assets.js";
export type {
  AgentNode,
  AttentionItem,
  ConnectionState,
  DashboardEvent,
  DashboardSnapshot,
  EventSummary,
  EvidenceSource,
  Relation,
  SessionNode,
  SkillNode,
  TaskNode,
} from "./model.js";
export {
  cloneSnapshot,
  createEmptySnapshot,
  DASHBOARD_BOUNDS,
  dashboardId,
  IdentityRegistry,
} from "./model.js";
export type {
  DashboardMonitorDependencies,
  DashboardMonitorHandle,
  DashboardMonitorOptions,
} from "./monitor.js";
export { startDashboardMonitor } from "./monitor.js";
export type {
  ObserverError,
  OpenCodeEventEnvelope,
  OpenCodeObserverOptions,
  OpenCodeProjectCheck,
  OpenCodeSdkReadClient,
  OpenCodeSession,
  OpenCodeSource,
  OpenCodeSourceOptions,
  OpenCodeStatus,
  OpenCodeTodo,
} from "./opencode.js";
export {
  createOpenCodeSource,
  normalizeOpenCodeEvent,
  OpenCodeObserver,
} from "./opencode.js";
export type {
  AllowedEventType,
  ProjectionOptions,
  ProjectionResult,
} from "./projection.js";
export { applyDashboardEvent } from "./projection.js";
export type {
  DashboardAsset,
  DashboardAssetProvider,
  DashboardAssets,
  DashboardServerHandle,
  DashboardServerOptions,
  DashboardServerStore,
} from "./server.js";
export { startDashboardServer } from "./server.js";
export type {
  DashboardStoreOptions,
  SnapshotSubscriber,
  StoreEvent,
} from "./store.js";
export { DashboardStore } from "./store.js";
export {
  DASHBOARD_ASSET_PATHS,
  DASHBOARD_FONT_PATHS,
  type DashboardAssetPath,
  type DashboardFontPath,
} from "./web/assets.js";
export type {
  BootstrapOptions,
  DashboardController,
  DashboardFilter,
  DashboardProjection,
  RenderOptions,
  SnapshotEventSource,
  ViewNode,
  ViewNodeKind,
} from "./web/client.js";
export {
  bootstrapDashboard,
  filterNodes,
  projectSnapshot,
  renderDashboard,
} from "./web/client.js";
