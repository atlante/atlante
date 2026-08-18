# `@atlante/builder`

Project loading, validation, host-neutral preparation, and artifact publication for
[Atlante](https://github.com/atlante/atlante). Requires Node.js 22 or later.

The package loads a project configuration, resolves local and installed static
package resource facets, validates template inputs, renders agent and skill descriptors, and
publishes verified host-independent artifacts. The preparation pipeline is
deterministic and fail-closed: if validation, interpolation, composition, or
rendering fails, no partial descriptor set is returned.

```ts
import { prepareProject } from "@atlante/builder";

const prepared = prepareProject("/path/to/project");
```

`loadProject` exposes canonical project loading and `validateProject` performs
the same checks without rendering. `mergeValues` performs the non-mutating
global-plus-local value merge used by resource-backed preparation. `readArtifacts`
is the adapter-facing, fail-closed reader exported from
`@atlante/builder/artifacts`.

`buildProject` prepares the complete artifact set before writing a private sibling
tree and publishing it by directory rename. Readers can observe a complete old
tree, a complete new tree, or no usable tree during the swap, but never a partial
tree. Post-publication directory-sync and backup-cleanup failures are returned as
`warnings` while the complete new tree remains published; a failed pre-publication
swap restores the old tree when possible and preserves the backup path if restore
itself fails.

The published format is `atlante-artifacts` version 1 under
`.atlante/artifacts/`. It contains a manifest and Markdown payloads for agents
and skills. Each manifest payload entry records a relative path and lowercase
SHA-256 digest; the reader verifies the format, paths, UTF-8 payloads, and
digests before returning anything to an adapter. Artifact format/version is
separate from the document `$schema` version. Artifacts are host-neutral build
outputs, not source configuration, and may contain sensitive rendered values;
keep them local and do not publish them.

## Reading artifacts

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
  the complete canonical filename derived from the ID and payload digest,
  including the slug and both digest segments.
- No descriptors are returned until every manifest entry and payload has been
  verified. The adapter-visible result contains only `{ hostAgentId,
  description, prompt }` for agents and `{ skillId, description, content }` for
  skills.

Artifact verification provides local integrity checking, not a privilege or
trust boundary. Rendered values may contain secrets. Keep `.atlante/` ignored
and local; do not publish artifact payloads or treat their digests as proof that
the source or build environment is trusted.
