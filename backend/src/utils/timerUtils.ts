/** Maximum delay supported by Node.js setTimeout (32-bit signed integer ms). */
export const MAX_SET_TIMEOUT_MS = 2_147_483_647;

/** Clamp a delay so setTimeout does not overflow or fire immediately. */
export function clampSetTimeoutMs(ms: number, minMs = 1): number {
  return Math.min(Math.max(minMs, ms), MAX_SET_TIMEOUT_MS);
}
