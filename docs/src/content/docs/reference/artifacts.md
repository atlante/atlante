---
title: Artifact format
description: Manifest, payload naming, and verification rules for generated artifacts.
---

A build publishes an artifact tree under `.atlante/artifacts/`. The tree is a
host-neutral output for an adapter, not another source configuration format.

## Manifest

The manifest is UTF-8 JSON with only `format`, `version`, `agents`, and `skills`:

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

Each entry has a non-empty ID, description, relative POSIX path, and lowercase
SHA-256 digest of the exact UTF-8 payload. Agent payloads live under `agents/`;
skill payloads live under `skills/`.

## Payload names

A payload filename contains:

- An ASCII slug derived from the ID.
- The ID digest.
- The content digest.

IDs, paths, entries, and payloads must be unique. The artifact format and numeric
version are independent of the `atlante.jsonc` schema URI.

## Verification

`@atlante/builder/artifacts` exports the adapter-facing `readArtifacts` reader.
It returns no descriptors until every manifest entry and payload passes checks.
The reader rejects:

- Unknown manifest fields or unsupported format and version.
- Absolute, traversal, backslash, or unsafe paths.
- Duplicate IDs or paths.
- Missing payloads or digest mismatches.
- Invalid UTF-8, symlinks, and non-regular files.

The OpenCode adapter uses this reader before materialization. Keep rendered
payloads local because they may contain sensitive values.
