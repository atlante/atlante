import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const EXTERNAL_AGENT_PROMPT = `# External Review

You review external packs.

## Mission

Review the strict artifact.

Detail: Relative detail from the external pack.
`;

export const EXTERNAL_SKILL_CONTENT = `# External Testing

Use the external pack.

Strict external body.
`;

const schemaUri = "https://atlante.sh/schema/v0.1/schema.json";

function writeTemplate(
  root: string,
  name: string,
  schema: Record<string, unknown>,
  source: string,
): void {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "template.jsonc"),
    JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      ...schema,
    }),
  );
  writeFileSync(join(directory, "template.md"), source);
}

export function writeExternalPackContent(root: string): void {
  writeTemplate(
    root,
    "templates/reviewer",
    {
      type: "object",
      properties: {
        identity: { type: "string" },
        mission: { type: "string" },
        details: { template: "./details" },
      },
      required: ["identity", "mission", "details"],
      additionalProperties: false,
    },
    "# External Review\n\n{{identity}}\n\n## Mission\n\n{{mission}}\n\n{{> slot/details}}\n",
  );
  writeTemplate(
    root,
    "templates/reviewer/details",
    {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    "Detail: {{text}}\n",
  );
  writeTemplate(
    root,
    "templates/testing",
    {
      type: "object",
      properties: {
        title: { type: "string" },
        overview: { type: "string" },
        body: { type: "string" },
      },
      required: ["title", "overview", "body"],
      additionalProperties: false,
    },
    "# {{title}}\n\n{{overview}}\n\n{{body}}\n",
  );
  mkdirSync(join(root, "reviewer"), { recursive: true });
  writeFileSync(
    join(root, "reviewer", "instance.jsonc"),
    JSON.stringify({
      $template: "../templates/reviewer",
      identity: "You review external packs.",
      mission: "Review the default artifact.",
      details: { text: "Relative detail from the external pack." },
    }),
  );
  mkdirSync(join(root, "testing"), { recursive: true });
  writeFileSync(
    join(root, "testing", "instance.jsonc"),
    JSON.stringify({
      $template: "../templates/testing",
      title: "External Testing",
      overview: "Use the external pack.",
      body: "Default external body.",
    }),
  );
}

export function writeExternalPack(root: string): void {
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "@acme/review-pack",
      version: "1.2.3",
      atlante: { format: 1 },
    })}\n`,
  );
  writeFileSync(
    join(root, "atlante.jsonc"),
    `${JSON.stringify({
      $schema: schemaUri,
      values: { project: "default-project" },
      agents: {
        reviewer: {
          $instance: "./reviewer",
          description: "External reviewer for {{values.project}}.",
        },
      },
      skills: {
        testing: {
          $instance: "./testing",
          description: "External testing for {{values.project}}.",
        },
      },
    })}\n`,
  );
  mkdirSync(join(root, "strict"), { recursive: true });
  writeFileSync(
    join(root, "strict", "atlante.jsonc"),
    `${JSON.stringify({
      extends: "./..",
      values: { project: "strict-project" },
      agents: { reviewer: { mission: "Review the strict artifact." } },
      skills: {
        testing: {
          description: "Strict external testing for {{values.project}}.",
          body: "Strict external body.",
        },
      },
    })}\n`,
  );
  writeExternalPackContent(root);
}
