# `@atlante/builder`

Project loading, validation, host-neutral preparation, and build orchestration for
[Atlante](https://github.com/atlante/atlante). Requires Node.js 22 or later.

The package loads a project configuration, resolves local and installed
static-package templates and instances, validates template inputs, renders agent
and skill descriptors, and keeps the prepared project in memory for the
selected host materializers. The preparation
pipeline is deterministic and fail-closed: if validation, interpolation,
composition, or rendering fails, no partial descriptor set is returned.

```ts
import { prepareProject } from "@atlante/builder";

const prepared = prepareProject("/path/to/project");
```

`loadProject` exposes canonical project loading and `validateProject` performs
the same checks without rendering. `mergeValues` performs the non-mutating
global-plus-local value merge used by resource-backed preparation.

`buildProject` prepares the complete descriptor set in memory and then runs
the injected `HostMaterializer` values selected by the document's `hosts`
field, collecting each outcome (`diagnostics`, `writtenPaths`,
`removedPaths`) into the result. The builder never imports a host package:
materializers are injected by the composition layer (the CLI passes the
OpenCode materializer). Rendered values can be sensitive; generated outputs
stay local and are not published.
