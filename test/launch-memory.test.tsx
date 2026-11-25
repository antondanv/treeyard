import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({ open: vi.fn(), startPane: vi.fn(), listPanes: vi.fn(), sessions: vi.fn() }));
vi.mock('@antondanv/brainyard', async (original) => ({
  ...(await original<typeof import('@antondanv/brainyard')>()),
  ...backend,
}));

import { launch } from '../src/agents/launch.js';
import { launchInPane } from '../src/agents/panes.js';
import {
  brainOrder,
  lastLaunch,
  launchOptions,
  loadLaunchMemory,
  memoryPath,
  openOptions,
  rememberLaunch,
} from '../src/launch-memory.js';
import { addNode } from '../src/model/ops.js';
import { DEFAULTS, loadSettings, resetSettings, saveSettings, updateSettings } from '../src/settings.js';
import { type LaunchEntry, NodeMenu, SettingsDialog } from '../src/tui/dialogs.js';
import { snapshot } from '../src/tui/snapshot.js';
import { emptyTree, tempDir } from './helpers.js';

afterEach(() => {
  cleanup();
  resetSettings(undefined);
});

beforeEach(() => {
  vi.clearAllMocks();
  backend.listPanes.mockResolvedValue([]);
  backend.sessions.mockResolvedValue([]);
  resetSettings({ ...DEFAULTS, launchMemory: 'project' });
});

const T1 = new Date('2026-11-25T10:00:00Z');
const T2 = new Date('2026-11-25T11:00:00Z');
const T3 = new Date('2026-11-25T12:00:00Z');

