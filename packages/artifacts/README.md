# `@atlante/artifacts`

The artifact-tree contract for [Atlante](https://github.com/atlante/atlante):
deterministic naming and hashing, manifest and payload serialization, atomic
publication primitives, and fail-closed verification. Requires Node.js 22 or
later.

The package is private and host-neutral. It owns the complete
`atlante-artifacts` version 1 format under `.atlante/artifacts/`: a manifest
plus Markdown payloads for agents and skills, where each manifest entry records
a relative path and lowercase SHA-256 digest. It may use Node standard-library
filesystem and cryptographic APIs and does not depend on any other Atlante
workspace.

## Entries

- `@atlante/artifacts` exposes the complete contract: `createArtifacts`,
  `publishArtifacts`, `readArtifacts`, and the format, manifest, payload, and
  verified-descriptor types. Build orchestration consumes this entry.
- `@atlante/artifacts/read-only` exposes the adapter-facing reader only:
  `readArtifacts`, `ArtifactReadError`, and the verified types
  (`VerifiedArtifacts`, `VerifiedAgentArtifact`, `VerifiedSkillArtifact`). It
  exposes no artifact creation, digest, or publication helpers. Host adapters
  consume this entry.

## Creating and publishing

`createArtifacts` builds the complete deterministic v1 representation in
memory: payload bytes are returned separately so publication can write them
before its manifest without reconstructing rendered content. `publishArtifacts`
writes a private sibling tree, flushes every file, and replaces the live tree by
directory rename. Readers observe a complete old tree, a complete new tree, or
no usable tree during the swap, but never a partial tree. Post-publication
directory-sync and backup-cleanup failures are returned as `warnings` while the
complete new tree remains published; a failed pre-publication swap restores the
old tree when possible and preserves the backup path if restore itself fails.

Artifact creation is fail-closed at the source boundary: non-string or empty
IDs and descriptions, duplicate agent or skill IDs, and non-lowercase-hex
digests throw before any publication happens.

## Reading artifacts

`readArtifacts` is the adapter-facing, fail-closed reader. The reader verifies
the format, paths, UTF-8 payloads, and digests before returning anything to an
adapter.

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
  the complete canonical filename derived from the ID and payload digest,
  including the slug and both digest segments.
- No descriptors are returned until every manifest entry and payload has been
  verified. The adapter-visible result contains only `{ hostAgentId,
  description, prompt }` for agents and `{ skillId, description, content }` for
  skills.

Artifact verification provides local integrity checking, not a privilege or
trust boundary. Rendered values may contain secrets. Keep `.atlante/` ignored
and local; do not publish artifact payloads or treat their digests as proof that
the source or build environment is trusted. Artifact format/version is separate
from the document `$schema` version.
