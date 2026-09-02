import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createProjectResourcePack,
  interpolateValues,
  type JsonObject,
  renderResolvedTemplate,
  resolveResourceInstance,
} from "@atlante/resources";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const packRoot = join(repositoryRoot, "packages", "pack");
const packVersion = JSON.parse(
  readFileSync(join(packRoot, "package.json"), "utf8"),
).version as string;

const created: string[] = [];

export function packResourceFixture(): { root: string; config: string } {
  const root = mkdtempSync(join(repositoryRoot, ".pack-resource-test-"));
  created.push(root);
  mkdirSync(join(root, "node_modules", "@atlante"), { recursive: true });
  symlinkSync(packRoot, join(root, "node_modules", "@atlante", "pack"), "dir");
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "atlante-pack-resource-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": `workspace:${packVersion}` },
    })}\n`,
  );
  const config = join(root, "atlante.jsonc");
  writeFileSync(config, '{ "extends": "@atlante/pack" }\n');
  return { root, config };
}

export function cleanupPackResourceFixtures(): void {
  for (const root of created.splice(0))
    rmSync(root, { recursive: true, force: true });
}

type ListSectionKind =
  | "instructions"
  | "responsibilities"
  | "gotchas"
  | "invariants";

export interface ResolvedPackSkill {
  readonly title: string;
  readonly overview: string;
  readonly sections: readonly JsonObject[];
  readonly templateLocator: string;
  listText(kind: ListSectionKind): string;
  markdownText(): string;
  referencesText(): string;
  everythingText(): string;
  renderedOutput(): string;
}

function packSkillSections(
  locator: string,
  payload: JsonObject,
): readonly JsonObject[] {
  const raw = payload.sections;
  if (raw === undefined) return [];
  if (!Array.isArray(raw))
    throw new Error(`pack skill ${locator} expects an array of sections`);
  const sections: JsonObject[] = [];
  for (const section of raw) {
    if (
      typeof section !== "object" ||
      section === null ||
      Array.isArray(section)
    )
      throw new Error(`pack skill ${locator} expects object sections`);
    sections.push(section);
  }
  return sections;
}

function packSkillInput(
  locator: string,
  payload: JsonObject,
): Pick<ResolvedPackSkill, "title" | "overview" | "sections"> {
  const { title, overview } = payload;
  if (typeof title !== "string")
    throw new Error(`pack skill ${locator} expects a string title`);
  if (typeof overview !== "string")
    throw new Error(`pack skill ${locator} expects a string overview`);
  return { title, overview, sections: packSkillSections(locator, payload) };
}

function skillListItems(
  sections: readonly JsonObject[],
  kind: ListSectionKind,
): string[] {
  const items: string[] = [];
  for (const section of sections) {
    const value = section[kind];
    if (Array.isArray(value))
      items.push(
        ...value.filter((item): item is string => typeof item === "string"),
      );
  }
  return items;
}

type FlowKind = "p" | "ul" | "ol";
type HeadingKind = "h2" | "h3";

function flowLines(record: Record<string, unknown>, kind: FlowKind): string[] {
  const items = record[kind];
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => (kind === "p" ? item : `- ${item}`));
}

function headingLines(
  record: Record<string, unknown>,
  kind: HeadingKind,
): string[] {
  const heading = record[kind];
  if (typeof heading !== "object" || heading === null || Array.isArray(heading))
    return [];
  const { title, block } = heading as Record<string, unknown>;
  return [
    ...(typeof title === "string" ? [title] : []),
    ...markdownBlockLines(block),
  ];
}

function markdownBlockLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((block) => {
    if (typeof block !== "object" || block === null || Array.isArray(block))
      return [];
    const record = block as Record<string, unknown>;
    const flowKinds: FlowKind[] = ["p", "ul", "ol"];
    const headingKinds: HeadingKind[] = ["h2", "h3"];
    return [
      ...flowKinds.flatMap((kind) => flowLines(record, kind)),
      ...headingKinds.flatMap((kind) => headingLines(record, kind)),
    ];
  });
}

function skillMarkdownText(sections: readonly JsonObject[]): string {
  return sections
    .map((section) => markdownBlockLines(section.markdown).join("\n"))
    .filter((text) => text.length > 0)
    .join("\n");
}

function skillReferencesEntries(
  sections: readonly JsonObject[],
): readonly JsonObject[] {
  return sections.flatMap((section) =>
    Array.isArray(section.references)
      ? section.references.filter(
          (entry): entry is JsonObject =>
            typeof entry === "object" &&
            entry !== null &&
            !Array.isArray(entry),
        )
      : [],
  );
}

function referencesTextOf(entries: readonly JsonObject[]): string {
  return entries
    .map((entry) =>
      ["name", "location", "readWhen"]
        .map((key) =>
          typeof entry[key] === "string" ? (entry[key] as string) : "",
        )
        .filter((value) => value.length > 0)
        .join(" "),
    )
    .join("\n");
}

function skillEverythingText(
  input: Pick<ResolvedPackSkill, "overview" | "sections">,
  referencesText: string,
): string {
  return [
    input.overview,
    skillMarkdownText(input.sections),
    skillListItems(input.sections, "responsibilities").join("\n"),
    skillListItems(input.sections, "instructions").join("\n"),
    skillListItems(input.sections, "gotchas").join("\n"),
    skillListItems(input.sections, "invariants").join("\n"),
    referencesText,
  ].join("\n");
}

export function resolvePackSkill(locator: string): ResolvedPackSkill {
  const { root, config } = packResourceFixture();
  const resolved = resolveResourceInstance(
    createProjectResourcePack(root),
    locator,
    config,
  );
  const input = packSkillInput(locator, resolved.input);
  const referencesText = referencesTextOf(
    skillReferencesEntries(input.sections),
  );
  const renderedOutput = (): string =>
    renderResolvedTemplate({
      template: resolved.effectiveTemplate,
      input: interpolateValues(resolved.input, {}),
    });

  return {
    ...input,
    templateLocator: resolved.effectiveTemplate.locator,
    listText: (kind) => skillListItems(input.sections, kind).join("\n"),
    markdownText: () => skillMarkdownText(input.sections),
    referencesText: () => referencesText,
    everythingText: () => skillEverythingText(input, referencesText),
    renderedOutput,
  };
}
