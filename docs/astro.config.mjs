// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://docs.atlante.sh",
  trailingSlash: "never",
  redirects: {
    "/": "/introduction",
    "/index.md": "/introduction.md",
    "/contributing":
      "https://github.com/atlante/atlante/blob/main/CONTRIBUTING.md",
    "/guides/extensions": "/guides/authoring-packs",
    "/guides/opencode": "/guides/building-a-harness",
    "/concepts/native-outputs": "/reference/materialization",
  },
  integrations: [
    starlight({
      disable404Route: true,
      title: "Atlante documentation",
      description:
        "Reference documentation for Atlante configuration, validation, builds, host materialization, and native outputs.",
      logo: {
        src: "./src/assets/atlante-horizontal.svg",
        alt: "Atlante",
        replacesTitle: true,
      },
      components: {
        SiteTitle: "./src/components/SiteTitle.astro",
        Head: "./src/components/Head.astro",
      },
      favicon: "/brand/favicons/atlante-favicon.svg",
      head: [
        {
          tag: "link",
          attrs: {
            rel: "preload",
            href: "/fonts/bodonimoda/bodoni-moda-latin.woff2",
            as: "font",
            type: "font/woff2",
            crossorigin: true,
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "preload",
            href: "/fonts/sourcesans3/source-sans-3-latin.woff2",
            as: "font",
            type: "font/woff2",
            crossorigin: true,
          },
        },
      ],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/atlante/atlante",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/atlante/atlante/edit/main/docs/",
      },
      customCss: ["./src/styles/atlante-tokens.css", "./src/styles/custom.css"],
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      lastUpdated: true,
      pagination: true,
      titleDelimiter: "·",
      sidebar: [
        { slug: "introduction", label: "Introduction" },
        { slug: "getting-started", label: "Getting started" },
        {
          label: "Concepts",
          items: [
            { slug: "concepts/configuration", label: "Configuration" },
            { slug: "concepts/resources", label: "Resources" },
            { slug: "concepts/templates", label: "Templates" },
            { slug: "concepts/values", label: "Values" },
            { slug: "concepts/resolution", label: "Resolution" },
            { slug: "concepts/evaluation", label: "Evaluation" },
          ],
        },
        {
          label: "Guides",
          items: [
            {
              slug: "guides/building-a-harness",
              label: "Customize your harness",
            },
            {
              slug: "guides/evaluating-a-harness",
              label: "Evaluate your harness",
            },
            {
              slug: "guides/authoring-packs",
              label: "Author a pack",
            },
          ],
        },
        {
          label: "Reference",
          items: [
            { slug: "reference/mcp", label: "MCP" },
            { slug: "reference/cli", label: "CLI" },
            { slug: "reference/eval", label: "Eval" },
            { slug: "reference/schema", label: "Schema" },
            { slug: "reference/template-syntax", label: "Template syntax" },
            { slug: "reference/materialization", label: "Materialization" },
            { slug: "reference/diagnostics", label: "Diagnostics" },
          ],
        },
        { slug: "troubleshooting", label: "Troubleshooting" },
        { link: "https://packs.atlante.sh/", label: "Pack explorer" },
      ],
    }),
  ],
});
