---
title: Eval
description: The eval configuration, scenario documents, checks, budgets, and reports for testing a harness.
---

`atlante eval` runs a built harness through
[OpenCode](https://opencode.ai/) or
[Claude Code](https://code.claude.com/docs) in disposable sandboxes. Each trial starts
with a copy of the scenario fixture and the native agent and skill files,
then checks the resulting files and command results against explicit assertions.
Scenario suites can be authored by the project or shipped as opt-in metadata in
a resource pack. Pack-owned fixtures resolve from the pack root; project-local
fixtures resolve from the project root.

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
| Scenario documents | The files matched by the local `scenarios` glob and any explicitly included pack suites |
| Verified native outputs | A prior `atlante build`, for the selected `eval.host` |
| The selected host on `PATH` | The installed `opencode` or `claude` executable |
| Stored provider credentials | The host's stored authentication — see [Host versions](#host-versions); shell API-key variables alone are insufficient for OpenCode |
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
| `host` | `"opencode"` or `"claude-code"` | The host runner; v0.1 documents admit only `"opencode"`, v0.2 documents admit both |
| `scenarios` | string | Glob of scenario documents, relative to the project root |
| `include` | string[] | Package or selected package-preset locators whose pack suites are allowed to run |
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

The project must provide either `scenarios` or `include`. `include` is explicit
permission for suites exposed by packages or selected package presets already
reached through the project's resource graph. Installed packages that are not
selected are unavailable to `eval.include`; an include with no pack suite is a
validation error. The `--scenario` option filters the local and included suites
after discovery. It does not opt a pack suite in by itself.

## Host versions

Eval probes `opencode --version` once per run and supports OpenCode V1
(`>=1.18.29 <2.0.0`) and V2 (`>=2.0.0 <3.0.0`); any other version fails with a
diagnostic before any trial. The dialect decides the sandbox configuration's
field names (V1 `agent`, `permission`, `bash`, and `task`; V2 `agents`,
`permissions`, `shell`, and `subagent`), the containment-policy shape, and the
invocation: V2 runs with `--standalone` from the sandbox working directory.

Credentials come from the host's own stored authentication: `auth.json` for
V1, and for V2 the credential tables of its SQLite database alongside
`auth.json`. Only credentials and migration bookkeeping are copied; session
history never reaches the trial sandbox.

The trial's OpenCode configuration is authored fresh for every trial, so
`eval.model` plus the host's stored authentication is the supported provider
path. An isolated sandbox has no global OpenCode configuration, which also
means a V2 host has no default model to fall back to.

### Claude Code

Eval probes `claude --version` once per run and supports Claude Code
(`>=2.0.0 <3.0.0`); any other version fails with a diagnostic before any
trial. The runner verifies the project's Claude Code native outputs, then
authors a fresh `.claude/settings.json` sandbox configuration carrying only
the tool containment policy. It never merges project MCP servers, settings,
or hooks. A fixture that provides `.mcp.json`, `.claude/settings.json`, or
`.claude/settings.local.json` fails before the trial, because Claude Code
would load or merge those files alongside the generated configuration.

Credentials come from the host's own stored authentication: an
`ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` value, a
`CLAUDE_CODE_OAUTH_TOKEN` value generated with `claude setup-token`, a
cloud-provider credential mode, or a `claude auth login` session. Only the
credentials file is copied into the sandbox; session history and unrelated
user configuration never reach the trial. The runner pre-accepts workspace
trust for the ephemeral sandbox directory only, so the host honors the
generated allow policy; without it the host ignores the policy and the trial
cannot start.

Trials run headless as `claude -p --output-format stream-json --verbose
--setting-sources project` from the sandbox working directory, with the
optional `--agent` and `--model` selections. Usage, cost, and model identity
come from the structured event stream, and the per-trial token and timeout
budgets are enforced while the stream flows. Without stored credentials the
run fails with `eval-host-unauthenticated` before any trial.

### Pack suite compatibility

A pack suite without a declared `host` is host-neutral and runs under either
project host. A suite with a declared `host` runs only under the matching
project `host`: including an incompatible suite fails with
`eval-pack-host-incompatible` before execution, instead of running under the
other host or being skipped silently.

### Pack-owned suites

A pack can declare suite metadata in its root preset:

```jsonc title="packages/review-pack/atlante.jsonc"
{
  "eval": {
    "host": "opencode",
    "scenarios": "eval/scenarios/*.eval.json",
    "fixtures": "eval/fixtures",
    "report": "eval/report.json",
    "source": "packages/review-pack/eval"
  }
}
```

The `scenarios` and optional `fixtures`, `report`, and `source` paths are
relative to the pack root; `source` is relative to the pack's repository root
instead. `fixtures` describes the pack's fixture tree; each scenario's
`task.fixture` is also resolved from that pack root, not from the consuming
project. Check paths and diff allowlists still resolve from the assembled
sandbox root. The optional `host` value describes the suite's intended host;
the consuming project's `host`, model, and budget control the run. The
optional `source` records where the pack's eval sources live inside its
repository, so registries can deep-link them at the release tag (`v<version>`)
next to the published report.

Selecting or extending a pack does not run its suite. A consuming project opts
in with a package or selected preset locator:

```jsonc title="atlante.jsonc — include a pack suite"
{
  "eval": {
    "host": "opencode",
    "include": ["@acme/review-pack"]
  }
}
```

Pack metadata is not inherited into the project's effective configuration.
Resolution, validation, build, and pack synchronization read the metadata but
do not execute its setup commands, checks, or scenarios. Only an explicit
`atlante eval` run can delegate an included suite to the host. Treat third-party
pack fixtures, setup commands, and checks as executable input and review them
before inclusion.

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
| `diff-allowlist` | `allow` | No changed paths fall outside the allowlist. The scan ignores the host-owned output directory: `.opencode/` for OpenCode trials, `.claude/` for Claude Code trials |

`outputMatches` is compiled as a regular expression and matched against
combined stdout and stderr. It and `file-contains` patterns with `regex: true`
are checked during validation, so invalid expressions fail before any model
call. A check-level `timeoutMs` is capped at 3600000.

A command-check timeout produces a failed check with `timedOut: true`, not a
trial `timeout`. A command that cannot be started produces an `error` check and
therefore a trial `infra-error`. Every check still runs after an earlier check
fails or errors.

## Path containment

For a project-local scenario, `task.fixture` is relative to the project root,
not the scenario document. For a pack scenario, it is relative to the pack
root. Check paths and allowlist entries are relative to the sandbox root.
Absolute paths, path traversal, and `.git` or `node_modules` segments are
rejected at validation.

Fixtures cannot contain `.git`, `node_modules`, or symlinks. A fixture may
contain an OpenCode config only at the exact project-relative path that the
host runner will overwrite; every other supported config path is rejected
because OpenCode would merge it as an additional layer. For example, a
fixture root `opencode.json` is rejected when the selected project config is
`.opencode/opencode.jsonc`. The runner authors a fresh dialect-native
configuration at that selected path in the sandbox and reads nothing from the
project's OpenCode settings, so project providers, servers, and permissions
cannot reach the trial. Project MCP servers are omitted from the eval
configuration so a disposable fixture cannot launch commands from the project
or developer environment. A fixture file that collides with a verified native
output fails the trial with a rename-or-remove diagnostic. Other noncolliding
`.opencode` files are copied.

For Claude Code trials, a fixture must not provide `.mcp.json`,
`.claude/settings.json`, or `.claude/settings.local.json`: Claude Code would
load or merge those files alongside the generated sandbox configuration, so
the runner rejects them before the trial. Other noncolliding `.claude` files
are copied.

<a id="containment"></a>

## Sandbox containment

Containment is tool-level policy, not OS-level isolation. Host permission
rules deny web and search tools and selected destructive shell commands.
The host's shell tool still has ordinary user access to the network and
machine. The policy is identical for every compared variant: OpenCode trials
carry it in the fresh dialect-native configuration, Claude Code trials in
the fresh `.claude/settings.json` sandbox configuration.

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

A pack may publish the report from a completed run at the path declared by its
root preset's `eval.report`. Pack indexes can ingest only a small, validated
provenance view: the report run date, Atlante version, host, model, model
version, and each scenario's pass rate. A missing, malformed, unsafe, or
inconsistent report is ignored rather than displayed. Any displayed result is
labeled **self-reported evaluation**. It describes the pack author's report;
it is not an Atlante certification, an independent reproduction, or a security
verdict. Report text and paths are untrusted input at the consuming boundary.

Setup and command checks retain the tool-level execution boundary described in
[Sandbox containment](#sandbox-containment). The checks are deterministic once
their commands run, but the commands themselves can access whatever the host
tool policy permits.

See [CLI](/reference/cli#atlante-eval) for flags and progress output, and
[Diagnostics](/reference/diagnostics) for the error envelope.

| Exit status | Meaning |
| --- | --- |
| `0` | Every requested trial has verdict `pass` |
| `1` | At least one trial failed, timed out, exceeded its budget, hit a trial-level infrastructure error, or was skipped by the session cap |
| `2` | Validation failed: missing or broken configuration or `eval` section, invalid scenario documents or pack selection, or missing or stale native outputs |
| `3` | A run-level infrastructure error occurred, including an unauthenticated host, an unexpected run failure, or report publication failure |
