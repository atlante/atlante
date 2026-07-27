# Remove agent-level `extends` from the published schema

## Scope

Remove the explicit `extends` property from the JSON Schema customization for agent bindings. Regenerate the checked-in schema artifact.

## Behavior

`extends` remains supported only at document level. Agent bindings retain their existing permissive handling of template-owned fields; this change adds no runtime rejection or validation behavior.

## Verification

Run the schema generation path and the repository type-check, lint, and test commands. Confirm the generated schema no longer advertises `agents.*.extends`.
