export function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i < end; i += 1) {
    out.push(i);
  }
  return out;
}
