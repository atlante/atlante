# @atlante/resources

`@atlante/resources` is Atlante's private source-content subsystem. It owns
resource packs, lazy facet loading, containing-file-relative locator
resolution, provenance-aware overlays, composition, interpolation, and
Markdown rendering. The builder orchestrates preparation and publication; it
does not duplicate this engine.

The resource model defines immutable typed identities for:

- local containing-file-relative and temporary `atlante/*` locators;
- project and bundled source origins;
- `template.jsonc` plus `template.md` template facets;
- `instance.jsonc` instance facets;
- package-level `atlante.jsonc` or `atlante.json` preset roots; and
- structured source-aware resource failures.

The package is private and is not an npm publication surface. External package
and plugin resolution are intentionally outside this seam. A resource pack
captures one canonical trusted content root; absolute paths, URLs, unsafe
traversal, external symlinks, and targets outside that root are rejected. Only
selected facets and transitive dependencies are read, and unresolved parent
directories are returned for watch-mode recovery. The package does not depend
on Atlante's schema, validator, builder, or host integration.

Locators and origins in resource identities are validated branded types. Raw
authored strings are separate types used for diagnostics. Resource failures are
typed and source-aware; normal diagnostics use project-relative or stable
`atlante/*` identities rather than machine-specific absolute paths.
