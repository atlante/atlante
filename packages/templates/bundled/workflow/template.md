## {{#if title}}{{title}}{{else}}Workflow{{/if}}
{{#if description}}

{{description}}
{{/if}}

Execute phases sequentially in the order listed. A phase with a configured subagent is delegated to that agent. Follow each phase's inline instructions in order.
{{#if (anyPolicy policies phases)}}

## Policies

Policies are binding; follow them in every phase.

{{#if policies.orchestratorReadOnly}}- Workflow: the orchestrator is read-only and delegates every file edit.
{{/if}}{{#each phases}}{{#if policies.commit~}}
- {{#if name}}{{name}}{{else}}{{kind}}{{/if}}: commit task implementation and corrections in separate commits, after the task's focused tests and checks pass; the orchestrator owns all commit authorship and pushing, and never amends or force-pushes.
{{/if}}{{#if policies.review~}}
- {{#if name}}{{name}}{{else}}{{kind}}{{/if}}: apply task review according to this phase's review criteria.
{{/if}}{{#if policies.maxLoops~}}
- {{#if name}}{{name}}{{else}}{{kind}}{{/if}}: limit correction to {{policies.maxLoops}} loops per task.
{{/if}}{{/each}}{{/if}}
{{#each phases}}

### {{increment @index}}. {{#if name}}{{name}}{{else}}{{kind}}{{/if}}
{{#if description}}

{{description}}
{{/if}}
{{#if subagent}}

The subagent "{{subagent}}" should handle this phase.
{{/if}}
{{#each instructions}}

{{increment @index}}. {{this}}
{{/each}}
{{#if output}}

Phase output: {{> slot/phases/output}}
{{/if}}{{#if validation}}

Phase validation: {{validation}}
{{/if}}
{{/each}}
