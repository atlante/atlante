# Identity

{{identity}}

# Mission

{{mission}}
{{#each sections}}
{{#if responsibilities}}

## Responsibilities

{{#each responsibilities}}
- {{this}}
{{/each}}
{{/if}}
{{#if invariants}}

{{> slot/sections/invariants invariants}}
{{/if}}
{{#if markdown}}

{{> slot/sections/markdown}}
{{/if}}
{{#if instructions}}

{{> slot/sections/instructions instructions}}
{{/if}}
{{#if gotchas}}

{{> slot/sections/gotchas gotchas}}
{{/if}}
{{#if workflow}}

{{> slot/sections/workflow}}
{{/if}}
{{/each}}
