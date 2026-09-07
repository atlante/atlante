import { describe, expect, it } from "bun:test";
import { parsePlaygroundRequest } from "./playground";
import { consumeSessionBuild, resetSessionBuilds } from "./session-budget";

const validRequest = {
  step: "build",
  sessionId: "test-session",
  files: [{ path: "atlante.jsonc", content: "{}" }],
};

describe("playground request contract", () => {
  it("accepts a build request with a session identifier", () => {
    expect(parsePlaygroundRequest(validRequest)).toEqual(validRequest);
  });

  it("rejects the retired init and validate steps", () => {
    for (const step of ["init", "validate"]) {
      expect(() => parsePlaygroundRequest({ ...validRequest, step })).toThrow(
        'step must be "build"',
      );
    }
  });

  it("requires a session identifier", () => {
    const { sessionId: _sessionId, ...withoutSession } = validRequest;
    expect(() => parsePlaygroundRequest(withoutSession)).toThrow(
      "sessionId must be a non-empty string",
    );
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
});
