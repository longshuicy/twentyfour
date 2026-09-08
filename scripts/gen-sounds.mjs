/**
 * Cue generator. Renders every UI sound from a physical model and writes
 * PCM16 mono WAVs into src/assets/cues/.
 *
 *   node scripts/gen-sounds.mjs
 *
 * Build-time only: nothing here ships, and the game gains no dependency. The
 * output IS committed, so a regeneration should show an empty diff — every
 * noise source is seeded from the cue's own name (see `rand`), so re-running
 * this on any machine reproduces the same bytes.
 *
 * Three models carry all 19 cues, which is the point: cues built from the same
 * physics sound like one instrument even when they mean different things.
 *
 *   modal()  a struck object — damped resonators plus a contact transient.
 *            Cards, buttons, bells. The card cues are dark and fast-decaying
 *            because a playing card is stiff and nearly massless.
 *   glide()  a mass on a spring — a pitch trajectory through one timbre. The
 *            four operators are this model and differ ONLY in trajectory, so
 *            the arithmetic is what you hear.
 *   burst()  filtered noise — the whisper tier, where a cue should register
 *            without being noticed.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 22050;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'cues');

/* ------------------------------------------------------------------ *
 * Seeded noise
 *
 * Copies of mulberry32 and FNV-1a from src/lib/rng.ts rather than imports:
 * this is a plain .mjs build script and the game's determinism contract has
 * nothing to do with it. Keep them in step only in spirit.
 * ------------------------------------------------------------------ */

function mulberry32(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashCode(code) {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Set per cue so a cue's noise is a function of its name, not of call order. */
let rand = mulberry32(0);

/* ------------------------------------------------------------------ *
 * Buffers and filters
 * ------------------------------------------------------------------ */

const n = (seconds) => Math.max(1, Math.round(seconds * SR));
const buf = (seconds) => new Float32Array(n(seconds));

/** Add `src` into `dst` starting at `atSeconds`. Anything past the end is dropped. */
function mix(dst, src, atSeconds = 0, gain = 1) {
  const off = Math.round(atSeconds * SR);
  for (let i = 0; i < src.length; i++) {
    const j = off + i;
    if (j >= 0 && j < dst.length) dst[j] += src[i] * gain;
  }
  return dst;
}

/** One-pole lowpass. `cutoff` may be a number or a function of normalised time. */
function lowpass(x, cutoff) {
  const out = new Float32Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    const fc = typeof cutoff === 'function' ? cutoff(i / x.length) : cutoff;
    const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
    y += a * (x[i] - y);
    out[i] = y;
  }
  return out;
}

/** One-pole highpass, to keep the small cues out of the woofer. */
function highpass(x, fc) {
  const out = new Float32Array(x.length);
  const a = Math.exp((-2 * Math.PI * fc) / SR);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < x.length; i++) {
    prevOut = a * (prevOut + x[i] - prevIn);
    prevIn = x[i];
    out[i] = prevOut;
  }
  return out;
}

/** Gentle saturation. Keeps transients from clipping into a spit. */
function saturate(x, drive = 1.4) {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.tanh(x[i] * drive) / Math.tanh(drive);
  return out;
}

