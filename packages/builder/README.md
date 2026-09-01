# `@atlante/builder`

Project loading, validation, host-neutral preparation, and build orchestration for
[Atlante](https://github.com/atlante/atlante). Requires Node.js 22 or later.

The package loads a project configuration, resolves local and installed
static-package templates and instances, validates template inputs, renders agent
and skill descriptors, and maps the prepared project onto the artifact contract
owned by [`@atlante/artifacts`](../artifacts/README.md). The preparation
pipeline is deterministic and fail-closed: if validation, interpolation,
composition, or rendering fails, no partial descriptor set is returned.

```ts
import { prepareProject } from "@atlante/builder";

const prepared = prepareProject("/path/to/project");
```

`loadProject` exposes canonical project loading and `validateProject` performs
the same checks without rendering. `mergeValues` performs the non-mutating
global-plus-local value merge used by resource-backed preparation.

`buildProject` prepares the complete artifact set before writing a private sibling
tree and publishing it by directory rename. Readers can observe a complete old
tree, a complete new tree, or no usable tree during the swap, but never a partial
tree. Post-publication directory-sync and backup-cleanup failures are returned as
`warnings` while the complete new tree remains published; a failed pre-publication
swap restores the old tree when possible and preserves the backup path if restore
itself fails.

The published format is `atlante-artifacts` version 1 under
`.atlante/artifacts/`. It contains a manifest and Markdown payloads for agents
and skills. `buildProject` delegates artifact creation, publication, and
verification to `@atlante/artifacts`; that package's
[README](../artifacts/README.md#reading-artifacts) documents the format, the
atomic publication contract, and the fail-closed reader that host adapters
consume. Artifact format/version is separate from the document `$schema`
version. Artifacts are host-neutral build outputs, not source configuration,
and may contain sensitive rendered values; keep them local and do not publish
them.
