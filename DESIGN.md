# twentyfour — Design Doc

A browser game of the classic **24 point** card puzzle. Four cards, the four
arithmetic operations, make 24. Pure static frontend, hosted on GitHub Pages,
no backend anywhere.

**Status:** design agreed, initial implementation in progress.

---

## 1. Core rules

Deal 4 cards. Using `+ − × ÷` and each card **exactly once**, build an
expression equal to **24**. Parentheses are implicit in the interaction model
(see §5) — the player composes the expression by combining cards pairwise, so
any parse tree is reachable.

### Levels

| Level | Card values | Deck size | Hands per deck |
|---|---|---|---|
| Easy | A–9 (A = 1) | 36 | 9 |
| Hard | A–K (A = 1, J = 11, Q = 12, K = 13) | 52 | 13 |

Easy drops 10 through K; hard is the full standard deck. Suits are purely
cosmetic — they affect the card face, never the math.

### Unsolvable hands

Not every set of four cards can make 24. Measured over 20,000 random deals:

| Level | Unsolvable rate |
|---|---|
| Easy (1–9) | **9.3%** |
| Hard (1–13) | **19.6%** |

So on hard this is not an edge case — roughly 1 hand in 5 has no solution, and
a typical deck hits two or three of them. `1,1,1,1`, `1,1,2,2`, and
`13,13,13,13` are all dead.

**The rule:** an unsolvable hand is set aside and its cards shuffled back into
the remaining pile. **But this must be resolved at deal time, never during
play.**

#### Why live resolution deadlocks

Play the naive version forward. Deal 4, check, reshuffle on failure — fine
while the pile is large. Now run it to the end of the deck:

- 4 cards remain. Deal them. Unsolvable.
- Shuffle those 4 and deal 4 again → **the same four cards.**

Shuffling changes only **order**, and order is irrelevant to solvability:
`{7,7,3,3}` works in any sequence and `{1,1,1,1}` fails in any sequence. The
retry is a no-op and the game hangs forever.

It isn't only the final hand. With 8 cards left there are just 35 ways to split
them into two hands; if none yields two solvable hands, it deadlocks there too.
**The freedom to redeal shrinks to zero exactly where the rule needs it most.**

#### What the generator does instead

```
pool = shuffle(deck, seeded)
while pool has >= 4 cards:
    candidate = top 4 of pool
    if solver says candidate makes 24:
        commit as a hand; remove those 4 from pool
    else:
        reshuffle the WHOLE pool (candidate included) and retry
        after 40 consecutive failures: stop, remaining cards are leftover
```

Two details carry the weight:

- **Reshuffle the whole pool, not just the rejected four** — reshuffling only
  the four is the no-op described above.
- **The retry cap is the escape hatch,** not decoration. It is what terminates
  the case that has no solution at all. When it trips, the deck ends one hand
  early and the last four cards are reported as leftover.

Measured outcome of that loop over 3,000 decks:

| Level | Full deck | One hand short |
|---|---|---|
| Easy | 9 hands, 87.6% | 8 hands, 12.4% |
| Hard | 13 hands, 72.8% | 12 hands, 27.2% |

So **the UI must read the hand count off the generated deck**, not assume 13.
Solving a whole deck up front costs microseconds, so there is no reason to defer
it. It also means both players in a challenge get the same number of hands and
correct progress pips from the first second.

If guaranteed-full decks are ever wanted, the upgrade is a backtracking
partition search (split the 52 cards into 13 solvable groups, backtrack when
stuck) instead of random retry. More code, slightly non-uniform decks; only
worth it if the 27% short-deck rate becomes annoying.

### Give up

The player may give up on any hand. The app shows a correct solution (from the
solver) and applies a time penalty. The hand is not replayed.

**There are no hints.** Give up is the only assist, and it ends the hand. A
graduated hint system was considered and cut: it needs a defensible definition
of "the first move" out of a solution tree, it adds a second penalty constant to
balance, and it blurs the one clean decision the player has to make.

