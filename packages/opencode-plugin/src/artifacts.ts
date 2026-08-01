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
