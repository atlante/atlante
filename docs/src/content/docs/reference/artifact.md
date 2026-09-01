---
title: Artifact
description: Manifest, payload naming, publication, and verification rules for generated artifacts.
---

A build publishes a complete artifact tree under
`<project>/.atlante/artifacts/`. The tree is host-neutral output for an adapter,
not another source configuration format.

## Manifest

`manifest.json` is UTF-8 JSON with only `format`, `version`, `agents`, and
`skills`:

```json
{
  "format": "atlante-artifacts",
  "version": 1,
  "agents": [
    {
      "id": "reviewer",
      "description": "Built description",
      "path": "agents/reviewer-<id-sha256>-<content-sha256>.md",
      "sha256": "<64 lowercase hex characters>"
    }
  ],
  "skills": []
}
```

Each entry must have a non-empty ID, description, relative POSIX path, and
lowercase SHA-256 digest of the exact UTF-8 payload. Agent payloads live under
`agents/`; skill payloads live under `skills/`.

## Payload names

A payload filename contains an ASCII slug, the ID digest, and the content digest.
Slug generation folds only ASCII uppercase letters, replaces non-ASCII-
alphanumeric runs with hyphens, trims hyphens, and uses `artifact` when the slug
would be empty.

IDs, paths, entries, and payloads must be unique. The artifact `format` and
numeric `version` are independent of the `atlante.jsonc` schema URI.

## Publication

The builder prepares a complete private tree and replaces the live tree with an
atomic directory rename. An adapter therefore observes a complete previous tree,
a complete new tree, or no usable tree, never a partial tree.

## Verification

The adapter-facing `readArtifacts` reader is provided by the private
`@atlante/artifacts` workspace. It returns no descriptors until every manifest
entry and payload passes its checks; users of the published CLI do not install
that private workspace separately.

The reader rejects:

- Unknown manifest fields or unsupported artifact format and version.
- Absolute, traversal, backslash, or otherwise unsafe paths.
- Duplicate IDs or paths.
- Missing payloads or digest mismatches.
- Invalid UTF-8, symlinks, and non-regular files.

The [OpenCode](https://opencode.ai/) adapter uses this reader before
materialization. Keep rendered payloads local because they may contain sensitive
values.
