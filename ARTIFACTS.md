# Atlante Artifacts

Atlante artifact format v1 is the host-independent build output consumed by
adapters. Its `format` and `version` are independent of the source document's
`$schema` version. A successful build publishes this tree under the project
root:

```text
.atlante/
  artifacts/
    manifest.json
    agents/
      <id-sha256>-<content-sha256>.md
    skills/
      <id-sha256>-<content-sha256>.md
```

## Manifest

`manifest.json` is UTF-8 JSON with exactly this shape:

```json
{
  "format": "atlante-artifacts",
  "version": 1,
  "agents": [
    {
      "id": "reviewer",
      "description": "Resolved description",
      "path": "agents/<id-sha256>-<content-sha256>.md",
      "sha256": "<64 lowercase hex characters>"
    }
  ],
  "skills": [
    {
      "id": "workflow",
      "description": "Resolved description",
      "path": "skills/<id-sha256>-<content-sha256>.md",
      "sha256": "<64 lowercase hex characters>"
    }
  ]
}
```

The manifest contains only adapter metadata: the logical ID, resolved
description, relative payload path, and payload digest. Template IDs and source
configuration are build-time concerns and are not included.

The builder stages a complete replacement privately and publishes it by
directory rename, so adapters observe a complete old tree, a complete new tree,
or no usable tree, never a partial tree.

IDs are opaque non-empty strings. The first filename component is the lowercase
SHA-256 digest of the ID's UTF-8 bytes, so whitespace, Unicode, slashes,
traversal-looking strings, and long IDs produce safe deterministic names. The
second component and the manifest `sha256` are the lowercase SHA-256 digest of
the exact UTF-8 Markdown payload bytes.

## Verification

Adapters must import `readArtifacts` and the verified types from
`@atlante/builder/artifacts`. The reader is fail-closed. The subpath exposes
no artifact creation, digest, or publication helpers.

- An absent `.atlante/artifacts/` directory returns `undefined`, meaning the
  project has not been built.
- An existing tree with malformed JSON, unknown fields, an unsupported format or
  version, duplicate IDs or paths, invalid hashes, unsafe paths, symlinks,
  non-regular files, invalid UTF-8, missing payloads, or digest mismatches throws
  `ArtifactReadError`.
- Manifest and payload paths are checked component-by-component, opened with
  the available no-follow and non-blocking flags, and rechecked after opening
  by comparing descriptor and path identities. This rejects concurrent
  regular-file replacement, ancestor symlink swaps, and FIFOs without
  blocking. Node and Bun do not expose descriptor-relative `openat` traversal
  here, so the checks are not an atomic race-free trust boundary.
- Paths must be relative POSIX paths in their declared namespace and must match
  the deterministic filename derived from the ID and digest.
- No descriptors are returned until every manifest entry and payload has been
  verified. The adapter-visible result contains only `{ hostAgentId,
  description, prompt }` for agents and `{ skillId, description, content }` for
  skills.

Artifact verification provides local integrity checking, not a privilege or
trust boundary. Rendered values may contain secrets. Keep `.atlante/` ignored
and local; do not publish artifact payloads or treat their digests as proof that
the source or build environment is trusted.
