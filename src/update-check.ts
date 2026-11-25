/**
 * A newer treeyard in npm: told once the registry has one, never on the way of a start.
 *
 * The answer is cached for a day in `~/.treeyard/update-check.json`. The question to the
 * registry is asked by a detached child process, so the command in hand neither waits for it
 * nor stays alive for it; without a network the child fails quietly and the next start tries
 * again after an hour. `TREEYARD_UPDATES=off` or the setting `updates` switches it all off.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { homeFolder, settings } from './settings.js';

export const PACKAGE_NAME = '@antondanv/treeyard';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME.replace('/', '%2f')}/latest`;
const FRESH_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 3000;

interface Cache {
  /** When the registry last answered. */
  checkedAt?: number;
  /** The newest version it named. */
  latest?: string;
  /** When a check was last started: no new one before `RETRY_MS` passes, answered or not. */
  attemptedAt?: number;
}

export interface UpdateNotice {
  current: string;
  latest: string;
  /** What to type to get it. */
  command: string;
}

export function cachePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeFolder(env), 'update-check.json');
}

/** Whether to look for updates in this run: the setting, unless `TREEYARD_UPDATES` or CI says otherwise. */
export function updatesOn(env: NodeJS.ProcessEnv = process.env): boolean {
  // Read here, not in loadSettings: a one-run override must not end up in settings.json.
  const forced = env.TREEYARD_UPDATES?.trim().toLowerCase();
  if (forced === 'off' || forced === '0' || forced === 'false') return false;
  if (forced === 'on' || forced === '1' || forced === 'true') return true;
  if (env.CI || env.NO_UPDATE_NOTIFIER) return false;
  return settings().updates;
}

/** Is `a` a higher release than `b`? Plain `x.y.z`; a pre-release tag counts as lower than its release. */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(-[^+]*)?/.exec(v.trim());
    return match ? { nums: [Number(match[1]), Number(match[2]), Number(match[3])], pre: Boolean(match[4]) } : undefined;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i]! > y.nums[i]!;
  return y.pre && !x.pre;
}

function readCache(env: NodeJS.ProcessEnv): Cache {
  try {
    const data = JSON.parse(readFileSync(cachePath(env), 'utf8')) as Cache;
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeCache(cache: Cache, env: NodeJS.ProcessEnv): void {
  try {
    const path = cachePath(env);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(cache)}\n`);
  } catch {
    // A folder that cannot be written is no reason to say anything.
  }
}

/** The package manager that put this copy here, read from where it lives. */
export function updateCommand(folder: string = packageFolder()): string {
  const path = folder.split(sep).join('/');
  if (path.includes('/.pnpm/') || path.includes('/pnpm/')) return `pnpm add -g ${PACKAGE_NAME}@latest`;
  if (path.includes('/.bun/')) return `bun add -g ${PACKAGE_NAME}@latest`;
  if (path.includes('/yarn/')) return `yarn global add ${PACKAGE_NAME}@latest`;
  return `npm install -g ${PACKAGE_NAME}@latest`;
}

function packageFolder(): string {
  const here = fileURLToPath(new URL('..', import.meta.url));
  try {
    return realpathSync(here);
  } catch {
    return here;
  }
}

/** Run from node_modules, i.e. installed from npm: a `npm link` or a checkout updates by `git pull`, not by this. */
export function installedFromNpm(folder: string = packageFolder()): boolean {
  return folder.split(sep).includes('node_modules');
}

/** The code of the child that asks the registry; plain JS so that source and built runs both can use it. */
const FETCHER = `
const [url, file, timeout] = process.argv.slice(1);
const fs = require('node:fs');
(async () => {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(Number(timeout)) });
  if (!res.ok) return;
  const latest = (await res.json()).version;
  if (typeof latest !== 'string') return;
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  fs.writeFileSync(file, JSON.stringify({ ...cache, latest, checkedAt: Date.now() }) + '\\n');
})().catch(() => {});
`;

export interface UpdateDeps {
  env?: NodeJS.ProcessEnv;
  now?: number;
  current: string;
  /** Replaces the child that asks the registry (tests). */
  fetch?: (cache: string) => void;
  /** Overrides the check that this copy came from npm (tests). */
  fromNpm?: boolean;
  folder?: string;
}

/**
 * What to tell the person right now: reads the cache only. When the answer is older than a day,
 * starts a check in the background for the next run; the answer to this run is what is cached.
 */
export function updateNotice(deps: UpdateDeps): UpdateNotice | undefined {
  const env = deps.env ?? process.env;
  if (!updatesOn(env)) return undefined;
  if (!(deps.fromNpm ?? installedFromNpm(deps.folder))) return undefined;
  const now = deps.now ?? Date.now();
  const cache = readCache(env);
  const stale = !cache.checkedAt || now - cache.checkedAt > FRESH_MS || cache.checkedAt > now;
  const tried = cache.attemptedAt !== undefined && now - cache.attemptedAt < RETRY_MS && cache.attemptedAt <= now;
  if (stale && !tried) {
    writeCache({ ...cache, attemptedAt: now }, env);
    try {
      (deps.fetch ?? startFetcher)(cachePath(env));
    } catch {
      // No way to start it: the next run tries again.
    }
  }
  if (!cache.latest || !isNewer(cache.latest, deps.current)) return undefined;
  return { current: deps.current, latest: cache.latest, command: updateCommand(deps.folder) };
}

export function startFetcher(file: string, url: string = REGISTRY_URL): void {
  const child = spawn(process.execPath, ['-e', FETCHER, url, file, String(TIMEOUT_MS)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {});
  child.unref();
}
