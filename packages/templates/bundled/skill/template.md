# {{title}}

## Overview

{{overview}}
{{#each sections}}
{{#if markdown}}

{{markdown}}
{{/if}}
{{#if instructions}}

## {{#if instructions.title}}{{instructions.title}}{{else}}Instructions{{/if}}
{{#if instructions.description}}

{{instructions.description}}
{{else}}

Follow these steps in order.
{{/if}}

{{#each instructions.steps}}
1. {{this}}
{{/each}}
{{/if}}
{{#if gotchas}}

## {{#if gotchas.title}}{{gotchas.title}}{{else}}Gotchas{{/if}}

{{#if gotchas.description}}
{{gotchas.description}}
{{else}}
Watch for these common mistakes.
{{/if}}

{{#each gotchas.items}}
- {{this}}
{{/each}}
{{/if}}
{{/each}}
