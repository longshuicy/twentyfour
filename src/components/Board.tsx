import { useLayoutEffect, useRef, useState } from 'react';
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
 *
 * PERFORMANCE, which is the whole reason this file looks the way it does:
 *
 * 1. The pointer position never enters React state. It lives in a ref and is
 *    written straight to the proxy's transform. Only `targetId` and `sector`
 *    are state, and those change a handful of times per drag instead of on
 *    every event.
 * 2. Slot rectangles are measured once per drag. Calling
 *    getBoundingClientRect() per move forces a synchronous layout four times
 *    an event, which is exactly what makes a drag feel like it is catching up
 *    with the finger.
 * 3. Moves are coalesced into one requestAnimationFrame callback. Pointer
 *    events fire faster than frames on trackpads and 120Hz screens, and doing
 *    the work more than once per frame buys nothing.
 */

/* Ops live on a picker that splits the target CARD into four wedges, one per
   corner-to-corner triangle: up +, right ×, down −, left ÷. Choice is by
   direction from the card's centre, not by position within it, so the wedge a
   finger is over is the wedge that fires.

   Each op is DRAWN as exactly the region that selects it, which is why the
   angles below are measured in card-normalised space rather than screen space:
   a 1:1.42 card's diagonals run at about 55 degrees, not 45, and splitting on
   45 would put the seams on the long edges instead of through the corners. */
const WHEEL: { op: Op; label: string; pos: string; mid: number }[] = [
  { op: '+', label: '+', pos: 'up', mid: 90 },
  { op: '*', label: '×', pos: 'right', mid: 0 },
  { op: '-', label: '−', pos: 'down', mid: 270 },
  { op: '/', label: '÷', pos: 'left', mid: 180 },
];

/** Dead zone at the hub, as a fraction of the card's short side. */
const HUB = 0.16;
/** How far outside the card the drag may stray before the target is released. */
const STICKY = 0.85;
/**
 * How close the pointer must come to a card to arm it, as a fraction of the
 * card's short side. Cards do not have to be entered any more: the nearest one
 * within this reach wins, so aiming at a gap still picks something sensible.
 */
const ARM_REACH = 0.42;

/* ---- wheel geometry ----

   User units for the SVG below. Its viewBox is the card: 100 wide by
   100 * CARD_RATIO tall, centred on the origin, so one user unit is one
   hundredth of `--card-w` and the picker stays fluid with the card the way
   everything else here does.

   CARD_RATIO must track `--card-h` in index.css. It is the one number shared
   with the stylesheet, and it is what puts the seams through the corners. */
const CARD_RATIO = 1.42;
const HALF_W = 50;
const HALF_H = (100 * CARD_RATIO) / 2;

/* The hole in the middle, DERIVED from HUB rather than eyeballed: it is the
   dead zone, so any drift between the drawing and `sectorAt` shows up as a gap
   you can be standing in while nothing is selected. Leaving it open is also
   what keeps the target card's own value readable while you choose. */
const HOLE_R = HUB * 100;
/** How far out along its own axis a glyph sits, as a fraction of the half-span. */
const LABEL_AT = 0.6;

/**
 * Point on the card's outline in the card-normalised direction `deg`.
 *
 * Normalised space is a square, so 45 degrees is a corner; scaling the unit
 * square back out by the half-spans lands on the card's own corner.
 */
function edge(deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  const k = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
  return [(HALF_W * Math.cos(a)) / k, (-HALF_H * Math.sin(a)) / k];
}

/**
 * Point on the hole's rim below the card-normalised direction `deg`.
 *
 * The hole is a real circle, so the normalised direction has to be turned back
 * into a real one first, or the seams would not meet its rim.
 */
function hole(deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  const [ux, uy] = [HALF_W * Math.cos(a), HALF_H * Math.sin(a)];
  const len = Math.hypot(ux, uy);
  return [(HOLE_R * ux) / len, (-HOLE_R * uy) / len];
}

/** One corner-to-corner wedge, hole at the point, two card corners at the base. */
function wedgePath(mid: number): string {
  const a1 = mid - 45;
  const a2 = mid + 45;
  const [hx1, hy1] = hole(a1);
  const [hx2, hy2] = hole(a2);
  const [ex2, ey2] = edge(a2);
  const [ex1, ey1] = edge(a1);
  /* Sweep 0 runs anticlockwise on screen (rising angle with y flipped). The
     arc is always well under a half turn, so the large-arc flag is 0. */
  return [
    `M ${hx1} ${hy1}`,
    `A ${HOLE_R} ${HOLE_R} 0 0 0 ${hx2} ${hy2}`,
    `L ${ex2} ${ey2}`,
    `L ${ex1} ${ey1}`,
    'Z',
  ].join(' ');
}

