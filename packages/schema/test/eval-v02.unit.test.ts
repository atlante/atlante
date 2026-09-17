import { describe, expect, test } from "bun:test";
import {
  atlanteDocumentSchema,
  atlanteDocumentV02Schema,
  evalConfigSchema,
  evalConfigV02Schema,
  evalPackConfigSchema,
  evalPackConfigV02Schema,
  SCHEMA_URI,
  SCHEMA_URI_V02,
} from "../src/index.js";

// Issue #207 Task 1: eval host selection is versioned with the document.
// v0.1 admits only opencode; v0.2 also admits claude-code.
describe("versioned eval host selection", () => {
  test("v0.1 project eval still admits only opencode", () => {
    expect(
      evalConfigSchema.safeParse({
        host: "opencode",
        scenarios: "eval/scenarios/*.eval.json",
      }).success,
    ).toBe(true);
    expect(
      evalConfigSchema.safeParse({
        host: "claude-code",
        scenarios: "eval/scenarios/*.eval.json",
      }).success,
    ).toBe(false);
  });

  test("v0.2 project eval admits both hosts", () => {
    for (const host of ["opencode", "claude-code"]) {
      expect(
        evalConfigV02Schema.safeParse({
          host,
          scenarios: "eval/scenarios/*.eval.json",
        }).success,
      ).toBe(true);
      expect(
        evalConfigV02Schema.safeParse({ host, include: ["@acme/pack"] })
          .success,
      ).toBe(true);
    }
    expect(
      evalConfigV02Schema.safeParse({
        host: "claude",
        scenarios: "eval/scenarios/*.eval.json",
      }).success,
    ).toBe(false);
  });

  test("pack eval host metadata is versioned like the document", () => {
    expect(
      evalPackConfigSchema.safeParse({
        host: "opencode",
        scenarios: "eval/scenarios/*.eval.json",
      }).success,
    ).toBe(true);
    expect(
      evalPackConfigSchema.safeParse({
        host: "claude-code",
        scenarios: "eval/scenarios/*.eval.json",
      }).success,
    ).toBe(false);
    for (const host of ["opencode", "claude-code"]) {
      expect(
        evalPackConfigV02Schema.safeParse({
          host,
          scenarios: "eval/scenarios/*.eval.json",
        }).success,
      ).toBe(true);
    }
    expect(
      evalPackConfigV02Schema.safeParse({
        scenarios: "eval/scenarios/*.eval.json",
      }).success,
    ).toBe(true);
  });

  test("v0.2 canonical documents accept a claude-code eval host", () => {
    const result = atlanteDocumentV02Schema.safeParse({
      $schema: SCHEMA_URI_V02,
      hosts: ["claude-code"],
      eval: { host: "claude-code", scenarios: "eval/scenarios/*.eval.json" },
    });
    expect(result.success).toBe(true);
  });

  test("v0.1 canonical documents reject a claude-code eval host", () => {
    const result = atlanteDocumentSchema.safeParse({
      $schema: SCHEMA_URI,
      eval: { host: "claude-code", scenarios: "eval/scenarios/*.eval.json" },
    });
    expect(result.success).toBe(false);
  });
});
