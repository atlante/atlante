import { expect, test } from "vitest";

test("fails only when qualification explicitly requests the failing suite", () => {
  expect(process.env.ATLANTE_QUALIFICATION_FAILING_TEST).toBeUndefined();
});
