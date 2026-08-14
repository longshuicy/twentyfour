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
import {
  headToHead,
  loadBest,
  loadName,
  loadRecentRuns,
  loadRecords,
  loadTutorialDone,
  saveBest,
  saveHistoryEntry,
  saveName,
  saveTutorialDone,
} from './lib/storage';
import { isMuted, play, primeSounds, setMuted } from './lib/sound';
import { SoundOffIcon, SoundOnIcon } from './components/Icons';
import { Header } from './components/Header';
import { Tutorial } from './components/Tutorial';

/* Two minutes. At 30s a give-up was cheaper than thinking hard about a bad
   hand, which made it the efficient play and hollowed out the whole run. */
const GIVE_UP_PENALTY = 120;

/** Seconds on a single hand before the board nudges you. */
const LONG_WAIT = 30;

/**
 * What to say about a hand the moment it is solved.
 *
 * Specific praise beats loud praise, so this reaches for the most concrete
 * true thing available and says nothing at all rather than inventing one.
 * Order matters: beating the person who sent you the deck outranks beating
 * yourself, and beating your best outranks beating your average.
 */
function praiseFor(
  seconds: number,
  earlier: number[],
  rival: RunResult | null,
  handIndex: number,
): string | null {
  const theirs = rival?.splits[handIndex];
  if (theirs !== undefined && seconds < theirs) {
    return `${round1(theirs - seconds)}s faster than ${rival?.name} on this hand`;
  }
  if (earlier.length === 0) return 'first one down';
  if (seconds < Math.min(...earlier)) return 'fastest hand yet';
  const average = earlier.reduce((sum, s) => sum + s, 0) / earlier.length;
  if (seconds < average) return 'under your average';
  return null;
}

