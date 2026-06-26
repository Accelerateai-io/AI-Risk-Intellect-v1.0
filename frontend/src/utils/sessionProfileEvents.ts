/** Dispatched when sessionStorage user profile or token is updated (e.g. My account). */
export const SESSION_PROFILE_CHANGED = "app-session-changed";

export function notifySessionProfileChanged(): void {
  window.dispatchEvent(new Event(SESSION_PROFILE_CHANGED));
}
