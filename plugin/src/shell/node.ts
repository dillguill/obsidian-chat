/** Desktop-only Node module loading for the Obsidian desktop runtime.
 *
 *  Obsidian loads plugins as CommonJS with a working `require`; browsers and
 *  `node --test` only support dynamic import. Try `require` first (desktop
 *  reality, and what the bundle wrapper provides), then dynamic import. This is
 *  the seam that unit tests under Node could not exercise and that made the
 *  loopback host fail to start in Obsidian.
 */
declare const require: ((id: string) => unknown) | undefined;

export function requireNodeModule<T>(id: string): T | null {
  const local = typeof require === "function" ? require : undefined;
  const globalRequire = (globalThis as { require?: (id: string) => unknown }).require;
  for (const req of [local, globalRequire]) {
    if (typeof req !== "function") continue;
    try {
      return req(id) as T;
    } catch {
      // fall through to the next loader
    }
  }
  return null;
}

export async function loadNodeModule<T>(id: string): Promise<T> {
  const sync = requireNodeModule<T>(id);
  if (sync) return sync;
  try {
    return (await import(/* @vite-ignore */ id)) as T;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `could not load ${id} in the desktop runtime (${reason}). ` +
        "If this install should host, check Settings → Chat → Role.",
    );
  }
}
