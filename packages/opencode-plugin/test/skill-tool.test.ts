import { expect, test } from "bun:test";
import type { SkillToolState } from "../src/skill-tool.js";
import { createSkillTool } from "../src/skill-tool.js";

const skills = [
  {
    skillId: "testing",
    description: "Testing guidance",
    templateId: "atlante/skill",
    content: "Run tests.",
  },
  {
    skillId: "release",
    description: "Release guidance",
    templateId: "atlante/skill",
    content: "Cut a release.",
  },
] as const;

test("describes every skill ID and resolved description", () => {
  const state: SkillToolState = { status: "active" };
  const definition = createSkillTool(skills, state);

  expect(definition.description).toContain("testing: Testing guidance");
  expect(definition.description).toContain("release: Release guidance");
  expect(definition.description).toBe(
    "Retrieve a rendered Atlante project skill by name.\n" +
      "Available Atlante project skills:\n" +
      "- testing: Testing guidance\n" +
      "- release: Release guidance",
  );
});

test("returns known rendered Markdown", async () => {
  const definition = createSkillTool(
    [
      {
        skillId: "testing",
        description: "Testing",
        templateId: "atlante/skill",
        content: "Run tests.",
      },
    ],
    { status: "active" },
  );

  await expect(
    definition.execute({ name: "testing" }, {} as never),
  ).resolves.toBe("Run tests.");
});

test("rejects unknown names with the requested name and available IDs", async () => {
  const definition = createSkillTool(
    [
      {
        skillId: "testing",
        description: "Testing",
        templateId: "atlante/skill",
        content: "Run tests.",
      },
    ],
    { status: "active" },
  );

  await expect(
    definition.execute({ name: "missing" }, {} as never),
  ).rejects.toThrow(
    'unknown Atlante skill "missing"; available skills: testing',
  );
});

test("rejects calls before configuration commit and after materialization failure", async () => {
  const state: SkillToolState = { status: "inactive" };
  const definition = createSkillTool(skills, state);

  await expect(
    definition.execute({ name: "testing" }, {} as never),
  ).rejects.toThrow("inactive");
  state.status = "failed";
  state.reason = "adapter failure";
  await expect(
    definition.execute({ name: "testing" }, {} as never),
  ).rejects.toThrow("adapter failure");
});

test("rejects calls for every status other than active", async () => {
  const state = { status: "recovering" } as unknown as SkillToolState;
  const definition = createSkillTool(skills, state);

  await expect(
    definition.execute({ name: "testing" }, {} as never),
  ).rejects.toThrow("Atlante skills unavailable");
});

test("requires a non-empty skill name", () => {
  const definition = createSkillTool(skills, { status: "active" });
  const nameSchema = definition.args.name as unknown as {
    safeParse(value: string): { success: boolean };
  };

  expect(nameSchema.safeParse("").success).toBe(false);
  expect(nameSchema.safeParse("testing").success).toBe(true);
});
