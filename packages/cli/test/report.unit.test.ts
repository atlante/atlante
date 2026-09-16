import { describe, expect, test } from "bun:test";
import { printDiagnostic, reportBuildResult } from "../src/report.js";

type MutableStream = { isTTY?: boolean };

function forceInteractive(stream: MutableStream): () => void {
  const previous = stream.isTTY;
  Object.defineProperty(stream, "isTTY", {
    value: true,
    configurable: true,
    writable: true,
  });
  return () => {
    if (previous === undefined) delete stream.isTTY;
    else stream.isTTY = previous;
  };
}

/** Forces the styled branch regardless of how the tests run. */
function withColor(run: () => void): void {
  const stdout = process.stdout as MutableStream;
  const stderr = process.stderr as MutableStream;
  const restoreStdout = forceInteractive(stdout);
  const restoreStderr = forceInteractive(stderr);
  const previousNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    run();
  } finally {
    restoreStdout();
    restoreStderr();
    if (previousNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previousNoColor;
  }
}

/** Forces the plain branch regardless of how the tests run. */
function withPlain(run: () => void): void {
  const previousNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    run();
  } finally {
    if (previousNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previousNoColor;
  }
}

function captureConsole(method: "log" | "error"): {
  lines: string[];
  restore: () => void;
} {
  const lines: string[] = [];
  const original = console[method];
  console[method] = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  return {
    lines,
    restore: () => {
      console[method] = original;
    },
  };
}

const errorDiagnostic = {
  severity: "error" as const,
  code: "some-code",
  message: "boom",
  source: "atlante.jsonc",
  location: { line: 1, column: 2 },
  next: "fix it",
};

const warningDiagnostic = {
  severity: "warning" as const,
  code: "some-code",
  message: "careful",
};

const materializations = [
  {
    host: "opencode",
    writtenPaths: [".opencode/agents/atlante.md"],
    removedPaths: [".opencode/skills/old/SKILL.md"],
  },
];

describe("printDiagnostic styling", () => {
  test("colors the error severity word on an interactive stream", () => {
    const { lines, restore } = captureConsole("error");
    try {
      withColor(() => printDiagnostic(errorDiagnostic));
    } finally {
      restore();
    }
    expect(lines).toEqual([
      "\x1b[31merror\x1b[0m [some-code]: boom\nat: atlante.jsonc:1:2\nnext: fix it",
    ]);
  });

  test("colors the warning severity word on an interactive stream", () => {
    const { lines, restore } = captureConsole("error");
    try {
      withColor(() => printDiagnostic(warningDiagnostic));
    } finally {
      restore();
    }
    expect(lines).toEqual(["\x1b[33mwarning\x1b[0m [some-code]: careful"]);
  });

  test("keeps diagnostics plain on a non-interactive stream", () => {
    const { lines, restore } = captureConsole("error");
    try {
      withPlain(() => printDiagnostic(errorDiagnostic));
    } finally {
      restore();
    }
    expect(lines).toEqual([
      "error [some-code]: boom\nat: atlante.jsonc:1:2\nnext: fix it",
    ]);
  });
});

describe("reportBuildResult styling", () => {
  test("colors materialization verbs and dims paths on an interactive stream", () => {
    const { lines, restore } = captureConsole("log");
    let wrote: unknown;
    try {
      withColor(() => {
        wrote = reportBuildResult({ diagnostics: [], materializations });
      });
    } finally {
      restore();
    }
    expect(wrote).toBe(true);
    expect(lines).toEqual([
      "\x1b[32mwrote\x1b[0m opencode: \x1b[90m.opencode/agents/atlante.md\x1b[0m",
      "\x1b[32mremoved\x1b[0m opencode: \x1b[90m.opencode/skills/old/SKILL.md\x1b[0m",
    ]);
  });

  test("keeps materialization lines plain on a non-interactive stream", () => {
    const { lines, restore } = captureConsole("log");
    let wrote: unknown;
    try {
      withPlain(() => {
        wrote = reportBuildResult({ diagnostics: [], materializations });
      });
    } finally {
      restore();
    }
    expect(wrote).toBe(true);
    expect(lines).toEqual([
      "wrote opencode: .opencode/agents/atlante.md",
      "removed opencode: .opencode/skills/old/SKILL.md",
    ]);
  });

  test("reports error diagnostics and writes nothing on failure", () => {
    const logs = captureConsole("log");
    const errors = captureConsole("error");
    let wrote: unknown;
    try {
      withColor(() => {
        wrote = reportBuildResult({
          diagnostics: [errorDiagnostic],
          materializations,
        });
      });
    } finally {
      logs.restore();
      errors.restore();
    }
    expect(wrote).toBe(false);
    expect(logs.lines).toEqual([]);
    expect(errors.lines).toEqual([
      "\x1b[31merror\x1b[0m [some-code]: boom\nat: atlante.jsonc:1:2\nnext: fix it",
    ]);
  });

  test("labels planned paths as a preview in dryRun", () => {
    const { lines, restore } = captureConsole("log");
    let wrote: unknown;
    try {
      withPlain(() => {
        wrote = reportBuildResult(
          { diagnostics: [], materializations },
          { dryRun: true },
        );
      });
    } finally {
      restore();
    }
    expect(wrote).toBe(true);
    expect(lines).toEqual([
      "would write opencode: .opencode/agents/atlante.md",
      "would remove opencode: .opencode/skills/old/SKILL.md",
    ]);
  });

  test("colors preview verbs on an interactive stream", () => {
    const { lines, restore } = captureConsole("log");
    try {
      withColor(() => {
        reportBuildResult(
          { diagnostics: [], materializations },
          { dryRun: true },
        );
      });
    } finally {
      restore();
    }
    expect(lines).toEqual([
      "\x1b[32mwould write\x1b[0m opencode: \x1b[90m.opencode/agents/atlante.md\x1b[0m",
      "\x1b[32mwould remove\x1b[0m opencode: \x1b[90m.opencode/skills/old/SKILL.md\x1b[0m",
    ]);
  });
});
