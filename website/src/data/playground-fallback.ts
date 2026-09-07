export type PlaygroundFallbackFile = {
  path: string;
  content: string;
};

export const playgroundFallback = {
  output:
    "built .opencode/\nStatic example shown because the live playground is unavailable.",
  files: [
    {
      path: ".opencode/agents/implementer.md",
      content: `# Implementer

You are a senior implementer on my-app.

## Mission

Write clean, tested, production-ready code.
`,
    },
    {
      path: ".opencode/skills/SKILL.md",
      content: `# Project guidance

Use the project configuration as the source for the generated harness.
`,
    },
  ] satisfies PlaygroundFallbackFile[],
};
