import { useEffect, useMemo, useRef, useState } from 'react';
import { Board } from './components/Board';
import { buildDeck, type Deck, type Level } from './lib/deck';
import {
  applyOp,
  canUndo,
  initHand,
  isDeadEnd,
  isSolved,
  undo,
  type HandState,
} from './lib/hand';
import { findBestSolution, exprToString, type Op } from './lib/solver';
import { formatTime, round1 } from './lib/format';
import {
  buildChallengeUrl,
  clearUrlChallenge,
  readChallengeFromUrl,
  type Challenge,
  type RunResult,
} from './lib/challenge';
import { randomSeedCode } from './lib/rng';
import { headToHead, loadBest, loadName, saveBest, saveHistoryEntry, saveName } from './lib/storage';

const GIVE_UP_PENALTY = 30;

type Screen = 'home' | 'intro' | 'play' | 'done';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [name, setName] = useState(loadName());
  const [incoming, setIncoming] = useState<Challenge | null>(null);

  const [deck, setDeck] = useState<Deck | null>(null);
  const [handIndex, setHandIndex] = useState(0);
  const [hand, setHand] = useState<HandState | null>(null);

  const [penalty, setPenalty] = useState(0);
  const [splits, setSplits] = useState<number[]>([]);
  const [gaveUpCount, setGaveUpCount] = useState(0);
  const [revealed, setRevealed] = useState<string | null>(null);
  /** Hands the player gave up on, for the splits table on the result screen. */
  const [gaveUpHands, setGaveUpHands] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  const runStart = useRef(0);
  const handStart = useRef(0);
  const [now, setNow] = useState(0);

  /* An incoming challenge link is the whole multiplayer mechanism: no server,
     no socket — the URL carries the seed and the other player's result. */
  useEffect(() => {
    const found = readChallengeFromUrl();
    if (found) {
      setIncoming(found);
      setScreen('intro');
    }
  }, []);

  /* Ticking clock. Only runs while playing. */
  useEffect(() => {
    if (screen !== 'play') return;
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(id);
  }, [screen]);

  const elapsed = screen === 'play' ? (now - runStart.current) / 1000 + penalty : 0;

  const target = useMemo(() => {
    if (!incoming || incoming.results.length === 0) return null;
    return incoming.results.reduce((a, b) => (a.time <= b.time ? a : b));
  }, [incoming]);

  function startRun(seed: string, level: Level) {
    const built = buildDeck(seed, level);
    setDeck(built);
    setHandIndex(0);
    setHand(initHand(built.hands[0].cards));
    setPenalty(0);
    setSplits([]);
    setGaveUpCount(0);
    setGaveUpHands(new Set());
    setRevealed(null);
    setCopied(false);
    runStart.current = performance.now();
    handStart.current = performance.now();
    setNow(performance.now());
    setScreen('play');
  }

  function startFresh(level: Level) {
    saveName(name);
    setIncoming(null);
    clearUrlChallenge();
    startRun(randomSeedCode(), level);
  }

  function acceptChallenge() {
    if (!incoming) return;
    saveName(name);
    startRun(incoming.seed, incoming.level);
  }

  function advance(spentSeconds: number) {
    if (!deck) return;
    /* A hand's split includes its own penalty, so the splits sum to the total
       time. Otherwise a given-up hand reads as 0.3s next to a 4:33 total. */
    const cost = spentSeconds + (gaveUpHands.has(handIndex) ? GIVE_UP_PENALTY : 0);
    const nextSplits = [...splits, round1(cost)];
    setSplits(nextSplits);
    setRevealed(null);

    const next = handIndex + 1;
    if (next >= deck.hands.length) {
      finish(nextSplits);
      return;
    }
    setHandIndex(next);
    setHand(initHand(deck.hands[next].cards));
    handStart.current = performance.now();
  }

  function finish(finalSplits: number[]) {
    if (!deck) return;
    const total = round1((performance.now() - runStart.current) / 1000 + penalty);
    const mine: RunResult = {
      name: name.trim() || 'Player',
      time: total,
      splits: finalSplits,
      gaveUp: gaveUpCount,
    };
    const results = [...(incoming?.results ?? []), mine];
    const challenge: Challenge = { seed: deck.seed, level: deck.level, results };
    setIncoming(challenge);
    saveBest(deck.level, deck.seed, total);
    saveHistoryEntry({ seed: deck.seed, level: deck.level, results, at: Date.now() });
    setScreen('done');
  }

  function handleCombine(draggedId: string, targetId: string, op: Op) {
    if (!hand) return;
    const next = applyOp(hand, draggedId, targetId, op);
    setHand(next);
    if (isSolved(next)) {
      // Small beat so the player sees the 24 before the next deal.
      const spent = (performance.now() - handStart.current) / 1000;
      window.setTimeout(() => advance(spent), 450);
    }
  }

  function giveUp() {
    if (!deck || !hand) return;
    const cards = deck.hands[handIndex].cards.map((c) => c.value);
    const best = findBestSolution(cards);
    setRevealed(best ? `${exprToString(best)} = 24` : 'No solution exists.');
    setPenalty((p) => p + GIVE_UP_PENALTY);
    setGaveUpCount((g) => g + 1);
    setGaveUpHands((s) => new Set(s).add(handIndex));
  }

  async function share() {
    if (!incoming) return;
    const url = buildChallengeUrl(incoming);
    const text = `I cleared the ${incoming.level} deck in ${formatTime(
      incoming.results[incoming.results.length - 1].time,
    )}s. Beat it:`;
    try {
      if (navigator.share) {
        await navigator.share({ title: '24', text, url });
        return;
      }
    } catch {
      /* user dismissed the share sheet — fall through to clipboard */
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy this link:', url);
    }
  }

  /* ---------------- screens ---------------- */

  if (screen === 'home') {
    return (
      <div className="app">
        <Header />
        <p className="muted tiny">
          Four cards. Use each one exactly once with + − × ÷ to make 24. Clear the whole
          deck as fast as you can.
        </p>
        <input
          type="text"
          placeholder="Your name"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="stack">
          <button className="primary" onClick={() => startFresh('hard')}>
            Play hard · A–K · 13 hands
          </button>
          <button onClick={() => startFresh('easy')}>Play easy · A–9 · 9 hands</button>
        </div>
        <Record name={name} />
      </div>
    );
  }

  if (screen === 'intro' && incoming) {
    const challenger = target?.name ?? 'Someone';
    const preview = buildDeck(incoming.seed, incoming.level);
    return (
      <div className="app">
        <Header />
        <div className="panel">
          <h2>{challenger} challenged you</h2>
          <p className="muted tiny" style={{ margin: 0 }}>
            {incoming.level} · {preview.hands.length} hands · deck {incoming.seed}
          </p>
          {target && (
            <p className="mono" style={{ margin: 0, fontSize: 15 }}>
              time to beat <strong>{formatTime(target.time)}s</strong>
            </p>
          )}
        </div>
        <input
          type="text"
          placeholder="Your name"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="primary" onClick={acceptChallenge}>
          Start
        </button>
        <button
          onClick={() => {
            setIncoming(null);
            clearUrlChallenge();
            setScreen('home');
          }}
        >
          Play my own deck instead
        </button>
      </div>
    );
  }

  if (screen === 'play' && deck && hand) {
    const dead = isDeadEnd(hand);
    return (
      <div className="app playing">
        <div className="topbar">
          <span className={`clock mono${penalty > 0 ? ' penalized' : ''}`}>
            {formatTime(elapsed)}
          </span>
          <span className="target mono">
            {target ? `vs ${formatTime(target.time)}` : `hand ${handIndex + 1}/${deck.hands.length}`}
          </span>
        </div>

        <div className="progress">
          {deck.hands.map((h, i) => (
            <span
              key={h.index}
              className={`pip${i < handIndex ? ' done' : ''}${
                i === handIndex && revealed ? ' gaveup' : ''
              }`}
            />
          ))}
        </div>

        <Board hand={hand} disabled={!!revealed} onCombine={handleCombine} />

        {revealed ? (
          <div className="panel flag">
            <span className="muted tiny">Answer</span>
            <span className="expr">{revealed}</span>
            <button
              className="primary"
              onClick={() => advance((performance.now() - handStart.current) / 1000)}
            >
              Next hand
            </button>
          </div>
        ) : (
          <>
            {dead && (
              <p className="tiny muted center" style={{ margin: 0 }}>
                Not 24 — undo or reset.
              </p>
            )}
            <div className="row">
              <button disabled={!canUndo(hand)} onClick={() => setHand(undo(hand))}>
                Undo
              </button>
              <button
                disabled={!canUndo(hand)}
                onClick={() => setHand(initHand(deck.hands[handIndex].cards))}
              >
                Reset
              </button>
            </div>
            <button className="danger" onClick={giveUp}>
              Give up +{GIVE_UP_PENALTY}s
            </button>
          </>
        )}
      </div>
    );
  }

  if (screen === 'done' && incoming && deck) {
    const mine = incoming.results[incoming.results.length - 1];
    const others = incoming.results.slice(0, -1);
    const best = Math.min(...incoming.results.map((r) => r.time));
    const personalBest = loadBest(deck.level, deck.seed);
    return (
      <div className="app">
        <Header />
        <div>
          <div className="bigtime mono">{formatTime(mine.time)}</div>
          <p className="muted tiny" style={{ marginTop: 6 }}>
            {deck.level} · {deck.hands.length} hands
            {mine.gaveUp > 0 && ` · ${mine.gaveUp} gave up`}
            {deck.leftover.length > 0 && ` · ${deck.leftover.length} cards left over`}
            {personalBest !== null && personalBest < mine.time && (
              <> · best {formatTime(personalBest)}</>
            )}
          </p>
        </div>

        {others.length > 0 && (
          <div className="panel">
            {incoming.results.map((r, i) => (
              <div key={`${r.name}-${i}`} className={`scoreline${r.time === best ? ' win' : ''}`}>
                <span>{r.name}</span>
                <span className="mono">{formatTime(r.time)}</span>
              </div>
            ))}
          </div>
        )}

        <Splits mine={mine} others={others} gaveUpHands={gaveUpHands} />

        <button className="primary" onClick={share}>
          {others.length > 0
            ? `Send ${others[others.length - 1].name} your result`
            : 'Challenge someone to beat this'}
        </button>
        <p className="tiny muted center" style={{ margin: 0 }}>
          {copied ? 'Link copied — send it to them.' : 'copies a link — paste it anywhere'}
        </p>

        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => startRun(deck.seed, deck.level)}>Replay deck</button>
          <button
            onClick={() => {
              setIncoming(null);
              clearUrlChallenge();
              setScreen('home');
            }}
          >
            New deck
          </button>
        </div>
        <Record name={name} />
      </div>
    );
  }

  return <div className="app" />;
}

