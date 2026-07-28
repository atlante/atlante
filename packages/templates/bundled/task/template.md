- **{{name}}**: {{description}}
{{#if agent}}  The agent "{{agent}}" should be used for this task.
{{/if}}{{#if needs}}  This task needs the output of {{#each needs}}task '{{this}}'{{#unless @last}}, {{/unless}}{{/each}}.
{{/if}}{{#if steps}}
{{#each steps}}  1. {{this}}
{{/each}}{{/if}}{{#if output}}  This task output should be: {{> slot/output}}
{{/if}}{{#if check}}  Checks after task: {{> slot/check}}{{/if}}
