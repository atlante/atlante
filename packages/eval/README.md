# `@atlante/eval`

Private host-runner orchestration and deterministic evaluation checks for
[Atlante](https://github.com/atlante/atlante).

The package assembles disposable trial sandboxes (a copy of the scenario
fixture plus the project's verified native OpenCode outputs), runs the
[OpenCode](https://opencode.ai/) host headless against a scenario prompt, and
grades the resulting sandbox with deterministic, zero-LLM checks. Scenario
documents, budget resolution, and validation live in `@atlante/validator` and
`@atlante/schema`; this package owns the runtime: fixture setup, containment
(forced permission denials and an allowlisted environment), usage-derived
budget enforcement, snapshot-based file checks, and report assembly.

The package never loads source configuration or resolves packs: callers pass
an evaluated `EvalConfig` plus the discovered scenario documents, and the CLI
composes the result with `@atlante/opencode`'s verified native outputs.

```ts
import { createOpenCodeRunner, runEval } from "@atlante/eval";

const report = await runEval({
  projectRoot: "/path/to/project",
  evalConfig,
  budget,
  scenarios,
  atlanteVersion,
  runner: createOpenCodeRunner(),
  onProgress: (progress) => console.error(progress.kind),
});
```

Preparation is fail-closed: missing native outputs, invalid scenarios, or a
missing host produce diagnostics before any trial runs, and nothing is
published to the report path. `runChecks` and the budget helpers are exported
for host-neutral reuse; containment is tool-level policy, not OS-level
isolation, so only run scenarios whose fixture content you trust.
