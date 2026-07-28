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
{{#each sections}}
{{#if markdown}}

{{> slot/sections/markdown}}
{{/if}}
{{#if instructions}}

{{> slot/sections/instructions}}
{{/if}}
{{#if gotchas}}

{{> slot/sections/gotchas}}
{{/if}}
{{#if workflow}}

{{> slot/sections/workflow}}
{{/if}}
{{/each}}
