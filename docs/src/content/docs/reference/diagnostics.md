---
title: Diagnostics
description: Read Atlante errors and warnings by severity, code, location, and recovery action.
---

Atlante diagnostics are structured for terminal output and stable automation.
Each diagnostic starts with a severity and stable code:

```text
error [missing-target]: resource target does not exist
at: resources/reviewer /agents/reviewer
expected: a directory containing a valid instance or template
next: create the target or update the locator
cause: path was not found
```

The lines have a fixed order:

1. Severity and stable code.
2. Failure statement.
3. `at:` source, location, and JSON Pointer when available.
4. `expected:` required contract, when available.
5. `next:` one recovery action, when available.
6. `cause:` normalized low-level cause, last when available.

Diagnostics use project-relative or stable package-qualified source identities. A
normal diagnostic does not expose a machine-specific absolute path.

## Common codes

| Code | Meaning |
| --- | --- |
| `config-not-found` | Neither supported configuration filename was found |
| `ambiguous-config` | Both `atlante.jsonc` and `atlante.json` were found |
| `missing-target` | A selected preset, template, or instance target is missing |
| `build-failed` | A build could not complete after the reported failure |

Validation and build diagnostics are written before the command's success line.
A diagnostic with severity `error` produces exit status `1`. Warnings can be
reported after a successful publication without changing the successful result.

## JSON Pointers

When an issue belongs to document data, `at:` may include an RFC 6901 JSON
Pointer such as `/agents/reviewer/mission`. Preserve the pointer exactly when
using it to locate the invalid field.

For resource failures, the output can include the selected source and a
resource-traversal chain. Fix the first actionable error, then run the same CLI
command again.
