import { describe, expect, test, vi } from "vitest";

const { readArtifacts } = vi.hoisted(() => ({
  readArtifacts: vi.fn(),
}));

vi.mock("@atlante/builder/artifacts", () => ({
  readArtifacts,
  ArtifactReadError: class ArtifactReadError extends Error {},
}));

import { ArtifactReadError } from "@atlante/builder/artifacts";
import { projectArtifacts } from "../src/artifacts.js";

describe("projectArtifacts", () => {
  test("projects verified metadata and redacts rendered content immediately", () => {
    readArtifacts.mockReturnValue({
      agents: [
        {
          hostAgentId: "reviewer",
          description: "Reviews changes",
          prompt: "FORBIDDEN_PROMPT_FIXTURE",
        },
      ],
      skills: [
        {
          skillId: "workflow",
          description: "Checks changes",
          content: "FORBIDDEN_SKILL_FIXTURE",
        },
      ],
    });

    const snapshot = projectArtifacts("/projects/demo");
    const serialized = JSON.stringify(snapshot);

    expect(snapshot).toMatchObject({
      status: "available",
      agents: [
        {
          id: expect.stringMatching(/^agent:/u),
          sourceIdentity: "reviewer",
          description: "Reviews changes",
          status: "configured",
          evidence: "artifact-manifest",
        },
      ],
      skills: [
        {
          id: expect.stringMatching(/^skill:/u),
          description: "Checks changes",
          status: "configured",
          evidence: "artifact-manifest",
        },
      ],
      links: {
        configuration: "atlante.jsonc",
        artifacts: ".atlante/artifacts/",
      },
    });
    expect(serialized).not.toContain("FORBIDDEN_PROMPT_FIXTURE");
    expect(serialized).not.toContain("FORBIDDEN_SKILL_FIXTURE");
    expect(serialized).not.toContain("/projects/demo");
  });

  test("reports a missing artifact tree without creating nodes", () => {
    readArtifacts.mockReturnValue(undefined);

    expect(projectArtifacts("/projects/demo")).toMatchObject({
      status: "missing",
      agents: [],
      skills: [],
    });
  });

  test("reports an invalid artifact tree without exposing the error", () => {
    readArtifacts.mockImplementation(() => {
      throw new ArtifactReadError("FORBIDDEN_ARTIFACT_ERROR");
    });

    const projection = projectArtifacts("/projects/demo");

    expect(projection).toMatchObject({
      status: "invalid",
      agents: [],
      skills: [],
    });
    expect(JSON.stringify(projection)).not.toContain(
      "FORBIDDEN_ARTIFACT_ERROR",
    );
  });

  test("keeps bounded IDs distinct while bounding serialized labels", () => {
    const prefix = "x".repeat(200);
    readArtifacts.mockReturnValue({
      agents: [
        { hostAgentId: `${prefix}-a`, description: "a" },
        { hostAgentId: `${prefix}-b`, description: "b" },
      ],
      skills: [],
    });

    const projection = projectArtifacts("/projects/demo");

    expect(new Set(projection.agents.map(({ id }) => id)).size).toBe(2);
    expect(
      projection.agents.every(
        ({ id, label }) => id.length <= 128 && label.length <= 160,
      ),
    ).toBe(true);
  });
});
