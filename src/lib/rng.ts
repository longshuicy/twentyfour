/**
 * Seeded randomness. Every deck must be reproducible from a short code so two
 * players can race the identical deck with no server involved.
 *
 * Nothing here may touch Date.now(), Math.random(), or any player input.
 */

/** mulberry32 — small, fast, good enough, and deterministic across engines. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Base32-ish alphabet with no vowels or lookalikes: unambiguous when read aloud. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Deterministic 32-bit hash of a seed code (FNV-1a). */
export function hashCode(code: string): number {
  let h = 0x811c9dc5;
  const up = code.toUpperCase();
  for (let i = 0; i < up.length; i++) {
    h ^= up.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A fresh 6-character seed code. The only place unseeded randomness is allowed. */
export function randomSeedCode(length = 6): string {
  let out = '';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Normalize user-typed or URL-supplied codes. */
export function normalizeSeedCode(code: string): string {
  return code
    .toUpperCase()
    .split('')
    .filter((c) => ALPHABET.includes(c))
    .join('');
}

/** Fisher-Yates driven by a seeded generator. Pure: same input, same output. */
export function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}
