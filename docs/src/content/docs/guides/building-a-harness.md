---
title: Build a harness
description: Customize a versioned harness with project-specific agents, skills, and values.
---

You do not need to design the whole harness before you start. Add one useful
role, keep the source beside your code, and let each change go through the same
validate-and-build loop.

## Start with the generated source

If you have not initialized the project yet, begin with [Getting
started](/getting-started). `init` creates `atlante.jsonc` and materializes
the initial native outputs for [OpenCode](https://opencode.ai/).

The default preset provides the `architect` agent, the four phase skills
`brainstorm`, `plan`, `build`, and `review`, and the additional `harness`
stewardship skill for initializing, configuring, validating, building,
troubleshooting, or improving the harness itself. The architect selects only
the workflow phases and skills that materially improve the result, follows an
authorized request through completion, audits applicable instruction sources,
and delegates safely parallelizable work when collaboration tools are
available. Open `atlante.jsonc` and extend that source instead of copying the
preset's resources into the project.

## Add an agent

Add project values and a reviewer to the generated document:

```jsonc
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "@atlante/pack",
  "values": {
    "project": "billing-api",
    "language": "TypeScript"
  },
  "agents": {
    "reviewer": {
      "description": "Reviews changes for defects and design risks.",
      "identity": "You are a senior {{values.language}} reviewer on {{values.project}}.",
      "mission": "Find defects before changes are merged.",
      "sections": [
        {
          "responsibilities": [
            "Read the relevant source and tests",
            "Check behavior against the project requirements",
            "Report actionable findings with file and line references"
          ]
        },
        {
          "invariants": [
            "Do not approve a change while a material defect remains unresolved."
          ]
        }
      ]
    }
  }
}
```

This binding intentionally omits a selector. A top-level agent or skill binding
without `$template` or `$instance` uses the applicable first-party default
template. You can select `@atlante/pack/agent` explicitly when you want that
choice visible in the source. The selected template owns the remaining fields;
see [Templates](/concepts/templates) for the selection rules.

For value interpolation and system values, see [Values](/concepts/values).

## Add a skill

Skills are reusable Markdown guidance addressed by `skillId`, not host-agent IDs:

```jsonc
{
  "skills": {
    "release-check": {
      "description": "Release checks for this project.",
      "title": "Release checks",
      "overview": "Prepare a safe release.",
      "sections": [
        {
          "instructions": [
            "Run the project checks before creating a release."
          ]
        }
      ]
    }
  }
}
```

This selector-less skill uses the first-party skill template. The build
materializes it for OpenCode; Atlante renders the skill but does not execute it.
See [Materialization](/reference/materialization) for the generated output
contract.

## Validate and materialize

After editing `atlante.jsonc` or selected resources, validate first and then
materialize the new native outputs:

```sh
npx @atlante/cli@latest validate
npx @atlante/cli@latest build
```

Both commands report their result, and `build` lists files it writes or removes.
For the generated paths and ownership rules, see
[Materialization](/reference/materialization).

```text
validated /Users/example/billing-api/atlante.jsonc
built /Users/example/billing-api
wrote opencode: .opencode/agents/reviewer.md
```

For continuous editing, use `build --watch` as documented in
the [CLI](/reference/cli). Continue to [Use OpenCode](/guides/opencode) when the
native outputs are in place.
