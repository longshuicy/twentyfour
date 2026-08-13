/**
 * Hand state: the bag of tiles the player is manipulating, plus undo.
 *
 * A "tile" is either an original card or the result of combining two tiles.
 * The solver's bag and this bag are the same idea, and both go through
 * combine() from solver.ts, so the game and the search can never disagree
 * about what an operation means.
 */

import { rat, type Rat, equalsInt } from './rational';
import { combine, type ExprNode, type Op, TARGET } from './solver';
import type { Card } from './deck';

export type Tile = {
  id: string;
  value: Rat;
  expr: ExprNode;
  /** The original card, if this tile has not been combined yet. Drives the card face. */
  card?: Card;
};

export type HandState = {
  tiles: Tile[];
  /** Stack of previous tile arrangements, for undo. */
  past: Tile[][];
};

export function initHand(cards: Card[]): HandState {
  return {
    tiles: cards.map((card) => ({
      id: card.id,
      value: rat(card.value),
      expr: { kind: 'leaf', value: rat(card.value) },
      card,
    })),
    past: [],
  };
}

/**
 * Apply an operation. The DRAGGED tile is always the left operand — drag 7
 * onto 3 for 7-3, drag 3 onto 7 for 3-7 — which is why the drop target only
 * needs four quadrants instead of six labeled zones.
 *
 * The result takes the target's position in the array, so the card visually
 * lands where it was dropped.
 */
export function applyOp(state: HandState, draggedId: string, targetId: string, op: Op): HandState {
  if (draggedId === targetId) return state;
  const dragged = state.tiles.find((t) => t.id === draggedId);
  const target = state.tiles.find((t) => t.id === targetId);
  if (!dragged || !target) return state;

  const merged = combine(
    { value: dragged.value, expr: dragged.expr },
    { value: target.value, expr: target.expr },
    op,
  );
  if (!merged) return state; // division by zero

  const tile: Tile = {
    id: `${draggedId}${op}${targetId}`,
    value: merged.value,
    expr: merged.expr,
  };

  const tiles = state.tiles
    .map((t) => (t.id === targetId ? tile : t))
    .filter((t) => t.id !== draggedId);

  return { tiles, past: [...state.past, state.tiles] };
}

export function undo(state: HandState): HandState {
  if (state.past.length === 0) return state;
  const past = state.past.slice();
  const tiles = past.pop() as Tile[];
  return { tiles, past };
}

export const canUndo = (state: HandState): boolean => state.past.length > 0;

/** Won when a single tile remains and it is exactly 24. */
export const isSolved = (state: HandState): boolean =>
  state.tiles.length === 1 && equalsInt(state.tiles[0].value, TARGET);

/** Dead end: one tile left and it is not 24. The player must undo or reset. */
export const isDeadEnd = (state: HandState): boolean =>
  state.tiles.length === 1 && !equalsInt(state.tiles[0].value, TARGET);
