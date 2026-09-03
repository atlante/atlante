# `@atlante/opencode`

OpenCode host adapter for [Atlante](https://github.com/atlante/atlante). It
ships the build-time native materializer that `atlante build` runs to write
host-native agent and skill files directly into the project — no runtime
plugin, no persisted payload tree. Requires Node.js 22 or later.

## Published package

The adapter package is published to npm as `@atlante/opencode`. It ships as a
self-contained Bun-bundled artifact (the `dist/` output of `bun run build` at
the repository root) with a single entry, `@atlante/opencode`, exporting:

- `materializeOpenCode(projectRoot, prepared)` — deterministic native
  materialization of a prepared project
- `readOpenCodeNative(projectRoot)` — verifies and reads the manifest-backed
  native outputs for local consumers such as eval
- `openCodeMaterializer` — the builder-facing adapter
  (`{ host, materialize(projectRoot, prepared) }`) the CLI passes to
  `buildProject`; failures map to `MaterializationDiagnostic` values
- `OpenCodeMaterializationError` and its `OpenCodeMaterializationErrorCode`
  (`invalid-input`, `invalid-id`, `invalid-manifest`, `unsafe-path`,
  `collision`, `drift`, `filesystem`, `publication-failed`)
- the ownership-manifest types (`OpenCodeOwnershipManifest`,
  `OpenCodeOwnedFile`), verified-native-output types (`OpenCodeNativeProject`,
  `OpenCodeNativeFile`), prepared-project types (`OpenCodePreparedProject`,
  `OpenCodePreparedAgent`, `OpenCodePreparedSkill`), and adapter types
  (`OPENCODE_HOST_TARGET`, `MaterializationDiagnostic`,
  `OpenCodeMaterializerPrepared`, `HostMaterializationOutcome`)

## What a build materializes

`atlante build` renders the source configuration into a prepared project and
the materializer writes, deterministically:

- `.opencode/agents/<id>.md` — frontmatter description plus the agent prompt
- `.opencode/skills/<id>/SKILL.md` — frontmatter name/description plus the
  skill content
- `.atlante/opencode-native.json` — the ownership manifest: `format`,
  `version`, and one `files` entry (`kind`, `id`, `path`, `sha256`) per
  generated file

The manifest is bookkeeping state, not a trust boundary: it never stores
prompt or skill payloads, only identity and digests. Generated outputs and the
manifest are ignored by git by default (`atlante init` enforces
`.opencode/agents/`, `.opencode/skills/`, and `.atlante/` in `.gitignore`)
because rendered content can carry sensitive interpolated values.

## Safety invariants

Materialization is fail-closed and staged:

- **Collisions** — an unowned file at a target path is never overwritten; the
  build fails with a repair action instead.
- **Drift** — an owned file whose recorded hash no longer matches is never
  replaced; repair is intentional (restore or delete the drifted file).
- **Stale outputs** — owned files no longer produced by the configuration are
  removed only when the manifest still accounts for them.
- **Rollback** — publication stages first and rolls back on failure,
  preserving the previous valid generated set.
- **ID rules** — IDs must be lowercase kebab-case ASCII, at most 64
  characters; invalid IDs fail the build rather than being renamed.

Rebuilds are idempotent: unchanged content is not rewritten.

## Migration from the runtime plugin

Older versions exposed a runtime OpenCode plugin registered as
`"plugin": ["@atlante/opencode"]` in `opencode.jsonc`/`opencode.json`. The
plugin no longer exists: a stale registration is inert (the host silently
drops packages that expose no plugin target), and `atlante init` removes the
Atlante-written entry from the configuration. The harmless `"plugin": []`
residue it may leave behind requires no action.
