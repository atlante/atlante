# `@atlante/opencode-plugin`

OpenCode host adapter for [Atlante](https://github.com/atlante/atlante). It
reads and verifies the host-neutral artifact tree built by Atlante, atomically
stages the resulting agent prompts and descriptions in the in-memory host
config, and exposes skills through the `atlante_skill` tool. Requires Node.js 22
or later.

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

During initialization, the plugin reads `.atlante/artifacts/manifest.json` and
verifies every declared path, payload encoding, and SHA-256 digest before
materialization. If artifacts are absent, malformed, unsupported, or changed,
the `atlante_skill` tool is omitted and the host config is unchanged. After the
staged result is materialized, the tool is active; a failure after
materialization, including a runtime failure, moves it to the failed lifecycle
state. Verification and injection are fail-closed: the host config is updated
only from a complete verified artifact set, so a failure cannot partially
mutate the host. The plugin never loads or renders source configuration. The
native `skill` tool can coexist with `atlante_skill` without either replacing
the other.
