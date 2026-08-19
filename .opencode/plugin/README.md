# OpenCode model overrides

Local plugin that lets the ignored `.opencode/models.json` file set the model
for the `architect`, `general`, and `explore` roles at startup.

## Configuration order

OpenCode merges its normal configuration first. User-global configuration has
lower precedence than repository `.opencode` configuration, and the local plugin
then applies the ignored `.opencode/models.json`, giving that file the final say
on the three supported model fields at startup. This documents the normal
configuration order only; it does not promise that a repository plugin can
override administrator-managed policy.

## File format

The file is strict JSON, not JSONC. It accepts only the `architect`, `general`,
and `explore` keys, with `provider/model` string values:

```json
{
  "architect": "opencode/deepseek-v4-flash-free",
  "general": "opencode/deepseek-v4-flash-free",
  "explore": "opencode/deepseek-v4-flash-free"
}
```

## Behavior

- **Generated defaults**: if the file is missing, the plugin creates it with
  `opencode/deepseek-v4-flash-free` for all three roles.
- **Partial fallback**: a partial file overrides only the roles it lists;
  omitted roles preserve their model from the merged OpenCode configuration.
- **Fail-before-mutation validation**: malformed JSON, unknown keys, or
  malformed `provider/model` syntax fail plugin loading before any partial model
  mutation.
- **Preserved shared fields**: only model fields change; shared role settings,
  permissions, tools, reasoning settings, prompts, and descriptions remain
  intact.
- **No live availability validation**: validation does not check live provider
  or catalog availability.
- **Restart requirement**: restart OpenCode after changing this file or the
  plugin.