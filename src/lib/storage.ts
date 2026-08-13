/**
 * localStorage, not cookies: cookies are 4 KB and ride along with every
 * request; localStorage gives ~5 MB and stays on the device.
 */

import type { Level } from './deck';
import type { RunResult } from './challenge';

const KEY_NAME = 'tf.name';
const KEY_BESTS = 'tf.bests';
const KEY_HISTORY = 'tf.history';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private browsing / quota — the game still works, it just forgets */
  }
}

export const loadName = (): string => read<string>(KEY_NAME, '');
export const saveName = (name: string): void => write(KEY_NAME, name.slice(0, 24));

type Bests = Record<string, number>;

/** Personal best per (level, seed), plus a per-level best across all seeds. */
export function loadBest(level: Level, seed: string): number | null {
  const bests = read<Bests>(KEY_BESTS, {});
  const value = bests[`${level}:${seed}`];
  return typeof value === 'number' ? value : null;
}

export function saveBest(level: Level, seed: string, time: number): void {
  const bests = read<Bests>(KEY_BESTS, {});
  const key = `${level}:${seed}`;
  if (!(key in bests) || time < bests[key]) {
    bests[key] = time;
    write(KEY_BESTS, bests);
  }
}

export type HistoryEntry = {
  seed: string;
  level: Level;
  results: RunResult[];
  /** ms epoch — recorded at save time, never fed into deck generation. */
  at: number;
};

export const loadHistory = (): HistoryEntry[] => read<HistoryEntry[]>(KEY_HISTORY, []);

export function saveHistoryEntry(entry: HistoryEntry): void {
  const history = loadHistory().filter((h) => !(h.seed === entry.seed && h.level === entry.level));
  history.unshift(entry);
  write(KEY_HISTORY, history.slice(0, 100));
}

/** Head-to-head tally across every deck this browser has seen. */
export function headToHead(myName: string): { wins: number; losses: number; ties: number } {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const entry of loadHistory()) {
    const mine = entry.results.find((r) => r.name === myName);
    const theirs = entry.results.filter((r) => r.name !== myName);
    if (!mine || theirs.length === 0) continue;
    const best = Math.min(...theirs.map((r) => r.time));
    if (mine.time < best) wins++;
    else if (mine.time > best) losses++;
    else ties++;
  }
  return { wins, losses, ties };
}
