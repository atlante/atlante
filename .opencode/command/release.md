---
description: Inspect commits since last tag, propose a version bump, and cut a release
---

You are executing the `/release` command.

## Workflow

1. Find the latest release tag:
   ```sh
   git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || echo "none"
   ```

2. List commits since that tag (or full history for first release):
   ```sh
   git log vX.Y.Z..HEAD --oneline --no-decorate
   ```

3. Analyze commits using Conventional Commits:
   - Breaking change (`!` or `BREAKING CHANGE:`) → major bump
   - `feat:` → minor bump
   - `fix:` → patch bump
   - Only `chore:`/`docs:`/`refactor:`/`style:`/`test:`/`ci:` → patch bump
   - First release → `0.1.0`

4. Present a summary: proposed version, rationale, commits included.

5. Ask the user to confirm. Accept `yes`, `no`, or an alternative version string. Reject malformed versions and versions not greater than the latest tag.

6. On **explicit confirmation**, run:
   ```sh
   bun run release -- X.Y.Z
   ```
   Replace `X.Y.Z` with the confirmed version. Report the result.
