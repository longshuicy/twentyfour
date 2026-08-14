import { useState } from 'react';
import { Board, type Guide } from './Board';
import { Header } from './Header';
import type { Card, Level } from '../lib/deck';
import { applyOp, initHand, type HandState } from '../lib/hand';
import { useLang } from '../lib/i18n';

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
   result is known ahead of time and the steps can name it directly. The
   spoken line for each step lives in the translation dict (`tutorialStep1..3`)
   since it is the one piece of this that has to change per language. */
const STEPS: Guide[] = [
  { fromId: 'S8', toId: 'H4', op: '-' },
  { fromId: 'S8-H4', toId: 'C2', op: '*' },
  { fromId: 'S8-H4*C2', toId: 'D3', op: '*' },
];

export function Tutorial({
  onSkip,
  onPlay,
}: {
  /** Leave without finishing. Also what "I know how" does. */
  onSkip: () => void;
  onPlay: (level: Level) => void;
}) {
  const { t } = useLang();
  const [hand, setHand] = useState<HandState>(() => initHand(CARDS));
  const [step, setStep] = useState(0);

  const done = step >= STEPS.length;
  const guide = done ? null : STEPS[step];
  const says = [t.tutorialStep1, t.tutorialStep2, t.tutorialStep3];

  function handleCombine(draggedId: string, targetId: string, op: Parameters<typeof applyOp>[3]) {
    setHand((current) => applyOp(current, draggedId, targetId, op));
    setStep((s) => s + 1);
  }

  return (
    <div className="app">
      <Header />

      <div className="topbar">
        <h2>{done ? t.thatIsWholeGame : t.howToPlayTitle}</h2>
        {!done && (
          <button className="skip" onClick={onSkip}>
            {t.skipIKnowHow}
          </button>
        )}
      </div>

      {!done && (
        <p className="muted tiny" style={{ margin: 0 }}>
          {t.tutorialIntro}
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
            {t.tutorialDone}
          </p>
          {/* Both levels, in the same order and wording as the home screen.
              Finishing the walkthrough should not quietly narrow the choice. */}
          <div className="stack">
            <button className="primary" onClick={() => onPlay('easy')}>
              {t.playEasy}
            </button>
            <button onClick={() => onPlay('hard')}>{t.playHard}</button>
          </div>
          <button className="link" onClick={onSkip}>
            {t.backToStart}
          </button>
        </>
      ) : (
        <div className="step">
          <span className="step-count">{t.stepOf(step + 1, STEPS.length)}</span>
          <span className="step-say">{says[step]}</span>
        </div>
      )}
    </div>
  );
}
