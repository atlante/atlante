## {{#if title}}{{title}}{{else}}Workflow{{/if}}
{{#if description}}

{{description}}
{{/if}}

Execute phases sequentially in the order listed. A phase with a configured subagent is delegated to that agent. Follow each phase's inline instructions in order.
{{#if policies.orchestratorReadOnly}}

Workflow policy: the orchestrator is read-only and delegates every file edit.
{{/if}}
{{#each phases}}

### {{increment @index}}. {{name}}
{{#if description}}

{{description}}
{{/if}}
{{#if subagent}}

The subagent "{{subagent}}" should handle this phase.
{{/if}}
{{#if policies.commit}}

Phase policy: commit task implementation and corrections separately.
{{/if}}
{{#if policies.review}}

Phase policy: apply task review according to this phase's review criteria.
{{/if}}
{{#if policies.maxLoops}}

Phase policy: limit correction to {{policies.maxLoops}} loops per task.
{{/if}}
{{#each instructions}}

{{increment @index}}. {{this}}
{{/each}}
{{#if output}}

Phase output: {{> slot/phases/output}}
{{#if output.updateable}}

This output is a living artifact that later phases may revisit and update, looping back when needed.
{{/if}}
{{/if}}{{#if validation}}

Phase validation: {{validation}}
{{/if}}
{{/each}}
