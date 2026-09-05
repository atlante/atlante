---
title: Materialization
description: Native output paths, ownership manifest, publication rules, and failure codes for generated outputs.
---

A build materializes a validated, fully rendered prepared project as
host-native files. The prepared project is kept in memory; the materializer
publishes the files the host discovers. The output is not another source
configuration format. The authored configuration remains the source: edit it
and rebuild when the harness changes.

## Host selection

The document's `hosts` field selects the materialization targets. Version 0.1
admits only `"opencode"`, and `["opencode"]` is the canonical default. Each
declared host must have a registered materializer; an unknown host fails the
build with `unsupported-host`.

## Native output paths

For the OpenCode host the build materializes exactly:

| Output | Path |
| --- | --- |
| Agent | `.opencode/agents/<id>.md` |
| Skill | `.opencode/skills/<id>/SKILL.md` |
| Ownership manifest | `.atlante/opencode-native.json` |

IDs come from the document: lowercase kebab-case ASCII (`a-z`, `0-9`, hyphen
separators), at most 64 characters. Atlante never renames an ID; a violating
ID fails the build with `materialization-invalid-id`.

An agent file is a YAML frontmatter `description` followed by the rendered
prompt. A skill file is a YAML frontmatter `name` and `description` followed
by the rendered skill content.

## Ownership manifest

`.atlante/opencode-native.json` is UTF-8 JSON with exactly `format`,
`version`, and `files`:

```json
{
  "format": "atlante-opencode-native",
  "version": 1,
  "files": [
    {
      "kind": "agent",
      "id": "reviewer",
      "path": ".opencode/agents/reviewer.md",
      "sha256": "<64 lowercase hex characters>"
    }
  ]
}
```

Each `files` entry has exactly `kind` (`agent` or `skill`), `id`, `path`, and
`sha256`. The `path` is the native path implied by the kind and ID, and
`sha256` is the lowercase SHA-256 digest of the file's exact UTF-8 bytes.
Entries are unique by ID and by path. The manifest records metadata only; it
never contains prompt or skill payload content. The materializer writes it
last, and only when its bytes would change.

## Host discovery

OpenCode discovers native agents and skills from the paths above when it starts.
Host-owned settings in `opencode.jsonc` or `opencode.json`, such as model, mode,
permissions, and tools, remain under OpenCode's control. Restart OpenCode to
pick up new or changed native files. Atlante renders the files but does not
execute the resulting agents or skills.

## Publication contract

Planning completes before anything is written. For every target and every
previously generated file, the materializer captures a byte snapshot, then:

- **Collision** — an existing file at a target path that the manifest does not
  own is never overwritten. The build fails with `materialization-collision`.
- **Drift** — an owned file whose bytes no longer match its recorded digest is
  never replaced or removed. The build fails with `materialization-drift`.
- **Stale cleanup** — a generated file the source no longer declares is
  removed only when its bytes still match the manifest digest.
- **Unsafe paths** — a symlinked project root, parent directory, or target
  fails with `materialization-unsafe-path`.
- **Staged writes** — bytes are staged, flushed, and published per file by
  atomic rename, with the manifest written last. Each file is replaced
  atomically; Atlante does not claim whole-tree atomicity across host
  directories. A failure mid-publication rolls back to the previous valid
  generated set and reports `materialization-publication-failed`.
- **Idempotence** — an unchanged prepared project writes nothing: identical
  bytes are not rewritten.

## Failure diagnostics

Materialization failures carry a `materialization-` prefix:

| Code | Meaning |
| --- | --- |
| `materialization-invalid-id` | An agent or skill ID violates the native ID grammar |
| `materialization-collision` | An unowned file occupies a target path |
| `materialization-drift` | A generated file no longer matches its recorded digest |
| `materialization-invalid-manifest` | The ownership manifest is malformed or unsupported |
| `materialization-unsafe-path` | A symlink or non-directory blocks a materialization path |
| `materialization-filesystem` | A filesystem operation failed |
| `materialization-publication-failed` | Publication failed; the previous generated set was restored |

Each diagnostic names the affected path and one deterministic recovery action.
Keep rendered outputs local: values may contain sensitive content. `atlante init`
adds `.opencode/agents/`, `.opencode/skills/`, and `.atlante/` to `.gitignore`.
