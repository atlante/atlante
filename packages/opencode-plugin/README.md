# `@atlante/opencode-plugin`

OpenCode host adapter for [Atlante](https://github.com/atlante/atlante). It
resolves an Atlante document once during OpenCode initialization, atomically
stages the resulting agent prompts in the in-memory host config, and exposes
project-global skills through the `atlante_skill` tool. Requires Node.js 22 or
later.

Register the plugin in `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@atlante/opencode-plugin"],
}
```

Running `npx @atlante/cli init` creates this registration automatically while
preserving existing OpenCode settings.

`atlante_skill` accepts exactly `{ "name": "skill-id" }` and looks up the
resolved root `skills` map by that name. A successful lookup returns the skill's
rendered Markdown content only; its description is not returned by the tool.
Invalid input, an unknown name, and an inactive, unavailable, or failed tool
return an error rather than partial content. Skill content is informational
Markdown: the adapter does not execute it.

During initialization, the plugin expands the raw overlay and performs the
complete validation and resolution preparation before materialization. If that
preparation fails, the `atlante_skill` tool is omitted and the host config is
unchanged. After the staged result is materialized, the tool is active; a
failure after materialization, including a runtime failure, moves it to the
failed lifecycle state. Resolution and injection are fail-closed: the host
config is updated only from a complete staged result, so a failure cannot
partially mutate the host. The plugin writes no agent or skill files, creates no
skill cache, and does not register a native OpenCode `skill`; the native `skill`
tool can coexist with `atlante_skill` without either replacing the other.