/** Scale to a target peak. Silence stays silence. */
function normalize(x, peak = 1) {
  let max = 0;
  for (const v of x) max = Math.max(max, Math.abs(v));
  if (max < 1e-9) return x;
  const g = peak / max;
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

/** A click at either edge of a buffer is a defect, not a transient. */
function deClick(x, ms = 1.5) {
  const w = Math.min(n(ms / 1000), Math.floor(x.length / 2));
  for (let i = 0; i < w; i++) {
    const g = i / w;
    x[i] *= g;
    x[x.length - 1 - i] *= g;
  }
  return x;
}

/* ------------------------------------------------------------------ *
 * The three models
 * ------------------------------------------------------------------ */

/**
 * A struck object. Each mode is a sinusoid decaying at its own rate, which is
 * what separates a card (modes gone in 30ms) from a bell (modes ringing for
 * 300ms) without changing a line of code.
 *
 * modes: [freq, amp, tau] — tau is the 1/e decay in seconds.
 * contact: optional { ms, cutoff, amp } transient for the moment of impact.
 */
function modal(seconds, modes, contact) {
  const out = buf(seconds);
  for (const [f, a, tau] of modes) {
    /* A hair of detune per mode, seeded: perfectly harmonic partials sound
       synthetic, and real objects are never machined that well. */
    const detune = 1 + (rand() - 0.5) * 0.004;
    const phase = rand() * Math.PI * 2;
    const w = 2 * Math.PI * f * detune;
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      out[i] += a * Math.exp(-t / tau) * Math.sin(w * t + phase);
    }
  }
  if (contact) {
    const c = burst(contact.ms / 1000, contact.cutoff, contact.ms / 3000);
    mix(out, c, 0, contact.amp);
  }
  return out;
}

/**
 * Filtered noise under an exponential decay. `cutoff` accepts a function, so a
 * sweep costs nothing extra.
 */
function burst(seconds, cutoff, tau) {
  const raw = buf(seconds);
  for (let i = 0; i < raw.length; i++) raw[i] = rand() * 2 - 1;
  const filtered = lowpass(raw, cutoff);
  for (let i = 0; i < filtered.length; i++) filtered[i] *= Math.exp(-i / SR / tau);
  return filtered;
}

/**
 * A mass on a spring: one timbre swept along a pitch trajectory. `curve` maps
 * normalised time to normalised pitch, so easing is a parameter rather than a
 * special case. Frequency is integrated into phase — stepping phase by the
 * instantaneous frequency is the only way a glide stays continuous.
 */
function glide(seconds, f0, f1, curve = (u) => u, harmonics = 4) {
  const out = buf(seconds);
  const total = out.length;
  let phase = 0;
  for (let i = 0; i < total; i++) {
    const u = i / total;
    const f = f0 + (f1 - f0) * curve(u);
    phase += (2 * Math.PI * f) / SR;
    /* Odd harmonics at 1/k^2 — a soft triangle. Warmer than a sine, and it
       survives a phone speaker, which a sine does not. */
    let v = 0;
    for (let k = 1; k <= harmonics * 2; k += 2) v += Math.sin(phase * k) / (k * k);
    /* Percussive body: fast attack so the pitch is audible from the first ms,
       then a decay long enough to hear where the pitch went. */
    const env = Math.min(1, u / 0.04) * Math.exp(-u * 3.2);
    out[i] = v * env;
  }
  return out;
}

const easeOut = (u) => 1 - (1 - u) * (1 - u);
const easeIn = (u) => u * u;
const smooth = (u) => u * u * (3 - 2 * u);

/* ------------------------------------------------------------------ *
 * Cue definitions
 *
 * Tier is the whole reason 19 cues do not become noise. `loud` cues are
 * earned moments and there are five of them; `whisper` cues fire constantly
 * and sit at the edge of hearing.
 * ------------------------------------------------------------------ */

const TIER = { loud: 0.92, soft: 0.44, whisper: 0.13 };

/** Shared card body. A stiff, light object on a soft surface. */
const CARD_MODES = [
  [186, 1.0, 0.028],
  [312, 0.55, 0.02],
  [523, 0.28, 0.013],
];

/** Every operator cue is this length and this envelope: only pitch differs. */
const OP_SECONDS = 0.16;

function bells(freqs, stagger, tau, seconds) {
  const out = buf(seconds);
  freqs.forEach((f, i) => {
    const voice = modal(seconds, [
      [f, 1.0, tau],
      [f * 2.01, 0.3, tau * 0.5],
      [f * 3.02, 0.12, tau * 0.28],
    ]);
    mix(out, voice, i * stagger, 1 / (1 + i * 0.15));
  });
  return out;
}

