## {{#if title}}{{title}}{{else}}Gotchas{{/if}}

{{#if description}}
{{description}}
{{else}}
Watch for these common mistakes.
{{/if}}

{{#each items}}
- {{this}}
{{/each}}
