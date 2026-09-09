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
| `timeoutMs` | 600000 | Wall-clock limit per trial; at most 3600000 |
| `maxSessions` | 15 | Host sessions per run; the run stops when exhausted |
| `maxTokens` | 400000 | Token spend per trial, enforced from host usage events |

`maxTokens` is enforced separately for each trial; it is not an aggregate run
cap. A run can therefore consume up to that amount for each executed trial. A
trial whose host emits no usage events is reported with `budgetUnmonitored: true`:
`maxTokens` cannot be enforced for it and only the trial timeout bounds its
spend.

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
| `setup` | no | argv run inside the sandbox before the baseline snapshot |
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
| `file-exists` | `path` | The file exists |
| `file-absent` | `path` | The file does not exist |
| `file-unchanged` | `path` | The file matches its baseline snapshot |
| `file-contains` | `path`, `pattern`, `regex` (default `false`) | The file contains the pattern; literal text by default, regular expression when `regex` is `true` |
| `diff-allowlist` | `allow` | No changed paths fall outside the allowlist. The scan ignores the host-owned `.opencode/` directory |

`outputMatches` is compiled as a regular expression and matched against
combined stdout and stderr. It and `file-contains` patterns with `regex: true`
are checked during validation, so invalid expressions fail before any model
call. A check-level `timeoutMs` is capped at 3600000.

## Path containment

`task.fixture` is relative to the project root, not the scenario document.
Check paths and allowlist entries are relative to the sandbox root. Absolute
paths, path traversal, and `.git` or `node_modules` segments are rejected at
validation.

Fixtures must not ship host-owned files. A fixture `.opencode` file that
collides with a native output fails the trial with a rename-or-remove
diagnostic, and a fixture `opencode.jsonc` is rejected because the host would
prefer it over the generated `opencode.json`, which always wins over a
fixture-provided one.

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
`--out <dir>` relocates it and `--keep` preserves the
trial sandboxes; see [CLI](/reference/cli#atlante-eval) for flags and progress
output, and [Diagnostics](/reference/diagnostics) for the error envelope.

| Exit status | Meaning |
| --- | --- |
| `0` | Every executed trial passed |
| `1` | At least one trial failed, timed out, exceeded its budget, hit a trial-level infrastructure error, or was skipped by the session cap |
| `2` | Validation failed: missing or broken configuration or `eval` section, invalid scenario documents, or missing or stale native outputs |
| `3` | An infrastructure error prevented the run from executing at all, including an unauthenticated host |
