# `@atlante/opencode-plugin`

OpenCode host adapter for [Atlante](https://github.com/atlante/atlante). It
reads and verifies the host-neutral artifact tree built by Atlante, atomically
stages the resulting agent prompts and descriptions in the in-memory host
config, and exposes skills through the `atlante_skill` tool. Requires Node.js 22
or later.

## Published package

The plugin is published to npm as `@atlante/opencode-plugin`. It ships as a
self-contained Bun-bundled artifact (the `dist/` output of `bun run build` at
the repository root). `@opencode-ai/plugin` is a peer dependency: the host
OpenCode installation provides it.

The package exposes two entries:

- `@atlante/opencode-plugin` — the default export (`AtlantePlugin`) registered
  in `opencode.jsonc`
- `@atlante/opencode-plugin/api` — the explicit programmatic entry, exporting
  `injectAgents`, `createAtlantePlugin`, `AtlantePlugin`, `createSkillTool`,
  and the plugin's artifact and host-config types

Import from the `./api` entry with
`import { injectAgents } from "@atlante/opencode-plugin/api"`.

## Usage

Register the plugin in `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@atlante/opencode-plugin"],
}
```

Running `npx @atlante/cli init` creates this registration and builds artifacts
automatically while preserving existing OpenCode settings. Run
`npx @atlante/cli build` after changing the source configuration.

`atlante_skill` accepts exactly `{ "name": "skill-id" }` and looks up the
resolved root `skills` map by that name. A successful lookup returns the skill's
rendered Markdown content only; its description is not returned by the tool.
Invalid input, an unknown name, and an inactive, unavailable, or failed tool
return an error rather than partial content. Skill content is informational
Markdown: the adapter does not execute it.

During initialization, the plugin reads only `.atlante/artifacts/manifest.json`
and verifies every declared path, payload encoding, and SHA-256 digest before
materialization. It does not load `atlante.jsonc`, local resources, bundled
resources, or any resolver/loader. If artifacts are absent, malformed,
unsupported, or changed, the `atlante_skill` tool is omitted and the host config
is unchanged. After the staged result is materialized, the tool is active; a
failure after materialization, including a runtime failure, moves it to the
failed lifecycle state. Verification and injection are fail-closed: the host
config is updated only from a complete verified artifact set, so a failure
cannot partially mutate the host. The native `skill` tool can coexist with
`atlante_skill` without either replacing the other.
