---
title: Diagnostics
description: Diagnostic fields, terminal format, common codes, and source locations for Atlante errors and warnings.
---

Diagnostics describe errors and warnings from initialization, validation,
builds, evaluation, and materialization. This reference defines their fields
and terminal format. [Troubleshooting](/troubleshooting) organizes recovery
procedures by symptom.

Each diagnostic has a severity, stable code, and message. It may also carry a
source reference, a JSON Pointer, a one-based source location, a resource
reference chain, an expected contract, a recovery action, and a normalized cause:

```text
error [invalid-resolved-input]: binding input is invalid
at: atlante.jsonc:12:7 /agents/reviewer/mission
expected: a string accepted by the selected template
next: update the field or select a compatible template
```

The terminal formatter emits these lines in order, omitting optional fields
when they are unavailable:

1. Severity, stable code, and failure statement on one line.
2. `at:` source, location, and JSON Pointer.
3. `expected:` required contract.
4. `next:` recovery action.
5. `cause:` normalized low-level cause.

CLI diagnostics are written to stderr. Color can be disabled with
`NO_COLOR=1`; see [CLI output](/reference/cli#output).

Diagnostic sources may be project-relative paths, package-qualified resource
identities, or absolute filesystem paths. Materialization diagnostics can
include absolute paths in both `source` and the message. See
[CLI path behavior](/reference/cli#path-behavior) for paths in success messages.

## Diagnostic fields

| Field | Meaning |
| --- | --- |
| `severity` | `error` or `warning` |
| `code` | Stable machine-readable diagnostic code |
| `message` | Human-readable failure statement |
| `source` | Source identity or filesystem path, which may be absolute |
| `path` | Primary JSON Pointer into document data, when applicable |
| `pointer` | Explicit JSON Pointer alias used by source and resource diagnostics |
| `location` | One-based `{ line, column }`, when available |
| `chain` | Preset, instance, or template traversal that caused a resource failure |
| `expected` | Expected contract or runtime condition |
| `next` | Deterministic recovery action |
| `cause` | Normalized low-level cause |

Only `severity`, `code`, and `message` are required. The resource traversal
`chain` is structured metadata; the terminal formatter does not print it as
a separate line. When both `path` and `pointer` are present, the formatter uses
`path`.

## Common codes

This table lists common codes and is not exhaustive. Validation, resource, watch,
and publication failures can produce additional stable codes.

| Code | Meaning |
| --- | --- |
| `config-not-found` | Neither supported configuration filename was found |
| `ambiguous-config` | Both `atlante.jsonc` and `atlante.json` were found |
| `missing-target` | A selected preset, template, or instance target is missing |
| `package-not-declared` | A package locator lacks an admitted declaration: project references use `dependencies`, `optionalDependencies`, or `devDependencies`; pack-to-pack references use runtime dependencies |
| `package-not-installed` | A declared package cannot be found in the installation |
| `invalid-json` | A configuration or scenario document is malformed JSON or JSONC |
| `malformed-jsonc` | A selected resource JSONC file is malformed |
| `invalid-resolved-input` | Resolved document or template-owned input is invalid |
| `conflicting-selectors` | A source uses `$template` and `$instance` together |
| `build-failed` | The CLI caught an unexpected exception from the build operation; ordinary failures retain their specific code |
| `unsupported-host` | The document declares a host with no registered materializer |
| `materialization-*` | An OpenCode materialization failure; see [Materialization](/reference/materialization) for the code list |
| `watch-build-failed` | The watch wrapper's build function threw unexpectedly; ordinary failed rebuilds retain their underlying code |
| `watch-inputs-failed` | Watch mode caught an exception while resolving or reconciling watched inputs |

Validation and build warnings appear before a success line. Errors produce
exit status `1` for one-shot validation and build commands, without a success
line. Watch-mode errors keep the process active and are retried after changes.
Evaluation uses [separate exit statuses](/reference/eval#reports-and-exit-status)
for failed trials, validation failures, and infrastructure failures.

## JSON Pointers and locations

When an issue belongs to document data, `at:` may include an RFC 6901 JSON
Pointer such as `/agents/reviewer/mission`. Use the pointer to locate the
invalid field. A location, when present, uses one-based line and column numbers.

For resource failures, the structured diagnostic can include the selected
source and a resource-traversal chain. Each chain entry identifies a preset,
instance, or template by its `kind`, `locator`, and `source`.

## Next steps

- [CLI](/reference/cli) documents the commands that emit diagnostics.
- [Materialization](/reference/materialization) lists output-specific failure
  codes.
- [Troubleshooting](/troubleshooting) organizes recovery paths by symptom.
- [Eval](/reference/eval) documents scenario validation and exit statuses.