---

## 2. Scoring — time, not points

**Score = total elapsed time to clear the deck. Lower is better.**

- Timer starts on the first deal, stops when the last hand is solved.
- Give up → **+30 s** penalty, answer revealed. This is the only penalty.

Per-hand points were considered and rejected: they feel good moment-to-moment
but make cross-player comparison mushy, and comparison is the whole point of
the multiplayer model.

### Per-hand splits

Splits are recorded and **shown on the result screen** as a small horizontal
bar per hand, with the slowest hand scaled to full width. Hands that were given
up on are red. When an opponent's splits arrived in the challenge link, each row
also shows the per-hand delta, so you can see exactly which hand won or lost the
run rather than only the total.

Splits travel inside the challenge payload, which doubles as a plausibility
check on a shared time (see §3).

---

## 3. Two-player: shared-seed challenge links

There is no server, no socket, no shared state. **The URL is the entire
message.** It works like mailing someone a puzzle you have already solved.

### Mechanism

1. **Seeded PRNG.** A `mulberry32` generator seeded from a short code makes
   deck generation a pure function: same seed → identical 48 cards in
   identical order → identical hands, on any device, forever. Both players
   solve literally the same puzzles in the same sequence, which is what makes
   the time comparison fair.

2. **Result rides in the URL fragment.**

   ```
   https://<user>.github.io/twentyfour/#c=<base64url({s,l,n,t,...})>
   ```

   `s` seed · `l` level · `n` name · `t` time. Use the **fragment**, not a
   query string: fragments are never sent to the server, which suits static
   hosting, and keeps the payload entirely client-side.

3. **The reply is another link.** The recipient plays, and their result link
   carries *both* times. It ping-pongs like chess by mail. Every challenge
   seen is stored in `localStorage`, so a head-to-head record accumulates
   with no database in existence.

### Hard invariant

`buildDeck(seed, level)` must be a **pure function** — no clock access, no
player input, no unseeded randomness, including inside the unsolvable-hand
retry loop. If anything else influences it, the two players get different
hands from the same seed and the comparison is meaningless. This is the single
most important correctness property in the codebase.

### Accepted limitation

Times in a link are trivially forgeable — anyone can edit the base64. This is
a game played between people who know each other; we accept it. Per-hand
splits travel in the payload so an implausible time is at least visibly
implausible. No cryptographic verification.

### What the seed also gives us for free

Solo play, async challenges, and "replay that exact deck" — all with no
additional machinery. (A Wordle-style daily puzzle would also fall out of this
for free, but it is explicitly **not** in scope.)

---

## 4. The solver

Needed for three things: deciding whether a hand is solvable (deck
generation), showing the answer on give-up, and generating hints.

### Algorithm: recursive pairwise combine

**Not** permutations-plus-operator-strings. That approach (`4!` orderings ×
`4³` operator fillings) only ever builds *left-linear* trees
`((a∘b)∘c)∘d`, and silently misses the balanced shape `(a∘b)∘(c∘d)` — where a
large share of real solutions live, e.g. `(3−2)×(4×6)`.

Instead, treat the state as a **bag of numbers**. One move removes two
elements and puts back one combined result. Recurse until one element remains,
then test `== 24`:

```
{3,3,7,7} --(3/7)--> {3, 3/7, 7} --(3+3/7)--> {24/7, 7} --(×7)--> {24} ✓
```

Because an intermediate result is indistinguishable from an original card,
**every parse tree of every arity is reachable with one loop nest and no
special cases.**

Six operations per unordered pair: `a+b`, `a−b`, `b−a`, `a×b`, `a÷b`, `b÷a`
(`+` and `×` commute, `−` and `÷` do not). Guard both divisions against a zero
denominator.

Search size is trivial:

