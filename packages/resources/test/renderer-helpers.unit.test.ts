import { describe, expect, test } from "bun:test";
import Handlebars from "handlebars";
import {
  codeSpan,
  continuationIndent,
  escapeProse,
  fencedCode,
  indentExceptFirst,
  inTableCell,
  linePrefix,
  linkDestination,
  listItemMarker,
  prefixLines,
  repeatText,
  tableAlignments,
} from "../src/renderer-helpers.js";

describe("repeatText", () => {
  test("repeats a fragment count times", () => {
    expect(repeatText("#", 3)).toBe("###");
    expect(repeatText("ab", 2)).toBe("abab");
  });

  test("returns an empty string for counts below one", () => {
    expect(repeatText("#", 0)).toBe("");
    expect(repeatText("#", -2)).toBe("");
  });
});

describe("prefixLines", () => {
  test("prefixes every line including empty ones", () => {
    expect(prefixLines("a\n\nb", "> ")).toBe("> a\n> \n> b");
  });

  test("keeps a trailing line boundary", () => {
    expect(prefixLines("a\n", "- ")).toBe("- a\n- ");
  });
});

describe("escapeProse", () => {
  test("escapes characters that form inline constructs", () => {
    expect(escapeProse("a *b* _c_ `d` [e](f) <g>")).toBe(
      "a \\*b\\* \\_c\\_ \\`d\\` \\[e\\](f) \\<g>",
    );
  });

  test("escapes backslashes first", () => {
    expect(escapeProse("a\\*b")).toBe("a\\\\\\*b");
  });

  test("escapes ! everywhere to protect image syntax", () => {
    expect(escapeProse("Hi!")).toBe("Hi\\!");
  });

  test("escapes quotes and strikethrough delimiters", () => {
    expect(escapeProse('say "hi" ~~not strike~~')).toBe(
      'say \\"hi\\" \\~\\~not strike\\~\\~',
    );
  });

  test("escapes entity-like ampersands only", () => {
    expect(escapeProse("R&D and AT&T")).toBe("R&D and AT&T");
    expect(escapeProse("&#65; &x; &")).toBe("\\&#65; \\&x; &");
  });

  test("escapes line-start-sensitive characters at line starts only", () => {
    expect(escapeProse("a\n- b\n+ c")).toBe("a\n\\- b\n\\+ c");
    expect(escapeProse("a - b")).toBe("a - b");
    expect(escapeProse("#x\n#y")).toBe("\\#x\n\\#y");
    expect(escapeProse("a\n> quote")).toBe("a\n\\> quote");
    expect(escapeProse("a\n= b")).toBe("a\n\\= b");
  });

  test("escapes ordered-list markers at line starts", () => {
    expect(escapeProse("a\n1. x")).toBe("a\n1\\. x");
    expect(escapeProse("a\n12) x")).toBe("a\n12\\) x");
    expect(escapeProse("1. x")).toBe("1\\. x");
  });
});

describe("table-context escaping", () => {
  const tableData = { data: Handlebars.createFrame({ gfmTable: true }) };

  test("escapeProse escapes pipes inside table cells", () => {
    expect(escapeProse("a|b", tableData)).toBe("a\\|b");
    expect(escapeProse("a|b")).toBe("a|b");
  });

  test("codeSpan escapes pipes inside table cells only", () => {
    expect(codeSpan("a|b", tableData)).toBe("`a\\|b`");
    expect(codeSpan("a|b")).toBe("`a|b`");
  });
});

describe("block helpers", () => {
  test("linePrefix prefixes every line of the block output", () => {
    const output = linePrefix("> ", {
      fn: () => "para one\n\npara two",
    } as never);
    expect(output).toBe("> para one\n> \n> para two");
  });

  test("indentExceptFirst leaves the first line at the marker", () => {
    const output = indentExceptFirst("  ", {
      fn: () => "first line\nsecond\n\nthird",
    } as never);
    expect(output).toBe("first line\n  second\n  \n  third");
  });

  test("inTableCell exposes the gfmTable flag through the data frame", () => {
    let seen: unknown;
    inTableCell({
      fn: (_context: unknown, options: { data?: { gfmTable?: boolean } }) => {
        seen = options.data?.gfmTable;
        return "cell";
      },
    } as never);
    expect(seen).toBe(true);
  });
});

describe("codeSpan", () => {
  test("wraps simple values in single backticks", () => {
    expect(codeSpan("bun install")).toBe("`bun install`");
  });

  test("widens the delimiter past embedded backtick runs", () => {
    expect(codeSpan("a `b` c")).toBe("``a `b` c``");
    expect(codeSpan("a ```b")).toBe("````a ```b````");
  });

  test("pads values that start or end with a backtick", () => {
    expect(codeSpan("`a")).toBe("`` `a ``");
    expect(codeSpan("a`")).toBe("`` a` ``");
  });

  test("renders the empty code span", () => {
    expect(codeSpan("")).toBe("`` ``");
  });
});

describe("fencedCode", () => {
  test("emits a fenced block with info string and trailing newline", () => {
    expect(fencedCode("const value = 1;", "ts", 'title="x"')).toBe(
      '```ts title="x"\nconst value = 1;\n```',
    );
  });

  test("omits absent info parts and terminates unterminated values", () => {
    expect(fencedCode("plain")).toBe("```\nplain\n```");
    expect(fencedCode("a\nb")).toBe("```\na\nb\n```");
  });

  test("widens the fence past embedded backtick runs", () => {
    expect(fencedCode("```\ninner")).toBe("````\n```\ninner\n````");
    expect(fencedCode("x````y")).toBe("`````\nx````y\n`````");
  });
});

describe("linkDestination", () => {
  test("passes plain destinations through", () => {
    expect(linkDestination("https://atlante.sh/guide")).toBe(
      "https://atlante.sh/guide",
    );
  });

  test("wraps destinations with whitespace or delimiters in angle brackets", () => {
    expect(linkDestination("./my file.md")).toBe("<./my file.md>");
    expect(linkDestination("a(1).md")).toBe("<a(1).md>");
    expect(linkDestination("a<b.md")).toBe("<a\\<b.md>");
  });

  test("escapes pipes in table-cell destinations", () => {
    const tableData = { data: Handlebars.createFrame({ gfmTable: true }) };
    expect(linkDestination("a|b", tableData)).toBe("<a\\|b>");
    expect(linkDestination("a|b")).toBe("a|b");
  });
});

describe("listItemMarker", () => {
  test("renders unordered markers", () => {
    expect(listItemMarker(0, 1, false)).toBe("- ");
    expect(listItemMarker(2, 1, false)).toBe("- ");
  });

  test("numbers ordered items from the list start", () => {
    expect(listItemMarker(0, 1, true)).toBe("1. ");
    expect(listItemMarker(3, 1, true)).toBe("4. ");
    expect(listItemMarker(1, 5, true)).toBe("6. ");
    expect(listItemMarker(0, undefined, true)).toBe("1. ");
  });
});

describe("tableAlignments", () => {
  test("matches the header width and pads missing alignments", () => {
    const rows = [{ children: [{}, {}] }];
    expect(tableAlignments(["left", "right", "center"], rows)).toEqual([
      "left",
      "right",
    ]);
    expect(tableAlignments(["center"], rows)).toEqual(["center", null]);
  });
});

describe("continuationIndent", () => {
  test("scales with the marker width", () => {
    expect(continuationIndent("- ")).toBe("  ");
    expect(continuationIndent("10. ")).toBe("    ");
    expect(continuationIndent("1. ")).toBe("   ");
  });
});
