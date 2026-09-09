---
title: Evaluate your harness
description: Test a reviewer on a known defect, inspect the check results, and repeat the scenario after changing its instructions.
---

Test your harness on a task with a known expected result. In this guide, a
reviewer examines a small invoice function and writes its findings to a file.
You will check that it identifies a defect without changing the implementation.

The scenario gives you a repeatable task and fixed checks. The model's actions
can still vary between runs, which is why a useful evaluation includes more
than one trial. See [Evaluation](/concepts/evaluation) for the distinction
between deterministic grading and variable agent results.

## Before you begin

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
Evaluation launches OpenCode and can incur model usage costs. The checks
grade the results without a model-judge; running the task still uses a model.
Review the [sandbox containment boundary](/reference/eval#sandbox-containment)
before running fixtures or instructions from other sources.
:::

## Prepare a fixture

A fixture supplies the files the reviewer will see at the start of each
trial. Keep it small enough that a failed check is straightforward to
investigate.

Create `eval/fixtures/invoice-review/invoice.js` with this function:

```js title="eval/fixtures/invoice-review/invoice.js"
export function invoiceTotal(items) {
  return items.reduce((total, item) => total + item.price, 0);
}
```

Each item is meant to contribute its unit price multiplied by its quantity.
This implementation ignores quantity: two units priced at 10 produce a total
of 10 instead of 20. Leave the defect in place; it is the condition you want
the reviewer to identify.

Your evaluation files will have this layout after the next step:

```text
my-project/
├── atlante.jsonc
└── eval/
    ├── fixtures/
    │   └── invoice-review/
    │       └── invoice.js
    └── scenarios/
        └── invoice-review.eval.json
```

## Describe the task and its checks

Create a scenario that selects `reviewer`, asks for a report, and defines
what counts as a passing result:

```json title="eval/scenarios/invoice-review.eval.json"
{
  "$schema": "https://atlante.sh/schema/v0.1/eval-scenario.json",
  "version": "0.1",
  "name": "invoice-review",
  "task": {
    "fixture": "eval/fixtures/invoice-review",
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

`task.fixture` is relative to the project root. Check paths such as
`review.md` refer to files inside the trial's sandbox, where the fixture
contents become the starting project files.

The first two checks require a report that names the function and the field
involved in the defect. The last check rejects changes outside `review.md`,
including an attempted fix to `invoice.js`.

These checks establish a narrow baseline: the report mentions the expected
details and the implementation remains untouched. Read the report too;
matching those words alone does not prove that its explanation is correct.
For larger fixtures, add checks for other concrete requirements rather than
trying to grade every aspect of a review with one text pattern.

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

Build the current harness before evaluating it:

```sh
npx atlante validate
npx atlante build
```

Evaluation reads the native outputs from that build. A source edit reaches
the next trial only after you rebuild it.

## Run one trial

Start with one trial to check the setup and inspect the result:

```sh
npx atlante eval --trials 1 --keep
```

`--trials 1` runs each selected scenario once; it does not cap that trial's
token use. Configure appropriate time and usage limits through the
[budget settings](/reference/eval) before running larger tasks. `--keep`
retains trial sandboxes for inspection.

Atlante copies the fixture into a fresh sandbox, makes the built harness
available there, and asks OpenCode to run the task. It then grades the
resulting files against the scenario's checks.

## Inspect the result

Use the report and retained sandbox paths reported by the command to inspect
the trial. Check three pieces of evidence:

1. **The check results.** Confirm that `review.md` contains the expected
   function and field names, and that only the allowed report changed.
2. **The report itself.** Open the sandbox's `review.md`. It should explain
   that the function sums unit prices without accounting for quantity.
3. **The implementation.** Confirm that the sandbox's `invoice.js` still
   contains the original defect. The task asks for a review, not a repair.

For example, a useful finding would explain that an item with `price: 10`
and `quantity: 2` contributes 10 when it should contribute 20. Your reviewer
may phrase the finding differently.

A failed text check means the report did not contain its required pattern.
A failed allowlist check means something outside the report changed. A host
startup failure or timeout needs a different response from an incorrect
review; inspect the recorded failure before changing the instructions.

The [Eval reference](/reference/eval#reports-and-exit-status) describes the
report format and exit statuses.

## Repeat after changing the harness

Use a failure to identify a specific instruction worth testing. If the
reviewer edits the implementation, for example, strengthen the reviewer's
instructions about reporting defects without fixing them.

Edit the source binding or instance, rebuild, and repeat the same scenario:

```sh
npx atlante validate
npx atlante build
npx atlante eval --trials 3 --keep
```

Compare the reports from before and after the change. Keep the fixture,
task, checks, model, and per-trial budget the same so the instruction change
is the variable you are investigating. Use the same trial count for a
like-for-like comparison; the initial single trial is a setup check.

Look at failed checks and the reports behind them, not only whether one
trial passed. Repeated trials help expose variation, while each check still
supports only the expectation it actually measures.

As your harness grows, add scenarios for other tasks you rely on it to
perform. Keep the starting files and expected outcomes explicit so a change
in results can lead to a specific investigation.
