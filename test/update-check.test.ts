import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULTS, resetSettings, updateSettings } from '../src/settings.js';
import {
  cachePath,
  installedFromNpm,
  isNewer,
  startFetcher,
  updateCommand,
  updateNotice,
  updatesOn,
} from '../src/update-check.js';
import { tempDir } from './helpers.js';

const NOW = Date.parse('2026-11-26T12:00:00Z');
const HOUR = 60 * 60 * 1000;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  env = { TREEYARD_HOME: tempDir('treeyard-home-') };
  process.env.TREEYARD_HOME = env.TREEYARD_HOME;
  resetSettings({ ...DEFAULTS });
});

afterEach(() => {
  resetSettings(undefined);
});

const cache = (data: object) => writeFileSync(cachePath(env), JSON.stringify(data));
const ask = (extra: Partial<Parameters<typeof updateNotice>[0]> = {}) =>
  updateNotice({
    env,
    now: NOW,
    current: '0.1.1',
    fromNpm: true,
    folder: '/usr/lib/node_modules/@antondanv/treeyard',
    ...extra,
  });

describe('versions', () => {
  it('compares releases by number, not by text', () => {
    expect(isNewer('0.2.0', '0.1.1')).toBe(true);
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.1.1', '0.1.1')).toBe(false);
    expect(isNewer('0.1.0', '0.1.1')).toBe(false);
    expect(isNewer('0.2.0-beta.1', '0.2.0')).toBe(false);
    expect(isNewer('0.2.0', '0.2.0-beta.1')).toBe(true);
    expect(isNewer('garbage', '0.1.1')).toBe(false);
  });

  it('names the package manager that put treeyard where it is', () => {
    expect(updateCommand('/usr/lib/node_modules/@antondanv/treeyard')).toBe(
      'npm install -g @antondanv/treeyard@latest',
    );
    expect(updateCommand('/Users/a/Library/pnpm/global/5/.pnpm/@antondanv+treeyard@0.1.1/node_modules/x')).toBe(
      'pnpm add -g @antondanv/treeyard@latest',
    );
    expect(updateCommand('/Users/a/.bun/install/global/node_modules/@antondanv/treeyard')).toBe(
      'bun add -g @antondanv/treeyard@latest',
    );
  });

  it('a checkout is not an npm install', () => {
    expect(installedFromNpm('/usr/lib/node_modules/@antondanv/treeyard')).toBe(true);
    expect(installedFromNpm('/Users/a/Projects/Treeyard')).toBe(false);
  });
});

describe('the notice', () => {
  it('names the newer version and the command from a fresh cache, asking nobody', () => {
    cache({ latest: '0.2.0', checkedAt: NOW - HOUR });
    const fetch = vi.fn();
    expect(ask({ fetch })).toEqual({
      current: '0.1.1',
      latest: '0.2.0',
      command: 'npm install -g @antondanv/treeyard@latest',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says nothing when the installed version is the newest', () => {
    cache({ latest: '0.1.1', checkedAt: NOW - HOUR });
    expect(ask({ fetch: vi.fn() })).toBeUndefined();
  });

  it('with no cache yet starts a background check and answers at once with nothing', () => {
    const fetch = vi.fn();
    expect(ask({ fetch })).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(cachePath(env));
  });

  it('a day-old answer is shown and refreshed in the background', () => {
    cache({ latest: '0.2.0', checkedAt: NOW - 25 * HOUR });
    const fetch = vi.fn();
    expect(ask({ fetch })?.latest).toBe('0.2.0');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not start another check within an hour of the last one, answered or not (no network)', () => {
    const fetch = vi.fn();
    ask({ fetch });
    ask({ fetch, now: NOW + 10 * 60 * 1000 });
    expect(fetch).toHaveBeenCalledTimes(1);
    ask({ fetch, now: NOW + 2 * HOUR });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a check that cannot even start does not break the run', () => {
    const fetch = vi.fn(() => {
      throw new Error('spawn EAGAIN');
    });
    expect(() => ask({ fetch })).not.toThrow();
  });

  it('a broken cache file is the same as none', () => {
    writeFileSync(cachePath(env), '{not json');
    expect(ask({ fetch: vi.fn() })).toBeUndefined();
  });

  it('stays silent and asks nobody when switched off: by env, by the setting, in CI, outside npm', () => {
    cache({ latest: '0.2.0', checkedAt: NOW - HOUR });
    const fetch = vi.fn();
    expect(ask({ fetch, env: { ...env, TREEYARD_UPDATES: 'off' } })).toBeUndefined();
    expect(ask({ fetch, env: { ...env, CI: 'true' } })).toBeUndefined();
    expect(ask({ fetch, env: { ...env, NO_UPDATE_NOTIFIER: '1' } })).toBeUndefined();
    expect(ask({ fetch, fromNpm: false })).toBeUndefined();
    updateSettings({ updates: false });
    expect(ask({ fetch })).toBeUndefined();
    expect(updatesOn(env)).toBe(false);
    expect(updatesOn({ ...env, TREEYARD_UPDATES: 'on' })).toBe(true);
    const stale = join(env.TREEYARD_HOME!, 'update-check.json');
    writeFileSync(stale, JSON.stringify({ latest: '0.2.0', checkedAt: 0 }));
    expect(ask({ fetch })).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the background check', () => {
  const waitFor = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  };

  it('writes the registry answer into the cache without the caller waiting', async () => {
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ name: '@antondanv/treeyard', version: '0.3.0' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
      const started = Date.now();
      startFetcher(cachePath(env), `http://127.0.0.1:${port}/latest`);
      expect(Date.now() - started).toBeLessThan(1000);
      await waitFor(() => existsSync(cachePath(env)));
      const data = JSON.parse(readFileSync(cachePath(env), 'utf8')) as { latest: string; checkedAt: number };
      expect(data.latest).toBe('0.3.0');
      expect(data.checkedAt).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });

  it('leaves no cache and no noise when the registry cannot be reached', async () => {
    // A port nobody listens on: the connection is refused at once.
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    await new Promise((resolve) => server.close(resolve));
    startFetcher(cachePath(env), `http://127.0.0.1:${port}/latest`);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(existsSync(cachePath(env))).toBe(false);
  });
});
