# @atlante/resources

`@atlante/resources` is Atlante's private source-content subsystem. It owns
project and static package packs, package metadata and declared runtime
dependency resolution, lazy template and instance loading,
containing-file-relative locator resolution, provenance-aware overlays, composition,
interpolation, and Markdown
rendering. The builder orchestrates preparation and publication; it does not
duplicate this engine.

The resource model defines immutable typed identities for:

- local containing-file-relative and package locators;
- project and version-qualified package source origins;
- template definitions in `template.jsonc` and `template.md`;
- instance definitions in `instance.jsonc`;
- package-level `atlante.jsonc` or `atlante.json` preset roots with
  `package.json#atlante.format: 1`; and
- structured source-aware resource failures.

The package is private and is not an npm publication surface. Package loading is
static and generic; it does not expose a host adapter API or execute pack code. A
`ResourcePack` captures one canonical trusted pack root; absolute paths, URLs,
unsafe traversal, external symlinks, and targets outside that pack root are rejected. Only
selected templates and instances and their transitive dependencies are read, and unresolved
parent directories are returned for watch-mode recovery. The package does not depend
on Atlante's schema, validator, builder, or host integration.

Locators and origins in resource identities are validated branded types. Raw
authored strings are separate types used for diagnostics. Resource failures are
typed and source-aware; normal diagnostics use project-relative or stable
package-qualified identities rather than machine-specific absolute paths. Watch
contexts carry only selected package metadata, template and instance files,
trusted roots, and safe unresolved parents.
