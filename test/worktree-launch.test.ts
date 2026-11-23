import { execFileSync } from 'node:child_process';
import { realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { SessionInfo } from '@antondanv/brainyard';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  open: vi.fn(),
  startPane: vi.fn(),
  listPanes: vi.fn(),
  closePane: vi.fn(),
  sessions: vi.fn(),
  setPaneSession: vi.fn(),
  stopSession: vi.fn(),
}));
vi.mock('@antondanv/brainyard', async (original) => ({
  ...(await original<typeof import('@antondanv/brainyard')>()),
  ...backend,
  panesAvailable: () => true,
}));

import { launch, projectSessions, resume, sleepBackground } from '../src/agents/launch.js';
import { launchInPane, paneInProject, settlePending, wakeInPane } from '../src/agents/panes.js';
import { type QueueEvent, type QueueSources, runQueue } from '../src/agents/queue.js';
import { openInPanes } from '../src/cli/commands.js';
import { addNode, attachSession, setStatus } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { ensureWorktree, worktreeParent } from '../src/worktree.js';
import { emptyTree } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim();

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(worktreeParent(dir), { recursive: true, force: true });
});
beforeEach(() => {
  vi.clearAllMocks();
  resetSettings({ ...DEFAULTS, animation: false, marquee: false, antigravityAccess: 'full' });
  backend.listPanes.mockResolvedValue([]);
  backend.sessions.mockResolvedValue([]);
  backend.closePane.mockResolvedValue(true);
  backend.setPaneSession.mockResolvedValue(true);
  backend.open.mockResolvedValue({
    ok: true,
    sessionId: 'sess-1',
    startedAt: new Date().toISOString(),
    warnings: [],
  });
  backend.startPane.mockResolvedValue({
    pane: 'pane-1',
    sessionId: undefined,
    startedAt: new Date().toISOString(),
    warnings: [],
  });
});

/** Where treeyard puts a node's worktree, as git names it (the real path: /private/var on macOS). */
function expectedDir(main: string, id: string): string {
  return join(realpathSync(dirname(main)), `${basename(main)}.worktrees`, id);
}

function project() {
  const tree = emptyTree();
  const main = tree.project.dir;
  made.push(main);
  const a = addNode(tree, { title: 'Бот', doneWhen: 'бот отвечает' });
  const b = addNode(tree, { title: 'Сайт', doneWhen: 'сайт открывается' });
  writeFileSync(join(main, '.gitignore'), '.tree/.local/\n');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'start');
  return { tree: loadTree(main), main, a: a.id, b: b.id };
}

