---
title: Diagnostics
description: Parse Atlante errors and warnings by severity, code, location, and recovery action.
---

Diagnostics are the stable error contract emitted by validation, build, watch,
and materialization commands. Use this page when a person or a CI tool needs to
parse command output; use [Troubleshooting](/troubleshooting) when you need a
recovery path.

Each diagnostic has a severity, stable code, and message. It may also carry a
stable source identity, a JSON Pointer, a one-based source location, a resource
reference chain, an expected contract, a recovery action, and a normalized cause:

```text
error [invalid-resolved-input]: binding input is invalid
at: atlante.jsonc:12:7 /agents/reviewer/mission
expected: a string accepted by the selected template
next: update the field or select a compatible template
```

The terminal lines have a fixed order:

1. Severity and stable code.
2. Failure statement.
3. `at:` source, location, and JSON Pointer when available.
4. `expected:` required contract, when available.
5. `next:` one recovery action, when available.
6. `cause:` normalized low-level cause, last when available.

Diagnostics use project-relative or stable package-qualified source identities.
They do not expose machine-specific absolute paths. CLI success lines separately
report resolved filesystem paths for the configuration and materialized outputs.

## Diagnostic fields

| Field | Meaning |
| --- | --- |
| `severity` | `error` or `warning` |
| `code` | Stable machine-readable diagnostic code |
| `message` | Human-readable failure statement |
| `source` | Project-relative or stable package-qualified source identity |
| `path` / `pointer` | JSON Pointer into document data, when applicable |
| `location` | One-based `{ line, column }`, when available |
| `chain` | Preset, instance, or template traversal that caused a resource failure |
| `expected` | Contract the authored input must satisfy |
| `next` | Deterministic recovery action |
| `cause` | Normalized low-level cause |

## Common codes

This table lists common codes and is not exhaustive. Validation, resource, watch,
and publication failures can produce additional stable codes.

| Code | Meaning |
| --- | --- |
| `config-not-found` | Neither supported configuration filename was found |
| `ambiguous-config` | Both `atlante.jsonc` and `atlante.json` were found |
| `missing-target` | A selected preset, template, or instance target is missing |
| `package-not-declared` | A package locator is not declared by the authoring project |
| `package-not-installed` | A declared package cannot be found in the installation |
| `malformed-jsonc` | A selected JSONC source is malformed |
| `invalid-resolved-input` | Resolved document or template-owned input is invalid |
| `conflicting-selectors` | A source uses `$template` and `$instance` together |
| `build-failed` | A build could not complete after the reported failure |
| `unsupported-host` | The document declares a host with no registered materializer |
| `materialization-*` | An OpenCode materialization failure; see [Materialization](/reference/materialization) for the code list |
| `watch-build-failed` | A watch-mode rebuild failed and will be retried |
| `watch-inputs-failed` | Watch mode could not update its watched files and will retry |

Validation and build diagnostics are written before the command's success line.
An `error` diagnostic produces exit status `1` for a one-shot command. Warnings
can follow successful publication without changing the result. Watch-mode errors
keep the process active and are retried after changes.

## JSON Pointers and locations

When an issue belongs to document data, `at:` may include an RFC 6901 JSON
Pointer such as `/agents/reviewer/mission`. Use the pointer to locate the
invalid field. A location, when present, uses one-based line and column numbers.

For resource failures, the structured diagnostic can include the selected source
and a resource-traversal chain. See [Troubleshooting](/troubleshooting) for
recovery paths. See [Eval](/reference/eval) for scenario validation and exit
statuses.
