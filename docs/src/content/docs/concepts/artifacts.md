---
title: Artifacts
description: Understand the generated, host-neutral output published by an Atlante build.
---

Artifacts are generated output, not authored configuration. A successful build
publishes them under `.atlante/artifacts/`:

```text
.atlante/artifacts/
├── manifest.json
├── agents/
│   └── reviewer-<id-sha256>-<content-sha256>.md
└── skills/
    └── testing-<id-sha256>-<content-sha256>.md
```

The output is host-neutral. The OpenCode adapter reads the complete verified
tree and materializes it into host configuration.

## Publication guarantees

The builder prepares the complete artifact set in a private sibling tree. It
publishes that tree by atomic directory rename, so a reader observes a complete
previous tree, a complete new tree, or no usable tree. It never observes a
partial artifact set.

Each payload is deterministic for the same source and selected content. Payload
filenames include an ASCII slug, an ID digest, and a content digest. The manifest
records the relative payload path and its lowercase SHA-256 digest.

## Keep artifacts local

Rendered values may contain sensitive project content. Keep `.atlante/` ignored
and local. Do not publish artifact payloads or treat their digests as proof that
the source or build environment is trusted.

For the exact manifest fields and verification rules, read [the artifact format
reference](/reference/artifacts).