describe.each(['claude', 'codex', 'antigravity', 'opencode'] as const)('a session of %s in a worktree', (brain) => {
  it('starts in the node’s worktree with the main tree in its environment, and the node remembers where', async () => {
    const { tree, main, a } = project();
    const { ref } = await launch(tree, a, { brain, start: 'do', worktree: true });
    const call = backend.open.mock.lastCall?.[0];
    const wt = expectedDir(main, a);
    expect(call).toMatchObject({ brain, cwd: wt, env: { TREEYARD_NODE: a, TREEYARD_PROJECT: main } });
    // The CLI is not asked for a worktree of its own: treeyard made this one.
    expect(call).not.toHaveProperty('worktree');
    expect(call.system).toContain(`treeyard/${a}`);
    expect(call.system).toContain('основное дерево');
    expect(ref).toMatchObject({ brain, id: 'sess-1', dir: wt });
    const saved = loadTree(main).nodes.get(a)!;
    expect(saved.sessions).toMatchObject([{ id: 'sess-1', dir: wt }]);
    expect(saved.body).toContain(`в worktree treeyard/${a}`);
    expect(saved.status).toBe('active');

    // Coming back to the node: the same worktree without asking, and the resume in its folder.
    await resume(loadTree(main), a, ref!);
    expect(backend.open.mock.lastCall?.[0]).toMatchObject({ resume: 'sess-1', cwd: wt });
    await launch(loadTree(main), a, { brain, start: 'do' });
    expect(backend.open.mock.lastCall?.[0]).toMatchObject({ cwd: wt });
    // Unless the person sends it to the project's folder.
    await launch(loadTree(main), a, { brain, start: 'do', worktree: false });
    expect(backend.open.mock.lastCall?.[0]).toMatchObject({ cwd: main });
    expect(backend.open.mock.lastCall?.[0].system).not.toContain('Ты работаешь в отдельном git worktree');
  });

  it('starts in a pane there, wakes there and settles its id from the CLI’s history of that folder', async () => {
    const { tree, main, a } = project();
    const wt = expectedDir(main, a);
    const { ref } = await launchInPane(
      tree,
      a,
      { brain, start: 'do', pane: true, worktree: true },
      { width: 100, height: 30 },
    );
    expect(backend.startPane.mock.lastCall?.[0]).toMatchObject({ brain, cwd: wt, env: { TREEYARD_PROJECT: main } });
    expect(backend.startPane.mock.lastCall?.[0]).not.toHaveProperty('worktree');
    expect(ref).toMatchObject({ mode: 'pane', pane: 'pane-1', dir: wt });

    // A CLI that names its session later: the conversation is looked for in the worktree's folder.
    const pending = loadTree(main);
    const history: SessionInfo = {
      brain,
      id: 'named-later',
      interactive: true,
      cwd: wt,
      startedAt: new Date(Date.now() + 500).toISOString(),
    };
    backend.sessions.mockResolvedValue([history]);
    if (!ref!.id.startsWith('pane:')) return;
    expect(await settlePending(pending, [])).toBe(true);
    expect(backend.sessions.mock.lastCall?.[0]).toMatchObject({ cwd: wt });
    expect(loadTree(main).nodes.get(a)!.sessions[0]).toMatchObject({ id: 'named-later', dir: wt });

    // Waking a sleeping session goes to the same folder.
    backend.startPane.mockResolvedValue({
      pane: 'pane-2',
      sessionId: 'named-later',
      startedAt: new Date().toISOString(),
      warnings: [],
    });
    await wakeInPane(loadTree(main), a, loadTree(main).nodes.get(a)!.sessions[0]!, { width: 100, height: 30 });
    expect(backend.startPane.mock.lastCall?.[0]).toMatchObject({ resume: 'named-later', cwd: wt });
  });
});

describe('sessions of a project with worktrees', () => {
  it('lists the sessions of the project folder and of every worktree, and puts to sleep in the right folder', async () => {
    const { tree, main, a } = project();
    const { worktree } = await ensureWorktree(tree, a);
    const own: SessionInfo = { brain: 'codex', id: 'in-main', interactive: true, startedAt: '2026-11-23T10:00:00Z' };
    const there: SessionInfo = {
      brain: 'codex',
      id: 'in-worktree',
      interactive: true,
      cwd: worktree.dir,
      startedAt: '2026-11-23T11:00:00Z',
    };
    backend.sessions.mockImplementation(async ({ cwd }: { cwd: string }) => (cwd === worktree.dir ? [there] : [own]));
    expect((await projectSessions(tree)).map((s) => s.id)).toEqual(['in-worktree', 'in-main']);

    await sleepBackground(tree, { brain: 'claude', id: 'x', dir: worktree.dir });
    expect(backend.stopSession.mock.lastCall?.[0]).toMatchObject({ cwd: worktree.dir });
    await sleepBackground(tree, { brain: 'claude', id: 'y' });
    expect(backend.stopSession.mock.lastCall?.[0]).toMatchObject({ cwd: main });
  });

  it('counts a pane in a worktree as the project’s', async () => {
    const { tree, main, a } = project();
    const { worktree } = await ensureWorktree(tree, a);
    const pane = (cwd: string) => ({ pane: 'p', brain: 'codex' as const, cwd });
    expect(paneInProject(pane(main) as never, main)).toBe(true);
    expect(paneInProject(pane(worktree.dir) as never, main)).toBe(true);
    expect(paneInProject(pane(join(main, '..')) as never, main)).toBe(false);
  });
});

