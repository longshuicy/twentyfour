import { isRedSuit, rankLabel, SUIT_GLYPH } from '../lib/deck';
import { ratToString } from '../lib/rational';
import type { Tile } from '../lib/hand';

/**
 * Typographic card face. An original card shows rank + suit; a combined tile
 * shows its exact value, as a fraction when it is not whole (24/7, never
 * 3.4285714285714284).
 */
export function CardFace({ tile }: { tile: Tile }) {
  if (tile.card) {
    const { card } = tile;
    const label = rankLabel(card.value);
    const glyph = SUIT_GLYPH[card.suit];
    /* Single top-left index only. A 180-degree-rotated bottom corner is the
       traditional layout, but a rotated heart reads as a spade at this size —
       actively misleading. One corner, upright. */
    return (
      <>
        <span className="corner">
          {label}
          <br />
          {glyph}
        </span>
        <span className="rank">{label}</span>
      </>
    );
  }

  const text = ratToString(tile.value);
  return <span className={`rank mono${text.includes('/') ? ' fraction' : ''}`}>{text}</span>;
}

export const faceClass = (tile: Tile): string =>
  tile.card ? (isRedSuit(tile.card.suit) ? 'red' : '') : 'derived';