/** Static, so the paths are laid out once for the module, not once per drag. */
const SECTORS = WHEEL.map((q) => {
  const vertical = q.mid === 90 || q.mid === 270;
  const span = vertical ? HALF_H : HALF_W;
  const a = (q.mid * Math.PI) / 180;
  return {
    ...q,
    d: wedgePath(q.mid),
    lx: span * LABEL_AT * Math.cos(a),
    ly: -span * LABEL_AT * Math.sin(a),
  };
});

/**
 * Index into WHEEL for a point over the target, or null in the dead zone.
 *
 * The angle is measured in CARD-NORMALISED space, where the card is a square,
 * so the 45 degree boundaries below are the card's own diagonals whatever its
 * aspect ratio: each op owns the triangle running to one pair of corners, and
 * that is exactly the shape `wedgePath` draws.
 */
function sectorAt(rect: DOMRect, x: number, y: number): number | null {
  const dx = x - (rect.left + rect.width / 2);
  // Screen y grows downward; flip so positive dy means "up" on the wheel.
  const dy = rect.top + rect.height / 2 - y;
  /* The dead zone stays a real circle, in real pixels: it is a place a thumb
     rests, not a place on a diagram. */
  if (Math.hypot(dx, dy) < Math.min(rect.width, rect.height) * HUB) return null;
  const deg = (Math.atan2(dy / (rect.height / 2), dx / (rect.width / 2)) * 180) / Math.PI;
  if (deg >= 45 && deg < 135) return 0; // up      +
  if (deg >= -45 && deg < 45) return 1; // right   ×
  if (deg >= -135 && deg < -45) return 2; // down  −
  return 3; // left  ÷
}

/** Distance from a point to a rectangle. Zero when the point is inside it. */
function distanceTo(rect: DOMRect, x: number, y: number): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

const within = (rect: DOMRect, by: number, x: number, y: number): boolean =>
  x >= rect.left - by && x <= rect.right + by && y >= rect.top - by && y <= rect.bottom + by;

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

/** What the tutorial is asking for right now. Absent during a normal run. */
export type Guide = { fromId: string; toId: string; op: Op };

type Drag = {
  tileId: string;
  targetId: string | null;
  sector: number | null;
};