function Header() {
  return (
    <div className="topbar">
      <h1>24</h1>
      <span className="muted tiny">four cards, one target</span>
    </div>
  );
}

/**
 * Per-hand splits. Slowest hand is called out, and when an opponent's splits
 * came along in the link we show the per-hand delta so you can see exactly
 * where the run was won or lost.
 */
function Splits({
  mine,
  others,
  gaveUpHands,
}: {
  mine: RunResult;
  others: RunResult[];
  gaveUpHands: Set<number>;
}) {
  if (mine.splits.length === 0) return null;
  const rival = others.length > 0 ? others.reduce((a, b) => (a.time <= b.time ? a : b)) : null;
  const slowest = Math.max(...mine.splits);

  return (
    <div className="panel">
      <span className="muted tiny">Per hand</span>
      <div className="splits">
        {mine.splits.map((seconds, i) => {
          const theirs = rival?.splits[i];
          const delta = theirs === undefined ? null : round1(seconds - theirs);
          return (
            <div key={i} className="splitrow">
              <span className="muted mono tiny">{i + 1}</span>
              <span className="bar">
                <span
                  className={`fill${gaveUpHands.has(i) ? ' gaveup' : ''}`}
                  style={{ width: `${Math.max(3, (seconds / slowest) * 100)}%` }}
                />
              </span>
              <span className="mono tiny">{formatTime(seconds)}</span>
              {delta !== null && (
                <span className={`mono tiny ${delta <= 0 ? 'muted' : 'behind'}`}>
                  {delta > 0 ? `+${delta}` : delta === 0 ? '=' : delta}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {gaveUpHands.size > 0 && (
        <span className="tiny muted">
          Red bars are hands you gave up — the +{GIVE_UP_PENALTY}s penalty is included.
        </span>
      )}
    </div>
  );
}

function Record({ name }: { name: string }) {
  const record = useMemo(() => headToHead(name.trim() || 'Player'), [name]);
  if (record.wins + record.losses + record.ties === 0) return null;
  return (
    <p className="tiny muted center" style={{ margin: 0 }}>
      head to head · {record.wins}W {record.losses}L {record.ties}T
    </p>
  );
}
