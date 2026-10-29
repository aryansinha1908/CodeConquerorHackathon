// A lazy page whose file is gone. After a redeploy, an open tab still asks for the old build's
// hashed chunks, which the new deployment doesn't have (vercel.json answers a missing /assets file
// with a 404, not index.html), so the import rejects ("Failed to fetch dynamically imported
// module") and, unhandled, the shell's ErrorBoundary replaces the whole app. Reloading fetches the
// new index.html and its chunks. At most one reload per RELOAD_WINDOW_MS, remembered in
// sessionStorage: if the reloaded page fails too (an outage, a broken deploy), the error goes on to
// the ErrorBoundary instead of reloading in a loop.

export const RELOAD_KEY = 'campuscommons:chunk-reload-at';
export const RELOAD_WINDOW_MS = 10_000;

/**
 * Starts a reload unless one started in the last RELOAD_WINDOW_MS; true when it did. Never reloads
 * when it can't record that it did (storage missing or blocked), or while the browser is offline.
 */
export function reloadForStaleChunk({ storage, reload, now = Date.now(), online = true }) {
  if (!online || !storage) return false;
  try {
    const last = Number(storage.getItem(RELOAD_KEY));
    if (last > 0 && now >= last && now - last < RELOAD_WINDOW_MS) return false;
    storage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

function browserDeps() {
  let storage = null;
  try {
    storage = window.sessionStorage;
  } catch {
    // Blocked site data: no reload, the ErrorBoundary takes the error.
  }
  return {
    storage,
    reload: () => window.location.reload(),
    now: Date.now(),
    online: window.navigator?.onLine !== false,
  };
}

/**
 * load (() => import('…')) for React.lazy. When the import fails and a reload starts, the promise
 * never settles: the Suspense fallback stays up until the reload replaces the page, rather than the
 * error screen flashing first. Otherwise the error is rethrown.
 */
export function withStaleChunkReload(load, deps = browserDeps) {
  return () =>
    load().catch((error) => {
      if (reloadForStaleChunk(deps())) return new Promise(() => {});
      throw error;
    });
}
