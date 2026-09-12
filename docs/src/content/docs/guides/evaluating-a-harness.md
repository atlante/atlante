---
title: Evaluate your harness
description: Test a reviewer on a known defect, inspect the check results, and repeat the scenario after changing its instructions.
---

Using a deliberately flawed invoice function, this guide runs a reviewer
through a repeatable scenario, checks that its report identifies the defect
without changing the implementation, and compares the results across multiple
trials. [Evaluation](/concepts/evaluation) explains how fixed checks assess
variable agent results.

## Prerequisites

You need:

- An initialized project with a
  [project-local CLI](/getting-started#use-a-project-local-cli).
- A `reviewer` agent, such as the one in
  [Customize your harness](/guides/building-a-harness).
- [OpenCode](https://opencode.ai/docs/) installed and available as `opencode`
  in your terminal, with stored provider credentials. You can select a model
  explicitly or use the host default.
- Git available in your terminal so Atlante can establish each trial's
  starting filesystem state.

Run commands from the root of the project containing `atlante.jsonc`.

:::caution
Evaluation launches OpenCode, so trials can incur model usage costs even though
the checks grade their results without another model acting as judge.
Review the [sandbox containment boundary](/reference/eval#sandbox-containment)
before running fixtures or instructions from other sources.
:::

## Prepare a fixture

A fixture supplies the files the reviewer will see at the start of each
trial. Keep it small enough that a failed check is straightforward to
investigate.

Create the fixture directory and file:

```sh
mkdir -p eval/fixtures
touch eval/fixtures/invoice.js
```

Open `eval/fixtures/invoice.js` and add this function:

```js title="eval/fixtures/invoice.js"
export function invoiceTotal(items) {
  return items.reduce((total, item) => total + item.price, 0);
}
```

Each item is meant to contribute its unit price multiplied by its quantity.
This implementation ignores quantity: two units priced at 10 produce a total
of 10 instead of 20. Leave the defect in place; it is the condition you want
the reviewer to identify.

## Describe the task and its checks

Create the scenario directory and file:

```sh
mkdir -p eval/scenarios
touch eval/scenarios/invoice-review.eval.json
```

The evaluation files now have this layout:

```text
my-project/
├── atlante.jsonc
└── eval/
    ├── fixtures/
    │   └── invoice.js
    └── scenarios/
        └── invoice-review.eval.json
```

Open `eval/scenarios/invoice-review.eval.json` and define the task and its
passing conditions:

```json title="eval/scenarios/invoice-review.eval.json"
{
  "$schema": "https://atlante.sh/schema/v0.1/eval-scenario.json",
  "version": "0.1",
  "name": "invoice-review",
  "task": {
    "fixture": "eval/fixtures",
    "agent": "reviewer",
    "prompt": "Review invoice.js. Each item has a unit price and a quantity, and invoiceTotal should sum price multiplied by quantity for all items. Write your findings to review.md, naming the affected function and fields. Do not change implementation files."
  },
  "checks": [
    {
      "type": "file-contains",
      "path": "review.md",
      "pattern": "invoiceTotal"
    },
    {
      "type": "file-contains",
      "path": "review.md",
      "pattern": "quantity"
    },
    {
      "type": "diff-allowlist",
      "allow": ["review.md"]
    }
  ]
}
```

The scenario applies these paths and checks as follows:

- **Fixture:** `task.fixture` resolves from the project root. Atlante copies the
  contents of `eval/fixtures` into the trial's sandbox, where `invoice.js`
  appears at the sandbox root.
- **Required report content:** Check paths resolve from the sandbox root. The
  two `file-contains` checks therefore require the generated `review.md` to
  mention both `invoiceTotal` and `quantity`.
- **Allowed changes:** The `diff-allowlist` check permits only `review.md` to
  change. The trial fails if the reviewer edits `invoice.js` or creates another
  file.

Passing all three checks means the report contains the expected terms and the
implementation remains unchanged. It does not prove that the report explains
the defect correctly, so inspect the report itself and add more concrete checks
as the expected outcomes grow.

## Select the scenarios

Add an `eval` section to your existing `atlante.jsonc`. Keep its preset,
values, agents, and skills; this excerpt shows only the new section:

```jsonc title="atlante.jsonc — add eval"
{
  "eval": {
    "host": "opencode",
    "scenarios": "eval/scenarios/*.eval.json*"
  }
}
```

The glob selects the scenario you created. `task.agent` selects your named
reviewer rather than relying on the host's default agent.

### Include a pack-owned suite

Evaluation scenarios can also ship with a resource pack. The pack's root
preset declares the suite, and your project opts in explicitly:

```jsonc title="atlante.jsonc — include a pack suite"
{
  "eval": {
    "host": "opencode",
    "include": ["@acme/review-pack"]
  }
}
```

Installing or extending a pack never runs its suite, and `--scenario` only
narrows suites that are already included. Pack fixtures, setup commands, and
checks are executable input, so review them before adding a pack to
`eval.include`. [Pack-owned suites](/reference/eval#pack-owned-suites) defines
the resolution and containment rules that apply.

Build the current harness before evaluating it:

```sh
npx atlante validate
npx atlante build
```

Evaluation reads the native outputs from that build. A source edit reaches
the next trial only after you rebuild it.

## Run one trial

Start with one trial to verify the setup and inspect the result:

```sh
npx atlante eval --trials 1 --keep
```

`--keep` retains the trial sandbox for inspection. The trial count applies to
each selected scenario and does not limit token use; configure appropriate time
and usage limits through the [budget settings](/reference/eval) before running
larger tasks.

Atlante creates a fresh sandbox from the fixture, adds the built harness, asks
OpenCode to run the task, and grades the resulting files against the scenario's
checks.

## Inspect the result

Open the report and retained sandbox paths printed by the command, then inspect
three pieces of evidence:

1. **The check results.** Confirm that `review.md` contains the expected
   function and field names, and that only the allowed report changed.
2. **The report itself.** Open the sandbox's `review.md`. It should explain
   that the function sums unit prices without accounting for quantity.
3. **The implementation.** Confirm that the sandbox's `invoice.js` still
   contains the original defect. The task asks for a review, not a repair.

For example, a useful finding would explain that an item with `price: 10`
and `quantity: 2` contributes 10 when it should contribute 20. Your reviewer
may phrase the finding differently.

The failure determines what to inspect next:

- **Failed `file-contains` check:** The report is missing a required pattern.
  Read `review.md` to see whether the reviewer missed the defect or described
  it in different terms.
- **Failed `diff-allowlist` check:** A file other than `review.md` changed.
  Inspect the sandbox diff to identify what the reviewer edited or created.
- **Host startup failure or timeout:** The trial did not complete normally, so
  the result does not show that the review instructions are wrong. Inspect the
  recorded error, host setup, and applicable budgets before changing the
  harness.

The [Eval reference](/reference/eval#reports-and-exit-status) describes the
report format and exit statuses.

When a pack publishes a completed report at its declared `eval.report` path,
the pack explorer can display it as
[self-reported evaluation](/reference/eval#reports-and-exit-status).

## Compare a harness change

After the setup trial succeeds, establish a baseline with three trials:

```sh
npx atlante eval --trials 3 --keep
```

Use the baseline results to identify a specific instruction worth testing. If
the reviewer edits the implementation, for example, strengthen its instructions
about reporting defects without fixing them.

Edit the source binding or instance, rebuild, and repeat the same number of
trials:

```sh
npx atlante validate
npx atlante build
npx atlante eval --trials 3 --keep
```

Compare the before-and-after reports under the same fixture, task, checks,
model, per-trial budget, and trial count so the instruction change is the only
variable. Review failures and reports across the full run rather than relying
on a single pass, because repeated trials reveal variation and each check
supports only the expectation it measures. As the harness grows, add scenarios
for other important tasks, keeping their starting files and expected outcomes
explicit enough to trace a changed result to a specific cause.
