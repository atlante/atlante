## {{#if title}}{{title}}{{else}}Workflow{{/if}}
{{#if description}}

{{description}}
{{/if}}

Phases MUST run sequentially in the order listed. A phase with a configured subagent is delegated to that agent. Each phase's inline instructions MUST be followed in order.
{{#if (anyTruthy policies phases "policies")}}

## Policies

Policies are binding; they MUST be followed in every phase.

{{#if (anyEqual phases "policies.adaptive" true)}}### Adaptive phases

An adaptive phase is optional and SHOULD add only as much ceremony as the work needs.

Before running an adaptive phase, assess whether it would materially improve the outcome using task complexity, risk, uncertainty, and existing evidence.

- Skip the phase when the task is already clear, low-risk, and simple enough that the phase would not materially improve the outcome; briefly state why.
- Otherwise run the phase with depth proportional to the work, focusing only on material questions and evidence.
- Whenever the phase runs, it MUST preserve its required output, approvals, and safety gates.

Reassess later adaptive phases when implementation or review reveals new material evidence. A non-adaptive phase remains mandatory and runs as written.

{{/if}}{{#if policies.orchestratorReadOnly}}### Workflow: read-only orchestration

The orchestrator is read-only and delegates every file edit.

{{/if}}{{#each phases}}{{#if policies.commit~}}
### {{#if name}}{{name}}{{else}}{{kind}}{{/if}}: task commits

Task implementation and corrections MUST be committed in separate commits, after the task's focused tests and checks pass; the orchestrator owns all commit authorship and pushing, and MUST NOT amend or force-push.

{{/if}}{{#if policies.review~}}
### {{#if name}}{{name}}{{else}}{{kind}}{{/if}}: task review

Apply task review according to this phase's review criteria.

{{/if}}{{#if policies.maxLoops~}}
### {{#if name}}{{name}}{{else}}{{kind}}{{/if}}: correction loops

Correction MUST be limited to {{policies.maxLoops}} loops per task.
{{/if}}{{/each}}{{/if}}
{{#each phases}}

### {{increment @index}}. {{#if name}}{{name}}{{else}}{{kind}}{{/if}}{{#if (anyEqual ../phases "policies.adaptive" true)}} ({{#if (isEqual policies.adaptive true)}}adaptive{{else}}mandatory{{/if}}){{/if}}
{{#if description}}

{{description}}
{{/if}}
{{#if subagent}}

The subagent "{{subagent}}" is responsible for this phase.
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
