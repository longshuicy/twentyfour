/**
 * Challenge links. There is no server: the URL fragment IS the whole message.
 *
 *   https://<user>.github.io/twentyfour/#c=<base64url(payload)>
 *
 * The fragment (not a query string) is never sent to the server, which suits
 * static hosting and keeps the payload entirely client-side.
 *
 * Times here are trivially forgeable — anyone can edit the base64. Accepted:
 * this is a game between people who know each other. Per-hand splits travel
 * along so an implausible time is at least visibly implausible.
 */

import type { Level } from './deck';

export type RunResult = {
  /** Display name. */
  name: string;
  /** Total seconds including penalties, one decimal place. */
  time: number;
  /** Per-hand seconds, for plausibility and flavor. */
  splits: number[];
  /** Number of hands given up on. */
  gaveUp: number;
};

export type Challenge = {
  seed: string;
  level: Level;
  /** Results already recorded on this deck, oldest first. */
  results: RunResult[];
};

type Wire = {
  s: string;
  l: Level;
  r: [string, number, number, number[]][];
};

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeChallenge(challenge: Challenge): string {
  const wire: Wire = {
    s: challenge.seed,
    l: challenge.level,
    r: challenge.results.map((r) => [r.name, r.time, r.gaveUp, r.splits.map((s) => Math.round(s * 10) / 10)]),
  };
  return toBase64Url(JSON.stringify(wire));
}

export function decodeChallenge(encoded: string): Challenge | null {
  try {
    const wire = JSON.parse(fromBase64Url(encoded)) as Wire;
    if (!wire || typeof wire.s !== 'string' || (wire.l !== 'easy' && wire.l !== 'hard')) return null;
    const results: RunResult[] = (wire.r ?? []).map(([name, time, gaveUp, splits]) => ({
      name: String(name ?? 'Anonymous').slice(0, 24),
      time: Number(time) || 0,
      gaveUp: Number(gaveUp) || 0,
      splits: Array.isArray(splits) ? splits.map(Number) : [],
    }));
    return { seed: wire.s, level: wire.l, results };
  } catch {
    return null;
  }
}

/** Read a challenge out of the current URL, if there is one. */
export function readChallengeFromUrl(hash: string = window.location.hash): Challenge | null {
  const match = /[#&]c=([A-Za-z0-9\-_]+)/.exec(hash);
  return match ? decodeChallenge(match[1]) : null;
}

/** Full shareable URL for a challenge, based on where the app is deployed. */
export function buildChallengeUrl(challenge: Challenge): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#c=${encodeChallenge(challenge)}`;
}

/** Drop the fragment without reloading, so a refresh starts clean. */
export function clearUrlChallenge(): void {
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}
