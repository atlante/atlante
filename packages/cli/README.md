# `@atlante/cli`

Command-line interface for validating, resolving, and initializing
[Atlante](https://github.com/atlante/atlante) projects. Requires Node.js 22 or
later.

## Usage

Run the CLI directly from npm:

```bash
npx @atlante/cli init
npx @atlante/cli validate
npx @atlante/cli resolve
```

For a global `atlante` command:

```bash
npm install --global @atlante/cli
atlante --help
```

## Commands

- `atlante init [path] [--preset starter] [--force]` — scaffold
  `atlante.jsonc` and register `@atlante/opencode-plugin`
- `atlante validate [path]` — validate the document and referenced template
  inputs without rendering
- `atlante resolve [path] [--agent <id>] [--json]` — render resolved agent
  prompts and skills

`path` defaults to the current directory and may be a config file or project
directory. Atlante discovers both `atlante.jsonc` and `atlante.json`.
Validation and resolution use the same raw-overlay expansion path before
checking or rendering the canonical document.

`init` creates or updates `opencode.jsonc` while preserving existing settings.

Human-readable `resolve` output prints both agent and skill artifacts. The
`--agent <id>` filter applies only to agents; it never hides or filters skills.
With `--json`, the CLI emits exactly this envelope to stdout. JSON-mode failures
also emit the envelope to stdout with diagnostics; diagnostics are not duplicated
on stderr, and failed results contain empty `agents` and `skills` arrays:

```json
{
  "agents": [
    {
      "hostAgentId": "implementer",
      "templateId": "atlante/agent",
      "description": "Implements requested changes.",
      "prompt": "..."
    }
  ],
  "skills": [
    {
      "skillId": "testing",
      "templateId": "atlante/skill",
      "description": "Testing guidance.",
      "content": "Run the focused test suite."
    }
  ],
  "diagnostics": []
}
```
