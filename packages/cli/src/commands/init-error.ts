import { formatDiagnostic } from "@atlante/validator";
import { diagnosticPath } from "../report.js";

export type InitError = {
  code: string;
  message: string;
  source?: string;
  expected?: string;
  next?: string;
  cause?: string;
};

export function formatInitError(
  code: string,
  message: string,
  extra: Omit<InitError, "code" | "message"> = {},
): string {
  return formatDiagnostic({
    severity: "error",
    code,
    message,
    ...extra,
    source: extra.source ? diagnosticPath(extra.source) : undefined,
  });
}
