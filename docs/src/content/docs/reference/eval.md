---
title: Eval
description: The eval configuration, scenario documents, checks, budgets, and reports for testing a harness.
---

`atlante eval` runs a built harness through
[OpenCode](https://opencode.ai/) in disposable sandboxes. Each trial starts
with a copy of the scenario fixture and the native agent and skill files,
then checks the resulting files and command results against explicit assertions.

This reference defines configuration, scenarios, checks, budgets, and reports.
For a complete setup procedure, see
[Evaluate your harness](/guides/evaluating-a-harness).

Eval never builds. It reads the verified native outputs of a prior
`atlante build`, and a rebuild is required whenever the sources change. Every
validation failure — including an invalid check pattern — fails before any
host run or model call.

## Requirements

A run needs all of the following:

| Requirement | Provided by |
| --- | --- |
| An `eval` section | `atlante.jsonc` |
| Scenario documents | The files matched by the `scenarios` glob |
| Verified native outputs | A prior `atlante build` |
| OpenCode on `PATH` | The installed `opencode` executable |
| Stored provider credentials | OpenCode's `auth.json`; shell API-key variables alone are insufficient |
| Git on `PATH` | Used to establish the trial's baseline snapshot |
| Setup and check executables | Tools invoked by the scenario, such as Bun for `bun test` |

## Configuration

```jsonc title="atlante.jsonc — eval excerpt"
{
  "eval": {
    "host": "opencode",
    // Scenario documents may be .json or .jsonc; a trailing star matches both.
    "scenarios": "eval/scenarios/*.eval.json*",
    "model": "anthropic/claude-sonnet-4-5",
    "budget": {
      "trials": 3,
      "timeoutMs": 600000,
      "maxSessions": 15,
      "maxTokens": 400000
    }
  }
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `host` | `"opencode"` | The host runner; the only admitted value in v0.1 |
| `scenarios` | string | Glob of scenario documents, relative to the project root |
| `model` | string | Optional model passed through to the host run; omitted uses the host default |
| `budget` | object | Optional run budget; absent fields inherit the defaults below |

| Budget field | Default | Meaning |
| --- | --- | --- |
| `trials` | 3 | Trials per scenario; at most 50 per scenario |
| `timeoutMs` | 600000 | Host-session wall-clock limit per trial; at most 3600000 |
| `maxSessions` | 15 | Host sessions per run; later requested trials become `skipped-budget` |
| `maxTokens` | 400000 | Token threshold per trial, enforced from cumulative host usage events |

`timeoutMs` covers the host session only. It excludes sandbox assembly, setup,
checks, diff collection, and cleanup. Scenario `budget.timeoutMs` overrides it
for that scenario. Setup has a separate fixed 300000 ms timeout, and command
checks have independent timeouts that default to 120000 ms.

`maxTokens` is enforced separately for each trial; it is not an aggregate run
cap. Enforcement aborts after an observed cumulative usage value exceeds the
threshold, so the final event can overshoot it. A trial whose host emits no
usage events is reported with `budgetUnmonitored: true`: `maxTokens` cannot be
enforced for it and only the host-session timeout bounds model spend.

## Scenario documents

A scenario is a versioned document that validates against
[`https://atlante.sh/schema/v0.1/eval-scenario.json`](https://atlante.sh/schema/v0.1/eval-scenario.json):

```jsonc title="eval/scenarios/adds-health-endpoint.eval.json"
{
  "$schema": "https://atlante.sh/schema/v0.1/eval-scenario.json",
  "version": "0.1",
  "name": "adds-health-endpoint",
  "task": {
    "fixture": "eval/fixtures/empty-app",
    "agent": "api-designer",
    "prompt": "Add a GET /health endpoint that returns { \"status\": \"ok\" }."
  },
  "checks": [
    { "type": "command", "run": ["bun", "test", "health"] },
    {
      "type": "file-contains",
      "path": "src/routes.ts",
      "pattern": "\"status\": \"ok\""
    },
    {
      "type": "diff-allowlist",
      "allow": ["src/routes.ts", "src/health.test.ts"]
    }
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `$schema` | string | The exact v0.1 eval-scenario URI |
| `version` | `"0.1"` | Scenario document version |
| `name` | string | Slug (`a-z`, `0-9`, hyphen), unique across the suite; duplicates fail at discovery |
| `description` | string | Optional human-readable summary |
| `task` | object | The fixture, setup, agent, and prompt that drive one trial |
| `budget` | object | Optional `{ "timeoutMs" }` override for this scenario |
| `checks` | array | At least one deterministic check |

| `task` field | Required | Meaning |
| --- | --- | --- |
| `fixture` | yes | Directory copied as the sandbox root for every trial |
| `setup` | no | argv run inside the sandbox before the baseline snapshot, with a fixed 300000 ms timeout |
| `agent` | no | Harness agent that drives the task; omitted uses the host default |
| `prompt` | yes | The prompt sent to the agent |

## Checks

File and diff checks apply fixed rules to sandbox state. Command checks run
the supplied program and inspect its exit status and optional output pattern.
Atlante does not use a model-judge, but a command check's behavior depends on
the program it invokes.

| Type | Fields | Asserts |
| --- | --- | --- |
| `command` | `run`, `expectExit` (default `0`), `outputMatches`, `timeoutMs` (default `120000`) | argv runs in the sandbox root, never through a shell; exit code and, optionally, a regular expression on combined stdout and stderr |
| `file-exists` | `path` | A non-symlink path exists; it may be a file or directory |
| `file-absent` | `path` | No non-symlink path exists |
| `file-unchanged` | `path` | The regular-file digest matches its pre-trial state; missing and non-file paths are represented as `null` |
| `file-contains` | `path`, `pattern`, `regex` (default `false`) | The file contains the pattern; literal text by default, regular expression when `regex` is `true` |
| `diff-allowlist` | `allow` | No changed paths fall outside the allowlist. The scan ignores the host-owned `.opencode/` directory |

`outputMatches` is compiled as a regular expression and matched against
combined stdout and stderr. It and `file-contains` patterns with `regex: true`
are checked during validation, so invalid expressions fail before any model
call. A check-level `timeoutMs` is capped at 3600000.

A command-check timeout produces a failed check with `timedOut: true`, not a
trial `timeout`. A command that cannot be started produces an `error` check and
therefore a trial `infra-error`. Every check still runs after an earlier check
fails or errors.

## Path containment

`task.fixture` is relative to the project root, not the scenario document.
Check paths and allowlist entries are relative to the sandbox root. Absolute
paths, path traversal, and `.git` or `node_modules` segments are rejected at
validation.

Fixtures cannot contain `.git`, `node_modules`, symlinks, or an OpenCode
configuration that would shadow host integration: `.opencode/opencode.jsonc`,
`.opencode/opencode.json`, or root `opencode.jsonc`. The host runner uses the
same configuration precedence as OpenCode and writes the generated host config
at the selected project-relative path in the sandbox. A fixture file that
collides with a verified native output fails the trial with a rename-or-remove
diagnostic. Other noncolliding `.opencode` files are copied, and a generated
root `opencode.json` replaces a fixture-provided file of that name.

<a id="containment"></a>

## Sandbox containment

Containment is tool-level policy, not OS-level isolation. Host permission
rules deny web and search tools and selected destructive shell commands.
The host's shell tool still has ordinary user access to the network and
machine.

The host trial and command checks receive an allowlisted environment.
Scenario setup commands run before the baseline snapshot and inherit the
full environment of the Atlante process. Review fixture content, setup
commands, and check commands before executing a scenario from another source.

## Reports and exit status

The default report path is `<project>/.atlante/eval/<run-id>/report.json`.
Atlante adds `eval/` to `<project>/.atlante/.gitignore` for this default. An
`--out <dir>` value is used as supplied, so a relative path resolves from the
CLI process working directory; custom output does not update that project
ignore file. `--keep` leaves trial sandboxes in the OS temporary directory
under an `atlante-eval-*` run directory. The report does not record those paths.

Each trial records one of these verdicts:

| Verdict | Meaning |
| --- | --- |
| `pass` | The host completed and every check passed |
| `fail` | The host completed and at least one check failed |
| `timeout` | The host session exceeded its timeout |
| `budget-exceeded` | Observed cumulative token usage exceeded `maxTokens` |
| `infra-error` | Trial setup, host execution, grading, or a check could not produce a normal verdict |
| `skipped-budget` | The trial did not start because `maxSessions` was exhausted |

Skipped trials have zero duration and no checks or diff. Scenario pass rate,
mean duration, and p95 duration exclude them; an all-skipped scenario has a
zero pass rate. Report diff evidence is capped at 20000 characters, and command
output evidence keeps the last 2000 characters.

See [CLI](/reference/cli#atlante-eval) for flags and progress output, and
[Diagnostics](/reference/diagnostics) for the error envelope.

| Exit status | Meaning |
| --- | --- |
| `0` | Every requested trial has verdict `pass` |
| `1` | At least one trial failed, timed out, exceeded its budget, hit a trial-level infrastructure error, or was skipped by the session cap |
| `2` | Validation failed: missing or broken configuration or `eval` section, invalid scenario documents, or missing or stale native outputs |
| `3` | A run-level infrastructure error occurred, including an unauthenticated host, an unexpected run failure, or report publication failure |