describe('several nodes at once', () => {
  it('open a b c --pane: the first stays in the project’s folder, the rest get a worktree', async () => {
    const { tree, a, b } = project();
    const c = addNode(tree, { title: 'Почта' }).id;
    const asked: Record<string, unknown> = {};
    const launcher: typeof launchInPane = async (_tree, id, options) => {
      asked[id] = options.worktree;
      return { pane: `p-${id}`, ref: { brain: 'codex', id: `s-${id}` }, warnings: [] };
    };
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await openInPanes(
      loadTree(tree.project.dir),
      [a, b, c],
      { brain: 'codex', start: 'do', pane: true },
      false,
      launcher,
    );
    expect(asked).toEqual({ [a]: undefined, [b]: 'auto', [c]: 'auto' });
    for (const key of Object.keys(asked)) delete asked[key];
    await openInPanes(
      loadTree(tree.project.dir),
      [a, b],
      { brain: 'codex', start: 'do', pane: true, worktree: true },
      false,
      launcher,
    );
    expect(asked).toEqual({ [a]: true, [b]: true });
    for (const key of Object.keys(asked)) delete asked[key];
    await openInPanes(
      loadTree(tree.project.dir),
      [a, b],
      { brain: 'codex', start: 'do', pane: true, worktree: false },
      false,
      launcher,
    );
    expect(asked).toEqual({ [a]: false, [b]: false });
    quiet.mockRestore();
  });

  it('really makes the worktrees of the second and third node and keeps the first in the folder', async () => {
    const { tree, main, a, b } = project();
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await openInPanes(tree, [a, b], { brain: 'opencode', start: 'do', pane: true }, false);
    quiet.mockRestore();
    const [first, second] = backend.startPane.mock.calls.map((call) => call[0].cwd);
    expect(first).toBe(main);
    expect(second).toBe(expectedDir(main, b));
    const saved = loadTree(main);
    expect(saved.nodes.get(a)!.sessions[0]!.dir).toBeUndefined();
    expect(saved.nodes.get(b)!.sessions[0]!.dir).toBe(second);
  });

  it('in a folder that is not a repository the nodes stay together, as before, and nothing is said', async () => {
    const tree = emptyTree();
    const ids = ['Бот', 'Сайт'].map((title) => addNode(tree, { title }).id);
    const quiet = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const loud = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(await openInPanes(tree, ids, { brain: 'codex', start: 'do', pane: true }, false)).toBe(0);
    expect(backend.startPane.mock.calls.map((call) => call[0].cwd)).toEqual([tree.project.dir, tree.project.dir]);
    expect(loud).not.toHaveBeenCalled();
    quiet.mockRestore();
    loud.mockRestore();
  });
});

describe('the queue and worktrees', () => {
  function sources(starts: Record<string, unknown>): QueueSources {
    return {
      load: loadTree,
      live: async () => [],
      panes: async () => [],
      paneSession: async () => undefined,
      capture: async () => undefined,
      idle: async (_panes, asked) => asked,
      watch: () => ({ stop: () => undefined }),
      now: () => Date.now(),
      start: async (tree, id, options) => {
        starts[id] = options.worktree;
        attachSession(tree, id, {
          brain: 'codex',
          id: `s-${id}`,
          mode: 'background',
          started: new Date().toISOString(),
        });
        setStatus(tree, id, 'active');
        return { session: `s-${id}` };
      },
      limits: async () => null,
    };
  }

  async function run(parallel: number, worktree?: boolean, count = 3) {
    const tree = emptyTree();
    const ids = Array.from({ length: count }, (_, i) => addNode(tree, { title: `Узел ${i}`, status: 'todo' }).id);
    const starts: Record<string, unknown> = {};
    const events: QueueEvent[] = [];
    const controller = new AbortController();
    // Every node is started in the first round, then the queue is stopped.
    const done = runQueue(tree.project.dir, ids, {
      launch: { brain: 'codex', start: 'do', background: true, ...(worktree === undefined ? {} : { worktree }) },
      parallel,
      intervalMs: 5,
      graceMs: 60_000,
      sources: sources(starts),
      onEvent: (event) => {
        events.push(event);
        if (events.filter((e) => e.type === 'start').length === Math.min(parallel, count)) controller.abort();
      },
      signal: controller.signal,
    });
    await done;
    return { ids, starts };
  }

  it('with slots in parallel the first node stays in the folder and the others are sent to worktrees', async () => {
    const { ids, starts } = await run(3);
    expect(starts).toEqual({ [ids[0]!]: undefined, [ids[1]!]: 'auto', [ids[2]!]: 'auto' });
  });

  it('one slot at a time needs no worktrees', async () => {
    const { ids, starts } = await run(1);
    expect(starts).toEqual({ [ids[0]!]: undefined });
  });

  it('what the person said wins: every node in a worktree, or every node in the folder', async () => {
    const yes = await run(2, true);
    expect(Object.values(yes.starts)).toEqual([true, true]);
    const no = await run(2, false);
    expect(Object.values(no.starts)).toEqual([false, false]);
  });
});
