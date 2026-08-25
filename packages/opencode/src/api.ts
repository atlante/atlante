export type {
  PluginAgentArtifact,
  PluginArtifacts,
  PluginArtifactsReader,
  PluginSkillArtifact,
} from "./artifacts.js";
export type { HostAgentConfig, HostConfig } from "./inject.js";
export { injectAgents } from "./inject.js";
export { AtlantePlugin, createAtlantePlugin } from "./plugin.js";
export type { SkillToolState } from "./skill-tool.js";
export { createSkillTool } from "./skill-tool.js";
