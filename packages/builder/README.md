# `@atlante/builder`

Project loading, validation, host-neutral preparation, and artifact publication for
[Atlante](https://github.com/atlante/atlante). Requires Node.js 22 or later.

The package loads a project configuration, expands bundled presets, validates
template inputs, renders agent and skill descriptors, and publishes verified
host-independent artifacts. The preparation pipeline is deterministic and
fail-closed: if validation, interpolation, composition, or rendering fails, no
partial descriptor set is returned.

```ts
import { prepareProject } from "@atlante/builder";

const prepared = prepareProject("/path/to/project");
```

`loadProject` exposes canonical project loading and `validateProject` performs
the same checks without rendering. `mergeValues` performs the non-mutating
global-plus-local value merge used by preparation. `readArtifacts` is the
adapter-facing, fail-closed reader exported from `@atlante/builder/artifacts`.

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
