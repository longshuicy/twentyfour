/**
 * Deck generation.
 *
 * HARD INVARIANT: buildDeck(seed, level) is a PURE function. No clock, no
 * player input, no unseeded randomness — including inside the unsolvable-hand
 * retry loop below. If anything else influences it, two players opening the
 * same challenge link get different hands and the whole time comparison is
 * meaningless. This is the most important correctness property in the codebase.
 */

import { hashCode, mulberry32, shuffled } from './rng';
import { isSolvable } from './solver';

export type Level = 'easy' | 'hard';

export type Suit = 'S' | 'H' | 'D' | 'C';

export type Card = {
  /** Unique within a deck, so React keys and drag identity are stable. */
  id: string;
  /** 1..9 on easy, 1..13 on hard. A = 1, J = 11, Q = 12, K = 13. */
  value: number;
  suit: Suit;
};

export type Hand = {
  index: number;
  cards: Card[];
};

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

export const LEVEL_MAX: Record<Level, number> = {
  easy: 9, // A-9
  hard: 13, // A-K
};

export const RANK_LABEL: Record<number, string> = {
  1: 'A',
  11: 'J',
  12: 'Q',
  13: 'K',
};

export const rankLabel = (value: number): string => RANK_LABEL[value] ?? String(value);

export const SUIT_GLYPH: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const isRedSuit = (suit: Suit): boolean => suit === 'H' || suit === 'D';

/** Full ordered deck for a level, before shuffling. */
export function freshDeck(level: Level): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (let value = 1; value <= LEVEL_MAX[level]; value++) {
      cards.push({ id: `${suit}${value}`, value, suit });
    }
  }
  return cards;
}

/** Hands per deck when every hand is solvable: 9 on easy (36 cards), 13 on hard (52). */
export const handsPerDeck = (level: Level): number => LEVEL_MAX[level];

export type Deck = {
  seed: string;
  level: Level;
  hands: Hand[];
  /** Cards that could not be formed into a solvable hand and were dropped at the tail. */
  leftover: Card[];
};

/**
 * Deal the whole deck into solvable hands.
 *
 * Draws four cards; if the hand cannot make 24, the cards go back into the
 * pool and the pool is reshuffled with the *same* seeded generator, so the
 * retry consumes deterministic randomness. After MAX_RETRIES failures the
 * remaining cards are declared leftover and the deck ends early — this is what
 * prevents the tail of the deck from becoming an infinite loop when only
 * unsolvable combinations remain.
 */
export function buildDeck(seedCode: string, level: Level): Deck {
  const next = mulberry32(hashCode(seedCode));
  let pool = shuffled(freshDeck(level), next);

  const hands: Hand[] = [];
  const MAX_RETRIES = 40;
  let retries = 0;

  while (pool.length >= 4) {
    const candidate = pool.slice(0, 4);
    if (isSolvable(candidate.map((c) => c.value))) {
      hands.push({ index: hands.length, cards: candidate });
      pool = pool.slice(4);
      retries = 0;
      continue;
    }
    retries++;
    if (retries > MAX_RETRIES) break;
    // Set aside and shuffle back into the remaining pile.
    pool = shuffled(pool, next);
  }

  return { seed: seedCode, level, hands, leftover: pool };
}
