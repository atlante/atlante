import { describe, expect, test } from "vitest";
import {
  compareIdentityReports,
  normalizeIdentity,
  type StoredIdentity,
} from "./suite-parity";

describe("suite identity parity", () => {
  test("normalizes a file and all ancestor titles", () => {
    expect(
      normalizeIdentity(
        {
          fileName: "/repo/packages/schema/test/document.test.ts",
          name: "document > rejects malformed input",
          status: "pass",
        },
        "/repo",
      ),
    ).toBe(
      "packages/schema/test/document.test.ts::document rejects malformed input",
    );
  });

  test("reports a changed identity as missing and extra", () => {
    const result = compareIdentityReports(
      [identity("packages/a.test.ts", "suite original")],
      [identity("packages/a.test.ts", "suite changed")],
    );

    expect(result).toEqual({
      status: "mismatch",
      expectedCount: 1,
      actualCount: 1,
      missing: ["packages/a.test.ts::suite original"],
      extra: ["packages/a.test.ts::suite changed"],
      statusMismatches: [],
    });
  });

  test("compares sorted reports and reports passing counts", () => {
    expect(
      compareIdentityReports(
        [identity("b", "suite test"), identity("a", "suite test")],
        [identity("a", "suite test"), identity("b", "suite test")],
      ),
    ).toEqual({
      status: "pass",
      expectedCount: 2,
      actualCount: 2,
      missing: [],
      extra: [],
      statusMismatches: [],
    });
  });

  test("does not collapse 12 repeated cases when one is missing or changed", () => {
    const expected = Array.from({ length: 12 }, () =>
      identity("packages/a.test.ts", "suite same case"),
    );
    const actual = expected
      .slice(0, 11)
      .concat([identity("packages/a.test.ts", "suite changed case")]);

    expect(compareIdentityReports(expected, actual)).toEqual({
      status: "mismatch",
      expectedCount: 12,
      actualCount: 12,
      missing: ["packages/a.test.ts::suite same case"],
      extra: ["packages/a.test.ts::suite changed case"],
      statusMismatches: [],
    });
  });

  test("reports a status change for an otherwise identical case", () => {
    expect(
      compareIdentityReports(
        [identity("a", "suite test", "pass")],
        [identity("a", "suite test", "fail")],
      ),
    ).toEqual({
      status: "mismatch",
      expectedCount: 1,
      actualCount: 1,
      missing: [],
      extra: [],
      statusMismatches: [
        {
          identity: "a::suite test",
          expected: "pass",
          actual: "fail",
        },
      ],
    });
  });
});

function identity(
  fileName: string,
  name: string,
  status: StoredIdentity["status"] = "pass",
): StoredIdentity {
  return { fileName, name, status };
}
