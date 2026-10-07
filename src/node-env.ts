/**
 * Treeyard runs itself with NODE_ENV=production (React's dev build leaks
 * memory in a long-lived TUI), but only when the shell left it unset. That
 * default is ours: what Treeyard starts for you — a node's check, a session —
 * must not inherit it, or `npm test` runs as production. This module only
 * remembers whether we put it there; it imports nothing, so it is safe to load
 * before React.
 */

const DEFAULT = 'production';
let own = false;

/** Sets NODE_ENV for this process unless it is already set. Call before React loads. */
export function defaultNodeEnv(): void {
  if (process.env.NODE_ENV !== undefined) return;
  process.env.NODE_ENV = DEFAULT;
  own = true;
}

/** True when this process's NODE_ENV is the one Treeyard set, not the user's. */
export function ownNodeEnv(): boolean {
  return own && process.env.NODE_ENV === DEFAULT;
}

/** The environment for a child process: ours plus `extra`, without NODE_ENV when it is ours. */
export function childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  if (ownNodeEnv() && !('NODE_ENV' in extra)) delete env.NODE_ENV;
  return env;
}
