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

Drag any card onto any other card. On hover, the target card raises a **radial
op wheel** — `+` up, `×` right, `−` down, `÷` left — and releasing on a spoke
applies that operation. The two source cards are removed and **one new card**
holding the result takes the target's slot. Repeat until one card remains; if
it reads 24, the hand is won.

**The dragged card does not move.** It stays in its slot, dimmed and dashed to
read as picked up, and a small proxy card carrying just its value follows the
pointer above everything else. Dragging the full-size card was the first
version and it fought the wheel: a whole card under the pointer covered the
target it was being aimed at. The proxy sits up and to the left on the
diagonal, because the four spokes are at the compass points and straight up put
it on top of `+` exactly when `+` was the choice being made.

The wheel replaced a four-quadrant overlay drawn *inside* the target card. The
overlay was unusable for the reason every in-place picker is: the hand doing
the dragging sits on top of the card, so the choices were under the player's
own finger. The wheel is larger than the card and its spokes sit outside the
card's edges, which puts every option in clear air.

Two consequences fall out of that geometry, and both are deliberate:

- **Choice is by direction from the target's centre, not by position inside
  it.** A dead zone at the hub means a drag that lands dead-centre selects
  nothing — a drop there is a no-op rather than an arbitrary operation.
- **An armed target stays armed while the pointer strays outside it**, up to
  about half a card. The outer half of each spoke is beyond the card's own
  bounds; without stickiness those pixels would deselect the target the moment
  the player reached for the thing they were aiming at.

### Operand order

`−` and `÷` are not commutative. Resolution: **the dragged card is always the
left operand.**

- Drag 7 onto 3 → `7 − 3`
- Drag 3 onto 7 → `3 − 7`

So the wheel stays a simple `+ − × ÷`, and reversing an operation is just
dragging the other direction. The alternative — six zones labeled `a−b` /
`b−a` — is unambiguous but fiddly on a phone.

### Feedback: three moments, sound plus motion

Three things happen to a player that deserve a response, and each gets one
visual cue and one short clip:

| Moment | Visual | Sound |
| --- | --- | --- |
| 30s on one hand | board breathes, staggered; a line appears naming the elapsed time and the give-up price | `long_wait_meow` |
| Give up | the screen shakes once | `dog_giveup_woof` |
| Made 24 | the cards pop and outline in white, held for 750ms before the next deal | `succeed_meow` |

**The visual carries the meaning; the sound is a bonus.** Audio is muted,
blocked by autoplay policy until the first gesture, or simply off far more
often than it plays, so nothing may depend on hearing it. The clips are
imported through Vite rather than referenced by path, so they are fingerprinted
and rewritten for the `/twentyfour/` base — a literal `/assets/…` URL 404s on
GitHub Pages. A mute toggle sits next to the hand counter and persists.

The long-wait nudge fires **once per hand**, not once per tick, and never while
the answer is on screen. Repeating it every 30 seconds would turn a hard hand
into nagging.

All motion is suppressed under `prefers-reduced-motion`. One subtlety worth
keeping in mind if these are ever edited: a running CSS animation outranks the
inline transform the drag writes, so any card-level animation has to exclude
`.dragging` and `.armed` or dragging silently stops tracking the pointer.

### Required affordances

- **Undo**: a step-back stack. People misdrop constantly.
- **Reset hand**: return to the four dealt cards.
- **Start over**: restart the whole run from hand 1 on the same deck. Undo and
  Reset are free and instant, so they act on the first tap; this one throws
  away a run in progress, so it asks once and disarms itself after three
  seconds rather than sitting hot for the rest of the hand.
- Fractional results display as fractions (`24/7`), never decimals.
- Times carry their unit in the formatter, not at the call site: `41.3s` under a
  minute, `2:23.1` above it. A bare number says nothing, and `2:23.1s` is an
  `s` stapled to a clock reading.

### Implementation note

Use **pointer events** (`pointerdown` / `pointermove` / `pointerup` +
`setPointerCapture`), not HTML5 drag-and-drop (miserable on touch) and not a
DnD library (overkill for four targets). ~80 lines, identical behavior on
mouse and touch, full control over wheel hit-testing.

---

## 6. Share moments

The link mechanism is invisible, so the UI is the only thing that makes intent
legible. Two sides, both required.

### Sending — end-of-run screen only