const CUES = {
  /* --- card interaction ------------------------------------------ */

  /** Card lifting off the felt: mostly air, a trace of body. */
  lift: {
    tier: 'soft',
    render: () => {
      const out = buf(0.07);
      mix(out, burst(0.014, 2200, 0.005), 0, 0.9);
      mix(out, modal(0.06, [[240, 0.5, 0.018]]), 0.002);
      return highpass(out, 140);
    },
  },

  /** A card tapped once — the drop target has been acquired. */
  target: {
    tier: 'soft',
    render: () => {
      const out = modal(0.08, CARD_MODES, { ms: 5, cutoff: 3400, amp: 0.35 });
      return highpass(out, 130);
    },
  },

  /**
   * Rejected drop. Same card, resonators pulled a minor second apart so the
   * two modes beat against each other: the wrongness is in the physics, not
   * in a sour note bolted on.
   */
  reject: {
    tier: 'soft',
    render: () => {
      const out = modal(
        0.22,
        [
          [196, 1.0, 0.09],
          [208, 0.9, 0.09],
          [104, 0.5, 0.07],
        ],
        { ms: 7, cutoff: 1500, amp: 0.5 },
      );
      return highpass(saturate(out, 1.8), 90);
    },
  },

  /* --- the four operators ---------------------------------------- */

  /** Rising fifth: two things becoming a larger thing. */
  opAdd: { tier: 'soft', render: () => glide(OP_SECONDS, 392, 587, easeOut) },

  /** The same interval, walked back down. */
  opSub: { tier: 'soft', render: () => glide(OP_SECONDS, 587, 392, easeOut) },

  /** No glide: a hard octave jump, because multiplying is not a walk. */
  opMul: {
    tier: 'soft',
    render: () => {
      const out = buf(OP_SECONDS);
      mix(out, glide(0.055, 392, 392), 0, 1);
      mix(out, glide(0.105, 784, 784), 0.05, 0.95);
      return out;
    },
  },

  /** A long smooth descent — the one operator that can make things smaller. */
  opDiv: { tier: 'soft', render: () => glide(0.2, 784, 392, smooth) },

  /* --- hand outcome ---------------------------------------------- */

  /** Dead end: the reject cue, sagging. Not a failure, just nowhere left. */
  deadEnd: {
    tier: 'soft',
    render: () => {
      const g = glide(0.34, 300, 190, easeIn, 3);
      const out = buf(0.36);
      mix(out, g, 0, 1);
      mix(out, modal(0.3, [[196, 0.4, 0.12], [206, 0.35, 0.12]]), 0.02);
      return highpass(out, 100);
    },
  },

  /** Deck complete: a four-bell arpeggio, the longest sound in the app. */
  deckDone: { tier: 'loud', render: () => bells([523, 659, 784, 1047], 0.075, 0.3, 0.62) },

  /** Personal best: the same bells with a shimmer on top. */
  best: {
    tier: 'loud',
    render: () => {
      const out = bells([523, 784, 1047], 0.07, 0.34, 0.66);
      mix(out, bells([1319, 1568], 0.05, 0.22, 0.4), 0.14, 0.35);
      return out;
    },
  },

  /** Beat the challenger: three notes climbing, with a tail to sit in. */
  beatTarget: {
    tier: 'loud',
    render: () => {
      const out = buf(0.72);
      [659, 880, 1319].forEach((f, i) => {
        mix(out, bells([f], 0, i === 2 ? 0.4 : 0.16, 0.6), i * 0.085);
      });
      return out;
    },
  },

  /* --- chrome ----------------------------------------------------- */

  /** Primary CTA. A button with some mass behind it. */
  cta: {
    tier: 'soft',
    render: () => {
      const out = modal(
        0.2,
        [
          [330, 1.0, 0.08],
          [494, 0.45, 0.06],
          [660, 0.2, 0.03],
        ],
        { ms: 4, cutoff: 4000, amp: 0.3 },
      );
      return highpass(out, 150);
    },
  },

  /** Copied: two blips, the second higher. Small and finished. */
  copied: {
    tier: 'soft',
    render: () => {
      const out = buf(0.14);
      mix(out, glide(0.045, 660, 660, easeOut, 3), 0, 1);
      mix(out, glide(0.075, 990, 990, easeOut, 3), 0.045, 0.85);
      return out;
    },
  },

  /** Start Over armed: a safety being flicked, twice, dry. */
  arm: {
    tier: 'whisper',
    render: () => {
      const out = buf(0.09);
      mix(out, burst(0.008, 1800, 0.002), 0, 1);
      mix(out, burst(0.008, 1600, 0.002), 0.055, 0.8);
      return highpass(out, 300);
    },
  },

  /** Undo: a click swept backwards, the cutoff opening instead of closing. */
  undo: {
    tier: 'whisper',
    render: () => highpass(burst(0.05, (u) => 500 + 2600 * u, 0.09), 250),
  },

  /** Reset: three tiny contacts, a hand squaring up a pile. */
  reset: {
    tier: 'whisper',
    render: () => {
      const out = buf(0.1);
      for (let i = 0; i < 3; i++) mix(out, burst(0.01, 2000 - i * 300, 0.004), i * 0.026, 1 - i * 0.2);
      return highpass(out, 260);
    },
  },

  /** Advance to the next hand: a soft page-turn with a little body. */
  advance: {
    tier: 'whisper',
    render: () => {
      const out = buf(0.09);
      mix(out, burst(0.02, 1000, 0.008), 0, 1);
      mix(out, modal(0.06, [[260, 0.35, 0.02]]), 0.004);
      return highpass(out, 160);
    },
  },

  /**
   * Wedge cross. The most frequent cue in the app by an order of magnitude:
   * 8ms, dark, and deliberately almost nothing.
   */
  wedge: { tier: 'whisper', render: () => highpass(burst(0.008, 1200, 0.003), 350) },

  /** Navigation. Neutral, directionless, forgettable. */
  nav: { tier: 'whisper', render: () => highpass(burst(0.012, 1100, 0.005), 220) },

  /** Tutorial step: nav plus a blip, so progress reads as progress. */
  step: {
    tier: 'whisper',
    render: () => {
      const out = buf(0.08);
      mix(out, burst(0.01, 1300, 0.004), 0, 1);
      mix(out, glide(0.05, 880, 880, easeOut, 2), 0.008, 0.5);
      return highpass(out, 200);
    },
  },
};

