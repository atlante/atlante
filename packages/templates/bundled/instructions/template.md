## {{#if title}}{{title}}{{else}}Instructions{{/if}}
{{#if description}}

{{description}}
{{else}}

Follow these steps in order.
{{/if}}

{{#each steps}}
1. {{this}}
{{/each}}
