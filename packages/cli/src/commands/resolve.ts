import { resolve as resolveHarness } from "@atlante/resolver";
import { loadBundledTemplates } from "@atlante/templates";
import {
  hasErrors,
  loadDocument,
  templateLoadDiagnostics,
} from "@atlante/validator";
import { printDiagnostics } from "../report.ts";

export type ResolveOptions = { agent?: string; json?: boolean };

export async function runResolve(
  target: string,
  options: ResolveOptions,
): Promise<number> {
  const loaded = loadDocument(target);
  if (!loaded.document) {
    printDiagnostics(loaded.diagnostics);
    return 1;
  }

  const { registry, errors } = loadBundledTemplates();
  if (errors.length > 0) {
    printDiagnostics(templateLoadDiagnostics(errors));
    return 1;
  }

  const { agents, diagnostics } = resolveHarness(loaded.document, registry);
  printDiagnostics(diagnostics);
  if (hasErrors(diagnostics)) return 1;

  const selected = options.agent
    ? agents.filter((a) => a.hostAgentId === options.agent)
    : agents;

  if (selected.length === 0) {
    console.error(`error: no agent named "${options.agent}"`);
    return 1;
  }

  if (options.json) {
    console.log(JSON.stringify(selected, null, 2));
    return 0;
  }

  for (const artifact of selected) {
    console.log(`--- ${artifact.hostAgentId} (${artifact.templateId}) ---`);
    console.log(artifact.prompt);
  }
  return 0;
}
