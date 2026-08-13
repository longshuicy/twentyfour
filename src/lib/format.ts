/** Seconds as m:ss.s, or ss.s under a minute. */
export function formatTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const whole = Math.floor(clamped);
  const tenths = Math.floor((clamped - whole) * 10);
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  return minutes > 0
    ? `${minutes}:${String(secs).padStart(2, '0')}.${tenths}`
    : `${secs}.${tenths}`;
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;
