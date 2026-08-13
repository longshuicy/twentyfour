/**
 * Seconds as `m:ss.s`, or `ss.ss` under a minute.
 *
 * The unit is part of the format, not something callers append: a bare `41.3`
 * could be anything, and `2:23.1s` — an `s` stapled onto a clock reading — is
 * simply wrong. So sub-minute values carry the `s` and `m:ss` values do not,
 * because the colon already says what the number is.
 */
export function formatTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const whole = Math.floor(clamped);
  const tenths = Math.floor((clamped - whole) * 10);
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  return minutes > 0
    ? `${minutes}:${String(secs).padStart(2, '0')}.${tenths}`
    : `${secs}.${tenths}s`;
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;
