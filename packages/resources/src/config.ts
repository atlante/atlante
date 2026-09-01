/**
 * The accepted Atlante configuration filenames, in discovery-preference
 * order. Single source of truth shared by document discovery (validator),
 * preset-facet loading (resources), and pack preset scanning (CLI);
 * consumers must import this list rather than restate it.
 */
export const CONFIG_FILENAMES = ["atlante.jsonc", "atlante.json"] as const;

/** The name of an Atlante configuration file. */
export type ConfigFilename = (typeof CONFIG_FILENAMES)[number];
