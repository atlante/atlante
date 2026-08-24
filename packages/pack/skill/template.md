# {{title}}

## Overview

{{overview}}
{{#each sections}}
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
{{#if constraints}}

{{> slot/sections/constraints constraints}}
{{/if}}
{{#if invariants}}

{{> slot/sections/invariants invariants}}
{{/if}}
{{/each}}
