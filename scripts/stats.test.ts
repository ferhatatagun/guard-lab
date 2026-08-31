/**
 * Wilson intervals against published reference values.
 *
 * The 0/n row is the one that matters: it's the number shown to someone whose
 * test run came back clean, and it's the difference between "no failures" and
 * "no failures you could have seen".
 */
import { failureRate, runsToRuleOut, wilson } from '../src/lib/stats';

const near = (a: number, b: number, tol = 0.001) => Math.abs(a - b) < tol;

const cases: Array<[k: number, n: number, lo: number, hi: number]> = [
  [0,  50, 0.0000, 0.0713],
  [4,  50, 0.0316, 0.1892],
  [1,  20, 0.0089, 0.2361],
  [5,  10, 0.2366, 0.7634],
  [10, 10, 0.7225, 1.0000],
];

let pass = 0, fail = 0;
for (const [k, n, lo, hi] of cases) {
  const w = wilson(k, n);
  const ok = near(w.lo, lo) && near(w.hi, hi);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${k}/${n}  → [${w.lo.toFixed(4)}, ${w.hi.toFixed(4)}]  ref [${lo}, ${hi}]`);
}

console.log('\n  rule of three:');
for (const r of [0.01, 0.05, 0.1]) {
  const n = runsToRuleOut(r);
  const hi = wilson(0, n).hi;
  const ok = hi <= r;  // n clean runs must actually bound the rate below r
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✓' : '✗'} rule out ${(r*100).toFixed(0)}% → ${n} runs; 0/${n} bounds at ${(hi*100).toFixed(2)}%`);
}

const z = failureRate(0, 50);
const okZero = z.zeroObserved && z.observed === 0 && z.hi > 0.05;
okZero ? pass++ : fail++;
console.log(`\n  ${okZero ? '✓' : '✗'} 0/50 flagged zeroObserved with a non-zero upper bound (${(z.hi*100).toFixed(1)}%)`);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
