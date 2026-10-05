import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({ open: vi.fn(), startPane: vi.fn(), panesAvailable: vi.fn() }));
vi.mock('@antondanv/brainyard', async (original) => ({
  ...(await original<typeof import('@antondanv/brainyard')>()),
  ...backend,
}));

import { plantWithAgent } from '../src/agents/planting.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { tempDir } from './helpers.js';

const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

beforeEach(() => {
  vi.clearAllMocks();
  resetSettings({ ...DEFAULTS });
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
  backend.panesAvailable.mockReturnValue(true);
  backend.startPane.mockImplementation(async ({ brain }) => ({
    brain,
    pane: 'planting-pane',
    startedAt: new Date().toISOString(),
    warnings: [],
  }));
  backend.open.mockResolvedValue({ ok: true, warnings: [] });
});
afterEach(() => {
  if (stdinTty) Object.defineProperty(process.stdin, 'isTTY', stdinTty);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  if (stdoutTty) Object.defineProperty(process.stdout, 'isTTY', stdoutTty);
  else Reflect.deleteProperty(process.stdout, 'isTTY');
  resetSettings({ ...DEFAULTS });
  vi.unstubAllEnvs();
});

describe('the planting session entry', () => {
  it.each(['claude', 'codex', 'antigravity', 'opencode'] as const)(
    'opens %s beside the tree without planting it early',
    async (brain) => {
      const dir = tempDir();
      vi.stubEnv('TREEYARD_NODE', 'the-parent-session-node');
      const result = await plantWithAgent(dir, brain);
      expect(result).toMatchObject({ mode: 'pane', pane: { pane: 'planting-pane', cwd: dir, brain } });
      expect(backend.open).not.toHaveBeenCalled();
      const options = backend.startPane.mock.lastCall![0];
      expect(options).toMatchObject({ brain, cwd: dir, env: { TREEYARD_NODE: '' } });
      expect(options.system.split('## Session entry')[1]).toContain('Ctrl+Q');
      expect(options.system).toContain('Do not ask them to launch treeyard again');
      expect(Boolean(options.name)).toBe(brain === 'claude');
      expect(existsSync(join(dir, '.tree'))).toBe(false);
    },
  );

  it.each(['no tmux', 'terminal preference', 'no tty'])(
    '%s keeps the interview in the terminal and explains the return',
    async (reason) => {
      if (reason === 'no tmux') backend.panesAvailable.mockReturnValue(false);
      if (reason === 'terminal preference') resetSettings({ ...DEFAULTS, open: 'terminal' });
      if (reason === 'no tty') Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
      const dir = tempDir();
      expect(await plantWithAgent(dir, 'claude')).toMatchObject({ mode: 'terminal', result: { ok: true } });
      expect(backend.startPane).not.toHaveBeenCalled();
      expect(backend.open.mock.lastCall![0].system.split('## Session entry')[1]).toContain(
        'exit this session — the tree will open automatically',
      );
      expect(existsSync(join(dir, '.tree'))).toBe(false);
    },
  );
});
