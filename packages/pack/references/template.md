## References

Consult these entries on demand; the guidance above stands on its own:

{{#each (input)}}
{{increment @index}}. **{{name}}** — {{location}}{{#if readWhen}} — {{readWhen}}{{/if}}
{{/each}}
