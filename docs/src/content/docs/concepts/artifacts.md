---
title: Artifacts
description: Generated, host-neutral output published from a validated build.
---

What does the host actually consume after a successful build? It consumes
artifacts, not your authored configuration. Artifacts are generated,
host-neutral Markdown and metadata published under
`<project>/.atlante/artifacts/`:

```text
.atlante/artifacts/
├── manifest.json
├── agents/
│   └── <id>-<id-digest>-<content-digest>.md
└── skills/
    └── <id>-<id-digest>-<content-digest>.md
```

The flow is `atlante.jsonc` or `atlante.json` -> validation and resolution ->
build -> this complete artifact tree. The source remains the place to make
changes; the artifact tree is the verified handoff to an adapter.

## Manifest and payloads

`manifest.json` is UTF-8 JSON with only `format`, `version`, `agents`, and
`skills`. Each entry identifies a binding, its built description, the relative
POSIX payload path, and a lowercase SHA-256 digest of the exact UTF-8 Markdown
payload. Payload names contain an ASCII ID slug, an ID digest, and a content
digest. The [Artifact](/reference/artifact) reference contains the complete
field and verification contract rather than duplicating it here.

Artifacts are derived from validated source. Keep `.atlante/` local when
rendered values can contain project-sensitive content; a payload digest verifies
the payload in the tree, not the trustworthiness of its source or build
environment.

## Atomic publication

The builder prepares every payload and the manifest in a private staging tree,
flushes the files, and replaces the live artifact directory with a directory
rename. A reader sees the previous complete tree, the new complete tree, or no
usable tree, never a partial set. If validation or preparation fails, the
existing tree is not replaced.

## Adapter boundary

The adapter-facing `readArtifacts` reader verifies the complete manifest and
every payload before returning descriptors. It rejects unknown manifest fields,
unsupported formats or versions, absolute/traversal/backslash or otherwise
unsafe paths, duplicate IDs or paths, missing payloads, digest mismatches,
invalid UTF-8, symlinks, and non-regular files. The reader is the boundary
between the private `@atlante/artifacts` workspace and host adapters; users do
not install that private implementation package.

In v0.1, the [OpenCode](https://opencode.ai/) adapter consumes only this
verified tree and materializes Atlante-owned descriptions and prompts. It
preserves host-owned model, effort, permission, tool, and mode settings, and
warns when replacing a non-empty host prompt. If discovery, verification, or
materialization fails, it leaves host configuration unchanged. Atlante does not
execute the resulting agents or skills. See [Use OpenCode](/guides/opencode) for
that integration.