describe('the memory of last launches', () => {
  it('keeps each CLI’s last launch in the project, out of git', () => {
    const { project } = emptyTree();
    rememberLaunch(
      project.dir,
      { brain: 'claude', start: 'do', model: 'opus', effort: 'high', pane: true, worktree: true },
      'project',
      T1,
    );
    rememberLaunch(project.dir, { brain: 'claude', start: 'goal', background: true }, 'project', T2);
    rememberLaunch(project.dir, { brain: 'antigravity', start: 'plan' }, 'project', T3);
    expect(existsSync(join(project.dir, '.tree', '.local', 'last-launch.json'))).toBe(true);
    const memory = loadLaunchMemory(project.dir, 'project');
    // The second launch of a CLI replaces the first one wholesale: no model or worktree left over.
    expect(memory.claude).toEqual({ brain: 'claude', start: 'goal', where: 'background', at: T2.toISOString() });
    expect(memory.antigravity).toMatchObject({ start: 'plan', where: 'terminal' });
    expect(lastLaunch(memory)?.brain).toBe('antigravity');
  });

  it('is one for all projects when the setting says so', () => {
    const one = emptyTree().project.dir;
    const two = emptyTree().project.dir;
    rememberLaunch(one, { brain: 'codex', start: 'do' }, 'global', T1);
    expect(loadLaunchMemory(two, 'global').codex?.start).toBe('do');
    expect(loadLaunchMemory(two, 'project')).toEqual({});
    expect(memoryPath(one, 'global')).toBe(join(process.env.TREEYARD_HOME!, 'last-launch.json'));
    expect(existsSync(memoryPath(one, 'project'))).toBe(false);
  });

  it('puts the last CLI first, then the others by recency, then never launched ones', () => {
    const { project } = emptyTree();
    expect(brainOrder({})).toEqual(['claude', 'codex', 'antigravity', 'opencode']);
    // The project's own CLI leads the ones never launched.
    expect(brainOrder({}, 'antigravity')).toEqual(['antigravity', 'claude', 'codex', 'opencode']);
    rememberLaunch(project.dir, { brain: 'claude', start: 'do' }, 'project', T1);
    rememberLaunch(project.dir, { brain: 'antigravity', start: 'do' }, 'project', T2);
    const memory = loadLaunchMemory(project.dir, 'project');
    expect(brainOrder(memory)).toEqual(['antigravity', 'claude', 'codex', 'opencode']);
    rememberLaunch(project.dir, { brain: 'claude', start: 'do' }, 'project', T3);
    expect(brainOrder(loadLaunchMemory(project.dir, 'project'), 'opencode')).toEqual([
      'claude',
      'antigravity',
      'opencode',
      'codex',
    ]);
  });

  it('turns what was saved into options, and mends what the CLI cannot do', () => {
    const { project } = emptyTree();
    const path = memoryPath(project.dir, 'project');
    mkdirSync(join(project.dir, '.tree', '.local'), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        codex: { start: 'goal', where: 'background', model: 'gpt-6', at: T1.toISOString() },
        claude: { start: 'chat', where: 'background', at: T1.toISOString() },
        opencode: { start: 'nonsense', where: 'pane' },
      }),
    );
    const memory = loadLaunchMemory(project.dir, 'project');
    // Codex has neither /goal nor a background mode; a chat cannot run in the background.
    expect(launchOptions(memory.codex!, true)).toEqual({
      brain: 'codex',
      start: 'do',
      background: false,
      pane: false,
      model: 'gpt-6',
    });
    expect(memory.claude).toMatchObject({ start: 'do', where: 'background' });
    expect(memory.opencode).toBeUndefined();
    // No tmux: a pane is this terminal.
    expect(launchOptions({ brain: 'claude', start: 'do', where: 'pane', at: '' }, false).pane).toBe(false);
    expect(launchOptions({ brain: 'claude', start: 'do', where: 'pane', at: '' }, true).pane).toBe(true);
  });

  it('does not remember a coordinator’s assignment', () => {
    const { project } = emptyTree();
    rememberLaunch(project.dir, { brain: 'codex', start: 'do', task: 'сделай' }, 'project', T1);
    expect(loadLaunchMemory(project.dir, 'project')).toEqual({});
  });

  it('is remembered by every way to start a session', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Узел' });
    backend.open.mockResolvedValue({ ok: true, sessionId: 'c-1', startedAt: new Date().toISOString() });
    await launch(tree, node.id, { brain: 'claude', start: 'do', background: true, model: 'opus', effort: 'low' });
    backend.startPane.mockResolvedValue({
      pane: 'p1',
      sessionId: 'a-1',
      startedAt: new Date().toISOString(),
      warnings: [],
    });
    await launchInPane(
      tree,
      node.id,
      { brain: 'antigravity', start: 'plan', pane: true, worktree: false },
      { width: 80, height: 24 },
    );
    const memory = loadLaunchMemory(tree.project.dir, 'project');
    expect(memory.claude).toMatchObject({ start: 'do', where: 'background', model: 'opus', effort: 'low' });
    expect(memory.antigravity).toMatchObject({ start: 'plan', where: 'pane', worktree: false });
    expect(lastLaunch(memory)?.brain).toBe('antigravity');
    // A launch that did not start anything leaves the memory as it was.
    backend.open.mockResolvedValue({ ok: false, error: { message: 'нет' }, warnings: [] });
    await launch(tree, node.id, { brain: 'codex', start: 'do' });
    expect(loadLaunchMemory(tree.project.dir, 'project').codex).toBeUndefined();
  });
});

describe('treeyard open without flags', () => {
  const fallback = { brain: 'claude' as const, start: 'plan' as const };
  const memory = {
    claude: {
      brain: 'claude' as const,
      start: 'goal' as const,
      where: 'pane' as const,
      model: 'opus',
      effort: 'high',
      worktree: true,
      at: '2026-11-25T10:00:00Z',
    },
    antigravity: {
      brain: 'antigravity' as const,
      start: 'do' as const,
      where: 'terminal' as const,
      at: '2026-11-25T11:00:00Z',
    },
  };

  it('starts as the last launch did', () => {
    expect(openOptions({}, memory, fallback, true)).toEqual({ brain: 'antigravity', start: 'do' });
  });

  it('--brain takes that CLI’s own last launch', () => {
    expect(openOptions({ brain: 'claude' }, memory, fallback, true)).toEqual({
      brain: 'claude',
      start: 'goal',
      pane: true,
      model: 'opus',
      effort: 'high',
      worktree: true,
    });
    // A CLI never launched: the project's defaults, as before.
    expect(openOptions({ brain: 'codex' }, memory, fallback, true)).toEqual({ brain: 'codex', start: 'plan' });
  });

  it('every flag said out loud beats the memory', () => {
    const options = openOptions(
      { brain: 'claude', start: 'chat', background: true, model: 'sonnet', worktree: false },
      memory,
      fallback,
      true,
    );
    // The remembered effort belongs to the remembered model, not to the one asked for.
    expect(options).toEqual({ brain: 'claude', start: 'chat', background: true, model: 'sonnet', worktree: false });
    expect(openOptions({ brain: 'claude', pane: true, effort: 'low' }, memory, fallback, false)).toMatchObject({
      pane: true,
      effort: 'low',
      model: 'opus',
    });
  });

  it('a remembered pane is the terminal where tmux is missing; a remembered chat does not run in the background', () => {
    expect(openOptions({ brain: 'claude' }, memory, fallback, false)).not.toHaveProperty('pane');
    const chat = { claude: { ...memory.claude, start: 'chat' as const } };
    expect(openOptions({ background: true }, chat, fallback, true)).toMatchObject({ background: true, start: 'do' });
  });

  it('with no memory: the project’s CLI and start in this terminal, as always', () => {
    expect(openOptions({}, {}, { brain: 'codex', start: 'do' }, true)).toEqual({ brain: 'codex', start: 'do' });
  });
});

