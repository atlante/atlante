import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { playgroundFallback } from "../src/data/playground-fallback";

const websiteRoot = join(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(join(websiteRoot, relativePath), "utf8");
}

const observatoryEntries = [
  [
    "configuration",
    "Family",
    "One harness, held together",
    "atlante.jsonc",
    "Agents, skills, values, and eval configuration live in one versioned configuration beside your code.",
  ],
  [
    "inputs",
    "Stars",
    "Every signal stays visible",
    "named inputs, available to templates only when selected",
    "Each reference point remains named, diffable, and available to templates only when explicitly declared.",
  ],
  [
    "agent",
    "Constellations",
    "Your stars form an agent",
    "agents.implementer → agents/implementer.md",
    "Identity, mission, responsibilities, invariants, and a reusable template combine into one coherent agent.",
  ],
  [
    "validation",
    "Coordinates",
    "Validate before you build",
    "atlante validate",
    "Atlante validates the configuration and every selected template before anything can be published.",
  ],
  [
    "adapter",
    "Projection",
    "The build writes what the host reads",
    "configuration → build → native files",
    "Atlante materializes a prepared project as host-native files and an ownership manifest; OpenCode discovers them when it starts.",
  ],
  [
    "runtime",
    "Bearing",
    "Atlante bears the structure. The host runs it.",
    "models · effort · permissions · tools · modes",
    "Runtime settings and execution remain with the host while Atlante keeps the authored structure reproducible.",
  ],
] as const;

