import { canDelete } from "./src/app.ts";

const cases: Array<[string, boolean]> = [
  ["admin", true],
  ["editor", false],
  ["viewer", false],
];

let failed = 0;
for (const [role, expected] of cases) {
  const actual = canDelete({ name: "case-user", role });
  if (actual !== expected) {
    console.error(`canDelete(${role}) = ${actual}, expected ${expected}`);
    failed += 1;
  }
}
if (failed > 0) {
  console.error(`${failed} case(s) failed`);
  process.exit(1);
}
console.log("all cases passed");