const entries: LaunchEntry[] = [
  {
    remembered: true,
    options: { brain: 'antigravity', start: 'do', pane: true, model: 'gemini-3', effort: 'high', worktree: true },
  },
  { remembered: true, options: { brain: 'claude', start: 'plan', pane: false, model: 'opus', effort: 'low' } },
  { remembered: false, options: { brain: 'codex', start: 'plan', pane: true } },
  { remembered: false, options: { brain: 'opencode', start: 'plan', pane: true } },
];

function menu(launches: LaunchEntry[], onChoose = vi.fn(), width = 110) {
  const tree = emptyTree();
  const node = addNode(tree, { title: 'Узел' });
  const app = render(
    <NodeMenu
      node={node}
      width={width}
      height={30}
      launches={launches}
      live={new Map()}
      panes={[]}
      frame={0}
      onChoose={onChoose}
      onCancel={() => {}}
    />,
  );
  return { app, onChoose };
}

const pause = () => new Promise((done) => setTimeout(done, 50));

describe('the node menu', () => {
  it('shows the last launch on top with all its settings, the others with theirs', async () => {
    const { app } = menu(entries);
    await pause();
    const lines = (app.lastFrame() ?? '').split('\n');
    const at = (text: string) => lines.findIndex((line) => line.includes(text));
    expect(lines[at('Новая сессия') + 1]).toContain('▶ Antigravity · делать · gemini-3 · high · в панели · worktree');
    expect(at('▶ Claude Code · план · opus · low · в терминале')).toBeGreaterThan(at('▶ Antigravity'));
    expect(at('▶ Claude Code в фоне · план · opus · low')).toBe(at('▶ Claude Code · план') + 1);
    expect(at('▶ Codex · план · в панели')).toBeGreaterThan(at('▶ Claude Code в фоне'));
    expect(at('▶ OpenCode')).toBeGreaterThan(at('▶ Codex'));
  });

  it('keeps every hotkey with its CLI, in any order', async () => {
    for (const [key, brain] of [
      ['c', 'claude'],
      ['x', 'codex'],
      ['g', 'antigravity'],
      ['O', 'opencode'],
    ] as const) {
      const { app, onChoose } = menu(entries);
      await pause();
      app.stdin.write(key);
      await pause();
      const choice = onChoose.mock.calls[0]?.[0];
      expect(choice, key).toMatchObject({ kind: 'new', options: { brain } });
      app.unmount();
    }
    // b is Claude Code in the background, with Claude's own settings.
    const { app, onChoose } = menu(entries);
    await pause();
    app.stdin.write('b');
    await pause();
    expect(onChoose.mock.calls[0]?.[0]).toEqual({
      kind: 'new',
      options: { brain: 'claude', start: 'plan', background: true, pane: false, model: 'opus', effort: 'low' },
    });
  });

  it('starts the remembered launch as it was, with ⏎ on the first item', async () => {
    const { app, onChoose } = menu([...entries.slice(1), entries[0]!]);
    await pause();
    app.stdin.write('\r');
    await pause();
    expect(onChoose.mock.calls[0]?.[0].options).toEqual(entries[1]!.options);
    app.unmount();
  });

  it('when Claude Code ran in the background last, c and b both start it there', async () => {
    const background: LaunchEntry[] = [
      { remembered: true, options: { brain: 'claude', start: 'do', background: true, pane: false, model: 'opus' } },
      { remembered: false, options: { brain: 'codex', start: 'plan' } },
      { remembered: false, options: { brain: 'antigravity', start: 'plan' } },
      { remembered: false, options: { brain: 'opencode', start: 'plan' } },
    ];
    const { app } = menu(background);
    await pause();
    const frame = app.lastFrame() ?? '';
    expect(frame).toContain('▶ Claude Code · делать · opus · в фоне');
    expect(frame).not.toContain('Claude Code в фоне');
    for (const key of ['c', 'b']) {
      const { app: other, onChoose } = menu(background);
      await pause();
      other.stdin.write(key);
      await pause();
      expect(onChoose.mock.calls[0]?.[0].options).toMatchObject({ brain: 'claude', background: true });
      other.unmount();
    }
  });

  it('fits a narrow screen: the line is clipped, the hotkeys stay', async () => {
    const { app } = menu(entries, vi.fn(), 70);
    await pause();
    const frame = app.lastFrame() ?? '';
    expect(frame).toContain('▶ Antigravity');
    for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(70);
  });
});

