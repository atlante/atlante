import { range } from "./src/range.ts";

const actual = range(0, 3).join(",");
if (actual !== "0,1,2,3") {
  console.error(`range(0, 3) = [${actual}], expected [0,1,2,3]`);
  process.exit(1);
}
console.log("range case passed");
