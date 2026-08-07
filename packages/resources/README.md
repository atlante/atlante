# @atlante/resources

`@atlante/resources` is Atlante's private source-content seam. It owns the
resource model and the loading, resolution, composition, interpolation, and
rendering engine used by later preparation and bundled-content work. The
builder orchestrates preparation and publication; it does not duplicate this
engine.

T1 defines immutable typed identities for:

- local containing-file-relative and temporary `atlante/*` locators;
- project and bundled source origins;
- `template.jsonc` plus `template.md` template facets;
- `instance.jsonc` instance facets;
- package-level `atlante.jsonc` or `atlante.json` presets; and
- structured source-aware resource failures.

The package is private and is not an npm publication surface. External package
and plugin resolution are intentionally outside this seam. It may depend on
the source-content implementation dependencies needed by later tasks, but it
does not depend on Atlante's validator, builder, or former content packages.

Locators and origins in resource identities are validated branded types. Raw
authored strings are separate types used for diagnostics. T1 intentionally
provides no validation constructors; later T3 filesystem resolution is the
only layer that may create trusted identities.