| bag size | pairs C(n,2) | × 6 ops | branches |
|---|---|---|---|
| 4 | 6 | 6 | 36 |
| 3 | 3 | 6 | 18 |
| 2 | 1 | 6 | 6 |

≈3,900 leaves worst case (measured 3,480 for `1,1,1,1`, lower because
subtraction reaching zero prunes the division branches). Microseconds — cheap
enough to solve an entire deck at deal time.

### Exact rationals, not floats

24-game solutions love fractional intermediates — `7×(3+3/7)`, `6÷(1−3/4)`,
`8÷(3−8/3)` — and those are most of the hard set. Floats plus an epsilon
mostly work, but:

1. **False positives.** A loose epsilon lets `a ÷ tiny_residue` land near 24
   when the exact value is not, so the app claims a hand is solvable and shows
   an "answer" that does not evaluate to 24.
2. **We need exactness for display anyway** — the UI must render `3 3/7` or
   `24/7`, never `3.4285714285714284`.

Representation is a normalized integer pair, sign in the numerator:

```ts
type Rat = { n: number; d: number };  // d > 0, gcd(|n|, d) === 1
```

Card values ≤ 12 with 3 operations keep numerator and denominator far inside
`Number.MAX_SAFE_INTEGER`. No BigInt.

### Two behaviors

- **Solvable?** — return on the first hit (fast; `2,3,4,6` resolves in 238
  leaves rather than 3,480). Used for every candidate hand at deal time.
- **Best answer to display** — collect all solutions, dedupe by canonical
  form, prefer the one with the fewest fractional intermediates, then the most
  balanced tree, then the shortest rendering. Players find `(3−2)×(4×6)` more
  satisfying than a division-heavy equivalent. Used only on give-up.

Each bag element carries `{ value: Rat, expr: ExprNode }`, so the displayable
expression is built on the way down at no extra cost.

### Shared primitive

`combine(a, b, op)` is used by both the solver and the drag interaction. One
player gesture = one solver edge. The game logic and the search share the same
function, so they cannot disagree.

---

## 5. Interaction model

### Layout

Four cards in a **2 × 2 grid**. Timer and hand counter above; give up / undo /
reset below.

### Drag to combine

Drag any card onto any other card. On hover, the target card reveals four
quadrants: `+  −  ×  ÷`. Releasing over a quadrant applies that operation.
The two source cards are removed and **one new card** holding the result takes
the target's slot. Repeat until one card remains; if it reads 24, the hand is
won.

### Operand order

`−` and `÷` are not commutative. Resolution: **the dragged card is always the
left operand.**

- Drag 7 onto 3 → `7 − 3`
- Drag 3 onto 7 → `3 − 7`

So the quadrants stay a simple `+ − × ÷`, and reversing an operation is just
dragging the other direction. The alternative — six zones labeled `a−b` /
`b−a` — is unambiguous but fiddly on a phone.

### Required affordances

- **Undo** — a step-back stack. People misdrop constantly.
- **Reset hand** — return to the four dealt cards.
- Fractional results display as fractions (`24/7`), never decimals.

### Implementation note

Use **pointer events** (`pointerdown` / `pointermove` / `pointerup` +
`setPointerCapture`), not HTML5 drag-and-drop (miserable on touch) and not a
DnD library (overkill for four targets). ~80 lines, identical behavior on
mouse and touch, full control over quadrant hit-testing.

---

## 6. Share moments

The link mechanism is invisible, so the UI is the only thing that makes intent
legible. Two sides, both required.

### Sending — end-of-run screen only

No share affordance during a run; it invites leaving mid-timer. On completion:

```
143.2s · hard · 1 gave up

[ Challenge someone to beat this ]
copies a link — paste it anywhere
```

