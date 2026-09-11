import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadRegistrySnapshot,
  type RegistryPack,
  type RegistrySnapshot,
} from "../src/data/registry";

const packsRoot = dirname(dirname(fileURLToPath(import.meta.url)));

type FakePack = {
  name: string;
  description: string;
  tags: string[];
  versions: string[];
  downloads: number;
  stars: number;
  publishedAt: string;
};

// Local-testing fixtures only: names, metrics, and repositories are invented
// and must never reach the committed snapshot or production.
const FAKE_PACKS: FakePack[] = [
  {
    name: "@northstar/review-pack",
    description:
      "Focused review agents for API compatibility, security boundaries, and release readiness.",
    tags: ["review", "security", "api"],
    versions: ["strict", "release-gate"],
    downloads: 9210,
    stars: 316,
    publishedAt: "2026-09-07T10:00:00.000Z",
  },
  {
    name: "@orbit/typescript-pack",
    description:
      "TypeScript implementation, testing, and migration guidance for product engineering teams.",
    tags: ["typescript", "testing", "migration"],
    versions: ["library", "service"],
    downloads: 7340,
    stars: 209,
    publishedAt: "2026-08-31T08:00:00.000Z",
  },
  {
    name: "@acme/platform-harness",
    description:
      "A platform-team harness for architecture decisions, service ownership, and production changes.",
    tags: ["platform", "architecture", "operations"],
    versions: [],
    downloads: 4880,
    stars: 184,
    publishedAt: "2026-09-10T16:45:00.000Z",
  },
  {
    name: "@small-hours/docs-pack",
    description:
      "Documentation planning, technical editing, and release-note workflows for maintainers.",
    tags: ["documentation", "editing", "release"],
    versions: ["release-notes"],
    downloads: 2710,
    stars: 96,
    publishedAt: "2026-08-25T12:00:00.000Z",
  },
  {
    name: "@meridian/api-pack",
    description:
      "API design agents and review templates for versioned public interfaces.",
    tags: ["api", "design", "review"],
    versions: ["design-first"],
    downloads: 1840,
    stars: 74,
    publishedAt: "2026-08-19T09:30:00.000Z",
  },
  {
    name: "@lighthouse/rust-pack",
    description:
      "Rust workspace skills covering ownership, unsafe boundaries, and release audits.",
    tags: ["rust", "systems", "audit"],
    versions: [],
    downloads: 920,
    stars: 51,
    publishedAt: "2026-08-12T14:00:00.000Z",
  },
  {
    name: "@papercup/design-pack",
    description:
      "Frontend design review agents with accessibility and token-consistency checks.",
    tags: ["design", "frontend", "accessibility"],
    versions: ["tokens", "a11y"],
    downloads: 460,
    stars: 33,
    publishedAt: "2026-08-06T18:20:00.000Z",
  },
  {
    name: "@driftwood/data-pack",
    description:
      "Data pipeline review agents for schema evolution, backfills, and quality gates.",
    tags: ["data", "pipelines", "quality"],
    versions: [],
    downloads: 210,
    stars: 21,
    publishedAt: "2026-07-30T11:10:00.000Z",
  },
  {
    name: "@quill/writing-pack",
    description:
      "Technical writing agents for guides, changelogs, and RFC reviews.",
    tags: ["writing", "docs", "rfc"],
    versions: ["rfc"],
    downloads: 90,
    stars: 12,
    publishedAt: "2026-07-21T07:00:00.000Z",
  },
  {
    name: "@harborline/release-pack",
    description:
      "Release management skills for staged rollouts, changelogs, and sign-off trails.",
    tags: ["release", "ci", "rollout"],
    versions: ["staged"],
    downloads: 40,
    stars: 5,
    publishedAt: "2026-07-14T19:55:00.000Z",
  },
];

function fakePack(fake: FakePack): RegistryPack {
  const presets = [
    {
      name: "default",
      locator: fake.name,
      default: true,
      bindings: {
        agents: 1,
        skills: 2 + (fake.versions.length % 3),
      },
    },
    ...fake.versions.map((version, index) => ({
      name: version,
      locator: `${fake.name}/${version}`,
      default: false,
      bindings: {
        agents: index % 2,
        skills: 2 + index,
      },
    })),
  ];

  return {
    name: fake.name,
    official: false,
    tags: [...fake.tags],
    description: fake.description,
    version: `1.4.${fake.downloads % 10}`,
    license: "MIT",
    maintainers: ["fixture-maintainer"],
    repository: {
      url: `git+https://github.com/${fake.name.slice(1)}.git`,
      slug: fake.name.slice(1),
    },
    npmUrl: `https://www.npmjs.com/package/${fake.name}`,
    metrics: {
      downloads: fake.downloads,
      stars: fake.stars,
      publishedAt: fake.publishedAt,
      updatedAt: fake.publishedAt,
    },
    presets,
    readmeHtml: `<h1>${fake.name}</h1><p>${fake.description}</p><p>This is a local fixture pack for testing the explorer.</p>`,
    files: [
      {
        path: "atlante.jsonc",
        content: JSON.stringify(
          {
            $schema: "https://atlante.sh/schema/v0.1/schema.json",
            extends: fake.name,
            agents: { reviewer: { $instance: `${fake.name}/reviewer` } },
          },
          null,
          2,
        ),
      },
      {
        path: "reviewer/instance.jsonc",
        content: JSON.stringify(
          {
            $template: `${fake.name}/skill`,
            description: fake.description,
          },
          null,
          2,
        ),
      },
      { path: "README.md", content: `# ${fake.name}\n\n${fake.description}\n` },
    ],
  };
}

/**
 * Appends local fixture packs to the registry snapshot so the catalog can be
 * exercised with a populated table. Only for development: run sync:packs to
 * restore the real, verified snapshot.
 */
export function fakePacks(count = FAKE_PACKS.length): RegistrySnapshot {
  const snapshot = loadRegistrySnapshot(packsRoot);
  const real = snapshot.packs.filter((pack) => pack.name === "@atlante/pack");
  const fakes = FAKE_PACKS.slice(0, count).map(fakePack);
  const next: RegistrySnapshot = {
    syncedAt: snapshot.syncedAt,
    packs: [...real, ...fakes],
  };
  writeFileSync(
    join(packsRoot, "src", "data", "registry-snapshot.json"),
    `${JSON.stringify(next, null, 2)}\n`,
  );
  return next;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = fakePacks();
  console.log(
    `fake-packs: catalog now holds ${result.packs.length} packs (fixtures are local only)`,
  );
}
