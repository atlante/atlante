## {{#if title}}{{title}}{{else}}Workflow{{/if}}
{{#if description}}

{{description}}
{{/if}}

Follow phases in the order listed. Within a phase, a task that lists other tasks in its needs depends on those tasks' outputs; tasks without needs have no declared dependencies. Tasks may specify the responsible agent, an output, and a verification check.
{{#each phases}}

### {{increment @index}}. {{name}}
{{#if description}}

{{description}}
{{/if}}
{{#each tasks}}

{{> slot/phases/tasks}}
{{/each}}
{{/each}}
