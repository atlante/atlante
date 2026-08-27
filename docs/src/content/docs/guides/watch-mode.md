---
title: Watch for changes
description: Rebuild selected configuration resources automatically during development.
---

Use watch mode while editing a configuration or its selected resources:

```sh
npx @atlante/cli build --watch
```

The initial build validates and publishes the artifact tree. The watcher then
rebuilds when a relevant source changes.

## What watch mode follows

The watch set includes:

- The selected configuration and preset manifests.
- Selected template and instance files.
- Transitive files referenced by those resources.
- Trusted pack roots.
- Safe unresolved parent directories, so a newly-created resource can be detected.

It does not watch unrelated resource siblings. This keeps rebuilds tied to the
selected dependency graph.

## Change handling

Each rebuild follows the same validation and fail-closed publication rules as a
one-shot `build`. An invalid edit does not replace the last complete usable
artifact tree.

Stop the watcher with `Ctrl-C`. Run the one-shot command when you want a finite
check in a script or CI job.
