import { useRef, useState } from 'react';
import type { Op } from '../lib/solver';
import type { HandState, Tile } from '../lib/hand';
import { CardFace, faceClass } from './CardFace';

/**
 * 2x2 board with drag-to-combine.
 *
 * Pointer events, deliberately not HTML5 drag-and-drop (unusable on touch) and
 * not a DnD library (overkill for four targets). setPointerCapture means we
 * keep receiving moves even when the finger leaves the element.
 *
 * The DRAGGED card is always the LEFT operand: drag 7 onto 3 gives 7-3, drag 3
 * onto 7 gives 3-7. That is what lets the drop target show a plain four-way
 * + - x / overlay instead of six labeled zones.
 */

const QUADRANTS: { op: Op; label: string }[] = [
  { op: '+', label: '+' },
  { op: '-', label: '−' },
  { op: '*', label: '×' },
  { op: '/', label: '÷' },
];

/** Index into QUADRANTS from a point inside the target rect. */
function quadrantAt(rect: DOMRect, x: number, y: number): number {
  const right = x > rect.left + rect.width / 2 ? 1 : 0;
  const bottom = y > rect.top + rect.height / 2 ? 1 : 0;
  return bottom * 2 + right;
}

type Drag = {
  tileId: string;
  dx: number;
  dy: number;
  targetId: string | null;
  quadrant: number | null;
};

export function Board({
  hand,
  disabled,
  onCombine,
}: {
  hand: HandState;
  disabled: boolean;
  onCombine: (draggedId: string, targetId: string, op: Op) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const slots = useRef(new Map<string, HTMLDivElement>());
  const origin = useRef({ x: 0, y: 0 });

  const setSlot = (id: string) => (el: HTMLDivElement | null) => {
    if (el) slots.current.set(id, el);
    else slots.current.delete(id);
  };

  /** Which other tile is under the pointer, and which quadrant of it. */
  function hitTest(x: number, y: number, selfId: string) {
    for (const [id, el] of slots.current) {
      if (id === selfId) continue;
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return { targetId: id, quadrant: quadrantAt(rect, x, y) };
      }
    }
    return { targetId: null, quadrant: null };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>, tile: Tile) {
    if (disabled || hand.tiles.length < 2) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    origin.current = { x: e.clientX, y: e.clientY };
    setDrag({ tileId: tile.id, dx: 0, dy: 0, targetId: null, quadrant: null });
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const hit = hitTest(e.clientX, e.clientY, drag.tileId);
    setDrag({
      tileId: drag.tileId,
      dx: e.clientX - origin.current.x,
      dy: e.clientY - origin.current.y,
      ...hit,
    });
  }

  function onPointerUp() {
    if (!drag) return;
    if (drag.targetId && drag.quadrant !== null) {
      onCombine(drag.tileId, drag.targetId, QUADRANTS[drag.quadrant].op);
    }
    setDrag(null);
  }

  return (
    <div className="board">
      {hand.tiles.map((tile) => {
        const isDragging = drag?.tileId === tile.id;
        const isTarget = drag?.targetId === tile.id;
        const classes = ['card', faceClass(tile)];
        if (isDragging) classes.push('dragging');
        if (isTarget) classes.push('armed');

        return (
          <div className="slot" key={tile.id} ref={setSlot(tile.id)}>
            <div
              className={classes.join(' ')}
              style={
                isDragging
                  ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` }
                  : undefined
              }
              onPointerDown={(e) => onPointerDown(e, tile)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <CardFace tile={tile} />
              {isTarget && (
                <div className="quadrants">
                  {QUADRANTS.map((q, i) => (
                    <div
                      key={q.op}
                      className={`quadrant${drag?.quadrant === i ? ' hot' : ''}`}
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
    </div>
  );
}
