import { resolve as resolveHarness } from "@atlante/resolver";
import { hasErrors } from "@atlante/validator";
import { printDiagnostics } from "../report.js";
import { loadCliResources } from "./load.js";

export type ResolveOptions = { agent?: string; json?: boolean };

export async function runResolve(
  target: string,
  options: ResolveOptions,
): Promise<number> {
  const loaded = loadCliResources(target);
  if (!loaded.document || !loaded.registry) {
    printDiagnostics(loaded.diagnostics);
    return 1;
  }

  const { agents, diagnostics } = resolveHarness(
    loaded.document,
    loaded.registry,
  );
  printDiagnostics(diagnostics);
  if (hasErrors(diagnostics)) return 1;

  const hasSelectedAgent = options.agent !== undefined;
  const selected = hasSelectedAgent
    ? agents.filter((a) => a.hostAgentId === options.agent)
    : agents;

  if (selected.length === 0 && hasSelectedAgent) {
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
