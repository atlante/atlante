# OpenCode materializer

Internal OpenCode host materializer for
[Atlante](https://github.com/atlante/atlante). The CLI builds this workspace and
bundles the materializer into its published artifact. It writes host-native
agent and skill files directly into the project; it is not a runtime plugin or
an installation target. Requires Node.js 22 or later.

## Role in the build

The workspace provides a single entry for the CLI and private eval code. Its
exports are:

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
