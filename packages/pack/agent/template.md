# Identity

{{identity}}

# Mission

{{mission}}
{{#each sections}}
{{#if invariants}}

{{> slot/sections/invariants invariants}}
{{/if}}
{{#if markdown}}

{{> slot/sections/markdown markdown}}
{{/if}}
{{#if instructions}}

{{> slot/sections/instructions instructions}}
{{/if}}
{{#if responsibilities}}

{{> slot/sections/responsibilities responsibilities}}
{{/if}}
{{#if gotchas}}

{{> slot/sections/gotchas gotchas}}
{{/if}}
{{#if workflow}}

{{> slot/sections/workflow}}
{{/if}}
{{/each}}
