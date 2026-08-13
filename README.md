# 24

Four cards. Use each one exactly once with `+ − × ÷` to make **24**. Clear the
whole deck as fast as you can, then send a friend a link to race the identical
deck.

No backend. No accounts. Static files on GitHub Pages.

## Play

```bash
npm install
npm run dev
```

## Levels

| Level | Cards | Deck | Hands |
|---|---|---|---|
| Easy | A–9 | 36 | 9 |
| Hard | A–K (J=11, Q=12, K=13) | 52 | 13 |

Roughly 1 in 5 random four-card hands from a full deck cannot make 24, so the
deck is dealt into guaranteed-solvable hands before the timer starts. A hard
deck yields 13 hands about 73% of the time and 12 otherwise, with the last four
cards reported as leftover.

## Scoring

Total elapsed time to clear the deck. Lower wins.

- Give up → **+30s**, and the answer is shown. That's the only penalty; there
  are no hints.

The result screen breaks the run down per hand, and when you're answering a
challenge it shows the per-hand delta against your opponent.

## Two players, no server

The URL is the whole message. A short seed code makes deck generation a pure
function, so the same code produces the same 52 cards on any device. Your
result is encoded into the link's fragment; your opponent opens it, plays the
identical deck, and sees both times. Their reply link carries both results
back. Every challenge is kept in `localStorage`, which accumulates a
head-to-head record with no database in existence.

Times in a link are forgeable by design — this is a game for people who know
each other.

## Deploy

Push to `main`. The included Action builds and publishes to Pages at
`https://<user>.github.io/twentyfour/`. Enable Pages with source **GitHub
Actions** in repo settings once.

If you rename the repo, update `base` in `vite.config.ts` to match.

## Docs

- `DESIGN.md` — the full design, with reasoning
- `CLAUDE.md` — invariants and working notes