type Screen = 'home' | 'intro' | 'play' | 'done' | 'record' | 'tutorial';

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

  /* Transient feedback. Each is a class on the board plus a sound; the visual
     is the one that has to work, since audio may be muted or blocked. */
  const [celebrating, setCelebrating] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [muted, setMutedState] = useState(isMuted);
  /** Second tap arms "Start over", which discards the run in progress. */
  const [confirmRestart, setConfirmRestart] = useState(false);
  /** Hands solved in a row without giving up. Reset by a give-up, not by time. */
  const [streak, setStreak] = useState(0);
  const [praise, setPraise] = useState<{ seconds: number; line: string | null } | null>(null);

  const linkRef = useRef<HTMLInputElement>(null);
  const runStart = useRef(0);
  /**
   * When the clock stopped, while an answer is on screen.
   *
   * Giving up already costs GIVE_UP_PENALTY. Billing the seconds spent reading
   * the answer on top of that is a second penalty nobody agreed to, and it
   * punishes the player for actually studying the solution, which is the one
   * useful thing a give-up buys.
   */
  const pausedAt = useRef<number | null>(null);
  const handStart = useRef(0);
  /** Hand index the long-wait nudge already fired for, so it fires once. */
  const nudgedFor = useRef(-1);
  const [now, setNow] = useState(0);

  /* An incoming challenge link is the whole multiplayer mechanism: no server,
     no socket — the URL carries the seed and the other player's result. */
  useEffect(() => {
    const found = readChallengeFromUrl();
    if (found) {
      /* Someone who was sent a race wants the race. No walkthrough here, ever,
         even on a first visit. */
      setIncoming(found);
      setScreen('intro');
      return;
    }
    if (!loadTutorialDone()) setScreen('tutorial');
  }, []);

  /* Ticking clock. Only runs while playing. */
  useEffect(() => {
    if (screen !== 'play') return;
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(id);
  }, [screen]);

  /* Every displayed time reads from this, so the clock freezes everywhere at
     once while an answer is up: the run total and the hand's own timer. */
  const clockNow = pausedAt.current ?? now;
  const elapsed = screen === 'play' ? (clockNow - runStart.current) / 1000 + penalty : 0;
  const onThisHand = screen === 'play' ? (clockNow - handStart.current) / 1000 : 0;
  /* The hand has to still be in play. An answer on screen pauses the clock,
     and a solved hand keeps ticking for the length of the celebration, so
     without the `celebrating` guard a hand solved at 29s nudges at 30, on top
     of its own success cue, for a hand the player already won. */
  const longWait =
    screen === 'play' && !revealed && !celebrating && onThisHand >= LONG_WAIT;

  /* An armed "Start over" disarms itself — leaving it hot for the rest of the
     hand turns a stray double-tap into a lost run. */
  useEffect(() => {
    if (!confirmRestart) return;
    const id = window.setTimeout(() => setConfirmRestart(false), 3000);
    return () => window.clearTimeout(id);
  }, [confirmRestart]);

  /* Nudge once per hand, not once per tick. */
  useEffect(() => {
    if (!longWait || nudgedFor.current === handIndex) return;
    nudgedFor.current = handIndex;
    play('longWait');
  }, [longWait, handIndex]);

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
    setCelebrating(false);
    setShaking(false);
    setConfirmRestart(false);
    setStreak(0);
    setPraise(null);
    pausedAt.current = null;
    nudgedFor.current = -1;
    /* First gesture of the session — the only moment the browser will let us
       warm the audio decoder. */
    primeSounds();
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

  /**
   * Restart the clock after an answer has been read.
   *
   * Both start marks move forward by however long the pause lasted, which is
   * what keeps the paused stretch out of the run total AND out of this hand's
   * split, without any of the arithmetic downstream knowing a pause happened.
   */
  function resumeClock() {
    if (pausedAt.current === null) return;
    const paused = performance.now() - pausedAt.current;
    runStart.current += paused;
    handStart.current += paused;
    pausedAt.current = null;
  }

  function advance(spentSeconds: number) {
    if (!deck) return;
    /* A hand's split includes its own penalty, so the splits sum to the total
       time. Otherwise a given-up hand reads as 0.3s next to a 4:33 total. */
    const cost = spentSeconds + (gaveUpHands.has(handIndex) ? GIVE_UP_PENALTY : 0);
    const nextSplits = [...splits, round1(cost)];
    setSplits(nextSplits);
    setRevealed(null);
    setCelebrating(false);
    setPraise(null);

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
      const spent = (performance.now() - handStart.current) / 1000;
      setStreak((s) => s + 1);
      setPraise({ seconds: round1(spent), line: praiseFor(spent, splits, target, handIndex) });
      setCelebrating(true);
      play('succeed');
      /* Long enough to read the time and the line under it, short enough that
         a player chasing a clock does not feel held. */
      window.setTimeout(() => advance(spent), 1400);
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
    setStreak(0);
    pausedAt.current = performance.now();
    play('giveUp');
    setShaking(true);
    window.setTimeout(() => setShaking(false), 500);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) play('succeed');
  }

  /* Copy only. An earlier version called navigator.share() first, which on
     some platforms is indistinguishable from having sent something — the app
     never sends anything, so the link is shown in full and handing it to
     someone stays the player's job. */
  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* Denied clipboard, or an insecure origin. Select it instead so the
         player can copy by hand rather than being told it worked. */
      linkRef.current?.select();
    }
  }

  /* ---------------- screens ---------------- */

  if (screen === 'home') {
    return (
      <div className="app">
        <Header />
        {/* Quiet on purpose: the banner is the loud thing on this screen. */}
        <div className="howto">
          <p>
            Four cards. Use each one exactly once with + − × ÷ to make 24. Clear the deck as
            fast as you can.
          </p>
          <p>
            Drag a card onto another and a wheel of + − × ÷ appears, then let go on the one
            you want. The two become one card holding the result. The dragged card goes on
            the left, so 7 onto 3 is 7 − 3.
          </p>
          <p>
            Undo and Reset are free. Give up costs {GIVE_UP_PENALTY}s and shows an answer:
            every hand has one.
          </p>
        </div>
        <input
          type="text"
          placeholder="Your name"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
        />
        {/* Easy is the default and leads: A-9 is the version most people can
            actually finish, and hard is one tap away for those who want it. */}
        <div className="stack">
          <button className="primary" onClick={() => startFresh('easy')}>
            Play easy · A–9 · 9 hands
          </button>
          <button onClick={() => startFresh('hard')}>Play hard · A–K · 13 hands</button>
        </div>
        <button className="link" onClick={() => setScreen('tutorial')}>
          How to play
        </button>
        <RecordSummary name={name} onOpen={() => setScreen('record')} />
      </div>
    );
  }

  if (screen === 'intro' && incoming) {
    /* The person who SENT this is the one who finished last and appended
       themselves, not the fastest one in the list. Naming the fastest meant a
       link forwarded by a slower player announced somebody else entirely, and
       whoever opened it could not tell who was actually challenging them. */
    const sender = incoming.results[incoming.results.length - 1] ?? null;
    const challenger = sender?.name ?? 'Someone';
    const preview = buildDeck(incoming.seed, incoming.level);
    /* Everyone already on this deck, fastest first. A chain can be several
       people long, and arriving at it you should see the whole field rather
       than one number. */
    const standings = [...incoming.results].sort((a, b) => a.time - b.time);
    const senderIsFastest = sender !== null && target !== null && sender.time === target.time;
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
              time to beat <strong>{formatTime(target.time)}</strong>
              {!senderIsFastest && <span className="muted"> · {target.name} leads</span>}
            </p>
          )}
        </div>

        {standings.length > 1 && (
          <div className="panel">
            <span className="muted tiny">
              {standings.length} have played this deck, fastest first
            </span>
            {standings.map((r, i) => (
              <div key={`${r.name}-${i}`} className={`scoreline${i === 0 ? ' win' : ''}`}>
                <span>
                  {r.name}
                  {r === sender && <span className="muted tiny"> · sent you this</span>}
                </span>
                <span className="mono">{formatTime(r.time)}</span>
              </div>
            ))}
          </div>
        )}
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
      <div className={`app playing${shaking ? ' shaking' : ''}`}>
        <div className="topbar">
          <span className={`clock mono${penalty > 0 ? ' penalized' : ''}`}>
            {formatTime(elapsed)}
          </span>
          <span className="target mono">
            {streak >= 2 && !celebrating && <span className="streak">{streak} in a row</span>}
            {target ? `vs ${formatTime(target.time)}` : `hand ${handIndex + 1}/${deck.hands.length}`}
            <button
              className="mute"
              onClick={toggleMute}
              aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
              title={muted ? 'Unmute sounds' : 'Mute sounds'}
            >
              {muted ? <SoundOffIcon /> : <SoundOnIcon />}
            </button>
          </span>
        </div>

        {/* A given-up hand stays red for the rest of the run. It used to go
            white the moment you moved on, which quietly rewrote the run as
            clean while you were still paying the penalty for it in the
            clock. */}
        <div className="progress">
          {deck.hands.map((h, i) => (
            <span
              key={h.index}
              className={`pip${i < handIndex ? ' done' : ''}${
                gaveUpHands.has(i) ? ' gaveup' : ''
              }`}
            />
          ))}
        </div>

        <Board
          hand={hand}
          disabled={!!revealed}
          onCombine={handleCombine}
          mood={celebrating ? 'won' : longWait ? 'nudge' : null}
        />

        {/* The celebration takes the controls' place rather than appearing
            below them: same space, no reflow, and there is nothing to press
            during the beat anyway. */}
        {celebrating && praise ? (
          <div className="cheer">
            <span className="cheer-time mono">{formatTime(praise.seconds)}</span>
            {praise.line && <span className="cheer-line">{praise.line}</span>}
            {streak >= 2 && (
              <span className="cheer-streak">
                {streak} in a row<span className="pips">{'•'.repeat(Math.min(streak, 8))}</span>
              </span>
            )}
          </div>
        ) : revealed ? (
          <div className="panel flag">
            <span className="muted tiny">Answer · clock paused, take your time</span>
            <span className="expr">{revealed}</span>
            <button
              className="primary"
              onClick={() => {
                resumeClock();
                advance((performance.now() - handStart.current) / 1000);
              }}
            >
              Next hand
            </button>
          </div>
        ) : (
          <>
            {dead ? (
              <p className="tiny muted center" style={{ margin: 0 }}>
                Not 24. Undo or reset.
              </p>
            ) : (
              longWait && (
                <p className="tiny center nudge-note" style={{ margin: 0 }}>
                  {Math.floor(onThisHand)}s on this hand. There is an answer, or take the +
                  {GIVE_UP_PENALTY}s and see it.
                </p>
              )
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
              {/* Undo and Reset are free and instant; this one throws away the
                  whole run, so it asks once before doing it. */}
              <button
                className={confirmRestart ? 'danger' : undefined}
                onClick={() => {
                  if (confirmRestart) startRun(deck.seed, deck.level);
                  else setConfirmRestart(true);
                }}
              >
                {confirmRestart ? 'Sure?' : 'Start over'}
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
    const challengeUrl = buildChallengeUrl(incoming);
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

        {/* The link itself, in the open. Earlier versions hid it behind a
            button that claimed to send it — showing the URL is what makes it
            obvious that copying is all that happens and the sending is yours
            to do. */}
        <div className="panel">
          <span className="muted tiny">Your challenge link</span>
          <div className="linkrow">
            <input
              type="text"
              className="mono"
              ref={linkRef}
              readOnly
              value={challengeUrl}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Challenge link"
            />
            <button className="primary" onClick={() => copyLink(challengeUrl)}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <span className="tiny muted">
            Send it to someone yourself, in a message or an email. Whoever opens it
            plays the exact same {deck.hands.length} hands, in the same order, racing your{' '}
            {formatTime(mine.time)}. When they finish they see who won, and they get a link
            back to you with both times in it.
          </span>
        </div>

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
        <RecordSummary name={name} onOpen={() => setScreen('record')} />
      </div>
    );
  }

  if (screen === 'record') {
    return <RecordScreen name={name} onBack={() => setScreen('home')} />;
  }

  if (screen === 'tutorial') {
    return (
      <Tutorial
        onSkip={() => {
          saveTutorialDone();
          setScreen('home');
        }}
        onPlay={(level) => {
          saveTutorialDone();
          startFresh(level);
        }}
      />
    );
  }

  return <div className="app" />;
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
          Red bars are hands you gave up. The +{GIVE_UP_PENALTY}s penalty is included.
        </span>
      )}
    </div>
  );
}

