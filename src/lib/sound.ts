/**
 * Three short clips, imported so Vite fingerprints them and rewrites the URL
 * for the `/twentyfour/` base — a hardcoded `/assets/...` path would 404 on
 * GitHub Pages.
 *
 * Everything here fails soft. Autoplay policy blocks playback until the page
 * has been interacted with, decoding can fail, and a muted player wants
 * silence: none of that is allowed to interrupt a run, so every entry point
 * swallows its errors.
 */

import giveUpUrl from '../assets/dog_giveup_woof.mp3';
import longWaitUrl from '../assets/long_wait_meow.mp3';
import succeedUrl from '../assets/succeed_meow.mp3';

export type Cue = 'giveUp' | 'longWait' | 'succeed';

const SOURCES: Record<Cue, string> = {
  giveUp: giveUpUrl,
  longWait: longWaitUrl,
  succeed: succeedUrl,
};

const KEY_MUTED = 'tf.muted';

export function isMuted(): boolean {
  try {
    return localStorage.getItem(KEY_MUTED) === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(KEY_MUTED, muted ? '1' : '0');
  } catch {
    /* private browsing — the setting just will not survive a reload */
  }
}

/* One element per cue, reused. Constructing an Audio per play leaks elements
   on a long run and adds a fetch the first time each one is needed. */
const players = new Map<Cue, HTMLAudioElement>();

function player(cue: Cue): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  let el = players.get(cue);
  if (!el) {
    el = new Audio(SOURCES[cue]);
    el.preload = 'auto';
    players.set(cue, el);
  }
  return el;
}

export function play(cue: Cue): void {
  if (isMuted()) return;
  const el = player(cue);
  if (!el) return;
  try {
    // Restart rather than ignore: two quick give-ups should sound twice.
    el.currentTime = 0;
    void el.play().catch(() => {});
  } catch {
    /* not fatal — the visual cue carries the same information */
  }
}

/** Warm the decoder on the first gesture so the first cue is not late. */
export function primeSounds(): void {
  if (isMuted()) return;
  for (const cue of Object.keys(SOURCES) as Cue[]) player(cue)?.load();
}
