/**
 * The 24 solver: recursive pairwise combine.
 *
 * State is a BAG of values. One move removes two elements and puts back one
 * combined result; recurse until a single element remains, then test == 24.
 *
 *   {3,3,7,7} -(3/7)-> {3, 3/7, 7} -(3+3/7)-> {24/7, 7} -(x7)-> {24}  win
 *
 * Because an intermediate is indistinguishable from an original card, every
 * parse tree of every arity is reachable with one loop nest and no special
 * cases. This is the reason not to use permutations + operator strings: those
 * only build left-linear trees ((a.b).c).d and silently miss the balanced
 * shape (a.b).(c.d), where a large share of real solutions live.
 *
 * Six ops per unordered pair: + and * commute, - and / do not.
 * Worst case ~3900 leaves for 4 cards. Microseconds.
 */

import { type Rat, add, sub, mul, div, equalsInt, rat, ratToString } from './rational';

export const TARGET = 24;

export type Op = '+' | '-' | '*' | '/';

export type ExprNode =
  | { kind: 'leaf'; value: Rat }
  | { kind: 'node'; op: Op; left: ExprNode; right: ExprNode; value: Rat };

/** One element of the bag: a value plus the expression that produced it. */
type Item = { value: Rat; expr: ExprNode };

const leaf = (value: Rat): Item => ({ value, expr: { kind: 'leaf', value } });

/**
 * All ways to combine two bag elements into one.
 * `a` is the LEFT operand for the non-commutative ops; the reversed variants
 * are emitted explicitly so the caller only needs unordered pairs.
 *
 * This is the shared primitive: the drag interaction calls combine() for a
 * single player gesture, and the search calls it for every edge. They cannot
 * disagree about what an operation means.
 */
export function combine(a: Item, b: Item, op: Op, reversed = false): Item | null {
  const [x, y] = reversed ? [b, a] : [a, b];
  let value: Rat | null;
  switch (op) {
    case '+':
      value = add(x.value, y.value);
      break;
    case '-':
      value = sub(x.value, y.value);
      break;
    case '*':
      value = mul(x.value, y.value);
      break;
    case '/':
      value = div(x.value, y.value);
      break;
  }
  if (value === null) return null; // division by zero: prune
  return {
    value,
    expr: { kind: 'node', op, left: x.expr, right: y.expr, value },
  };
}

function expansions(a: Item, b: Item): Item[] {
  const out: Item[] = [];
  const push = (i: Item | null) => {
    if (i) out.push(i);
  };
  push(combine(a, b, '+'));
  push(combine(a, b, '-'));
  push(combine(a, b, '-', true)); // b - a
  push(combine(a, b, '*'));
  push(combine(a, b, '/'));
  push(combine(a, b, '/', true)); // b / a
  return out;
}

function search(items: Item[], onSolution: (expr: ExprNode) => boolean): boolean {
  if (items.length === 1) {
    if (equalsInt(items[0].value, TARGET)) return onSolution(items[0].expr);
    return false;
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const rest: Item[] = [];
      for (let k = 0; k < items.length; k++) if (k !== i && k !== j) rest.push(items[k]);
      for (const merged of expansions(items[i], items[j])) {
        // `stop` propagates upward so a first-hit search unwinds immediately.
        if (search([...rest, merged], onSolution)) return true;
      }
    }
  }
  return false;
}

/** Fast path for deck generation: does any solution exist? Returns on first hit. */
export function isSolvable(values: number[]): boolean {
  let found = false;
  search(values.map((v) => leaf(rat(v))), () => {
    found = true;
    return true; // stop
  });
  return found;
}

/** First solution found. Cheap; order is an artifact of the search. */
export function findFirstSolution(values: number[]): ExprNode | null {
  let solution: ExprNode | null = null;
  search(values.map((v) => leaf(rat(v))), (expr) => {
    solution = expr;
    return true;
  });
  return solution;
}

/**
 * Every solution, deduped by rendered form. Still only a few thousand leaves,
 * so this is fine to call on demand (give-up screen, hints).
 */
export function findAllSolutions(values: number[]): ExprNode[] {
  const seen = new Set<string>();
  const out: ExprNode[] = [];
  search(values.map((v) => leaf(rat(v))), (expr) => {
    const key = exprToString(expr);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(expr);
    }
    return false; // keep going
  });
  return out;
}

/** Count of intermediate values that are not whole numbers. */
function fractionCount(expr: ExprNode): number {
  if (expr.kind === 'leaf') return 0;
  const self = expr.value.d === 1 ? 0 : 1;
  return self + fractionCount(expr.left) + fractionCount(expr.right);
}

function depth(expr: ExprNode): number {
  return expr.kind === 'leaf' ? 0 : 1 + Math.max(depth(expr.left), depth(expr.right));
}

/**
 * The solution to show a player who gave up. Fewest fractional intermediates
 * first — (3-2)*(4*6) reads as cleverer than a division-heavy equivalent —
 * then prefer balanced trees, then shortest rendering.
 */
export function findBestSolution(values: number[]): ExprNode | null {
  const all = findAllSolutions(values);
  if (all.length === 0) return null;
  let best = all[0];
  let bestKey: [number, number, number] = [
    fractionCount(best),
    depth(best),
    exprToString(best).length,
  ];
  for (const candidate of all.slice(1)) {
    const key: [number, number, number] = [
      fractionCount(candidate),
      depth(candidate),
      exprToString(candidate).length,
    ];
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1]) ||
        (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] < bestKey[2])) {
      best = candidate;
      bestKey = key;
    }
  }
  return best;
}

const SYMBOL: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

/** Renders with parentheses only where precedence requires them. */
export function exprToString(expr: ExprNode, parentOp?: Op, isRight = false): string {
  if (expr.kind === 'leaf') return ratToString(expr.value);
  const mine = expr.op;
  const left = exprToString(expr.left, mine, false);
  const right = exprToString(expr.right, mine, true);
  const body = `${left} ${SYMBOL[mine]} ${right}`;
  if (!parentOp) return body;
  const prec = (op: Op) => (op === '+' || op === '-' ? 1 : 2);
  const needs =
    prec(mine) < prec(parentOp) ||
    // a - (b - c) and a / (b / c) are not associative
    (prec(mine) === prec(parentOp) && isRight && (parentOp === '-' || parentOp === '/'));
  return needs ? `(${body})` : body;
}
