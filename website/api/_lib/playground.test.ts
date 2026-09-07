import { describe, expect, it } from "bun:test";
import { parsePlaygroundRequest, runPlaygroundStep } from "./playground";
import {
  consumeSessionBuild,
  resetSessionBuilds,
  resolvePlaygroundSession,
} from "./session-budget";

const validRequest = {
  step: "build",
  files: [{ path: "atlante.jsonc", content: "{}" }],
};

describe("playground request contract", () => {
  it("accepts a build request", () => {
    expect(parsePlaygroundRequest(validRequest)).toEqual(validRequest);
  });

  it("keeps the ownership manifest when generated output exceeds the cap", async () => {
    const agents = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => {
        const id = `agent-${String(index).padStart(2, "0")}`;
        return [
          id,
          {
            $template: "@atlante/pack/agent",
            description: `Agent ${index}`,
            identity: `You are agent ${index}.`,
            mission: "Test",
            sections: [{ invariants: ["Test"] }],
          },
        ];
      }),
    );
    const result = await runPlaygroundStep({
      step: "build",
      files: [
        {
          path: "atlante.jsonc",
          content: JSON.stringify({
            $schema: "https://atlante.sh/schema/v0.1/schema.json",
            values: { project: "many" },
            agents,
          }),
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(
      result.files.some(
        (file) => file.path === ".atlante/opencode-native.json",
      ),
    ).toBe(true);
  });

  it("rejects the retired init and validate steps", () => {
    for (const step of ["init", "validate"]) {
      expect(() => parsePlaygroundRequest({ ...validRequest, step })).toThrow(
        'step must be "build"',
      );
    }
  });
});

describe("playground session budget", () => {
  it("stops a session after its configured build limit", () => {
    resetSessionBuilds();
    expect(
      consumeSessionBuild("budget-session", { maxBuilds: 2, now: 100 }),
    ).toEqual({ allowed: true, remaining: 1 });
    expect(
      consumeSessionBuild("budget-session", { maxBuilds: 2, now: 101 }),
    ).toEqual({ allowed: true, remaining: 0 });
    expect(
      consumeSessionBuild("budget-session", { maxBuilds: 2, now: 102 }),
    ).toEqual({ allowed: false, remaining: 0 });
  });

  it("starts a fresh budget after the session expires", () => {
    resetSessionBuilds();
    expect(
      consumeSessionBuild("expired-session", { maxBuilds: 1, now: 100 }),
    ).toEqual({ allowed: true, remaining: 0 });
    expect(
      consumeSessionBuild("expired-session", {
        maxBuilds: 1,
        now: 30 * 60 * 1000 + 101,
      }),
    ).toEqual({ allowed: true, remaining: 0 });
  });

  it("bounds the number of tracked sessions", () => {
    resetSessionBuilds();
    consumeSessionBuild("first-session", {
      maxBuilds: 2,
      maxSessions: 2,
      now: 100,
    });
    consumeSessionBuild("second-session", {
      maxBuilds: 2,
      maxSessions: 2,
      now: 101,
    });
    consumeSessionBuild("third-session", {
      maxBuilds: 2,
      maxSessions: 2,
      now: 102,
    });

    expect(
      consumeSessionBuild("first-session", {
        maxBuilds: 2,
        maxSessions: 2,
        now: 103,
      }),
    ).toEqual({ allowed: true, remaining: 1 });
  });

  it("uses a signed cookie and address fallback for session identity", () => {
    resetSessionBuilds();
    const first = resolvePlaygroundSession(undefined, "127.0.0.1");
    expect(first.key).toBe("address:127.0.0.1");
    expect(first.fallbackKey).toBeUndefined();
    expect(first.setCookie).toContain("atlante_playground=");
    expect(consumeSessionBuild(first.key, { maxBuilds: 2, now: 100 })).toEqual({
      allowed: true,
      remaining: 1,
    });

    const cookie = first.setCookie.split(";")[0];
    const next = resolvePlaygroundSession(cookie, "127.0.0.1");
    expect(next.key.startsWith("session:")).toBe(true);
    expect(next.fallbackKey).toBe("address:127.0.0.1");
    expect(
      consumeSessionBuild(next.key, {
        fallbackKey: next.fallbackKey,
        maxBuilds: 2,
        now: 101,
      }),
    ).toEqual({ allowed: true, remaining: 0 });

    resetSessionBuilds();
    const anonymous = resolvePlaygroundSession(undefined, "203.0.113.1");
    expect(
      consumeSessionBuild(anonymous.key, {
        maxBuilds: 2,
        now: 200,
      }),
    ).toEqual({ allowed: true, remaining: 1 });
    const anonymousAgain = resolvePlaygroundSession(undefined, "203.0.113.1");
    expect(
      consumeSessionBuild(anonymousAgain.key, {
        maxBuilds: 2,
        now: 201,
      }),
    ).toEqual({ allowed: true, remaining: 0 });

    const forged = resolvePlaygroundSession(
      "atlante_playground=forged.signature",
      "127.0.0.1",
    );
    expect(forged.key).toBe("address:127.0.0.1");
    expect(forged.fallbackKey).toBeUndefined();
  });
});
