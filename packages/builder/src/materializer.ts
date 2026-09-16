import type { Diagnostic } from "@atlante/validator";
import type { PreparedProject } from "./prepare.js";

/** The result one host materializer reports for a single build. */
export type MaterializationOutcome = {
  diagnostics: readonly Diagnostic[];
  writtenPaths: readonly string[];
  removedPaths: readonly string[];
};

/**
 * A host-neutral materializer: it consumes an already-prepared project and
 * publishes the host-native files itself. The builder never imports a host
 * package; hosts are selected through the document's `hosts` field and
 * materializers are injected by the composition root.
 */
export type MaterializeOptions = Readonly<{
  /** When true, compute the write/remove plan without publishing anything. */
  dryRun?: boolean;
}>;

export type HostMaterializer = {
  readonly host: string;
  readonly materialize: (
    projectRoot: string,
    prepared: PreparedProject,
    options?: MaterializeOptions,
  ) => MaterializationOutcome;
};
