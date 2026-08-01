// These plugin-owned public types intentionally mirror the builder's verified
// artifact shapes so the published plugin declarations stay self-contained and
// consumers do not need the private, unpublished @atlante/builder package.
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
