/**
 * Inline SVG icons. `currentColor` throughout, so they inherit the button's
 * colour and its hover state without a second rule.
 *
 * Emoji were the obvious shortcut here and the wrong one: they render as a
 * different glyph on every platform, carry their own colour that ignores the
 * palette, and sit on a baseline that never quite lines up with the text
 * beside them.
 */

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

/** Speaker with waves — sound is on. */
export function SoundOnIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M4 9.5h3L11 6v12L7 14.5H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6" />
      <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  );
}

/** Speaker with a cross — sound is off. */
export function SoundOffIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size}>
      <path d="M4 9.5h3L11 6v12L7 14.5H4z" />
      <path d="M16 9.5l5 5" />
      <path d="M21 9.5l-5 5" />
    </svg>
  );
}
