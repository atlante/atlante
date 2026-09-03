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
the initial native outputs for [OpenCode](https://opencode.ai/). The
published CLI bundles the first-party `@atlante/pack`, so the default setup does
not require a separate pack installation.

The default preset provides the `architect` agent, the four phase skills
`brainstorm`, `plan`, `build`, and `review`, and the additional `harness`
stewardship skill for initializing, configuring, validating, building,
troubleshooting, or improving the harness itself. The architect selects only
the workflow phases and skills that materially improve the result. Open
`atlante.jsonc` and extend that source instead of copying the preset's
resources into the project.

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

Values are strings substituted into descriptions and template-owned prompt
fields. The only supported system value is `{{sys.cwd.basename}}`, which resolves
to the current working directory's basename. Atlante does not provide arbitrary
filesystem or environment access.

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
materializes its content as `.opencode/skills/<skillId>/SKILL.md`, which
OpenCode discovers; Atlante renders
the skill but does not execute it.

## Validate and materialize

After editing `atlante.jsonc` or selected resources, validate first and then
materialize the new native outputs:

```sh
npx @atlante/cli@latest validate
npx @atlante/cli@latest build
```

Both commands report the resolved filesystem path they used, and `build` adds
one line per file it wrote or removed. For example:

```text
validated /Users/example/billing-api/atlante.jsonc
built /Users/example/billing-api
wrote opencode: .opencode/agents/reviewer.md
```

Inspect `.opencode/` and `.atlante/opencode-native.json` when checking the
result. The native files are derived output and may contain rendered project
values, so the ignore policy keeps them local. For continuous editing, use
`build --watch` as documented in
the [CLI](/reference/cli). Continue to [Use OpenCode](/guides/opencode) when the
native outputs are in place.
