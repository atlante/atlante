import {
  materializeOpenCode,
  OpenCodeMaterializationError,
  type OpenCodeMaterializationErrorCode,
  type OpenCodePreparedProject,
} from "./native.js";

/**
 * Mirrors the validator's Diagnostic shape so the published declarations stay
 * self-contained; outcomes are structurally compatible with builder
 * diagnostics without importing a private package.
 */
export type MaterializationDiagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  /** Absolute path the condition applies to, when the failure has one. */
  source?: string;
  /** One deterministic recovery action, when available. */
  next?: string;
  /** Normalized low-level cause, reported last. */
  cause?: string;
};

/**
 * Structural input accepted from the builder's PreparedProject: the adapter
 * reads only the fields the native materializer owns, so the builder can pass
 * its richer prepared value without the adapter importing the builder.
 */
export type OpenCodeMaterializerPrepared = Readonly<{
  agents: ReadonlyArray<{
    hostAgentId: string;
    description: string;
    prompt: string;
  }>;
  skills: ReadonlyArray<{
    skillId: string;
    description: string;
    content: string;
  }>;
}>;

export type HostMaterializationOutcome = Readonly<{
  diagnostics: readonly MaterializationDiagnostic[];
  writtenPaths: readonly string[];
  removedPaths: readonly string[];
}>;

export const OPENCODE_HOST_TARGET = "opencode" as const;

function repairFor(code: OpenCodeMaterializationErrorCode): string {
  switch (code) {
    case "invalid-id":
      return "rename the ID in the Atlante source configuration; host materialization never renames IDs";
    case "collision":
      return "remove or rename the unowned file at that path, or take ownership by deleting it, then run `atlante build` again";
    case "drift":
      return "restore the file to its last generated state (for example by deleting the drifted file), then run `atlante build` again";
    case "invalid-manifest":
      return "delete the corrupt ownership manifest to discard Atlante's ownership state, then run `atlante build` again";
    case "unsafe-path":
      return "replace the symlink or non-directory with a real directory, then run `atlante build` again";
    case "filesystem":
    case "publication-failed":
      return "fix the reported filesystem condition, then run `atlante build` again; a failed publication preserves the previous generated set";
    case "invalid-input":
      return "this is a builder defect: the prepared project violated the materializer contract";
  }
}

function diagnosticFor(
  cause: OpenCodeMaterializationError,
): MaterializationDiagnostic {
  const location = cause.path ? ` at ${cause.path}` : "";
  return {
    severity: "error",
    code: `materialization-${cause.code}`,
    message: `OpenCode materialization failed${location}: ${cause.message}`,
    ...(cause.path ? { source: cause.path } : {}),
    next: repairFor(cause.code),
    ...(cause.cause ? { cause: String(cause.cause) } : {}),
  };
}

/**
 * The builder-facing OpenCode host materializer. It owns only host-native
 * publication semantics; source loading, validation, resolution, and rendering
 * stay in the builder, and the prepared project arrives already rendered.
 */
export const openCodeMaterializer: {
  readonly host: typeof OPENCODE_HOST_TARGET;
  readonly materialize: (
    projectRoot: string,
    prepared: OpenCodeMaterializerPrepared,
  ) => HostMaterializationOutcome;
} = {
  host: OPENCODE_HOST_TARGET,
  materialize(projectRoot, prepared): HostMaterializationOutcome {
    const input: OpenCodePreparedProject = {
      agents: prepared.agents.map((agent) => ({ ...agent })),
      skills: prepared.skills.map((skill) => ({ ...skill })),
    };
    try {
      const result = materializeOpenCode(projectRoot, input);
      return {
        diagnostics: [],
        writtenPaths: result.writtenPaths,
        removedPaths: result.removedPaths,
      };
    } catch (cause) {
      if (cause instanceof OpenCodeMaterializationError)
        return {
          diagnostics: [diagnosticFor(cause)],
          writtenPaths: [],
          removedPaths: [],
        };
      throw cause;
    }
  },
};
