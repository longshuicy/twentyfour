import { useRef, useState } from 'react';
import type { Op } from '../lib/solver';
import type { HandState, Tile } from '../lib/hand';
import { CardFace, faceClass, tileLabel } from './CardFace';

/**
 * 2x2 board with drag-to-combine.
 *
 * Pointer events, deliberately not HTML5 drag-and-drop (unusable on touch) and
 * not a DnD library (overkill for four targets). setPointerCapture means we
 * keep receiving moves even when the finger leaves the element.
 *
 * The DRAGGED card is always the LEFT operand: drag 7 onto 3 gives 7-3, drag 3
 * onto 7 gives 3-7. That is what lets the drop target show four choices
 * instead of six labeled zones.
 */

/* Ops live on a radial wheel that pops OVER the target card and reaches past
   its edges, so the hand covering the card never covers the choices. Choice is
   by direction from the card's centre, not by position within it: up +,
   right ×, down −, left ÷. */
const WHEEL: { op: Op; label: string; pos: string }[] = [
  { op: '+', label: '+', pos: 'up' },
  { op: '*', label: '×', pos: 'right' },
  { op: '-', label: '−', pos: 'down' },
  { op: '/', label: '÷', pos: 'left' },
];

/** Dead zone at the hub, as a fraction of the card's short side. */
const HUB = 0.16;
/** How far outside the card the drag may stray before the target is released. */
const STICKY = 0.55;

/** Index into WHEEL for a point near the target's centre, or null in the hub. */
function sectorAt(rect: DOMRect, x: number, y: number): number | null {
  const dx = x - (rect.left + rect.width / 2);
  // Screen y grows downward; flip so positive dy means "up" on the wheel.
  const dy = (rect.top + rect.height / 2) - y;
  if (Math.hypot(dx, dy) < Math.min(rect.width, rect.height) * HUB) return null;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg >= 45 && deg < 135) return 0; // up      +
  if (deg >= -45 && deg < 45) return 1; // right   ×
  if (deg >= -135 && deg < -45) return 2; // down  −
  return 3; // left  ÷
}

const inflate = (rect: DOMRect, by: number) => ({
  left: rect.left - by,
  right: rect.right + by,
  top: rect.top - by,
  bottom: rect.bottom + by,
});

/** Flight time of the merging card. Kept in sync with the `fly` keyframes. */
const MERGE_MS = 200;

/** A card in flight from its old slot to the slot it merged into. */
type Fly = {
  key: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  label: string;
  cls: string;
};

type Drag = {
  tileId: string;
  /** Viewport coordinates of the pointer, for placing the proxy. */
  x: number;
  y: number;
  targetId: string | null;
  sector: number | null;
};

