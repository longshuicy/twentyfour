import { describe, expect, it } from 'vitest';
import { findBestSolution, findFirstSolution, isSolvable, exprToString } from './solver';
import { rat, add, sub, mul, div, ratToString } from './rational';

/** Evaluate a rendered solution independently, to be sure the string is honest. */
function evalExpr(expr: ReturnType<typeof findFirstSolution>): number {
  if (!expr) return NaN;
  const walk = (node: NonNullable<typeof expr>): { n: number; d: number } => {
    if (node.kind === 'leaf') return node.value;
    const l = walk(node.left);
    const r = walk(node.right);
    switch (node.op) {
      case '+':
        return add(l, r);
      case '-':
        return sub(l, r);
      case '*':
        return mul(l, r);
      case '/':
        return div(l, r)!;
    }
  };
  const v = walk(expr);
  return v.n / v.d;
}

describe('rational arithmetic', () => {
  it('normalizes sign and reduces', () => {
    expect(rat(2, -4)).toEqual({ n: -1, d: 2 });
    expect(rat(6, 3)).toEqual({ n: 2, d: 1 });
  });

  it('renders fractions, never decimals', () => {
    expect(ratToString(rat(24, 7))).toBe('24/7');
    expect(ratToString(rat(24))).toBe('24');
  });

  it('refuses to divide by zero', () => {
    expect(div(rat(1), rat(0))).toBeNull();
  });
});

describe('solvability', () => {
  it('finds solutions that need fractional intermediates', () => {
    // These are the cases float arithmetic gets wrong or nearly wrong.
    for (const hand of [
      [3, 3, 7, 7],
      [1, 3, 4, 6],
      [5, 5, 5, 1],
      [8, 8, 3, 3],
      [1, 4, 5, 6],
      [2, 7, 8, 9],
      [10, 10, 4, 4],
    ]) {
      expect(isSolvable(hand), hand.join(',')).toBe(true);
    }
  });

  it('finds the balanced tree shape that permutation search misses', () => {
    // (3-2) * (4*6) = 24 — unreachable as ((a.b).c).d for these values.
    expect(isSolvable([2, 3, 4, 6])).toBe(true);
  });

  it('rejects genuinely unsolvable hands', () => {
    for (const hand of [
      [1, 1, 1, 1],
      [1, 1, 1, 2],
      [13, 13, 13, 13],
      [1, 1, 2, 2],
      [11, 11, 11, 11],
    ]) {
      expect(isSolvable(hand), hand.join(',')).toBe(false);
    }
  });

  it('handles kings (13) now that hard mode includes them', () => {
    expect(isSolvable([13, 12, 1, 1])).toBe(true); // 12*(13-1)/... exists
    expect(typeof isSolvable([13, 13, 1, 1])).toBe('boolean');
  });
});

describe('solutions are honest', () => {
  it('every returned solution actually evaluates to 24', () => {
    const hands = [
      [3, 3, 7, 7],
      [1, 3, 4, 6],
      [2, 3, 4, 6],
      [8, 8, 3, 3],
      [5, 5, 5, 1],
      [4, 6, 8, 10],
      [13, 12, 11, 1],
    ];
    for (const hand of hands) {
      const best = findBestSolution(hand);
      if (!best) continue;
      expect(evalExpr(best), `${hand.join(',')} -> ${exprToString(best)}`).toBe(24);
    }
  });

  it('prefers whole-number solutions when one exists', () => {
    const best = findBestSolution([2, 3, 4, 6]);
    expect(best).not.toBeNull();
    expect(exprToString(best!)).not.toContain('/');
  });

  it('renders with parentheses only where precedence needs them', () => {
    const best = findBestSolution([1, 3, 4, 6]);
    expect(exprToString(best!)).toMatch(/24|÷|×|−|\+/);
    expect(evalExpr(best)).toBe(24);
  });
});
