import { isRedSuit, rankLabel, SUIT_GLYPH } from '../lib/deck';
import { ratToString } from '../lib/rational';
import type { Tile } from '../lib/hand';

/**
 * Typographic card face. An original card shows rank + suit; a combined tile
 * shows its exact value, as a fraction when it is not whole (24/7, never
 * 3.4285714285714284).
 */
const CORNERS = ['tl', 'tr', 'bl', 'br'] as const;

export function CardFace({ tile }: { tile: Tile }) {
  if (tile.card) {
    const { card } = tile;
    const label = rankLabel(card.value);
    const glyph = SUIT_GLYPH[card.suit];
    /* The centre carries the number you actually compute with (A is 1, K is
       13); the letter survives only in the corners.

       All four corners are upright. The traditional 180-rotated bottom pair is
       the classic layout, but a rotated heart reads as a spade at this size. */
    return (
      <>
        {CORNERS.map((pos) => (
          <span key={pos} className={`corner ${pos}`}>
            {label}
            <br />
            {glyph}
          </span>
        ))}
        <span className="rank mono">{tileLabel(tile)}</span>
      </>
    );
  }

  const text = ratToString(tile.value);
  return <span className={`rank mono${text.includes('/') ? ' fraction' : ''}`}>{text}</span>;
}

/**
 * The value a tile shows in the middle, and what the drag proxy carries.
 *
 * Always the number, never the letter: the middle is the operand you are doing
 * arithmetic with, so an ace reads 1 and a king reads 13. The letters survive
 * in the corner indices, which is where a card says what card it is.
 */
export function tileLabel(tile: Tile): string {
  if (!tile.card) return ratToString(tile.value);
  return String(tile.card.value);
}

export const faceClass = (tile: Tile): string =>
  tile.card ? (isRedSuit(tile.card.suit) ? 'red' : '') : 'derived';