No share affordance during a run; it invites leaving mid-timer. On completion:

```
143.2s · hard · 1 gave up

Your challenge link
[ https://…/twentyfour/#c=eyJzIjoi… ] [ Copy ]

Send it to someone yourself, in a message or an email. Whoever opens
it plays the exact same 13 hands, in the same order, racing your
143.2s. When they finish they see who won, and they get a link back
to you with both times in it.
```

**Show the URL. Copy is the only thing the app does.** This went through two
worse drafts. The first read `[ Send Chen your result ]`, which was simply
false: nothing is sent, there is no recipient and no server. The second said
*Share challenge link* and called `navigator.share()`, which is better but
still leaves a player unsure whether anything left the device, because on some
platforms the share sheet looks exactly like sending.

Putting the link on screen settles it. You can see the thing that exists, the
button next to it says `Copy`, and the sentence underneath says the sending is
yours to do. If the clipboard write is refused (denied permission, insecure
origin) the field selects itself instead, so the player can copy by hand rather
than being told it worked when it did not.

### Receiving — before the first card

```
Chen challenged you
hard · 12 hands · time to beat 143.2s

[ Start ]
```

Without this, the recipient thinks it is an ordinary game and the framing is
lost. During play, the target stays passive: grey `vs 143.2` beside the
running clock — not a countdown, not a warning. On finishing, the reply link
is the same copy-a-link flow described above, with the challenger's time
already carried inside it.

### Smaller calls

- **Easy leads on the home screen and is the primary button.** A–9 is the
  version most people can actually finish; hard is one tap below it. Opening
  with the hardest option is a filter, not a welcome.

- Name is entered **once**, stored in `localStorage`, reused. Prompting at
  share time adds friction at the exact moment you want a single tap.
- **Always play first, then challenge.** Sending a deck cold is technically
  identical but a worse product: no target to chase, no immediate result, and
  nothing to be proud of when pasting the link.

---

## 7. Visual design

Minimalist and **dark-ground**: near-black page, white and grey type, red as
the single accent.

- Cards sit one step lighter than the page so they read as objects on a
  surface rather than holes cut in it. That separation is the whole reason the
  ground is not pure black.
- **The banner is the one element allowed to shout.** "TwentyFour" spelled out,
  fluid up to 76px, with the tagline in spaced small caps beneath it. Nothing
  else on the home screen competes: the house rules underneath are small and
  set in grey, because they are read once and then never again.
- Card size is fluid (`clamp()` on a single `--card-w` custom property, with
  height derived from it), so one rule covers a 375px phone and a desktop
  window. On desktop the column also widens and centres vertically instead of
  hugging the top of a tall window.
- Grey for passive information: the opponent's target time, card chrome,
  disabled controls, hand counter.
- **Red is the single accent and gets spent on exactly two things:** the
  primary CTA, and the give-up / penalty state. Nothing else. That keeps the
  challenge button unambiguously *the* thing to press.

Card faces are typographic — rank and suit glyph, no illustration. Red suits
(♥ ♦) are the one place red appears decoratively; keep it the same red or a
slightly muted variant so it does not compete with the CTA.

**The middle of a card shows its number, always.** A reads 1, J/Q/K read
11/12/13, and the letters survive in the four corner indices. The centre is the
operand you are doing arithmetic with; making the player translate a letter
every time is a tax with no upside, and once J/Q/K are numeric, leaving the ace
alone is an inconsistency rather than a kindness. All four corners are upright:
the traditional 180°-rotated bottom pair makes a rotated ♥ read as a ♠ at this
size.

---

### Seeing your own record

Bests, run history and the head-to-head tally were all being written from the
first build and never shown anywhere — the data existed, the screen did not.
There is now a **Your record** screen, reached from a quiet strip under the
play buttons (and repeated on the result screen), holding:

- best time per level, runs played, and how many were cleared without a give-up
- the head-to-head tally across decks people sent you
- the last ten runs, each marked with the rival's name where the deck was a
  match, and coloured by whether you beat them

Two decisions worth keeping. **Your own row is identified by position, not by
name** — `finish()` appends the local player last, and matching on name would
lose your whole history the moment you renamed yourself, or claim an opponent's
row when you both picked the same name. And the screen says plainly that this
lives in one browser: no account exists to sync it, so a different device or a
cleared browser starts from zero. Better to say so than to let someone
discover it.

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
