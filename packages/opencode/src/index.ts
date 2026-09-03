export type {
  HostMaterializationOutcome,
  MaterializationDiagnostic,
  OpenCodeMaterializerPrepared,
} from "./materialize.js";
export {
  OPENCODE_HOST_TARGET,
  openCodeMaterializer,
} from "./materialize.js";
export type {
  OpenCodeMaterializationErrorCode,
  OpenCodeNativeFile,
  OpenCodeNativeProject,
  OpenCodeOwnedFile,
  OpenCodeOwnershipManifest,
  OpenCodePreparedAgent,
  OpenCodePreparedProject,
  OpenCodePreparedSkill,
} from "./native.js";
export {
  materializeOpenCode,
  OpenCodeMaterializationError,
  readOpenCodeNative,
} from "./native.js";
