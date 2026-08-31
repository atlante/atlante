import { getCollection, getEntry } from "astro:content";
import { readFile } from "node:fs/promises";
import type { APIRoute } from "astro";

export async function getStaticPaths() {
  const entries = await getCollection("docs");

  return entries
    .filter((entry) => entry.data.draft !== true)
    .map((entry) => ({
      params: {
        slug: entry.id === "index" ? "index" : entry.id,
      },
    }));
}

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug;
  if (!slug) return new Response("Not Found", { status: 404 });

  const entry = await getEntry("docs", slug);
  if (!entry?.filePath) {
    throw new Error(
      `No local source file is available for docs entry "${slug}".`,
    );
  }

  const source = await readFile(entry.filePath, "utf8");
  return new Response(source, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
};
