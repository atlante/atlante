// These plugin-owned public types intentionally mirror the verified artifact
// shapes owned by @atlante/artifacts so the published plugin declarations stay
// self-contained and consumers do not need the private, unpublished
// @atlante/artifacts package.
// Compatibility is checked through the readArtifacts assignment in plugin.ts.

export type PluginAgentArtifact = {
  hostAgentId: string;
  description: string;
  prompt: string;
};

export type PluginSkillArtifact = {
  skillId: string;
  description: string;
  content: string;
};

export type PluginArtifacts = {
  agents: PluginAgentArtifact[];
  skills: PluginSkillArtifact[];
};

export type PluginArtifactsReader = (
  directory: string,
) => PluginArtifacts | undefined;
