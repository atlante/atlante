# `@atlante/eval`

Private workspace. Host-runner orchestration for `atlante eval`: sandbox
lifecycle for trials, budget enforcement, deterministic zero-LLM checks, and
run reports.

## Boundaries

- Delegates scenario execution to the declared host (OpenCode) in a disposable
  sandbox; it never performs LLM inference or executes agents itself outside
  that delegated run.
- Containment is tool-level policy, not OS-level isolation: only run
  scenarios whose fixture content you trust.

## Context

See [`AGENTS.md`](../../AGENTS.md) for the workspace architecture and
[`docs/src/content/docs/reference/cli.md`](../../docs/src/content/docs/reference/cli.md)
for the user-facing `atlante eval` contract.
