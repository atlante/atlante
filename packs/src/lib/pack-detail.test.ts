import { describe, expect, it } from "bun:test";
import { encodeJsonForScript } from "../data/json";
import { installPanel } from "./pack-detail";

type PackFile = { path: string; content: string | null };

const packFiles: PackFile[] = [
  { path: "atlante.jsonc", content: '{"agents": {}}' },
  { path: "skill/template.md", content: "</script><script>alert(1)</script>" },
];

describe("pack detail client wiring", () => {
  it("encodes JSON payloads so file contents cannot break out of the script tag", () => {
    const encoded = encodeJsonForScript(packFiles);
    const scriptTag = `<script type="application/json">${encoded}</script>`;
    expect(scriptTag.lastIndexOf("<script")).toBe(0);
    expect(encoded).not.toContain("</script");
  });

  it("exposes the install panel wiring for the detail page", () => {
    expect(typeof installPanel).toBe("function");
  });
});