export function Board({
  hand,
  disabled,
  onCombine,
  mood,
}: {
  hand: HandState;
  disabled: boolean;
  onCombine: (draggedId: string, targetId: string, op: Op) => void;
  /** Transient board-wide feedback: 'won' on 24, 'nudge' when a hand drags on. */
  mood?: 'won' | 'nudge' | null;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [fly, setFly] = useState<Fly | null>(null);
  const slots = useRef(new Map<string, HTMLDivElement>());
  const dragged = drag ? hand.tiles.find((t) => t.id === drag.tileId) ?? null : null;

  const setSlot = (id: string) => (el: HTMLDivElement | null) => {
    if (el) slots.current.set(id, el);
    else slots.current.delete(id);
  };

  /** Which other tile the pointer is on, and which wheel sector of it. */
  function hitTest(x: number, y: number, selfId: string, stickyId: string | null) {
    /* An already-armed target keeps the drag even when the pointer strays past
       its edge — the wheel's outer spokes sit outside the card, so requiring
       the finger to stay inside would make the far half of it unreachable. */
    if (stickyId && stickyId !== selfId) {
      const el = slots.current.get(stickyId);
      if (el) {
        const rect = el.getBoundingClientRect();
        const box = inflate(rect, Math.min(rect.width, rect.height) * STICKY);
        if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
          return { targetId: stickyId, sector: sectorAt(rect, x, y) };
        }
      }
    }
    for (const [id, el] of slots.current) {
      if (id === selfId) continue;
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return { targetId: id, sector: sectorAt(rect, x, y) };
      }
    }
    return { targetId: null, sector: null };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>, tile: Tile) {
    if (disabled || hand.tiles.length < 2) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ tileId: tile.id, x: e.clientX, y: e.clientY, targetId: null, sector: null });
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const hit = hitTest(e.clientX, e.clientY, drag.tileId, drag.targetId);
    setDrag({ tileId: drag.tileId, x: e.clientX, y: e.clientY, ...hit });
  }

  function onPointerUp() {
    if (!drag) return;
    if (drag.targetId && drag.sector !== null) {
      /* Launch the flyer BEFORE combining. The source tile is about to stop
         existing, so its position has to be read while it still has one: the
         flyer is the only thing carrying continuity between "two cards" and
         "one card", which is what makes the merge read as a merge rather than
         a card blinking out. */
      const fromEl = slots.current.get(drag.tileId);
      const toEl = slots.current.get(drag.targetId);
      const tile = hand.tiles.find((t) => t.id === drag.tileId);
      if (fromEl && toEl && tile) {
        const a = fromEl.getBoundingClientRect();
        const b = toEl.getBoundingClientRect();
        setFly({
          key: `${drag.tileId}->${drag.targetId}`,
          fromX: a.left + a.width / 2,
          fromY: a.top + a.height / 2,
          toX: b.left + b.width / 2,
          toY: b.top + b.height / 2,
          label: tileLabel(tile),
          cls: faceClass(tile),
        });
        window.setTimeout(() => setFly(null), MERGE_MS);
      }
      onCombine(drag.tileId, drag.targetId, WHEEL[drag.sector].op);
    }
    setDrag(null);
  }

  /* One tile left: the board collapses to a single centred cell, so the last
     card is the only thing on screen rather than sitting in the top-left of a
     2x2 grid with three holes beside it. */
  const single = hand.tiles.length === 1 ? ' single' : '';

  return (
    <div className={`board${single}${mood ? ` ${mood}` : ''}`}>
      {hand.tiles.map((tile) => {
        const isDragging = drag?.tileId === tile.id;
        const isTarget = drag?.targetId === tile.id;
        const classes = ['card', faceClass(tile)];
        /* The dragged card stays in its slot and dims. Moving the real card
           was the old behaviour and it fought the wheel: a full-size card
           under the pointer covered the target and its options. */
        if (isDragging) classes.push('lifted');
        if (isTarget) classes.push('armed');

        return (
          <div className="slot" key={tile.id} ref={setSlot(tile.id)}>
            <div
              className={classes.join(' ')}
              onPointerDown={(e) => onPointerDown(e, tile)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <CardFace tile={tile} />
              {isTarget && (
                <div className="wheel">
                  <div className="hub" />
                  {WHEEL.map((q, i) => (
                    <div
                      key={q.op}
                      className={`spoke ${q.pos}${drag?.sector === i ? ' hot' : ''}`}
                    >
                      {q.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* The merging card, in flight to the slot it is being absorbed into.
          Keyed so a second merge restarts the animation instead of resuming
          the first one's. */}
      {fly && (
        <div
          key={fly.key}
          className={`flyer ${fly.cls}`}
          style={
            {
              '--fx': `${fly.fromX}px`,
              '--fy': `${fly.fromY}px`,
              '--tx': `${fly.toX}px`,
              '--ty': `${fly.toY}px`,
            } as React.CSSProperties
          }
        >
          <span className="rank mono">{fly.label}</span>
        </div>
      )}

      {/* The proxy: a small card pinned to the pointer, above everything.
          Just the value — corner indices at this size are unreadable specks,
          and the card it came from is still on the board if you want them. */}
      {dragged && drag && (
        <div
          className={`proxy ${faceClass(dragged)}`}
          style={{ transform: `translate3d(${drag.x}px, ${drag.y}px, 0)` }}
        >
          <span className="rank mono">{tileLabel(dragged)}</span>
        </div>
      )}
    </div>
  );
}
