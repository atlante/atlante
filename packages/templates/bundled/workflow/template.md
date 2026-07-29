## {{#if title}}{{title}}{{else}}Workflow{{/if}}
{{#if description}}

{{description}}
{{/if}}

Execute phases sequentially in the order listed. A phase with a `subagent` delegates the entire phase to that configured agent; a phase without one is handled by the orchestrator. Follow each phase's inline instructions in order. A phase output records the aggregate result and a phase validation is the final quality gate.
{{#each phases}}

### {{increment @index}}. {{name}}
{{#if description}}

{{description}}
{{/if}}
{{#if subagent}}

The subagent "{{subagent}}" should handle this phase.
{{else}}

The orchestrator handles this phase.
{{/if}}
{{#each instructions}}

1. {{this}}
{{/each}}
{{#if output}}

Phase output: {{> slot/phases/output}}
{{/if}}{{#if validation}}

Phase validation: {{validation}}
{{/if}}
{{/each}}
