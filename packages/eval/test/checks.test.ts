import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecks } from "../src/checks.js";
import type { Sandbox } from "../src/sandbox.js";

function fakeSandbox(files: Record<string, string>): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "eval-checks-"));
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, content);
  }
  return {
    root,
    snapshot: Object.keys(files).map((path) => ({
      path,
      hash: "baseline",
    })),
    baseline: "",
    keep: false,
  };
}

const cleanup: string[] = [];
function sandboxOf(files: Record<string, string>): Sandbox {
  const sandbox = fakeSandbox(files);
  cleanup.push(sandbox.root);
  return sandbox;
}

afterAll(() => {
  for (const root of cleanup) rmSync(root, { recursive: true, force: true });
});

describe("runChecks", () => {
  test("command checks run with an allowlisted environment", async () => {
    const marker = "ATLANTE_EVAL_CHECK_SECRET";
    const previous = process.env[marker];
    process.env[marker] = "must-not-reach-check";
    try {
      const sandbox = sandboxOf({});
      const [result] = await runChecks(sandbox, [
        {
          type: "command",
          run: ["sh", "-c", `test -z "$${marker}"`],
          expectExit: 0,
          timeoutMs: 5000,
        },
      ]);
      expect(result?.verdict).toBe("pass");
    } finally {
      if (previous === undefined) delete process.env[marker];
      else process.env[marker] = previous;
    }
  });

  test("diff checks disable repository fsmonitor commands", async () => {
    const root = mkdtempSync(join(tmpdir(), "eval-diff-fsmonitor-"));
    cleanup.push(root);
    const canary = join(root, "fsmonitor-ran");
    const fsmonitor = join(root, "fsmonitor.sh");
    writeFileSync(fsmonitor, `#!/bin/sh\ntouch '${canary}'\n`);
    chmodSync(fsmonitor, 0o755);
    const git = async (argv: string[]) => {
      await Bun.$`git ${argv}`.cwd(root).quiet();
    };
    await git(["init"]);
    await git(["-c", "user.name=t", "-c", "user.email=t@t", "add", "--all"]);
    await git([
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "--allow-empty",
      "-m",
      "base",
    ]);
    await git(["config", "core.fsmonitor", fsmonitor]);
    const baseline = (await Bun.$`git rev-parse HEAD`.cwd(root).text()).trim();

    const [result] = await runChecks(
      { root, snapshot: [], baseline, keep: false },
      [{ type: "diff-allowlist", allow: ["allowed.ts"] }],
    );
    expect(result?.verdict).toBe("pass");
    expect(existsSync(canary)).toBe(false);
  });

  test("command check: exit code and output match", async () => {
    const sandbox = sandboxOf({});
    const results = await runChecks(sandbox, [
      { type: "command", run: ["true"], expectExit: 0, timeoutMs: 5000 },
      { type: "command", run: ["false"], expectExit: 0, timeoutMs: 5000 },
      {
        type: "command",
        run: ["echo", "hello-world"],
        expectExit: 0,
        outputMatches: "hello-wo?rld",
        timeoutMs: 5000,
      },
      {
        type: "command",
        run: ["echo", "other"],
        expectExit: 0,
        outputMatches: "expected-text",
        timeoutMs: 5000,
      },
      { type: "command", run: ["sleep", "5"], expectExit: 0, timeoutMs: 250 },
    ]);
    expect(results.map((result) => result.verdict)).toEqual([
      "pass",
      "fail",
      "pass",
      "fail",
      "fail",
    ]);
    expect(results[4]?.evidence.timedOut).toBe(true);
  });

  test("a command that exits cleanly after timeout still fails", async () => {
    const sandbox = sandboxOf({});
    const [result] = await runChecks(sandbox, [
      {
        type: "command",
        run: ["sh", "-c", "trap 'exit 0' TERM; while :; do sleep 1; done"],
        expectExit: 0,
        timeoutMs: 100,
      },
    ]);
    expect(result?.verdict).toBe("fail");
    expect(result?.evidence.timedOut).toBe(true);
  });

  test("file checks do not follow host-created symlinks", async () => {
    const sandbox = sandboxOf({});
    const outside = mkdtempSync(join(tmpdir(), "eval-checks-outside-"));
    writeFileSync(join(outside, "secret.txt"), "secret\n");
    symlinkSync(outside, join(sandbox.root, "link"), "dir");
    try {
      const results = await runChecks(sandbox, [
        { type: "file-exists", path: "link/secret.txt" },
        { type: "file-contains", path: "link/secret.txt", pattern: "secret" },
        { type: "file-unchanged", path: "link/secret.txt" },
      ]);
      expect(results.map((result) => result.verdict)).toEqual([
        "error",
        "error",
        "error",
      ]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
      rmSync(join(sandbox.root, "link"), { force: true });
    }
  });

  test("command check: spawn failure is an error verdict", async () => {
    const sandbox = sandboxOf({});
    const [result] = await runChecks(sandbox, [
      {
        type: "command",
        run: ["definitely-not-a-binary-xyz"],
        expectExit: 0,
        timeoutMs: 5000,
      },
    ]);
    expect(result?.verdict).toBe("error");
  });

  test("file-exists and file-absent", async () => {
    const sandbox = sandboxOf({ "src/keep.ts": "export {};\n" });
    const results = await runChecks(sandbox, [
      { type: "file-exists", path: "src/keep.ts" },
      { type: "file-exists", path: "src/gone.ts" },
      { type: "file-absent", path: "src/gone.ts" },
      { type: "file-absent", path: "src/keep.ts" },
    ]);
    expect(results.map((result) => result.verdict)).toEqual([
      "pass",
      "fail",
      "pass",
      "fail",
    ]);
  });

  test("file-contains: literal by default, regex opt-in", async () => {
    const sandbox = sandboxOf({ "src/a.ts": "const requireAdmin = true;\n" });
    const results = await runChecks(sandbox, [
      { type: "file-contains", path: "src/a.ts", pattern: "requireAdmin" },
      {
        type: "file-contains",
        path: "src/a.ts",
        pattern: "require.dmin",
        regex: true,
      },
      { type: "file-contains", path: "src/a.ts", pattern: "nope" },
      { type: "file-contains", path: "src/gone.ts", pattern: "x" },
    ]);
    expect(results.map((result) => result.verdict)).toEqual([
      "pass",
      "pass",
      "fail",
      "fail",
    ]);
  });

  test("file-unchanged compares against the baseline snapshot", async () => {
    const sandbox = sandboxOf({
      "src/policy.ts": "export const policy = 1;\n",
    });
    // Baseline recorded as "baseline"; content changed since -> hash differs.
    const [violated] = await runChecks(sandbox, [
      { type: "file-unchanged", path: "src/policy.ts" },
    ]);
    expect(violated?.verdict).toBe("fail");

    // Recompute the baseline to the current content: now unchanged.
    const { createHash } = await import("node:crypto");
    const { readFileSync } = await import("node:fs");
    sandbox.snapshot = [
      {
        path: "src/policy.ts",
        hash: createHash("sha256")
          .update(readFileSync(join(sandbox.root, "src/policy.ts")))
          .digest("hex"),
      },
      { path: "src/absent.ts", hash: null },
      { path: "src/created-later.ts", hash: null },
    ];
    const [unchanged, stillAbsent, _absentNow] = await runChecks(sandbox, [
      { type: "file-unchanged", path: "src/policy.ts" },
      { type: "file-unchanged", path: "src/absent.ts" },
      { type: "file-unchanged", path: "src/created-later.ts" },
    ]);
    expect(unchanged?.verdict).toBe("pass");
    expect(stillAbsent?.verdict).toBe("pass");
    // Created after the baseline (hash was null) -> violation. The write must
    // precede the check run: the check reads current state only.
    writeFileSync(join(sandbox.root, "src/created-later.ts"), "new\n");
    const [createdAfterBaseline] = await runChecks(sandbox, [
      { type: "file-unchanged", path: "src/created-later.ts" },
    ]);
    expect(createdAfterBaseline?.verdict).toBe("fail");
  });

  test("file-unchanged reports read errors and continues with later checks", async () => {
    const sandbox = sandboxOf({ "secret.txt": "secret\n" });
    const path = join(sandbox.root, "secret.txt");
    chmodSync(path, 0o000);
    try {
      const results = await runChecks(sandbox, [
        { type: "file-unchanged", path: "secret.txt" },
        { type: "file-exists", path: "secret.txt" },
      ]);
      expect(results.map((result) => result.verdict)).toEqual([
        "error",
        "pass",
      ]);
    } finally {
      chmodSync(path, 0o644);
    }
  });

  test("diff-allowlist: porcelain output is matched against the allowlist", async () => {
    const root = mkdtempSync(join(tmpdir(), "eval-diff-"));
    cleanup.push(root);
    const git = async (argv: string[]) => {
      await Bun.$`git ${argv}`.cwd(root).quiet();
    };
    await git(["init"]);
    await git(["-c", "user.name=t", "-c", "user.email=t@t", "add", "--all"]);
    await git([
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "--allow-empty",
      "-m",
      "base",
    ]);
    writeFileSync(join(root, "allowed.ts"), "ok\n");
    writeFileSync(join(root, "sneaky.ts"), "scope creep\n");
    const baseline = (await Bun.$`git rev-parse HEAD`.cwd(root).text()).trim();
    const sandbox: Sandbox = { root, snapshot: [], baseline, keep: false };

    const [tooNarrow, wellScoped] = await runChecks(sandbox, [
      { type: "diff-allowlist", allow: ["allowed.ts"] },
      { type: "diff-allowlist", allow: ["allowed.ts", "sneaky.ts"] },
    ]);
    expect(tooNarrow?.verdict).toBe("fail");
    expect(tooNarrow?.evidence.unexpected).toEqual(["sneaky.ts"]);
    expect(wellScoped?.verdict).toBe("pass");
  });

  test("diff-allowlist: detects newly created ignored files", async () => {
    const root = mkdtempSync(join(tmpdir(), "eval-diff-ignored-"));
    cleanup.push(root);
    writeFileSync(join(root, ".gitignore"), "ignored-*.ts\n");
    writeFileSync(join(root, "ignored-before.ts"), "baseline\n");
    const git = async (argv: string[]) => {
      await Bun.$`git ${argv}`.cwd(root).quiet();
    };
    await git(["init"]);
    await git(["add", "--all", "--force"]);
    await git([
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "--allow-empty",
      "-m",
      "base",
    ]);
    writeFileSync(join(root, "ignored-after.ts"), "scope creep\n");
    const baseline = (await Bun.$`git rev-parse HEAD`.cwd(root).text()).trim();

    const [result] = await runChecks(
      { root, snapshot: [], baseline, keep: false },
      [{ type: "diff-allowlist", allow: ["allowed.ts"] }],
    );
    expect(result?.verdict).toBe("fail");
    expect(result?.evidence.unexpected).toContain("ignored-after.ts");
  });

  test("diff-allowlist: ignores host-owned .opencode artifacts", async () => {
    const root = mkdtempSync(join(tmpdir(), "eval-diff-host-"));
    cleanup.push(root);
    const git = async (argv: string[]) => {
      await Bun.$`git ${argv}`.cwd(root).quiet();
    };
    await git(["init"]);
    await git(["-c", "user.name=t", "-c", "user.email=t@t", "add", "--all"]);
    await git([
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "--allow-empty",
      "-m",
      "base",
    ]);
    // OpenCode installs plugin node_modules and its own .gitignore into the
    // project's .opencode dir during the session; none of that is an edit.
    mkdirSync(join(root, ".opencode", "node_modules"), { recursive: true });
    writeFileSync(join(root, ".opencode", ".gitignore"), "node_modules\n");
    writeFileSync(join(root, ".opencode", "node_modules", "pkg.js"), "x\n");
    const baseline = (await Bun.$`git rev-parse HEAD`.cwd(root).text()).trim();

    const [hostOnly] = await runChecks(
      { root, snapshot: [], baseline, keep: false },
      [{ type: "diff-allowlist", allow: ["allowed.ts"] }],
    );
    expect(hostOnly?.verdict).toBe("pass");

    // A real out-of-scope edit next to the host noise is still flagged.
    writeFileSync(join(root, "sneaky.ts"), "scope creep\n");
    const [withCreep] = await runChecks(
      { root, snapshot: [], baseline, keep: false },
      [{ type: "diff-allowlist", allow: ["allowed.ts"] }],
    );
    expect(withCreep?.verdict).toBe("fail");
    expect(withCreep?.evidence.unexpected).toEqual(["sneaky.ts"]);
  });

  test("diff-allowlist: preserves special-character paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "eval-diff-special-"));
    cleanup.push(root);
    const git = async (argv: string[]) => {
      await Bun.$`git ${argv}`.cwd(root).quiet();
    };
    await git(["init"]);
    await git([
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "--allow-empty",
      "-m",
      "base",
    ]);
    const paths = ['quote"name.ts', "tab\tname.ts", "space name.ts"];
    for (const path of paths) writeFileSync(join(root, path), "scope\n");
    const baseline = (await Bun.$`git rev-parse HEAD`.cwd(root).text()).trim();

    const [result] = await runChecks(
      { root, snapshot: [], baseline, keep: false },
      [{ type: "diff-allowlist", allow: paths }],
    );
    expect(result?.verdict).toBe("pass");
  });

  test("diff-allowlist: detects changes hidden by index flags", async () => {
    const root = mkdtempSync(join(tmpdir(), "eval-diff-index-flags-"));
    cleanup.push(root);
    const trackedPath = "--tracked.ts";
    writeFileSync(join(root, trackedPath), "baseline\n");
    const git = async (argv: string[]) => {
      await Bun.$`git ${argv}`.cwd(root).quiet();
    };
    await git(["init"]);
    await git(["add", "--all"]);
    await git([
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "--allow-empty",
      "-m",
      "base",
    ]);
    const baseline = (await Bun.$`git rev-parse HEAD`.cwd(root).text()).trim();

    for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
      await git(["update-index", flag, "--", trackedPath]);
      writeFileSync(join(root, trackedPath), `${flag} changed\n`);
      const [result] = await runChecks(
        { root, snapshot: [], baseline, keep: false },
        [{ type: "diff-allowlist", allow: ["allowed.ts"] }],
      );
      expect(result?.verdict).toBe("fail");
      expect(result?.evidence.unexpected).toContain(trackedPath);
      await git([
        "update-index",
        "--no-assume-unchanged",
        "--no-skip-worktree",
        "--",
        trackedPath,
      ]);
    }
  });

  test("diff-allowlist: matches non-ASCII paths literally", async () => {
    const root = mkdtempSync(join(tmpdir(), "eval-diff-unicode-"));
    cleanup.push(root);
    const git = async (argv: string[]) => {
      await Bun.$`git ${argv}`.cwd(root).quiet();
    };
    await git(["init"]);
    await git([
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "--allow-empty",
      "-m",
      "base",
    ]);
    writeFileSync(join(root, "allowed.ts"), "ok\n");
    // Without core.quotePath=false git C-quotes non-ASCII paths, which would
    // both false-fail the allowlist and leak quoted evidence into the report.
    writeFileSync(join(root, "案результат.txt"), "scope creep\n");
    const baseline = (await Bun.$`git rev-parse HEAD`.cwd(root).text()).trim();
    const [result] = await runChecks(
      { root, snapshot: [], baseline, keep: false },
      [{ type: "diff-allowlist", allow: ["allowed.ts", "案результат.txt"] }],
    );
    // Passes only if the literal (unquoted) path matched the allowlist.
    expect(result?.verdict).toBe("pass");
  });

  test("all checks run even after one fails", async () => {
    const sandbox = sandboxOf({});
    const results = await runChecks(sandbox, [
      { type: "file-exists", path: "missing.ts" },
      { type: "file-exists", path: "also-missing.ts" },
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.verdict === "fail")).toBe(true);
  });

  test("check paths cannot traverse out of the sandbox", async () => {
    const sandbox = sandboxOf({});
    for (const path of ["../escape.ts", "/etc/passwd", "ok/../../escape.ts"]) {
      const [result] = await runChecks(sandbox, [
        { type: "file-exists", path },
      ]);
      expect(result?.verdict).toBe("error");
      expect(JSON.stringify(result?.evidence)).toContain(
        "must resolve inside the sandbox",
      );
    }
  });

  test("an invalid outputMatches pattern is an error, not a throw", async () => {
    const sandbox = sandboxOf({});
    const [result] = await runChecks(sandbox, [
      {
        type: "command",
        run: ["true"],
        expectExit: 0,
        outputMatches: "([unclosed",
        timeoutMs: 5000,
      },
    ]);
    expect(result?.verdict).toBe("error");
    expect(JSON.stringify(result?.evidence)).toContain("outputMatches");
  });
});
