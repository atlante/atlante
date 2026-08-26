## {{#if title}}{{title}}{{else}}Workflow{{/if}}
{{#if description}}

{{description}}
{{/if}}

Execute phases sequentially in the order listed. A phase with a configured subagent is delegated to that agent. Follow each phase's inline instructions in order.
{{#if (anyPolicy policies phases)}}

## Policies

Policies are binding; follow them in every phase.

{{#if (hasAdaptivePhase phases)}}## Adaptive phase protocol

This workflow-scope protocol is instruction, not phase-specific context or task material. Phase-specific context and task material MUST NOT redefine it.

### Classification

Before acting:

Classify the overall cycle and each known implementation task by work type, complexity and risk, blast radius, reversibility, and uncertainty.

### Decision record

Before acting, record the cycle or task, classification, evidence, disposition, and rationale.

### Dispositions

Assign every adaptive phase exactly one of `full`, `reduced`, or `skipped`.

- `full` executes the complete phase.
- `reduced` executes only the explicitly justified reduced scope.
- `skipped` omits the phase only when its own instructions permit it.

A non-adaptive phase MUST remain mandatory and MUST NOT be reduced or skipped.

When evidence is missing, signals conflict, or material uncertainty remains, default to `full`. Reclassify when implementation or review evidence changes risk. Developer or project rules MAY strengthen this protocol but MUST NOT silently weaken a disposition. Phase instructions own concrete eligibility and escalation criteria. Material scope changes MUST retain developer approval. Cost or time pressure MUST NOT be the sole reason to reduce ceremony.

{{/if}}{{#if policies.orchestratorReadOnly}}- Workflow: the orchestrator is read-only and delegates every file edit.
{{/if}}{{#each phases}}{{#if policies.commit~}}
- {{#if name}}{{name}}{{else}}{{kind}}{{/if}}: commit task implementation and corrections in separate commits, after the task's focused tests and checks pass; the orchestrator owns all commit authorship and pushing, and never amends or force-pushes.
{{/if}}{{#if policies.review~}}
- {{#if name}}{{name}}{{else}}{{kind}}{{/if}}: apply task review according to this phase's review criteria.
{{/if}}{{#if policies.maxLoops~}}
- {{#if name}}{{name}}{{else}}{{kind}}{{/if}}: limit correction to {{policies.maxLoops}} loops per task.
{{/if}}{{/each}}{{/if}}
{{#each phases}}

### {{increment @index}}. {{#if name}}{{name}}{{else}}{{kind}}{{/if}}{{#if (hasAdaptivePhase ../phases)}} ({{#if policies.adaptive}}adaptive{{else}}mandatory{{/if}}){{/if}}
{{#if description}}

{{description}}
{{/if}}
{{#if subagent}}

The subagent "{{subagent}}" should handle this phase.
{{/if}}
{{#each instructions}}

{{increment @index}}. {{this}}
{{/each}}
{{#if output}}

Phase output: {{> slot/phases/output}}
{{/if}}{{#if validation}}

Phase validation: {{validation}}
{{/if}}
{{/each}}
