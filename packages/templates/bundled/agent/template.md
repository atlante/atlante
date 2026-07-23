# Identity

{{identity}}

# Mission

{{mission}}
{{#if responsibilities}}

# Responsibilities

{{#each responsibilities}}
- {{this}}
{{/each}}
{{/if}}
{{#if constraints}}

# Constraints

{{#each constraints}}
- {{this}}
{{/each}}
{{/if}}
{{#if workflow}}

{{> slot/workflow}}
{{/if}}
