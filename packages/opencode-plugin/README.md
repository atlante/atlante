# `@atlante/opencode-plugin`

OpenCode host adapter for [Atlante](https://github.com/atlante/atlante). It
validates and resolves an Atlante document, then injects the resulting prompts
through OpenCode's configuration hook. Requires Node.js 22 or later.

Register the plugin in `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@atlante/opencode-plugin"],
}
```

Running `npx @atlante/cli init` creates this registration automatically while
preserving existing OpenCode settings.
