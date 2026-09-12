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
- Project-local scenarios use project-root fixture paths; scenarios discovered
  from a selected pack use pack-root fixture paths. The runner receives the
  resolved origin and does not reinterpret a pack path relative to the project.
- Pack metadata is discovery input, not execution authorization. Only the
  project's explicit `eval.include` selection can pass a pack suite to the
  runner.
- Setup and command checks remain executable tool-level policy inside the
  delegated sandbox. Inspect third-party fixtures and commands before running
  them.

## Pack reports

`atlante eval` writes run reports locally under `.atlante/eval` by default. A
pack may publish a report alongside its scenarios and declare that path in its
root preset's `eval.report` field. Consumers can display a validated subset of
that report as **self-reported evaluation**. The report is provenance from the
pack author, not Atlante certification, an independent reproduction, or a
security verdict. Report parsing belongs to the consuming surface and must
fail closed for unsafe paths and malformed provenance.

## Context

See [`AGENTS.md`](../../AGENTS.md) for the workspace architecture and
[`docs/src/content/docs/reference/cli.md`](../../docs/src/content/docs/reference/cli.md)
for the user-facing `atlante eval` contract.
