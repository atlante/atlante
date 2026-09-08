---
title: Evaluation
description: How scenarios, repeated trials, and explicit checks help assess changes to a coding-agent harness.
---

Validation checks whether a configuration and its selected content form
valid input for the build. Evaluation observes what the built harness
produces on defined tasks, then assesses those results against expectations
you specify.

Both matter when instructions change: a valid configuration can produce
results that fall short of the task's requirements. Evaluation makes those
expectations concrete enough to check across repeated runs and harness
revisions.

## Scenarios, fixtures, trials, and checks

A scenario describes a task and the checks that determine whether its
result meets the expected conditions. It connects four parts of an
evaluation:

- The **fixture** supplies the starting project files for the task.
- The **task** supplies the prompt and can select a named agent.
- A **trial** is one execution of that task in a fresh sandbox.
- The **checks** assess the resulting files or the results of verification commands.

For example, a fixture might contain a `billing-api` route with missing
request validation that the reviewer should identify. The task asks the
reviewer to record its findings in `review.md`, rather than change the
implementation.

Checks can require that report to contain an expected finding and restrict
changed files to the report alone. Those checks define the evidence that
counts as success for this particular scenario, rather than grading whether
the prompt sounds well written.

## What a trial evaluates

Each trial starts with a fresh copy of the fixture and the native outputs
from a prior build. OpenCode runs the task using that harness, and Atlante
grades the resulting sandbox against the scenario's checks.

```text
built harness + fixture + task
    -> OpenCode trial
    -> resulting sandbox state
    -> checks
    -> trial verdict
```

A source edit affects an evaluation after a build has materialized that
change into the native outputs used by trials. This keeps the evaluation
attached to the harness the host receives, rather than an unbuilt
configuration revision.

## Deterministic checks and variable results

File checks apply fixed rules to the resulting files; command checks use
exit statuses and optional output patterns. The checks grade that evidence
without asking a model to judge whether the task succeeded.

The agent may still take different actions or produce different results
when the same scenario runs again. Repeated trials expose that variation
while keeping the task and its expectations consistent across executions.

A trial passes when every check passes, so a required condition cannot be
offset by success on another check. A passing trial supports the
expectations expressed in those checks, for the task and conditions it
exercised.

## Comparing harness revisions

A comparison is more informative when scenarios, fixtures, checks, model
settings, and budgets stay consistent across harness revisions. Changing
those inputs alongside the instructions makes the cause of a result
difference harder to identify.

Reports provide trial outcomes and check evidence that you can inspect
across runs, rather than relying on a single successful example. An unmet
expectation, a timeout, and an infrastructure failure provide different
evidence about the harness and its evaluation conditions.

The [Eval reference](/reference/eval) defines scenario fields, check types,
budgets, reports, and sandbox containment. [Getting started](/getting-started)
shows the setup procedure, and the [Introduction](/introduction#where-atlante-stops)
explains Atlante's execution boundary.
