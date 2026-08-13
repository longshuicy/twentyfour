# CLAUDE.md

Working notes for Claude Code sessions in this repo. Read `DESIGN.md` first —
it holds the reasoning behind every decision here.

## What this is

A 24-point card game. Four cards, `+ − × ÷`, each card used exactly once, make
24. Pure static frontend on GitHub Pages. **No backend exists and none should
be added.**

## Commands

```bash
npm install
npm run dev      # vite dev server
npm test         # vitest: solver + deck determinism
npm run build    # tsc --noEmit && vite build
```

## Invariants — do not break these

1. **`buildDeck(seed, level)` must stay a pure function.** No `Date.now()`, no
   `Math.random()`, no player input, no unseeded randomness anywhere in
   `src/lib/deck.ts` or `src/lib/rng.ts`'s seeded paths. Two players opening the
   same challenge link must get byte-identical hands, or the entire multiplayer
   model is meaningless. `randomSeedCode()` is the *only* sanctioned use of
   unseeded randomness, and it runs before a deck exists.

2. **All game arithmetic goes through `src/lib/rational.ts`.** Never introduce
   floats or epsilon comparisons into solving or scoring. `24/7` must render as
   `24/7`, never `3.4285714285714284`.

3. **The solver and the drag interaction share `combine()`** from
   `src/lib/solver.ts`. One player gesture equals one solver edge. Do not
   reimplement operation semantics in the UI layer.

4. **Solvability is decided at deal time,** never during play. See DESIGN.md §1
   and §4: resolving it live can hang forever at the tail of the deck, because
   reshuffling a 4-card pile yields the same 4-card set.

5. **`vite.config.ts` `base` must match the repo name** (`/twentyfour/`) or
   GitHub Pages serves a blank page.

## Layout

```
src/lib/rational.ts   exact rational arithmetic
src/lib/solver.ts     recursive pairwise combine + answer ranking
src/lib/rng.ts        mulberry32, seed codes, seeded shuffle
src/lib/deck.ts       pure buildDeck(seed, level) -> Hand[]
src/lib/hand.ts       in-play tile bag + undo
src/lib/challenge.ts  URL-fragment encode/decode
src/lib/storage.ts    localStorage (name, bests, history)
src/lib/sound.ts      three cue clips + mute toggle, all failing soft
src/assets/*.mp3      long wait / give up / succeed clips
src/components/       Board (pointer-event drag), CardFace, Icons (inline SVG)
src/App.tsx           screens: home / intro / play / done
```

## Copy

- **No em dashes anywhere in user-facing copy.** Use a comma, colon, or
  parentheses, or split the sentence. En dashes in ranges (`A–K`, `A–9`) are
  fine, they are range markers.
- Units live in the formatter, not the call site: `formatTime` already appends
  `s` to sub-minute values, so never write `{formatTime(t)}s`.

## Style

- Dark ground, white / grey type, red only. **Red is spent on exactly two
  things: the primary CTA and the give-up / penalty state.** Red suit glyphs use
  `--red-muted` so decoration never competes with the button — and the drop
  wheel's selected operator is white, not red, for the same reason.
- `--ink` is the foreground and `--paper` the ground, as in the light build;
  only the values flipped. Cards sit on `--card-face`, one step lighter than
  the page.
- Card size is fluid: set `--card-w` (a `clamp()`) and everything else — height,
  rank size, corner size, wheel geometry — is derived from it. Don't hardcode
  card pixel sizes at breakpoints.
- Icons are inline SVG on `currentColor` (`src/components/Icons.tsx`), never
  emoji: emoji ignore the palette and render differently per platform.
- Your own result in a saved history entry is the **last** one in `results`,
  not the one matching your name — renaming yourself must not erase your record.
- Sound is a bonus, never the message: every cue has a visual that means the
  same thing. Import clips from `src/assets` (never a literal `/assets/...`
  path — it 404s under the Pages base) and let every audio call fail silently.
- A running CSS animation outranks the inline transform the drag writes, so any
  card-level animation must exclude `.dragging` and `.armed`, or dragging stops
  following the pointer.
- Pointer events for drag. No HTML5 drag-and-drop, no DnD library. The drop
  target's op picker is a radial wheel that overflows the card (so a finger
  can't cover the choices); its selection is by *direction* from the card's
  centre, with a hub dead zone and a sticky margin outside the card.
- No new runtime dependencies without a clear reason. Current runtime deps are
  React and React DOM, full stop.

## Testing expectations

The solver and deck generator are where a silent bug is invisible in the UI, so
they carry real tests. If you touch either, the suite must still cover:
known-solvable hands, fraction-only solutions, known-unsolvable hands, the
balanced-tree case (`2,3,4,6`), `buildDeck(seed) === buildDeck(seed)`, and
every-card-used-exactly-once.

## Explicitly out of scope

Do not add these back without being asked:

- **Hints.** Give up (+120s, shows the answer) is the only assist.
- **A daily puzzle.**
- **A global leaderboard** or any server, database, or hosted service.
- **New runtime dependencies**, including a drag-and-drop library.

Remaining open questions are in DESIGN.md §10.
