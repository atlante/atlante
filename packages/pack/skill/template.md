{{#if title}}# {{title}}

{{/if}}{{#if overview}}## Overview

{{overview}}
{{/if}}{{#each sections}}
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
{{#if invariants}}

{{> slot/sections/invariants invariants}}
{{/if}}
{{#if references}}

{{> slot/sections/references references}}
{{/if}}
{{/each}}
