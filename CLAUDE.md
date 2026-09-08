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
src/lib/sound.ts      the cue table, mute toggle, per-cue throttle, all failing soft
src/assets/*.mp3      long wait / give up / succeed clips (recordings)
src/assets/cues/*.wav generated cues, committed; see scripts/gen-sounds.mjs
src/components/       Board (pointer-event drag), CardFace, Header, Icons,
                      Tutorial (guided first hand)
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
- **Cues are tiered, and the tier is baked into the file, not applied at
  runtime.** `loud` is reserved for earned moments (a win, a give-up, the end
  of a deck), `soft` answers a gesture, `whisper` fires constantly and sits at
  the edge of hearing. Adding a cue means picking a tier in
  `scripts/gen-sounds.mjs`, not adjusting a volume at the call site.
- **One action, one cue.** A handler that sounds a cue and then calls something
  that sounds another plays both: that is what made "Play easy" fire the CTA
  twice. The cue belongs to whichever layer owns the action, and the other
  layer stays quiet.
- Cue files are generated and committed. `scripts/gen-sounds.mjs` seeds its
  noise from the cue's own name, so a regeneration is a no-op diff; if it is
  not, something changed on purpose or the script drifted.
- A running CSS animation outranks the inline transform the drag writes, so any
  card-level animation must exclude `.dragging` and `.armed`, or dragging stops
  following the pointer.
- **Keep the pointer position out of React state.** It lives in a ref, is
  written straight to the proxy's transform, and moves are coalesced into one
  rAF. Slot rects are measured once per drag, never per move. Re-rendering the
  board on every pointer event is what made the drag feel sticky.
- **`pointerup` must resolve the drop synchronously** from the last pointer
  position, not from the last frame's result: a fast flick, or a backgrounded
  tab, can end a drag before any frame runs.
- Pointer events for drag. No HTML5 drag-and-drop, no DnD library. The drop
  target's op picker splits the target card into four corner-to-corner wedges;
  its selection is by *direction* from the card's centre, with a hole at the
  centre for the dead zone and a sticky margin outside the card.
- **The picker's drawing and `sectorAt` must stay the same shape.** The angle
  is measured in card-normalised space precisely so the 45 degree boundaries
  land on the card's real diagonals: change the card's aspect ratio and
  `CARD_RATIO` in `Board.tsx` has to follow `--card-h`, or the seams stop
  running through the corners. The hole's radius is derived from `HUB` for the
  same reason.
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