Label by outcome, not mechanism. Use `navigator.share()` where available,
clipboard-copy fallback otherwise, and confirm inline ("Link copied — send it
to them"). Never show the raw URL unless asked.

### Receiving — before the first card

```
Chen challenged you
hard · 12 hands · time to beat 143.2s

[ Start ]
```

Without this, the recipient thinks it is an ordinary game and the framing is
lost. During play, the target stays passive: grey `vs 143.2` beside the
running clock — not a countdown, not a warning. On finishing, the reply is
pre-framed: `[ Send Chen your result ]`, not a generic share button.

### Smaller calls

- Name is entered **once**, stored in `localStorage`, reused. Prompting at
  share time adds friction at the exact moment you want a single tap.
- **Always play first, then challenge.** Sending a deck cold is technically
  identical but a worse product: no target to chase, no immediate result, and
  nothing to be proud of when pasting the link.

---

## 7. Visual design

Minimalist. Palette is **black / white / grey / red**.

- Black on white for structure and card faces.
- Grey for passive information: the opponent's target time, card chrome,
  disabled controls, hand counter.
- **Red is the single accent and gets spent on exactly two things:** the
  primary CTA, and the give-up / penalty state. Nothing else. That keeps the
  challenge button unambiguously *the* thing to press.

Card faces are typographic — rank and suit glyph, no illustration. Red suits
(♥ ♦) are the one place red appears decoratively; keep it the same red or a
slightly muted variant so it does not compete with the CTA.

---

## 8. Persistence

`localStorage`, not cookies — cookies are 4 KB and get sent with every
request; `localStorage` gives ~5 MB of JSON.

Stored: player name, personal best time per (level, seed), challenge history
for the head-to-head record, and preferences.

A truly global leaderboard is impossible on GitHub Pages (read-only static
hosting) and is out of scope. If it is ever wanted, the cheapest escapes are a
Cloudflare Worker + KV, or Supabase with an insert-only RLS policy — both keep
the frontend exactly as it is. Note that any client-writable leaderboard is
forgeable regardless.

---

## 9. Stack

**Vite + React + TypeScript**, and close to nothing else.

- **Vite** — `base: '/twentyfour/'` plus a GitHub Action is the entire deploy
  story.
- **TypeScript** — a `Rat`, an `ExprNode`, and a bag of tagged cards are
  exactly the kind of thing that saves hours of debugging.
- **React** — chosen over Vue/Svelte for ecosystem depth, not technical need.
  The design is framework-agnostic. Angular would be far too heavy.
- **CSS** — plain CSS with custom properties for the four-color palette. No
  Tailwind, no CSS-in-JS.
- **No DnD library.** See §5.
- **Vitest** for the solver and deck-determinism tests. These two are the
  parts where a silent bug is invisible in the UI, so they get real tests:
  known-solvable hands, known-unsolvable hands, fraction-only solutions, and
  `buildDeck(seed) === buildDeck(seed)` across runs.

### Layout

```
src/
  lib/
    rational.ts    exact arithmetic
    solver.ts      pairwise-combine search + answer selection
    rng.ts         mulberry32 + seeded shuffle + seed codes
    deck.ts        pure buildDeck(seed, level) → Hand[]
    challenge.ts   encode/decode the URL payload
    storage.ts     localStorage wrapper
  components/      Card, Board, Timer, ResultScreen, ChallengeIntro
  App.tsx
```

### Deploy

GitHub Actions on push to `main`: `npm ci && npm run build`, publish `dist/`
to Pages. Live at `https://<user>.github.io/twentyfour/`.

---

## 10. Decided and out of scope

- **No hints.** Give up is the only assist. See §1.
- **No daily puzzle.** The seed mechanism would support it; we are not building
  it.
- **Per-hand splits are shown** on the result screen, with opponent deltas. See
  §2.
- **No global leaderboard.** Impossible on static hosting; see §8.

### Still open

- Whether a wrong-but-committed hand (one tile left, not 24) should cost
  anything, or stay free to undo as it is now.
- Keyboard support for desktop play — currently drag-only.
