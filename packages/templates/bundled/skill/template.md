# {{title}}

## Overview

{{overview}}
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
{{/each}}