describe('in the whole TUI', () => {
  it('puts the CLI launched last on top of the node’s menu', async () => {
    const tree = emptyTree();
    addNode(tree, { title: 'Узел' });
    const dir = tree.project.dir;
    rememberLaunch(dir, { brain: 'claude', start: 'do', model: 'opus', effort: 'high' }, 'project', T1);
    rememberLaunch(dir, { brain: 'antigravity', start: 'plan' }, 'project', T2);
    const frame = await snapshot(dir, { columns: 130, rows: 36, keys: ['2', '\r'] });
    const lines = frame.split('\n');
    const at = (text: string) => lines.findIndex((line) => line.includes(text));
    expect(at('▶ Antigravity · план')).toBeGreaterThan(-1);
    expect(at('▶ Claude Code · делать · opus · high')).toBeGreaterThan(at('▶ Antigravity'));
  });

  it('a project that never launched anything lists Claude Code first, with the project’s defaults', async () => {
    const tree = emptyTree();
    addNode(tree, { title: 'Узел' });
    const frame = await snapshot(tree.project.dir, { columns: 100, rows: 30, keys: ['2', '\r'] });
    const lines = frame.split('\n');
    const at = (text: string) => lines.findIndex((line) => line.includes(text));
    expect(at('▶ Claude Code · план')).toBeGreaterThan(-1);
    expect(at('▶ Codex · план')).toBeGreaterThan(at('▶ Claude Code'));
  });
});

describe('the setting', () => {
  it('is per project unless changed, and survives in settings.json', () => {
    const home = tempDir();
    expect(DEFAULTS.launchMemory).toBe('project');
    saveSettings({ ...DEFAULTS, launchMemory: 'global' }, { TREEYARD_HOME: home });
    expect(readFileSync(join(home, 'settings.json'), 'utf8')).toContain('"launch_memory": "global"');
    expect(loadSettings({ TREEYARD_HOME: home }).launchMemory).toBe('global');
    expect(loadSettings({ TREEYARD_HOME: tempDir() }).launchMemory).toBe('project');
    updateSettings({ launchMemory: 'global' });
    expect(readFileSync(join(process.env.TREEYARD_HOME!, 'settings.json'), 'utf8')).toContain('global');
  });

  it('is a row of the settings screen', async () => {
    const app = render(
      <SettingsDialog
        rows={[
          {
            key: 'launchMemory',
            label: 'Память запусков',
            options: [
              { value: 'project', label: 'у проекта' },
              { value: 'global', label: 'общая для всех проектов' },
            ],
            value: 'project',
          },
        ]}
        width={100}
        height={20}
        onClose={() => {}}
        onChange={() => {}}
      />,
    );
    await pause();
    expect(app.lastFrame()).toMatch(/Память запусков\s+у проекта\s+общая для всех проектов/);
  });
});
