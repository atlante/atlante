import { describe, expect, test } from "vitest";
import { verifyMutationEvidence, type Workspace } from "./mutation-verify";

const workspaces: readonly Workspace[] = ["schema", "resources", "validator"];

describe("mutation evidence verification", () => {
  test("keeps stored campaign chains intact while reporting drifted sources as stale", async () => {
    const summary = await verifyMutationEvidence(workspaces);

    expect(summary.failures).toEqual([]);
    expect(summary.stale).toEqual(workspaces);
  });

  test("verifies every workspace independently from partial targets", async () => {
    const [schemaOnly] = await Promise.all([
      verifyMutationEvidence(["schema"]),
    ]);

    expect(schemaOnly.stale).toEqual(["schema"]);
  });
});
