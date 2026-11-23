import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  open: vi.fn(),
  startPane: vi.fn(),
  listPanes: vi.fn(),
  sessions: vi.fn(),
  setPaneSession: vi.fn(),
}));
vi.mock('@antondanv/brainyard', async (original) => ({
  ...(await original<typeof import('@antondanv/brainyard')>()),
  ...backend,
  panesAvailable: () => true,
}));

import { fullAccess } from '../src/agents/access.js';
import { launch, resume, resumeLoose } from '../src/agents/launch.js';
import { launchInPane, wakeInPane } from '../src/agents/panes.js';
import { type SendSources, sendToNode } from '../src/agents/send.js';
import { addNode, attachSession } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { ROOT } from '../src/model/types.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { emptyTree, tempDir } from './helpers.js';

const codexHome = process.env.CODEX_HOME;
const gitConfig = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };

beforeEach(() => {
  vi.clearAllMocks();
  backend.listPanes.mockResolvedValue([]);
  backend.sessions.mockResolvedValue([]);
  backend.setPaneSession.mockResolvedValue(true);
  // A Codex whose config.toml says nothing about the sandbox.
  const home = tempDir('treeyard-codex-home-');
  writeFileSync(join(home, 'config.toml'), 'model = "gpt-6"\n');
  process.env.CODEX_HOME = home;
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_SYSTEM = '/dev/null';
});
afterEach(() => {
  resetSettings(undefined);
  for (const [key, value] of [
    ['CODEX_HOME', codexHome],
    ['GIT_CONFIG_GLOBAL', gitConfig.global],
    ['GIT_CONFIG_SYSTEM', gitConfig.system],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** The tree of a git repository: the `.git` Codex's sandbox has to open lives next to `.tree`. */
function projectInRepo() {
  const tree = emptyTree();
  const dir = realpathSync(tree.project.dir);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  return { tree: loadTree(dir), gitDir: join(dir, '.git') };
}

const SANDBOX = (gitDir: string) => [
  '--sandbox',
  'workspace-write',
  '-c',
  'sandbox_workspace_write.network_access=true',
  '-c',
  `sandbox_workspace_write.writable_roots=["${gitDir}"]`,
];

describe('Codex starts with the sandbox the person chose', () => {
  it('«sandbox + treeyard and git»: a new session, a pane, a resume and a wake carry the flags', async () => {
    resetSettings({ ...DEFAULTS, codexAccess: 'sandbox' });
    const { tree, gitDir } = projectInRepo();
    const node = addNode(tree, { title: 'Work', doneWhen: 'it works' });
    backend.open.mockResolvedValue({ ok: true, sessionId: 'codex-1', startedAt: new Date().toISOString() });
    const { ref } = await launch(tree, node.id, { brain: 'codex', start: 'do' });
    expect(backend.open.mock.lastCall?.[0]).toMatchObject({ brain: 'codex', extraArgs: SANDBOX(gitDir) });
    // Codex has no permission mode to pass along: its sandbox is the flags.
    expect(backend.open.mock.lastCall?.[0]).not.toHaveProperty('permissionMode');

    await resume(tree, node.id, ref!);
    expect(backend.open.mock.lastCall?.[0]).toMatchObject({ resume: 'codex-1', extraArgs: SANDBOX(gitDir) });
    await resumeLoose(tree, { brain: 'codex', id: 'loose', interactive: true, startedAt: '2026-11-23T10:00:00Z' });
    expect(backend.open.mock.lastCall?.[0]).toMatchObject({ resume: 'loose', extraArgs: SANDBOX(gitDir) });

    backend.startPane.mockResolvedValue({
      pane: 'codex-p',
      sessionId: 'codex-2',
      startedAt: new Date().toISOString(),
      warnings: [],
    });
    const pane = await launchInPane(
      tree,
      node.id,
      { brain: 'codex', start: 'do', pane: true },
      { width: 80, height: 24 },
    );
    expect(backend.startPane.mock.lastCall?.[0]).toMatchObject({ brain: 'codex', extraArgs: SANDBOX(gitDir) });
    // The CLI wrote the conversation down: there is something to wake.
    backend.sessions.mockResolvedValue([
      { brain: 'codex', id: 'codex-2', interactive: true, startedAt: '2026-11-23T10:00:00Z' },
    ]);
    await wakeInPane(tree, node.id, pane.ref, { width: 80, height: 24 });
    expect(backend.startPane.mock.lastCall?.[0]).toMatchObject({ resume: 'codex-2', extraArgs: SANDBOX(gitDir) });
  });

  it('keeps the person’s own writable roots from config.toml next to the .git', () => {
    resetSettings({ ...DEFAULTS, codexAccess: 'sandbox' });
    const { tree, gitDir } = projectInRepo();
    writeFileSync(
      join(process.env.CODEX_HOME!, 'config.toml'),
      '[sandbox_workspace_write]\nwritable_roots = ["/data/shared"]\n',
    );
    expect(fullAccess('codex', tree.project.dir).extraArgs?.at(-1)).toBe(
      `sandbox_workspace_write.writable_roots=["/data/shared","${gitDir}"]`,
    );
  });

  it('«as in config.toml» and «not chosen yet» add nothing', async () => {
    const { tree } = projectInRepo();
    backend.open.mockResolvedValue({ ok: true, sessionId: 'codex-3', startedAt: new Date().toISOString() });
    for (const codexAccess of ['config', ''] as const) {
      resetSettings({ ...DEFAULTS, codexAccess });
      expect(fullAccess('codex', tree.project.dir)).toEqual({});
      await launch(tree, ROOT, { brain: 'codex', start: 'chat' });
      expect(backend.open.mock.lastCall?.[0]).not.toHaveProperty('extraArgs');
      expect(backend.open.mock.lastCall?.[0]).not.toHaveProperty('permissionMode');
    }
  });

  it('the choice is Codex’s alone: the other CLIs start as before', async () => {
    resetSettings({ ...DEFAULTS, codexAccess: 'sandbox', antigravityAccess: 'normal' });
    const { tree } = projectInRepo();
    backend.open.mockResolvedValue({ ok: true, sessionId: 'other', startedAt: new Date().toISOString() });
    for (const brain of ['claude', 'opencode', 'antigravity'] as const) {
      await launch(tree, ROOT, { brain, start: 'chat' });
      expect(backend.open.mock.lastCall?.[0]).not.toHaveProperty('extraArgs');
    }
  });

  it('a project in a folder that is no repository still opens the network', () => {
    resetSettings({ ...DEFAULTS, codexAccess: 'sandbox' });
    const dir = tempDir('treeyard-codex-plain-');
    mkdirSync(dir, { recursive: true });
    expect(fullAccess('codex', dir).extraArgs).toEqual([
      '--sandbox',
      'workspace-write',
      '-c',
      'sandbox_workspace_write.network_access=true',
    ]);
  });
});

describe('treeyard send to a sleeping Codex pane', () => {
  it('wakes it with the same sandbox the session was opened with', async () => {
    resetSettings({ ...DEFAULTS, codexAccess: 'sandbox' });
    const { tree, gitDir } = projectInRepo();
    const node = addNode(tree, { title: 'Спит', status: 'active' });
    attachSession(tree, node.id, { brain: 'codex', id: 'codex-9', mode: 'pane', pane: 'codex-old' });
    const started: unknown[] = [];
    const sources: SendSources = {
      live: async () => [],
      panes: async () => [],
      type: async () => undefined,
      startPane: (async (options: unknown) => {
        started.push(options);
        return { pane: 'codex-new', brain: 'codex', startedAt: new Date().toISOString(), warnings: [], display: '' };
      }) as unknown as SendSources['startPane'],
      open: (async () => ({})) as unknown as SendSources['open'],
      stop: async () => 'stopped',
      pause: async () => undefined,
    };
    const sent = await sendToNode(tree, node.id, 'продолжай', { sources, size: { width: 100, height: 30 } });
    expect(sent).toMatchObject({ how: 'woke', pane: 'codex-new' });
    expect(started).toMatchObject([
      { brain: 'codex', resume: 'codex-9', prompt: 'продолжай', extraArgs: SANDBOX(gitDir) },
    ]);
  });
});
