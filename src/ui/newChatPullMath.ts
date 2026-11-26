/** Finger travel that maps 1:1 before rubber-band resistance. */
const FOLLOW = 24;
/** Rubber-band asymptote for travel past FOLLOW — full ring needs ~120px of finger travel. */
const LIMIT = 120;
/** Upward speed (px/ms) at activation that is treated as a flick, not a pull. */
const FLICK_SPEED = 0.7;

/**
 * Maps raw finger travel to resisted pull distance. The first FOLLOW px follow the finger;
 * past that the thread lags so a deliberate pull is needed to close the ring.
 */
export function resisted(raw: number): number {
  const d = Math.max(0, raw);
  if (d <= FOLLOW) return d;
  const extra = d - FOLLOW;
  return FOLLOW + LIMIT * (1 - 1 / (extra / LIMIT + 1));
}

/** True when the finger is flicking upward fast enough that the list should keep ownership. */
export function isFlick(_distance: number, velocity: number): boolean {
  return velocity > FLICK_SPEED;
}
