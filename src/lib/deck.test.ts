import { describe, expect, it } from 'vitest';
import { buildDeck, freshDeck, LEVEL_MAX } from './deck';
import { isSolvable } from './solver';
import { hashCode, mulberry32, normalizeSeedCode, shuffled } from './rng';
import { decodeChallenge, encodeChallenge, type Challenge } from './challenge';

const SEEDS = ['7QK2M', 'ABCDEF', 'ZZZ999', '2345678', 'K7P3RQ'];

describe('deck determinism — the core multiplayer invariant', () => {
  it('is a pure function of (seed, level)', () => {
    for (const seed of SEEDS) {
      for (const level of ['easy', 'hard'] as const) {
        const a = buildDeck(seed, level);
        const b = buildDeck(seed, level);
        expect(a.hands.map((h) => h.cards.map((c) => c.id))).toEqual(
          b.hands.map((h) => h.cards.map((c) => c.id)),
        );
        expect(a.leftover.map((c) => c.id)).toEqual(b.leftover.map((c) => c.id));
      }
    }
  });

  it('produces different decks for different seeds', () => {
    const a = buildDeck('AAAAAA', 'hard');
    const b = buildDeck('BBBBBB', 'hard');
    expect(a.hands[0].cards.map((c) => c.id)).not.toEqual(b.hands[0].cards.map((c) => c.id));
  });

  it('is case-insensitive on the seed code', () => {
    const a = buildDeck('7qk2m'.toUpperCase(), 'hard');
    const b = buildDeck('7QK2M', 'hard');
    expect(a.hands[0].cards.map((c) => c.id)).toEqual(b.hands[0].cards.map((c) => c.id));
    expect(hashCode('7qk2m')).toBe(hashCode('7QK2M'));
  });
});

describe('deck contents', () => {
  it('easy is 36 cards A-9, hard is 52 cards A-K', () => {
    expect(freshDeck('easy')).toHaveLength(36);
    expect(freshDeck('hard')).toHaveLength(52);
    expect(LEVEL_MAX.easy).toBe(9);
    expect(LEVEL_MAX.hard).toBe(13);
    expect(Math.max(...freshDeck('hard').map((c) => c.value))).toBe(13);
  });

  it('never deals an unsolvable hand', () => {
    for (const seed of SEEDS) {
      for (const level of ['easy', 'hard'] as const) {
        const deck = buildDeck(seed, level);
        for (const hand of deck.hands) {
          expect(isSolvable(hand.cards.map((c) => c.value)), `${seed} ${level}`).toBe(true);
        }
      }
    }
  });

  it('uses every card exactly once across hands and leftovers', () => {
    for (const seed of SEEDS) {
      const deck = buildDeck(seed, 'hard');
      const ids = [...deck.hands.flatMap((h) => h.cards.map((c) => c.id)), ...deck.leftover.map((c) => c.id)];
      expect(ids).toHaveLength(52);
      expect(new Set(ids).size).toBe(52);
    }
  });

  it('terminates and deals a nearly-full deck', () => {
    for (const seed of SEEDS) {
      const deck = buildDeck(seed, 'hard');
      // 13 normally; 12 when the tail cannot form a solvable hand.
      expect(deck.hands.length).toBeGreaterThanOrEqual(11);
      expect(deck.hands.length).toBeLessThanOrEqual(13);
      expect(deck.leftover.length % 4).toBe(0);
    }
  });
});

describe('rng', () => {
  it('mulberry32 is reproducible', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('shuffle is a permutation', () => {
    const next = mulberry32(9);
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffled(input, next);
    expect(out.slice().sort((x, y) => x - y)).toEqual(input);
  });

  it('strips ambiguous characters from typed seed codes', () => {
    expect(normalizeSeedCode('7qk-2m!')).toBe('7QK2M');
  });
});

describe('challenge links', () => {
  it('round-trips a payload', () => {
    const challenge: Challenge = {
      seed: '7QK2M',
      level: 'hard',
      results: [
        { name: 'Chen', time: 143.2, splits: [10.1, 12.4], gaveUp: 1 },
        { name: 'Sam', time: 128.4, splits: [9.9], gaveUp: 0 },
      ],
    };
    const decoded = decodeChallenge(encodeChallenge(challenge));
    expect(decoded).toEqual(challenge);
  });

  it('returns null on garbage instead of throwing', () => {
    expect(decodeChallenge('not-valid-base64!!')).toBeNull();
    expect(decodeChallenge('')).toBeNull();
  });
});
