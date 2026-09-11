import { sum } from "./src/sum.ts";

const cases: Array<[number, number, number]> = [
  [2, 3, 5],
  [0, 0, 0],
  [-1, 1, 0],
  [10, -4, 6],
];

let failed = 0;
for (const [a, b, expected] of cases) {
  const actual = sum(a, b);
  if (actual !== expected) {
    console.error(`sum(${a}, ${b}) = ${actual}, expected ${expected}`);
    failed += 1;
  }
}
if (failed > 0) {
  console.error(`${failed} case(s) failed`);
  process.exit(1);
}
console.log("all cases passed");