export function Board({
  hand,
  disabled,
  onCombine,
  mood,
  guide,
}: {
  hand: HandState;
  disabled: boolean;
  onCombine: (draggedId: string, targetId: string, op: Op) => void;
  /** Transient board-wide feedback: 'won' on 24, 'nudge' when a hand drags on. */
  mood?: 'won' | 'nudge' | null;
  /** When set, only this one move is allowed. Everything else is inert. */
  guide?: Guide | null;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [fly, setFly] = useState<Fly | null>(null);

  const slots = useRef(new Map<string, HTMLDivElement>());
  /** Slot rects, measured once at pointerdown. Slots cannot move mid-drag. */
  const rects = useRef(new Map<string, DOMRect>());
  const pointer = useRef({ x: 0, y: 0 });
  const frame = useRef(0);
  /** Mirror of `drag` readable inside the rAF callback without a stale closure. */
  const dragRef = useRef<Drag | null>(null);
  const proxyRef = useRef<HTMLDivElement | null>(null);

  const dragged = drag ? hand.tiles.find((t) => t.id === drag.tileId) ?? null : null;

  const setDragState = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const setSlot = (id: string) => (el: HTMLDivElement | null) => {
    if (el) slots.current.set(id, el);
    else slots.current.delete(id);
  };

  /** Paint the proxy straight to the DOM. No React, no reflow, one write. */
  const paintProxy = () => {
    const el = proxyRef.current;
    if (el) {
      el.style.transform = `translate3d(${pointer.current.x}px, ${pointer.current.y}px, 0)`;
    }
  };

  // The proxy only exists once a drag begins, so its first paint has to happen
  // after React mounts it, before the browser draws.
  useLayoutEffect(paintProxy, [drag?.tileId]);

  /** Which other tile the pointer is on or near, and which wheel sector of it. */
  function hitTest(x: number, y: number, selfId: string, stickyId: string | null) {
    /* An already-armed target keeps the drag even when the pointer strays well
       past its edge. Direction from the centre is what picks the op, and that
       is still well defined outside the card, so releasing the target the
       moment a finger slips off the edge would only cost accuracy. */
    if (stickyId && stickyId !== selfId) {
      const rect = rects.current.get(stickyId);
      if (rect && within(rect, Math.min(rect.width, rect.height) * STICKY, x, y)) {
        return { targetId: stickyId, sector: sectorAt(rect, x, y) };
      }
    }

    /* Otherwise the NEAREST card within reach, rather than only a card the
       pointer is literally inside. Dropping into the gap between two cards
       used to arm nothing at all. */
    let bestId: string | null = null;
    let bestRect: DOMRect | null = null;
    let bestDistance = Infinity;
    for (const [id, rect] of rects.current) {
      if (id === selfId) continue;
      if (guide && id !== guide.toId) continue;
      const distance = distanceTo(rect, x, y);
      const reach = Math.min(rect.width, rect.height) * ARM_REACH;
      if (distance <= reach && distance < bestDistance) {
        bestId = id;
        bestRect = rect;
        bestDistance = distance;
      }
    }
    return bestId && bestRect
      ? { targetId: bestId, sector: sectorAt(bestRect, x, y) }
      : { targetId: null, sector: null };
  }

  function cancelFrame() {
    if (frame.current) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>, tile: Tile) {
    if (disabled || hand.tiles.length < 2) return;
    if (guide && tile.id !== guide.fromId) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    rects.current.clear();
    for (const [id, el] of slots.current) rects.current.set(id, el.getBoundingClientRect());

    pointer.current = { x: e.clientX, y: e.clientY };
    setDragState({ tileId: tile.id, targetId: null, sector: null });
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    pointer.current = { x: e.clientX, y: e.clientY };
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const current = dragRef.current;
      if (!current) return;
      paintProxy();
      const hit = hitTest(pointer.current.x, pointer.current.y, current.tileId, current.targetId);
      // State only when the ANSWER changes, not when the pointer does.
      if (hit.targetId !== current.targetId || hit.sector !== current.sector) {
        setDragState({ ...current, ...hit });
      }
    });
  }

  function onPointerUp() {
    cancelFrame();
    const pending = dragRef.current;
    if (!pending) return;

    /* Resolve the drop from the LAST pointer position, not from whatever the
       last animation frame happened to record. A quick flick can go down, move
       and release inside a single frame, and a drag that ends while the tab is
       hidden gets no frames at all; in both cases the queued work never ran.
       The rects are already cached, so this costs nothing. */
    const current = { ...pending, ...hitTest(pointer.current.x, pointer.current.y, pending.tileId, pending.targetId) };

    const op = current.sector !== null ? WHEEL[current.sector].op : null;
    const allowed = !guide || (current.targetId === guide.toId && op === guide.op);

    if (current.targetId && op && allowed) {
      /* Launch the flyer BEFORE combining. The source tile is about to stop
         existing, so its position has to be read while it still has one: the
         flyer is the only thing carrying continuity between "two cards" and
         "one card", which is what makes the merge read as a merge rather than
         a card blinking out. */
      const from = rects.current.get(current.tileId);
      const to = rects.current.get(current.targetId);
      const tile = hand.tiles.find((t) => t.id === current.tileId);
      if (from && to && tile) {
        setFly({
          key: `${current.tileId}->${current.targetId}`,
          fromX: from.left + from.width / 2,
          fromY: from.top + from.height / 2,
          toX: to.left + to.width / 2,
          toY: to.top + to.height / 2,
          label: tileLabel(tile),
          cls: faceClass(tile),
        });
        window.setTimeout(() => setFly(null), MERGE_MS);
      }
      onCombine(current.tileId, current.targetId, op);
    }
    setDragState(null);
  }

  /* One tile left: the board collapses to a single centred cell, so the last
     card is the only thing on screen rather than sitting in the top-left of a
     2x2 grid with three holes beside it. */
  const single = hand.tiles.length === 1 ? ' single' : '';
  const active = drag ? ' dragging' : '';

  return (
    <div className={`board${single}${active}${mood ? ` ${mood}` : ''}`}>
      {hand.tiles.map((tile) => {
        const isDragging = drag?.tileId === tile.id;
        const isTarget = drag?.targetId === tile.id;
        const classes = ['card', faceClass(tile)];
        /* The dragged card stays in its slot and dims. Moving the real card
           was the old behaviour and it fought the wheel: a full-size card
           under the pointer covered the target and its options. */
        if (isDragging) classes.push('lifted');
        if (isTarget) classes.push('armed');
        if (guide && !drag) {
          if (guide.fromId === tile.id) classes.push('guide-from');
          if (guide.toId === tile.id) classes.push('guide-to');
        }

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
                <svg
                  className="wheel"
                  viewBox={`${-HALF_W} ${-HALF_H} ${HALF_W * 2} ${HALF_H * 2}`}
                  aria-hidden="true"
                >
                  {SECTORS.map((q, i) => (
                    <g
                      key={q.op}
                      className={`sector${drag?.sector === i ? ' hot' : ''}${
                        guide && guide.op !== q.op ? ' off' : ''
                      }`}
                    >
                      <path d={q.d} />
                      <text x={q.lx} y={q.ly}>
                        {q.label}
                      </text>
                    </g>
                  ))}
                </svg>
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
          Just the value, because corner indices at this size are unreadable
          specks and the card it came from is still on the board. */}
      {dragged && (
        <div ref={proxyRef} className={`proxy ${faceClass(dragged)}`}>
          <span className="rank mono">{tileLabel(dragged)}</span>
        </div>
      )}
    </div>
  );
}