describe("website content contract", () => {
  it("keeps observatory display terms separate from technical keys", () => {
    const observatory = read("src/components/HarnessObservatory.astro");
    const symbols = read("src/components/IdentitySymbol.astro");
    const keys = [...observatory.matchAll(/focus: "([^"]+)" as const/g)].map(
      (match) => match[1],
    );

    expect(keys).toEqual(observatoryEntries.map(([key]) => key));
    expect(symbols).toContain(
      'type Kind =\n  | "configuration"\n  | "inputs"\n  | "agent"\n  | "validation"\n  | "adapter"\n  | "runtime";',
    );
    expect(observatory).not.toContain('data-focus="harness"');
    for (const [key, term, title, signal, detail] of observatoryEntries) {
      expect(observatory).toContain(`term: "${term}"`);
      expect(observatory).toContain(`title: "${title}"`);
      expect(observatory).toContain(`code: "${signal}"`);
      expect(observatory).toContain(`"${detail}"`);
      expect(observatory).toContain(`data-symbol={item.focus}`);
      expect(observatory).toContain(`data-observation={item.focus}`);
      expect(observatory).toContain(`data-focus="${key}"`);
    }
    expect(observatory).not.toContain("See the system before the host does");
  });

  it("keeps approved source copy and links present", () => {
    const source = [
      read("src/components/Hero.astro"),
      read("src/components/ContractBand.astro"),
      read("src/components/BuildInstrument.astro"),
      read("src/components/ReviewClose.astro"),
      read("src/components/SiteFooter.astro"),
    ].join("\n");
    for (const text of [
      "Define, test, and evolve your harness like any other code, one versioned source in your repository.",
      "What it does",
      "Define agents, skills, values, and eval configuration in one versioned source.",
      "Validate the configuration and selected templates.",
      "Build OpenCode-native files.",
      "What it does not",
      "Perform LLM inference.",
      "Execute agents, skills, or project code.",
      "Own models, effort, permissions, tools, or modes.",
      "Support hosts other than OpenCode in v0.1.",
      "Playground",
      "Build your constellation",
      "Built for change. Strict by design",
      "Chart your harness",
      "reviewable harness",
      "Review harness changes like code",
      "Keep harness changes reviewable alongside application code.",
      "optional eval",
      "Catch breakage before it ships with eval",
      "Optional eval scenarios catch breakage before changes reach users.",
      "same source + selected content",
      "Get the same output from the same source and selected content",
      "The same source and selected content produce reproducible host-native output.",
      "Edit the configuration and press Build to create your first harness.",
      "Documentation",
      "Getting started",
      "GitHub repo",
      "Releases",
      "Issues",
      "Specification",
      "Contributing",
    ]) {
      expect(source).toContain(text);
    }
    for (const text of [
      "invalid → no publication",
      "Keep the last good build",
      "Failed configuration or template validation leaves the current artifact tree untouched.",
      "Run <code>init</code> to create your configuration and build your first artifacts.",
      "Define, share, and evolve your harness through Atlante with your team.",
      "configuration → validate → .opencode/",
      "Read the documentation",
    ]) {
      expect(source).not.toContain(text);
    }
    expect(source).not.toContain("Built for change. Strict by design.");
    expect(source.match(/signal: "/g)).toHaveLength(3);
    for (const href of [
      "https://docs.atlante.sh",
      "https://docs.atlante.sh/getting-started",
      "#quick-start",
      "https://www.npmjs.com/package/@atlante/cli",
      "https://docs.atlante.sh/contributing",
    ]) {
      expect(source).toContain(href);
    }
    expect(source).toContain("href: `${" + "github}/releases`");
    expect(source).toContain("href: `${" + "github}/issues`");
    expect(source).toContain(
      "href: `${" + "github}/blob/main/SPECIFICATION.md`",
    );
  });

  it("uses the shared page container for every major section", () => {
    const global = read("src/styles/global.css");
    const tokens = read("../brand/atlante-design-tokens.css");
    expect(tokens).toContain("--container-wide: 1440px");
    expect(global).not.toContain("--container-hero");
    expect(global).not.toContain("--container-playground");

    for (const component of [
      "Hero.astro",
      "HarnessObservatory.astro",
      "BuildInstrument.astro",
      "ReviewClose.astro",
    ]) {
      expect(read(`src/components/${component}`)).toContain(
        "var(--container-wide)",
      );
    }
  });

  it("presents a build-only playground", () => {
    const playground = read("src/components/BuildInstrument.astro");
    const request = read("api/_lib/playground.ts");

    for (const text of [
      "Edit the configuration, build it, and inspect the generated files.",
      "data-code-editor",
      "data-build",
      "Press Build to inspect generated native files.",
      "data-output-view",
      "data-output-selector",
      "data-file-select",
      "data-line-numbers",
      "data-initial-config={config}",
      "CodeJar",
      "instrument.dataset.initialConfig",
      "syncLineNumbers(initialConfig)",
      ".line-numbers :global(span)",
      '"$template": "@atlante/pack/agent"',
      ".atlante/opencode-native.json",
      "result.timedOut",
      "The playground build timed out.",
      'editor.addEventListener("pointerdown"',
      'editor.addEventListener("keydown"',
      'editor.addEventListener("blur"',
      "data-pointer-focus",
      ".code-editor[data-pointer-focus]:focus",
    ]) {
      expect(playground).toContain(text);
    }
    for (const text of [
      'data-run="init"',
      'data-run="validate"',
      'data-action="edit"',
      'data-action="save"',
      'data-action="revert"',
      "<textarea",
      'editor.setAttribute("contenteditable", "true")',
      "Scaffolds a real project",
      '"extends": "@atlante/pack"',
      'class="field-map"',
      'class="pipeline"',
      "data-pipeline-stage",
      "data-tree-list",
    ]) {
      expect(playground).not.toContain(text);
    }

    expect(request).toContain('step must be "build"');
    expect(request).not.toContain("sessionId");
    expect(request).not.toContain('step !== "init"');
    expect(request).not.toContain('step !== "validate"');
    expect(playground).toContain(
      "grid-template-columns: repeat(2, minmax(0, 1fr));",
    );
    expect(playground).toContain("font-size: clamp(11px, 0.85vw, 14px);");
    expect(playground).toMatch(
      /\.code-editor:focus-visible\s*\{[\s\S]*?outline: 3px solid var\(--ds-fg\) !important;/,
    );
    expect(playground).toMatch(
      /\.code-editor\[data-pointer-focus\]:focus\s*\{[\s\S]*?outline: none !important;/,
    );
  });

  it("keeps landing-page headings readable at the approved heading family", () => {
    const tokens = read("../brand/atlante-design-tokens.css");
    expect(tokens).toContain(
      '--font-heading: "Source Serif 4", "Iowan Old Style", Georgia, serif;',
    );
    for (const component of [
      "Hero.astro",
      "ContractBand.astro",
      "HarnessObservatory.astro",
      "BuildInstrument.astro",
      "ReviewClose.astro",
    ]) {
      const source = read(`src/components/${component}`);
      expect(source).toContain("font-family: var(--font-heading);");
      expect(source).toContain("font-weight: 600;");
    }
  });

  it("applies the session budget to the development playground route", () => {
    const devConfig = read("astro.config.mjs");
    expect(devConfig).toContain('"/api/playground.ts"');
    expect(devConfig).toContain("await playgroundHandler(req, res)");
  });

  it("keeps the contract band borderless while retaining its divider", () => {
    const contract = read("src/components/ContractBand.astro");
    expect(contract).not.toContain("configuration → validate → .opencode/");
    expect(contract).not.toContain("border-block: 1px solid var(--ds-border)");
    expect(contract).toContain("article + article");
    expect(contract).toContain(
      "border-inline-start: 1px solid var(--ds-border-subtle)",
    );
  });

  it("keeps the static playground fallback manifest self-consistent", () => {
    const manifestFile = playgroundFallback.files.find(
      (file) => file.path === ".atlante/opencode-native.json",
    );
    expect(manifestFile).toBeDefined();
    const manifest = JSON.parse(manifestFile?.content ?? "{}");

    for (const entry of manifest.files) {
      const file = playgroundFallback.files.find(
        (candidate) => candidate.path === entry.path,
      );
      expect(file).toBeDefined();
      expect(entry.path).toBe(
        entry.kind === "agent"
          ? `.opencode/agents/${entry.id}.md`
          : `.opencode/skills/${entry.id}/SKILL.md`,
      );
      expect(entry.sha256).toBe(
        createHash("sha256")
          .update(file?.content ?? "")
          .digest("hex"),
      );
    }
  });

  it("keeps the CTA directly below its supporting sentence and matches hero actions", () => {
    const hero = read("src/components/Hero.astro");
    const reviewClose = read("src/components/ReviewClose.astro");
    const nextStep = reviewClose.slice(
      reviewClose.indexOf('<div class="next-step">'),
      reviewClose.indexOf(
        "  </div>\n</section>",
        reviewClose.indexOf('<div class="next-step">'),
      ),
    );

    expect(nextStep).toMatch(
      /<p class="literal">[\s\S]*?Edit the configuration and press Build to create your first harness\.[\s\S]*?<\/p>\s*<div class="actions">/,
    );
    expect(nextStep).not.toMatch(
      /<\/div>\s*<div class="actions">[\s\S]*?<\/div>\s*<\/div>\s*$/,
    );
    expect(reviewClose).not.toContain(
      "grid-template-columns: minmax(0, 1fr) auto",
    );
    expect(reviewClose).toContain("grid-template-columns: 1fr");

    for (const declaration of [
      "gap: var(--space-4)",
      "min-height: var(--control-min)",
      "padding-inline: var(--space-8)",
      "font-weight: 520",
      "letter-spacing: 0.09em",
    ]) {
      expect(reviewClose).toContain(declaration);
      expect(hero).toContain(declaration);
    }
    expect(reviewClose).toMatch(
      /@media \(max-width: 680px\) \{[\s\S]*?\.actions \{[\s\S]*?justify-content: center;/,
    );
  });

  it("keeps final CTA hover and focus behavior identical to hero actions", () => {
    const hero = read("src/components/Hero.astro");
    const reviewClose = read("src/components/ReviewClose.astro");

    for (const source of [hero, reviewClose]) {
      expect(source).toMatch(
        /\.primary:hover,\s*\.primary:focus-visible\s*\{[\s\S]*?background: transparent;[\s\S]*?color: var\(--ds-fg\);[\s\S]*?border-color: var\(--ds-border\);/,
      );
      expect(source).toMatch(
        /\.secondary:hover,\s*\.secondary:focus-visible\s*\{[\s\S]*?border-color: var\(--ds-border\);/,
      );
    }
  });

  it("keeps the identity symbols semantically distinct", () => {
    const symbols = read("src/components/IdentitySymbol.astro");
    const family = symbols.slice(
      symbols.indexOf('kind === "configuration"'),
      symbols.indexOf('kind === "inputs"'),
    );
    const bearing = symbols.slice(
      symbols.indexOf('kind === "runtime"'),
      symbols.indexOf("</div>"),
    );

    expect(family).toContain('class="cluster cluster-a"');
    expect(family).toContain('class="cluster cluster-b"');
    expect(family).toContain('class="cluster cluster-c"');
    expect(family).not.toContain('class="outline"');
    expect(bearing).toContain('class="constellation"');
    expect(bearing).toContain('class="boundary"');
    expect(bearing).toContain('class="motion-path"');
    expect(bearing.indexOf('class="boundary"')).toBeGreaterThan(
      bearing.indexOf('class="constellation"'),
    );
    expect(bearing.indexOf('class="motion-path"')).toBeGreaterThan(
      bearing.indexOf('class="boundary"'),
    );
    expect(symbols).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\.motion-path \{[\s\S]*?animation: bearing-motion [^;]+;/,
    );
    expect(symbols).toContain("@keyframes bearing-motion");
    expect(symbols).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.motion-path \{[\s\S]*?animation: none;/,
    );
  });

  it("keeps footer lockups exclusive and the footer layout structured", () => {
    const footer = read("src/components/SiteFooter.astro");
    expect(footer).toContain('<div class="footer-main">');
    expect(footer).toContain('<div class="footer-controls">');
    expect(footer).toContain(
      ':global(html:not([data-theme="dark"])) .lockup-dark',
    );
    expect(footer).toContain(':global(html[data-theme="dark"]) .lockup-light');
    expect(footer).toContain("display: none !important;");
    expect(footer).toContain("@media (max-width: 900px)");
    expect(footer).toContain("@media (max-width: 700px)");
    expect(footer).toContain("@media (max-width: 460px)");
  });

  it("keeps footer metadata in its groups and aligns the lockup responsively", () => {
    const footer = read("src/components/SiteFooter.astro");
    const project = footer.slice(
      footer.indexOf('label: "Project"'),
      footer.indexOf('label: "Reference"'),
    );
    const reference = footer.slice(footer.indexOf('label: "Reference"'));
    const markStyles = footer.slice(
      footer.indexOf("  .mark {"),
      footer.indexOf("  .lockup {"),
    );
    const mobileStyles = footer.slice(
      footer.indexOf("  @media (max-width: 900px)"),
    );

    expect(project).toContain(
      '{ label: "v0.1", href: `${' + "github}/releases/latest` }",
    );
    expect(reference).toContain(
      '{ label: "MIT", href: `${' + "github}/blob/main/LICENSE` }",
    );
    expect(footer).not.toContain('class="footer-meta"');
    expect(footer).not.toContain('class="license"');
    expect(footer).not.toContain(
      "border-block-start: 1px solid var(--ds-border-subtle)",
    );
    expect(footer).not.toContain('<span aria-hidden="true">·</span>');
    expect(markStyles).toContain("align-self: start");
    expect(mobileStyles).toMatch(/\.mark \{[\s\S]*?justify-content: center;/);
    expect(mobileStyles).toMatch(/\.link-groups \{[\s\S]*?text-align: center;/);
    expect(footer).toContain("box-sizing: border-box");
    expect(footer).toContain(
      "width: min(100%, calc(var(--container-wide) + 2 * var(--space-4)))",
    );
  });

  it("keeps exactly one theme control available across the mobile boundary", () => {
    const nav = read("src/components/SiteNav.astro");
    const footer = read("src/components/SiteFooter.astro");
    const theme = read("src/lib/theme.ts");

    expect(nav).toMatch(
      /@media \(max-width: 700px\) \{[\s\S]*?\.site-nav \{[\s\S]*?display: none;/,
    );
    expect(footer).toMatch(
      /@media \(max-width: 700px\) \{[\s\S]*?\.footer-controls \{[\s\S]*?display: flex;[\s\S]*?\.planet \{[\s\S]*?display: grid;/,
    );
    expect(footer).toMatch(/\.footer-controls \{[\s\S]*?display: none;/);
    expect(theme).toContain(
      '"[data-theme-toggle], [data-theme-toggle-footer]"',
    );
  });

  it("centers mobile playground controls without centering code output", () => {
    const playground = read("src/components/BuildInstrument.astro");
    const mobileStyles = playground.slice(
      playground.indexOf("  @media (max-width: 700px)"),
      playground.indexOf("  @media (max-width: 480px)"),
    );

    expect(mobileStyles).toMatch(
      /\.pane-actions\s*\{[\s\S]*?justify-content: center;/,
    );
    expect(mobileStyles).toMatch(
      /\.terminal-head\s*\{[\s\S]*?justify-content: center;/,
    );
    expect(mobileStyles).toMatch(
      /\.build-controls\s*\{[\s\S]*?text-align: center;/,
    );
    expect(mobileStyles).toMatch(
      /\.code-editor,[\s\S]*?pre\[data-output-view\],[\s\S]*?pre\[data-terminal-out\][\s\S]*?text-align: start;/,
    );
    expect(mobileStyles).toMatch(
      /\.code-editor,\s*pre\[data-output-view\]\s*\{[\s\S]*?min-height: 280px;[\s\S]*?max-height: 420px;/,
    );
    expect(playground).toMatch(
      /@media \(max-width: 480px\) \{[\s\S]*?\.code-editor,[\s\S]*?pre\[data-output-view\][\s\S]*?min-height: 240px;[\s\S]*?max-height: 360px;/,
    );
    expect(playground).toMatch(
      /\.pane-actions button\s*\{[\s\S]*?min-height: 44px;/,
    );
    expect(playground).toMatch(/\.build-button\s*\{[\s\S]*?min-width: 120px;/);
  });

  it("keeps the mobile contract pair compact and separated", () => {
    const contract = read("src/components/ContractBand.astro");
    const mobileStyles = contract.slice(
      contract.indexOf("  @media (max-width: 700px)"),
    );

    expect(contract).not.toContain("min-height: 100%;");
    expect(mobileStyles).toMatch(
      /article\s*\{[\s\S]*?padding: var\(--space-4\);/,
    );
    expect(mobileStyles).toMatch(
      /article \+ article\s*\{[\s\S]*?border-block-start: 1px solid var\(--ds-border-subtle\);/,
    );
  });

  it("centers the footer mobile treatment in one column", () => {
    const footer = read("src/components/SiteFooter.astro");
    const mobileStyles = footer.slice(
      footer.indexOf("  @media (max-width: 700px)"),
      footer.indexOf("  @media (max-width: 460px)"),
    );

    expect(mobileStyles).toMatch(
      /\.link-groups \{[\s\S]*?grid-template-columns: 1fr;/,
    );
    expect(mobileStyles).toMatch(/\.link-groups \{[\s\S]*?text-align: center;/);
    expect(mobileStyles).toMatch(/\.link-group[\s\S]*?text-align: center;/);
    expect(mobileStyles).toMatch(/\.link-group h2[\s\S]*?text-align: center;/);
    expect(mobileStyles).toMatch(/\.link-group a[\s\S]*?text-align: center;/);
    expect(mobileStyles).toMatch(
      /\.footer-controls \{[\s\S]*?justify-content: center;/,
    );
  });

  it("centers landing-page user-facing text on mobile", () => {
    const hero = read("src/components/Hero.astro");
    const observatory = read("src/components/HarnessObservatory.astro");
    const playground = read("src/components/BuildInstrument.astro");
    const benefits = read("src/components/ReviewClose.astro");
    const footer = read("src/components/SiteFooter.astro");
    const notFound = read("src/pages/404.astro");

    expect(hero).toMatch(
      /@media \(max-width: 680px\) \{[\s\S]*?\.copy \{[\s\S]*?text-align: center;[\s\S]*?\.actions \{[\s\S]*?justify-content: center;[\s\S]*?\.command-row \{[\s\S]*?justify-content: center;[\s\S]*?\.command-box \{[\s\S]*?text-align: start;/,
    );
    expect(observatory).toMatch(
      /@media \(max-width: 680px\) \{[\s\S]*?article \{[\s\S]*?display: block;[\s\S]*?text-align: center;[\s\S]*?\.mobile-symbol \{[\s\S]*?margin-inline: auto;[\s\S]*?h3 \{[\s\S]*?margin-inline: auto;[\s\S]*?article code,[\s\S]*?\.detail \{[\s\S]*?margin-inline: auto;/,
    );
    expect(playground).toMatch(
      /@media \(max-width: 700px\) \{[\s\S]*?\.intro \{[\s\S]*?text-align: center;[\s\S]*?\.instrument-bar \{[\s\S]*?justify-content: center;[\s\S]*?\.run-hint \{[\s\S]*?text-align: center;[\s\S]*?\.code-editor,[\s\S]*?pre\[data-output-view\],[\s\S]*?pre\[data-terminal-out\][\s\S]*?text-align: start;/,
    );
    expect(benefits).toMatch(
      /@media \(max-width: 680px\) \{[\s\S]*?\.intro \{[\s\S]*?text-align: center;[\s\S]*?\.benefits article \{[\s\S]*?text-align: center;[\s\S]*?\.next-step \{[\s\S]*?text-align: center;[\s\S]*?\.actions \{[\s\S]*?justify-content: center;/,
    );
    expect(footer).toMatch(
      /@media \(max-width: 700px\) \{[\s\S]*?\.mark \{[\s\S]*?justify-content: center;/,
    );
    expect(footer).toMatch(
      /@media \(max-width: 700px\) \{[\s\S]*?\.link-group,[\s\S]*?text-align: center;/,
    );
    expect(footer).toMatch(
      /@media \(max-width: 700px\) \{[\s\S]*?\.footer-controls \{[\s\S]*?justify-content: center;/,
    );
    expect(notFound).toMatch(
      /@media \(max-width: 680px\) \{[\s\S]*?\.inner \{[\s\S]*?justify-items: center;[\s\S]*?text-align: center;[\s\S]*?\.actions \{[\s\S]*?justify-content: center;/,
    );
  });

  it("keeps the final observatory readout active at document end", () => {
    const observatory = read("src/components/HarnessObservatory.astro");
    expect(observatory).toContain(
      'import { isDocumentEnd } from "../lib/scroll";',
    );
    expect(observatory).toContain(
      "const lastObservation = observations?.[observations.length - 1];",
    );
    expect(observatory).toContain("isDocumentEnd(");
    expect(observatory).toContain(
      "observatory.getBoundingClientRect().bottom <= window.innerHeight",
    );
    expect(observatory).toContain('window.addEventListener("scroll"');
    expect(observatory).toContain('window.addEventListener("resize"');
  });

  it("uses one shared content-width rule for major dividers", () => {
    const global = read("src/styles/global.css");
    expect(global).toContain("--container-divider: var(--container-wide)");
    expect(global).toContain(".major-divider::before");
    expect(global).toContain("var(--container-divider)");

    for (const component of [
      "HarnessObservatory.astro",
      "BuildInstrument.astro",
      "ReviewClose.astro",
      "SiteFooter.astro",
    ]) {
      expect(read(`src/components/${component}`)).toContain("major-divider");
    }
  });

  it("ships a branded accessible not-found page", () => {
    const page = read("src/pages/404.astro");
    expect(page).toContain(
      'import BaseLayout from "../layouts/BaseLayout.astro";',
    );
    expect(page).toContain("This star is off the map");
    expect(page).toContain("The page you requested was not found.");
    expect(page).toContain('href="/"');
    expect(page).toContain('href="https://docs.atlante.sh"');
    expect(page).toContain('aria-hidden="true"');
    expect(page).toContain("min-height: var(--control-min)");
    expect(page).toContain("border-radius: 0");
    expect(page).toContain("prefers-reduced-motion");
  });
});
