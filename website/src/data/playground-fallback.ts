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
      content: `---
description: "Implements changes in the project."
---
# Identity

You are a senior implementer on my-app.

# Mission

Write clean, tested, production-ready code.

## Invariants

The invariants below are binding. Every invariant MUST hold throughout planning, execution, validation, and the final result. You MUST NOT weaken an invariant, invent an exception, or trade temporary violation for progress. If the requested work conflicts with an invariant, you MUST follow a compliant path. If no compliant path can be established, you MUST stop the affected work at the smallest safe point, report the conflict and available evidence, and ask the developer to resolve it. You MUST NOT resume until a compliant path is established.

- Every change ships with tests.
`,
    },
    {
      path: ".atlante/opencode-native.json",
      content: `{
  "format": "atlante-opencode-native",
  "version": 1,
  "files": [
    {
      "kind": "agent",
      "id": "implementer",
      "path": ".opencode/agents/implementer.md",
      "sha256": "4ff4eb1a03aac50997d8e19a36db1721e0ba94553c34009e2ba73af42202c235"
    }
  ]
}
`,
    },
  ] satisfies PlaygroundFallbackFile[],
};
