---
title: MCP
description: Read-only Atlante project context and documentation tools for MCP hosts.
---

## Command

Start the Atlante context server with the CLI:

```sh
npx atlante mcp
```

The server uses its current working directory as the active project. It reads
newline-delimited JSON-RPC 2.0 requests from standard input and writes protocol
responses to standard output. Operational diagnostics use standard error.

The server is offline and read-only. It does not write project files, change
source configuration, install packages, build or materialize native output,
execute agents or commands, call an LLM, or fetch remote content.

## Contract versions

| Contract | Value |
| --- | --- |
| Atlante tool contract | `atlante-mcp/v1` |
| Default MCP protocol | `2024-11-05` |
| Supported MCP protocols | `2024-11-05`, `2025-03-26`, `2025-06-18` |
| Documentation catalog | `atlante-docs/v1` |

The Atlante tool contract and documentation catalog versions are independent of
the CLI package version. The package version appears in the MCP `serverInfo` and
in the command registered by `atlante init`.

## OpenCode registration

By default, `atlante init` registers the local server in the OpenCode
configuration for the initialized directory. It examines existing files in this
order:

1. `.opencode/opencode.jsonc`
2. `.opencode/opencode.json`
3. `opencode.jsonc`
4. `opencode.json`

The first existing file is the registration target. Every existing candidate is
parsed before initialization continues; malformed files and conflicting
`mcp.atlante` entries fail closed. When no candidate exists, `init` creates the
root `opencode.jsonc` file. Use `--no-mcp` to skip registration.

The managed entry is version-pinned to the CLI package:

```json
{
  "mcp": {
    "atlante": {
      "type": "local",
      "command": ["npx", "--yes", "atlante@<version>", "mcp"],
      "enabled": true
    }
  }
}
```

Registration preserves unrelated settings and JSONC comments, is idempotent,
and participates in `init`'s rollback transaction. See the [CLI reference](/reference/cli#atlante-init)
for initialization and package-installation behavior.

## Tool result envelope

The JSON-RPC `result` for every `tools/call` response has this shape. The
Atlante envelope is repeated as `structuredContent` and as the serialized text
inside `content`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"contract_version\":\"atlante-mcp/v1\",\"tool\":\"validate\",\"status\":\"ok\"}"
      }
    ],
    "structuredContent": {
      "contract_version": "atlante-mcp/v1",
      "tool": "validate",
      "status": "ok",
      "data": {}
    },
    "isError": false
  }
}
```

`data` is omitted when the tool has no successful data. `diagnostics` is omitted
when it is empty. Status values are:

| Status | Meaning |
| --- | --- |
| `ok` | The operation completed and returned data. |
| `empty` | The operation completed with no matching or resolved items. |
| `diagnostic` | The requested operation could not return its requested data. |
| `invalid` | The active project or tool arguments are invalid. |
| `unavailable` | A required project capability or bundled artifact is unavailable. |

Diagnostics provide a stable code and message and may include a source, project
relative path, JSON pointer, source location, expected shape, recovery action,
or cause. Normal project paths are project-relative; machine-specific absolute
paths are redacted.

Unknown methods and tools, malformed JSON-RPC requests, and invalid JSON-RPC
parameters use standard JSON-RPC errors instead of this envelope. Tool argument
errors use the envelope with the `invalid` status.

## Tools

### `inspect_project`

Inspect the active project without writing files.

| Input | Type | Range | Default |
| --- | --- | --- | --- |
| `include` | string[] | `authored`, `effective`, `resolved`, `provenance`, `artifact-files` | `[]` |

The result reports configuration metadata (`exists`, `path`, `schema_uri`,
`version`); validation, resource, documentation, schema, and
generated-artifact capabilities; diagnostics; and the freshness of
`.atlante/opencode-native.json` (`status`, `file_count`).

Each `include` value adds one section to the result. `authored`, `effective`,
and `resolved` add the corresponding configuration views, `provenance` adds
the per-pointer origin map, and `artifact-files` adds the generated-file list
with hashes. Unknown values return the `invalid` status with an
`invalid-arguments` diagnostic.

### `list_resources`

List only resources successfully resolved by the active project.

| Input | Type | Range | Default |
| --- | --- | --- | --- |
| `limit` | integer | 1–100 | 100 |

The result includes sorted `resources`, `total_count`, and `truncated`. Resource
views identify templates, instances, and bindings, with their IDs, locators,
origins, and applicable collection or template information.

### `validate`

Run authoritative project validation without rendering, materializing, or
writing files.

**Input:** no arguments.

The result includes `valid`, `config_path`, and `project_root`. Validation
diagnostics use the same envelope as every other tool.

### `search_docs`

Search the bundled Atlante documentation catalog deterministically.

| Input | Type | Range | Default |
| --- | --- | --- | --- |
| `query` | string | 1–256 characters | required |
| `limit` | integer | 1–20 | 10 |

The result includes the query and ranked matches. A match includes its source
kind, document ID, optional section ID and heading, excerpt, score, and optional
hosted source URL. Use the returned document and section identifiers with
`read_doc`.

### `read_doc`

Read a known documentation or specification document or section from the local
catalog.

| Input | Type | Range | Default |
| --- | --- | --- | --- |
| `document_id` | string | 1–256 characters | required |
| `section_id` | string | 1–256 characters | whole document |
| `max_bytes` | integer | 1–65536 | 65536 |

The result includes the document ID, optional section ID, source kind, title,
heading, description, source path, optional hosted source URL, headings, and
Markdown `content`. Unknown documents, unknown sections, and responses above
the requested limit return structured diagnostics.

### `get_schema`

Return one exact versioned JSON Schema from the bundled schema set.

| Input | Type | Range | Default |
| --- | --- | --- | --- |
| `uri` | string | 1–256 characters | required |

Supported URIs are:

| URI | Schema |
| --- | --- |
| `https://atlante.sh/schema/v0.1/schema.json` | Atlante configuration document |
| `https://atlante.sh/schema/v0.1/eval-scenario.json` | Eval scenario document |

Other URIs return the `schema-not-supported` diagnostic. The server does not
fetch a replacement schema.

## Documentation catalog

The CLI bundles a deterministic catalog generated from the repository's
documentation sources and `SPECIFICATION.md`. The catalog has the
`atlante-docs/v1` schema version and a source hash. The build produces the
catalog as a CLI bundle artifact; the source pages remain authoritative.

Each catalog document contains a source kind (`documentation` or
`specification`), document ID, source path, optional hosted source URL, title,
description, headings, Markdown `content`, and normalized `searchable_text`.

`content` is the readable Markdown body after frontmatter is removed.
`searchable_text` is an internal normalized field used for deterministic search;
it is not returned by `read_doc`. Search does not use embeddings, an LLM, or
the documentation website.

## Limits

The server rejects an incoming newline-delimited message larger than 256 KiB
with JSON-RPC error `-32600`. It bounds each response, including its trailing
newline, to the same 256 KiB limit. Individual tool limits are listed with
their inputs above. An oversized result is replaced with a structured
`response-too-large` diagnostic or a standard JSON-RPC size error.
