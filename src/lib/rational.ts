/**
 * Exact rational arithmetic.
 *
 * The 24 game is full of fractional intermediates — 7*(3+3/7), 6/(1-3/4),
 * 8/(3-8/3). Floats plus an epsilon produce both false negatives and, worse,
 * false positives: a division by a tiny rounding residue can land near 24 when
 * the exact value is nowhere close, which makes the solver claim a hand is
 * solvable and then display an "answer" that doesn't evaluate to 24.
 *
 * Invariant: d > 0 and gcd(|n|, d) === 1. Sign lives in the numerator.
 * Card values are <= 12 and there are only 3 operations per hand, so both
 * fields stay far inside Number.MAX_SAFE_INTEGER. No BigInt needed.
 */

export type Rat = { readonly n: number; readonly d: number };

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a || 1;
}

/** Construct a normalized rational. */
export function rat(n: number, d = 1): Rat {
  if (d === 0) throw new Error('rational with zero denominator');
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export const add = (a: Rat, b: Rat): Rat => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rat, b: Rat): Rat => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Rat, b: Rat): Rat => rat(a.n * b.n, a.d * b.d);

/** Division returns null rather than throwing — divide-by-zero is a normal, prunable branch. */
export const div = (a: Rat, b: Rat): Rat | null => (b.n === 0 ? null : rat(a.n * b.d, a.d * b.n));

export const isInteger = (r: Rat): boolean => r.d === 1;
export const equalsInt = (r: Rat, k: number): boolean => r.d === 1 && r.n === k;
export const eq = (a: Rat, b: Rat): boolean => a.n === b.n && a.d === b.d;
export const toNumber = (r: Rat): number => r.n / r.d;

/** Display form. Never a decimal: `24/7`, not 3.4285714285714284. */
export function ratToString(r: Rat): string {
  return r.d === 1 ? String(r.n) : `${r.n}/${r.d}`;
}
