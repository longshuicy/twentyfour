/**
 * The cue files are generated, committed binaries: a bad regeneration is
 * silent in the UI (a cue that fails to decode just plays nothing, because
 * every audio call swallows its errors) and silent in review, since nobody
 * reads a diff of a WAV. So the headers get checked here.
 *
 * Regenerate with: node scripts/gen-sounds.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CUE_DIR = join(import.meta.dirname, '..', 'assets', 'cues');
const SR = 22050;

/** The generator is the source of truth for which cues exist. */
const GENERATED: readonly string[] = readdirSync(CUE_DIR)
  .filter((f) => f.endsWith('.wav'))
  .map((f) => f.replace(/\.wav$/, ''))
  .sort();

/** Minimal RIFF/PCM header reader — enough to prove a decoder will accept it. */
function readWav(name: string) {
  const b = readFileSync(join(CUE_DIR, `${name}.wav`));
  return {
    riff: b.toString('ascii', 0, 4),
    wave: b.toString('ascii', 8, 12),
    format: b.readUInt16LE(20),
    channels: b.readUInt16LE(22),
    sampleRate: b.readUInt32LE(24),
    bits: b.readUInt16LE(34),
    data: b.toString('ascii', 36, 40),
    dataBytes: b.readUInt32LE(40),
    fileBytes: b.length,
  };
}

/** Peak sample as a fraction of full scale. */
function peak(name: string): number {
  const b = readFileSync(join(CUE_DIR, `${name}.wav`));
  let max = 0;
  for (let i = 44; i + 1 < b.length; i += 2) max = Math.max(max, Math.abs(b.readInt16LE(i)));
  return max / 32768;
}

describe('generated cues', () => {
  it('generates the whole set', () => {
    // A cue silently missing from the build is the failure this guards.
    expect(GENERATED.length).toBe(20);
  });

  it.each(GENERATED)('%s is a valid mono PCM16 WAV', (name) => {
    const w = readWav(name);
    expect(w.riff).toBe('RIFF');
    expect(w.wave).toBe('WAVE');
    expect(w.data).toBe('data');
    expect(w.format).toBe(1); // uncompressed PCM
    expect(w.channels).toBe(1);
    expect(w.bits).toBe(16);
    expect(w.sampleRate).toBe(SR);
    // A truncated write is the other way a regeneration goes wrong.
    expect(w.fileBytes).toBe(44 + w.dataBytes);
  });

  it.each(GENERATED)('%s carries signal', (name) => {
    // Catches the model that renders to silence: a decodable file that means
    // nothing, which no visual check would ever reveal.
    expect(peak(name)).toBeGreaterThan(0.05);
  });

  it('keeps every cue inside its tier', () => {
    /* Tier gain is the one thing holding 23 cues together, and it is applied
       at generation time, so drift can only be caught by measuring. */
    const LOUD = ['beatTarget', 'best', 'deckDone'];
    const WHISPER = ['advance', 'arm', 'nav', 'reset', 'step', 'undo', 'wedge'];
    for (const name of GENERATED) {
      const p = peak(name);
      if (LOUD.includes(name)) expect(p, name).toBeGreaterThan(0.8);
      else if (WHISPER.includes(name)) expect(p, name).toBeLessThan(0.2);
      else {
        expect(p, name).toBeGreaterThan(0.2);
        expect(p, name).toBeLessThan(0.6);
      }
    }
  });
});