const LEVEL_LABEL: Record<Level, string> = { easy: 'Easy · A–9', hard: 'Hard · A–K' };

const formatDay = (at: number): string =>
  new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * One line at the foot of the home and result screens: your bests, and the way
 * in to the full record. Everything it shows already lived in localStorage —
 * bests, run history, head-to-head — with no screen that ever displayed it.
 */
function RecordSummary({ name, onOpen }: { name: string; onOpen: () => void }) {
  const records = useMemo(loadRecords, []);
  const h2h = useMemo(() => headToHead(name.trim() || 'Player'), [name]);
  const played = records.reduce((sum, r) => sum + r.runs, 0);
  if (played === 0) return null;

  return (
    <button className="recordbar" onClick={onOpen}>
      <span className="tiny">
        {records
          .filter((r) => r.best !== null)
          .map((r) => `${r.level} best ${formatTime(r.best as number)}`)
          .join(' · ')}
        {h2h.wins + h2h.losses + h2h.ties > 0 && (
          <>
            {' · '}
            {h2h.wins}W {h2h.losses}L {h2h.ties}T
          </>
        )}
      </span>
      <span className="tiny chev">Your record →</span>
    </button>
  );
}

/** The full record: per-level bests and the recent runs behind them. */
function RecordScreen({ name, onBack }: { name: string; onBack: () => void }) {
  const records = useMemo(loadRecords, []);
  const recent = useMemo(() => loadRecentRuns(10), []);
  const h2h = useMemo(() => headToHead(name.trim() || 'Player'), [name]);
  const played = records.reduce((sum, r) => sum + r.runs, 0);

  return (
    <div className="app">
      <Header />
      <h2>Your record</h2>

      {played === 0 ? (
        <p className="muted tiny" style={{ margin: 0 }}>
          Nothing here yet. Finish a deck and your times show up on this screen.
        </p>
      ) : (
        <>
          {records.map((r) => (
            <div key={r.level} className="panel">
              <div className="scoreline win">
                <span>{LEVEL_LABEL[r.level]}</span>
                <span className="mono">{r.best === null ? '··' : formatTime(r.best)}</span>
              </div>
              <span className="tiny muted">
                {r.runs === 0
                  ? 'not played yet'
                  : `${r.runs} ${r.runs === 1 ? 'run' : 'runs'} · ${r.clean} without giving up${
                      r.lastAt ? ` · last ${formatDay(r.lastAt)}` : ''
                    }`}
              </span>
            </div>
          ))}

          {h2h.wins + h2h.losses + h2h.ties > 0 && (
            <p className="tiny muted" style={{ margin: 0 }}>
              Head to head against people who sent you a deck: {h2h.wins}W {h2h.losses}L{' '}
              {h2h.ties}T.
            </p>
          )}

          <div className="panel">
            <span className="muted tiny">Recent runs</span>
            <div className="splits">
              {recent.map((run) => (
                <div key={`${run.level}-${run.seed}-${run.at}`} className="runrow">
                  <span className="tiny muted">{formatDay(run.at)}</span>
                  <span className="tiny">
                    {run.level}
                    {run.rivalTime !== null && (
                      <span className={run.mine.time <= run.rivalTime ? 'beat' : 'lost'}>
                        {' '}
                        vs {run.rivalName}
                      </span>
                    )}
                  </span>
                  <span className="mono tiny">{formatTime(run.mine.time)}</span>
                </div>
              ))}
            </div>
            <span className="tiny muted">
              Kept in this browser only. Nothing is uploaded, so a different device or a
              cleared browser starts from zero.
            </span>
          </div>
        </>
      )}

      <button onClick={onBack}>Back</button>
    </div>
  );
}
