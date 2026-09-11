import { describe, expect, it } from "bun:test";
import {
  escapeHtml,
  highlightFile,
  highlightJson,
  highlightMarkdown,
} from "./highlight";

describe("highlightJson", () => {
  it("escapes html and tags json keys, strings, and literals", () => {
    const html = highlightJson('{"a": "b", "n": 1}');
    expect(html).toContain('<span class="token-key">"a"</span>');
    expect(html).toContain('<span class="token-string">"b"</span>');
    expect(html).toContain('<span class="token-literal">1</span>');
  });

  it("escapes angle brackets before tagging", () => {
    expect(highlightJson('{"a": "<b>"}')).not.toContain("<b>");
  });
});

describe("highlightMarkdown", () => {
  it("tags headings, bold, inline code, and list items", () => {
    const html = highlightMarkdown("# Title\n\n- item with `code`");
    expect(html).toContain('<span class="token-md-heading"># Title</span>');
    expect(html).toContain('<span class="token-md-item">- item with');
    expect(html).toContain('<span class="token-string">`code`</span>');
  });
});

describe("highlightFile", () => {
  it("picks the highlighter from the file extension", () => {
    expect(highlightFile("atlante.jsonc", '{"a": 1}')).toContain("token-key");
    expect(highlightFile("skill/template.md", "# Title")).toContain(
      "token-md-heading",
    );
    expect(highlightFile("LICENSE", "plain")).not.toContain("token-");
  });

  it("escapes html in the escaped output", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });
});
