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

export type LevelRecord = {
  level: Level;
  /** Runs finished on this level, in this browser. */
  runs: number;
  /** Fastest finish, or null if the level has never been cleared. */
  best: number | null;
  bestSeed: string | null;
  /** ms epoch of the most recent run. */
  lastAt: number | null;
  /** Runs finished without giving up on a single hand. */
  clean: number;
};

/**
 * Your own result in a saved entry.
 *
 * `finish()` appends the local player last, so position — not name — is what
 * identifies you. Matching on name would lose your history the moment you
 * change it, and would claim an opponent's row if you both use the same one.
 */
const myResult = (entry: HistoryEntry): RunResult | null =>
  entry.results.length > 0 ? entry.results[entry.results.length - 1] : null;

/** Per-level personal record, derived from the run history. */
export function loadRecords(): LevelRecord[] {
  const history = loadHistory();
  return (['easy', 'hard'] as Level[]).map((level) => {
    const record: LevelRecord = {
      level,
      runs: 0,
      best: null,
      bestSeed: null,
      lastAt: null,
      clean: 0,
    };
    for (const entry of history) {
      if (entry.level !== level) continue;
      const mine = myResult(entry);
      if (!mine) continue;
      record.runs++;
      if (mine.gaveUp === 0) record.clean++;
      if (record.best === null || mine.time < record.best) {
        record.best = mine.time;
        record.bestSeed = entry.seed;
      }
      if (record.lastAt === null || entry.at > record.lastAt) record.lastAt = entry.at;
    }
    return record;
  });
}

export type RecentRun = {
  seed: string;
  level: Level;
  at: number;
  mine: RunResult;
  /** Best opponent time carried in that deck's link, if it was a match. */
  rivalName: string | null;
  rivalTime: number | null;
};

/** Most recent runs, newest first — the history list, flattened for display. */
export function loadRecentRuns(limit = 10): RecentRun[] {
  const runs: RecentRun[] = [];
  for (const entry of loadHistory()) {
    const mine = myResult(entry);
    if (!mine) continue;
    const others = entry.results.slice(0, -1);
    const rival = others.length > 0 ? others.reduce((a, b) => (a.time <= b.time ? a : b)) : null;
    runs.push({
      seed: entry.seed,
      level: entry.level,
      at: entry.at,
      mine,
      rivalName: rival?.name ?? null,
      rivalTime: rival?.time ?? null,
    });
    if (runs.length >= limit) break;
  }
  return runs;
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
