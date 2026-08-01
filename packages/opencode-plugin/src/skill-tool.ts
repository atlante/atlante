import { type ToolDefinition, tool } from "@opencode-ai/plugin";
import type { PluginSkillArtifact } from "./artifacts.js";

export type SkillToolState = {
  status: "inactive" | "active" | "failed";
  reason?: string;
};

export function createSkillTool(
  skills: readonly PluginSkillArtifact[],
  state: SkillToolState,
): ToolDefinition {
  const artifacts = skills.map((skill) => ({ ...skill }));
  const byId = new Map(artifacts.map((skill) => [skill.skillId, skill]));
  const available = artifacts.map(
    (skill) => `- ${skill.skillId}: ${skill.description}`,
  );

  return tool({
    description: [
      "Retrieve a rendered Atlante project skill by name.",
      "Available Atlante project skills:",
      ...available,
    ].join("\n"),
    args: { name: tool.schema.string().min(1) },
    async execute({ name }) {
      if (state.status === "inactive") {
        throw new Error(
          "Atlante skills are inactive until configuration commits",
        );
      }
      if (state.status !== "active") {
        throw new Error(
          `Atlante skills unavailable: ${state.reason ?? "materialization failed"}`,
        );
      }

      const skill = byId.get(name);
      if (!skill) {
        throw new Error(
          `unknown Atlante skill "${name}"; available skills: ${
            artifacts.map((artifact) => artifact.skillId).join(", ") || "(none)"
          }`,
        );
      }
      return skill.content;
    },
  });
}
