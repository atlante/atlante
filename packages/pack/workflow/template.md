## Workflow

The phases below describe the available workflow in their configured order.
{{#each phases}}

### {{increment @index}}. {{name}}
{{#each instructions}}

{{increment @index}}. {{this}}
{{/each}}
{{#if output}}

Phase output: {{> slot/phases/output}}
{{/if}}
{{/each}}
