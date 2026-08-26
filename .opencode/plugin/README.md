# OpenCode model and reasoning effort overrides

Local plugin that lets the ignored `.opencode/models.json` file set the `model`
and `reasoningEffort` for the `architect`, `general`, and `explore` roles at
startup.

## Configuration order

OpenCode merges its normal configuration first. User-global configuration has
lower precedence than repository `.opencode` configuration, and the local plugin
then applies the ignored `.opencode/models.json`, giving that file the final say
on the model and reasoning effort fields it sets at startup. The shared
`.opencode/opencode.jsonc` no longer sets `model` or `reasoningEffort` for the
three roles, so the local file is the repository source for those fields. This
documents the normal configuration order only; it does not promise that a
repository plugin can override administrator-managed policy.

## File format

The file is strict JSON, not JSONC. It accepts only the `architect`, `general`,
and `explore` keys. Each role value is a strict object that may specify
`model`, `reasoningEffort`, or both; the legacy string-only role value is
rejected:

```json
{
  "architect": {
    "model": "opencode/x-preview-f-free",
    "reasoningEffort": "xhigh"
  },
  "general": {
    "model": "opencode/x-preview-f-free",
    "reasoningEffort": "max"
  },
  "explore": {
    "model": "opencode/x-preview-f-free",
    "reasoningEffort": "max"
  }
}
```

## Behavior

- **Generated defaults**: if the file is missing, the plugin creates it with the
  exact starter above — `opencode/x-preview-f-free` for every role, with
  `reasoningEffort` `xhigh` for `architect` and `max` for `general`/`explore` —
  and applies it for the current startup.
- **Partial fallback**: each role and each field is optional; omitted roles and
  omitted fields preserve their values from the merged OpenCode configuration.
- **Fail-before-mutation validation**: malformed JSON, unknown roles or fields,
  legacy string-only role values, invalid `provider/model` references, and empty
  or non-string `reasoningEffort` values reject the whole file before any model
  or effort mutation.
- **Preserved shared fields**: only `model` and `reasoningEffort` change; role
  mode, permissions, tools, prompts, descriptions, and all other fields remain
  intact.
- **How reasoningEffort applies**: the value is written both to the agent's
  `variant` — which drives the model-picker display and the variant recorded on
  new sessions — and to `options.reasoningEffort`, the request-level fallback
  used when no variant is resolved. A variant manually selected for the agent
  in the model picker during a session still takes precedence.
- **No live availability validation**: validation does not check live provider
  or catalog availability.
- **Restart requirement**: restart OpenCode after changing this file or the
  plugin.
