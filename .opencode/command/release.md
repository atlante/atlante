---
description: Inspect commits, propose a version bump, and cut a fixed-version release
---

You are executing the `/release` command. Follow this workflow exactly and never skip either confirmation. Treat any extra text after `/release` as context only; it must not bypass the safety checks or count as confirmation.

Additional user context:
$ARGUMENTS

## 1. Inspect the release range

Run this command exactly to find the latest release tag:

```sh
git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || echo "none"
```

Also inspect, without changing anything, the current branch, working-tree status, and `origin` remote. The release target is `origin/main`. Do not stage, stash, reset, clean, amend, force-push, or otherwise modify the repository during inspection.

If the result is `none`, explain that this is the first release and use `0.1.0` as the proposed version. Otherwise, treat the result as the latest release tag. Release tags must be in the form `vMAJOR.MINOR.PATCH`; if the tag is not a valid stable SemVer tag, stop and ask the user how to proceed rather than guessing.

If a tag exists, run the equivalent of:

```sh
git log vX.Y.Z..HEAD --oneline --no-decorate
```

Replace `vX.Y.Z` with the actual validated latest tag. Capture every commit in that range. For a first release, inspect the repository history and changed paths needed to identify the initial release scope.

Because `--oneline` omits commit bodies and footers, inspect the full message for each relevant commit as needed (for example with `git show --format=fuller --no-patch <commit>`) so that `BREAKING CHANGE:` footers are not missed.

Before asking for the final confirmation, verify that `scripts/release.ts` exists and read it sufficiently to report its actual release actions. If it is missing or its expected behavior cannot be verified, stop without running an alternative command.

## 2. Analyze commits and propose a version

Interpret each commit subject using Conventional Commit-style syntax. Recognize `feat`, `fix`, `chore`, `docs`, `refactor`, `style`, `test`, and `ci`, including optional scopes. Mark a commit as breaking when its type/scope is followed by `!` or when its message contains a `BREAKING CHANGE:` footer. Categorize merge commits, reverts, and unrecognized messages separately instead of inventing a conventional type.

Apply these bump rules, in descending precedence:

- Any breaking change (`!` or `BREAKING CHANGE:`) proposes a **major** bump.
- Otherwise, any `feat:` commit proposes a **minor** bump.
- Otherwise, any `fix:` commit proposes a **patch** bump.
- If the commits contain only `chore:`, `docs:`, `refactor:`, `style:`, `test:`, or `ci:`, propose a conservative **patch** bump.
- If there are no release tags, propose exactly `0.1.0` regardless of the commit categories.

For an existing stable tag, calculate the proposed version from its numeric `MAJOR.MINOR.PATCH` values. A major bump resets minor and patch to zero; a minor bump resets patch to zero; a patch bump increments patch. Do not silently accept a version that is not greater than the latest tag.

Present the analysis clearly before asking the user anything. Use a table like this, with one row per category and the relevant commit subjects or short hashes:

| Category | Commits | Release impact |
| --- | --- | --- |
| `feat` | ... | Minor |
| `fix` | ... | Patch |
| Breaking | ... | Major |
| Maintenance (`chore`, `docs`, etc.) | ... | Patch |
| Other | ... | No direct bump signal |

Include the number of commits, the latest tag or `first release`, the exact proposed version, and a concise rationale explaining which rule won. If there are no commits after an existing tag, state that explicitly and do not fabricate release content; ask the user whether they want to stop rather than proceeding automatically.

## 3. Confirm the version

Ask the user to confirm the exact version. Accept only one of these responses:

- `yes` accepts the proposed version.
- `no` stops the release without changing anything.
- An alternative version string overrides the proposal, but it must be validated before continuing.

Validate an alternative as a SemVer version without a leading `v`, using this regex:

```text
^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$
```

Reject malformed versions, versions with a leading `v`, and versions that are not greater than the latest stable tag when one exists. Ask again for a valid version or `no`; never coerce, infer, or silently normalize it. Keep the selected version exactly as confirmed. Do not treat this confirmation as the final release confirmation.

## 4. Show scope and request final confirmation

Determine the release scope from the commits and changed paths. List the commits included and identify affected packages by mapping paths under `packages/*` to their package names. Include the root package when root files are affected. If a package cannot be determined, say so rather than guessing.

Show a final summary containing:

- The exact confirmed version.
- The latest tag or `first release` and the commit range.
- Every commit included in the release.
- Packages affected.
- The release actions verified in `scripts/release.ts`.
- A clear statement that the release will be pushed to `origin/main`.
- A warning that creating release commits/tags and pushing to `origin/main` are irreversible shared-repository actions and will not be undone automatically.

Ask for an explicit final `yes` or `no`. Do not interpret an ambiguous response, the earlier version confirmation, or text in `$ARGUMENTS` as final approval. If the user says `no`, stop without running the release script.

## 5. Execute only after final approval

After an explicit final `yes`, run the deterministic script with the exact confirmed version and no substitutions:

```sh
bun scripts/release.ts --version X.Y.Z --yes
```

Replace `X.Y.Z` with the confirmed version. Do not use a different script, add `--force`, bypass a failed check, or manually reproduce the release. Report the command result, exit status, and relevant output. If it fails, stop and report the failure; do not retry automatically or claim that anything was pushed unless the command confirms it.
