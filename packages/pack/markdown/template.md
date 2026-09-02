{{#*inline "blocks"}}{{#each this~}}{{#unless @first}}

{{/unless~}}{{#if p}}{{#each p}}{{this}}{{#unless @last}}

{{/unless}}{{/each}}{{/if~}}{{#if ul}}{{#each ul}}- {{this}}{{#unless @last}}
{{/unless}}{{/each}}{{/if~}}{{#if ol}}{{#each ol}}{{increment @index}}. {{this}}{{#unless @last}}
{{/unless}}{{/each}}{{/if~}}{{#if h2}}## {{h2.title}}

{{> blocks h2.block}}{{/if~}}{{#if h3}}### {{h3.title}}

{{> blocks h3.block}}{{/if}}{{/each}}{{/inline~}}
{{> blocks (input)}}{{! trailing separation survives; bare trailing newlines are stripped}}
{{! by Handlebars at compile time, so the newline between comments carries it}}
