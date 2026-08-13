import { useState } from 'react';
import { Board, type Guide } from './Board';
import { Header } from './Header';
import type { Card, Level } from '../lib/deck';
import { applyOp, initHand, type HandState } from '../lib/hand';

/**
 * A guided first hand.
 *
 * You learn a gesture by making it, not by watching a diagram of it, so this
 * is the real board with the real drag: the only thing added is a constraint.
 * One move is legal at a time, the card to pick up breathes, the card to drop
 * on is outlined, and the three ops that are not the answer are dimmed. There
 * is no clock, no penalty, and no way to get it wrong.
 *
 * It is skippable from the first frame. Someone who already knows the game
 * should never have to sit through this, and someone who arrived on a
 * challenge link never sees it at all.
 */

/* A hand-picked deal, not a dealt one: 8 - 4 = 4, 4 x 2 = 8, 8 x 3 = 24.
   Every step is a plain operation with a whole-number result, and each result
   is immediately the thing you drag next, which is the idea that takes the
   longest to land. */
const CARDS: Card[] = [
  { id: 'S8', value: 8, suit: 'S' },
  { id: 'H4', value: 4, suit: 'H' },
  { id: 'C2', value: 2, suit: 'C' },
  { id: 'D3', value: 3, suit: 'D' },
];

/* Tile ids are `${draggedId}${op}${targetId}` (see hand.ts), so the id of each
   result is known ahead of time and the steps can name it directly. */
const STEPS: (Guide & { say: React.ReactNode })[] = [
  {
    fromId: 'S8',
    toId: 'H4',
    op: '-',
    say: (
      <>
        Drag the <strong>8</strong> onto the <strong>4</strong>, then let go on{' '}
        <strong>−</strong>.
      </>
    ),
  },
  {
    fromId: 'S8-H4',
    toId: 'C2',
    op: '*',
    say: (
      <>
        The two cards became one. That <strong>4</strong> is a card now: drag it onto the{' '}
        <strong>2</strong> and let go on <strong>×</strong>.
      </>
    ),
  },
  {
    fromId: 'S8-H4*C2',
    toId: 'D3',
    op: '*',
    say: (
      <>
        Last one. Drag the <strong>8</strong> onto the <strong>3</strong> and let go on{' '}
        <strong>×</strong>.
      </>
    ),
  },
];

export function Tutorial({
  onSkip,
  onPlay,
}: {
  /** Leave without finishing. Also what "I know how" does. */
  onSkip: () => void;
  onPlay: (level: Level) => void;
}) {
  const [hand, setHand] = useState<HandState>(() => initHand(CARDS));
  const [step, setStep] = useState(0);

  const done = step >= STEPS.length;
  const guide = done ? null : STEPS[step];

  function handleCombine(draggedId: string, targetId: string, op: Parameters<typeof applyOp>[3]) {
    setHand((current) => applyOp(current, draggedId, targetId, op));
    setStep((s) => s + 1);
  }

  return (
    <div className="app">
      <Header />

      <div className="topbar">
        <h2>{done ? 'That is the whole game' : 'How to play'}</h2>
        {!done && (
          <button className="skip" onClick={onSkip}>
            Skip, I know how
          </button>
        )}
      </div>

      {!done && (
        <p className="muted tiny" style={{ margin: 0 }}>
          Four cards, each used exactly once, with + − × ÷ to make 24. Here is one worked
          through.
        </p>
      )}

      <Board
        hand={hand}
        disabled={done}
        onCombine={handleCombine}
        mood={done ? 'won' : null}
        guide={guide}
      />

      {done ? (
        <>
          <p className="tiny muted" style={{ margin: 0 }}>
            A real deck is nine or thirteen hands of that, against the clock. Undo and Reset
            cost nothing. Give up costs two minutes and shows you an answer, and every hand
            has one.
          </p>
          {/* Both levels, in the same order and wording as the home screen.
              Finishing the walkthrough should not quietly narrow the choice. */}
          <div className="stack">
            <button className="primary" onClick={() => onPlay('easy')}>
              Play easy · A–9 · 9 hands
            </button>
            <button onClick={() => onPlay('hard')}>Play hard · A–K · 13 hands</button>
          </div>
          <button className="link" onClick={onSkip}>
            Back to the start
          </button>
        </>
      ) : (
        <div className="step">
          <span className="step-count">
            step {step + 1} of {STEPS.length}
          </span>
          <span className="step-say">{guide?.say}</span>
        </div>
      )}
    </div>
  );
}