/* ------------------------------------------------------------------ *
 * WAV out
 * ------------------------------------------------------------------ */

function wav(samples) {
  const bytes = samples.length * 2;
  const out = Buffer.alloc(44 + bytes);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + bytes, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16); // fmt chunk size
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(SR, 24);
  out.writeUInt32LE(SR * 2, 28); // byte rate
  out.writeUInt16LE(2, 32); // block align
  out.writeUInt16LE(16, 34); // bits
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(bytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    out.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return out;
}

mkdirSync(OUT, { recursive: true });

let total = 0;
const rows = [];
for (const [name, { tier, render }] of Object.entries(CUES)) {
  rand = mulberry32(hashCode(name));
  /* deClick BEFORE normalize: the fade steals peak from an 8ms burst, and a
     cue that lands under its tier gain is a cue nobody hears. */
  const samples = normalize(deClick(render()), TIER[tier]);
  const data = wav(samples);
  writeFileSync(join(OUT, `${name}.wav`), data);
  total += data.length;
  rows.push([name, tier, `${Math.round((samples.length / SR) * 1000)}ms`, `${(data.length / 1024).toFixed(1)}K`]);
}

const w = rows.reduce((a, r) => r.map((c, i) => Math.max(a[i] ?? 0, c.length)), []);
for (const r of rows) console.log(r.map((c, i) => c.padEnd(w[i])).join('  '));
console.log(`\n${rows.length} cues, ${(total / 1024).toFixed(1)}K total`);
