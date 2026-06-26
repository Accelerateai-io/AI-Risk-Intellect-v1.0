type ReloadFn = (options?: { silent?: boolean }) => Promise<void>;

let reloadFn: ReloadFn | null = null;

/** Registers the provider's reload handler; returns an unregister function. */
export function registerNotificationsReload(fn: ReloadFn): () => void {
  reloadFn = fn;
  return () => {
    if (reloadFn === fn) reloadFn = null;
  };
}

/** Triggers a notifications refresh when the provider is mounted. */
export function requestNotificationsReload(
  options?: { silent?: boolean },
): Promise<void> {
  return reloadFn?.(options) ?? Promise.resolve();
}
