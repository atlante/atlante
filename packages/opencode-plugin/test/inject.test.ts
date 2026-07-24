import { describe, expect, test } from "bun:test";
import type { AgentArtifact } from "@atlante/resolver";
import type { HostConfig } from "../src/index.ts";
import { injectAgents } from "../src/inject.ts";

const artifacts: AgentArtifact[] = [
  { hostAgentId: "reviewer", templateId: "atlante/agent", prompt: "PROMPT" },
];

describe("injectAgents", () => {
  test("creates a missing agent with host defaults", () => {
    const config: HostConfig = {};
    const diagnostics = injectAgents(config, artifacts);
    expect(diagnostics).toEqual([]);
    expect(config.agent?.reviewer).toEqual({ prompt: "PROMPT" });
  });

  test("injects __proto__ as an own agent without changing the agent map prototype", () => {
    const config: HostConfig = { agent: {} };
    const prototype = Object.getPrototypeOf(config.agent);
    injectAgents(config, [
      { hostAgentId: "__proto__", templateId: "atlante/agent", prompt: "P" },
    ]);
    expect(Object.getPrototypeOf(config.agent)).toBe(prototype);
    expect(Object.hasOwn(config.agent ?? {}, "__proto__")).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(config.agent ?? {}, "__proto__")?.value,
    ).toEqual({ prompt: "P" });
  });

  test("preserves host-owned fields on an existing agent", () => {
    const config: HostConfig = {
      agent: {
        reviewer: {
          model: "anthropic/claude-sonnet-5",
          mode: "subagent",
          permission: { edit: "deny" },
        },
      },
    };
    injectAgents(config, artifacts);
    expect(config.agent?.reviewer).toEqual({
      model: "anthropic/claude-sonnet-5",
      mode: "subagent",
      permission: { edit: "deny" },
      prompt: "PROMPT",
    });
  });

  test("warns when replacing a non-empty existing prompt", () => {
    const config: HostConfig = { agent: { reviewer: { prompt: "OLD" } } };
    const diagnostics = injectAgents(config, artifacts);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("warning");
    expect(diagnostics[0]?.code).toBe("prompt-replaced");
    expect(config.agent?.reviewer?.prompt).toBe("PROMPT");
  });

  test("does not warn when the existing prompt is empty", () => {
    const config: HostConfig = { agent: { reviewer: { prompt: "" } } };
    expect(injectAgents(config, artifacts)).toEqual([]);
  });

  test("leaves unrelated agents untouched", () => {
    const config: HostConfig = { agent: { other: { model: "x" } } };
    injectAgents(config, artifacts);
    expect(config.agent?.other).toEqual({ model: "x" });
  });

  test("is idempotent", () => {
    const config: HostConfig = {};
    injectAgents(config, artifacts);
    const second = injectAgents(config, artifacts);
    expect(second[0]?.code).toBe("prompt-replaced");
    expect(config.agent?.reviewer?.prompt).toBe("PROMPT");
  });
});
