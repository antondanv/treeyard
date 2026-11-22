import type { PaneInfo, SessionInfo } from '@antondanv/brainyard';
import { describe, expect, it } from 'vitest';

import { NotSent, type SendSources, sendToNode } from '../src/agents/send.js';
import { parseDuration, screenTail, type WaitSources, waitFor } from '../src/agents/wait.js';
import { journalEntries } from '../src/model/journal.js';
import { addNode, attachCommit, attachSession, logToNode, setStatus } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import type { SessionRef, Tree } from '../src/model/types.js';
import { emptyTree } from './helpers.js';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** A node «в работе» with one session. */
function nodeWithSession(tree: Tree, title: string, ref: Partial<SessionRef> & { id: string }) {
  const node = addNode(tree, { title, status: 'active' });
  attachSession(tree, node.id, {
    brain: 'claude',
    mode: 'background',
    started: ago(60_000),
    opened: ago(60_000),
    ...ref,
  });
  return node;
}

const live = (id: string, status: string, extra: Record<string, unknown> = {}): SessionInfo =>
  ({ brain: 'claude', id, interactive: true, live: { status, kind: 'background', ...extra } }) as SessionInfo;

const pane = (name: string, extra: Partial<PaneInfo> = {}): PaneInfo => ({
  pane: name,
  brain: 'claude',
  attached: false,
  width: 100,
  height: 30,
  ...extra,
});

/** What the sessions are doing, changed by a test between looks. */
interface World {
  live: SessionInfo[];
  panes: PaneInfo[];
  screens?: Record<string, string[]>;
  paneSessions?: Record<string, string>;
}

function waitSources(world: World, onLook?: (count: number) => void): WaitSources & { wake?: () => void } {
  let looks = 0;
  const sources: WaitSources & { wake?: () => void } = {
    load: (dir) => {
      onLook?.(looks++);
      return loadTree(dir);
    },
    live: async () => world.live,
    panes: async () => world.panes,
    paneSession: async (p) => world.paneSessions?.[p.pane],
    capture: async (name) =>
      world.screens?.[name]
        ? {
            lines: world.screens[name]!,
            width: 100,
            height: 30,
            cursor: { x: 0, y: 0, visible: true },
            historySize: 0,
            scrollOffset: 0,
            mouseTracking: false,
            mouseSgr: false,
            alternate: false,
          }
        : undefined,
    idle: async (_panes, asked) => asked,
    watch: (_dir, wake) => {
      sources.wake = wake;
      return { stop: () => undefined };
    },
    now: () => Date.now(),
  };
  return sources;
}

const fast = { intervalMs: 5, graceMs: 30_000 };

describe('treeyard wait', () => {
  it('answers at once for a node that is not «в работе»', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Готовое', status: 'review' });
    const result = await waitFor(tree.project.dir, [node.id], {
      ...fast,
      sources: waitSources({ live: [], panes: [] }),
    });
    expect(result.timedOut).toBe(false);
    expect(result.settled).toMatchObject([{ id: node.id, status: 'review', from: 'review', reason: 'status' }]);
  });

  it('reports a background session that ended its turn, with the last entry written by hand', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Фон', { id: 'bg-1' });
    // The session's own summary is the last entry; treeyard's lines after it do not count.
    logToNode(tree, node.id, 'итог: тесты 12/12', 'claude');
    attachCommit(tree, node.id, 'a'.repeat(40), 'claude');
    const result = await waitFor(tree.project.dir, [node.id], {
      ...fast,
      sources: waitSources({ live: [live('bg-1', 'idle', { state: 'done' })], panes: [] }),
    });
    expect(result.settled).toMatchObject([
      {
        id: node.id,
        reason: 'idle',
        entry: { source: 'claude', text: 'итог: тесты 12/12' },
        session: { brain: 'claude', id: 'bg-1', state: 'idle', mode: 'background' },
      },
    ]);
  });

  it('gives a fresh session time to start, then times out with it still pending', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Свежая', { id: 'bg-2', started: ago(1000), opened: ago(1000) });
    const result = await waitFor(tree.project.dir, [node.id], {
      ...fast,
      timeoutMs: 60,
      sources: waitSources({ live: [live('bg-2', 'idle')], panes: [] }),
    });
    expect(result.timedOut).toBe(true);
    expect(result.settled).toEqual([]);
    expect(result.pending).toMatchObject([{ id: node.id, session: { state: 'idle' } }]);
  });

  it('needs no grace once it has seen the session at work', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Быстрая', { id: 'bg-3', started: ago(1000), opened: ago(1000) });
    const world: World = { live: [live('bg-3', 'busy')], panes: [] };
    const result = await waitFor(tree.project.dir, [node.id], {
      ...fast,
      timeoutMs: 5000,
      sources: waitSources(world, (count) => {
        if (count === 2) world.live = [live('bg-3', 'idle')];
      }),
    });
    expect(result.timedOut).toBe(false);
    expect(result.settled).toMatchObject([{ id: node.id, reason: 'idle' }]);
  });

  it('reports a session waiting for the person at once, with the end of its pane', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Вопрос', {
      id: 'p-1',
      mode: 'pane',
      pane: 'claude-aa',
      started: ago(1000),
      opened: ago(1000),
    });
    const result = await waitFor(tree.project.dir, [node.id], {
      ...fast,
      sources: waitSources({
        live: [live('p-1', 'waiting', { waitingFor: 'permission: Bash' })],
        panes: [pane('claude-aa', { sessionId: 'p-1' })],
        screens: { 'claude-aa': ['\u001b[1mДать доступ?\u001b[0m', '  1. Да', '  2. Нет', '', ''] },
      }),
    });
    expect(result.settled).toMatchObject([
      {
        reason: 'waiting',
        session: {
          state: 'waiting',
          waitingFor: 'permission: Bash',
          pane: 'claude-aa',
          screen: ['Дать доступ?', '  1. Да', '  2. Нет'],
        },
      },
    ]);
  });

  it('finds the session of a pane that named it late, and calls a gone pane «закончилась»', async () => {
    const tree = emptyTree();
    const named = nodeWithSession(tree, 'Codex', {
      id: 'pane:codex-bb',
      brain: 'codex',
      mode: 'pane',
      pane: 'codex-bb',
    });
    const asleep = nodeWithSession(tree, 'Спит', { id: 'p-2', mode: 'pane', pane: 'claude-gone' });
    const result = await waitFor(tree.project.dir, [named.id, asleep.id], {
      ...fast,
      all: true,
      sources: waitSources({
        live: [{ ...live('th-1', 'idle'), brain: 'codex' }],
        panes: [pane('codex-bb', { brain: 'codex', cwd: tree.project.dir })],
        paneSessions: { 'codex-bb': 'th-1' },
      }),
    });
    expect(result.settled).toMatchObject([
      { id: named.id, reason: 'idle', session: { id: 'th-1', pane: 'codex-bb' } },
      { id: asleep.id, reason: 'gone', session: { state: 'gone' } },
    ]);
  });

  it('takes the idle state of a Codex pane from its rollout, since Codex lists only busy sessions', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Codex', { id: 'th-2', brain: 'codex', mode: 'pane', pane: 'codex-cc' });
    const sources = waitSources({ live: [], panes: [pane('codex-cc', { brain: 'codex', sessionId: 'th-2' })] });
    const silent = await waitFor(tree.project.dir, [node.id], { ...fast, timeoutMs: 40, sources });
    expect(silent.pending).toMatchObject([{ session: { state: 'unknown' } }]);
    sources.idle = async (panes, asked) =>
      new Map([...asked, ...panes.map((p) => [p.sessionId!, live(p.sessionId!, 'idle')] as const)]);
    const idle = await waitFor(tree.project.dir, [node.id], { ...fast, sources });
    expect(idle.settled).toMatchObject([{ reason: 'idle', session: { id: 'th-2', state: 'idle', pane: 'codex-cc' } }]);
  });

  it('wakes when the tree changes and, with --all, waits for every node', async () => {
    const tree = emptyTree();
    const a = nodeWithSession(tree, 'Первый', { id: 'bg-a' });
    const b = nodeWithSession(tree, 'Второй', { id: 'bg-b' });
    const world: World = { live: [live('bg-a', 'busy'), live('bg-b', 'busy')], panes: [] };
    const sources = waitSources(world);
    const waiting = waitFor(tree.project.dir, [a.id, b.id], { intervalMs: 60_000, all: true, sources });
    await new Promise((done) => setTimeout(done, 30));
    setStatus(loadTree(tree.project.dir), a.id, 'review');
    sources.wake?.();
    await new Promise((done) => setTimeout(done, 30));
    setStatus(loadTree(tree.project.dir), b.id, 'waiting', { waiting: 'нужен ключ' });
    sources.wake?.();
    const result = await waiting;
    expect(result.settled.map((s) => [s.id, s.from, s.status])).toEqual([
      [a.id, 'active', 'review'],
      [b.id, 'active', 'waiting'],
    ]);
  });

  it('keeps the rows of a screen that have something on them, without colours', () => {
    expect(screenTail(['', '\u001b[2m❯ подсказка\u001b[0m', 'ответ', '', '   '], 5)).toEqual(['❯ подсказка', 'ответ']);
  });

  it('reads a timeout in seconds, minutes and hours', () => {
    expect(parseDuration('90')).toBe(90_000);
    expect(parseDuration('90s')).toBe(90_000);
    expect(parseDuration('10m')).toBe(600_000);
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(parseDuration('10 мин')).toBeUndefined();
    expect(parseDuration('скоро')).toBeUndefined();
  });
});

/** Brainyard as send sees it, recording every call. */
function sendSources(world: World) {
  const calls: { typed: [string, string][]; stopped: string[]; opened: unknown[]; panes: unknown[] } = {
    typed: [],
    stopped: [],
    opened: [],
    panes: [],
  };
  const sources: SendSources = {
    live: async () => world.live,
    panes: async () => world.panes,
    type: async (name, data) => {
      calls.typed.push([name, data]);
    },
    startPane: (async (options: unknown) => {
      calls.panes.push(options);
      return { pane: 'claude-new', brain: 'claude', startedAt: new Date().toISOString(), warnings: [], display: '' };
    }) as unknown as SendSources['startPane'],
    open: (async (options: unknown) => {
      calls.opened.push(options);
      return { brain: 'claude', ok: true, exitCode: 0, background: true, startedAt: '', endedAt: '', warnings: [] };
    }) as unknown as SendSources['open'],
    stop: async (options) => {
      calls.stopped.push(options.sessionId);
      return 'stopped';
    },
    pause: async () => undefined,
  };
  return { sources, calls };
}

describe('treeyard send', () => {
  it('types into a live pane as a paste, then Enter, and logs the message', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Панель', { id: 'p-1', mode: 'pane', pane: 'claude-aa' });
    const { sources, calls } = sendSources({
      live: [live('p-1', 'busy')],
      panes: [pane('claude-aa', { sessionId: 'p-1' })],
    });
    const sent = await sendToNode(tree, node.id, 'поправь тест\nи закоммить', { sources, source: 'claude' });
    expect(sent).toMatchObject({ how: 'typed', pane: 'claude-aa' });
    expect(calls.typed).toEqual([
      ['claude-aa', '\u001b[200~поправь тест\nи закоммить\u001b[201~'],
      ['claude-aa', '\r'],
    ]);
    const saved = loadTree(tree.project.dir).nodes.get(node.id)!;
    expect(journalEntries(saved.body).at(-1)).toMatch(
      / · claude · письмо сессии claude p-1: «поправь тест и закоммить»$/,
    );
    // `wait` gives the session time to take it from here.
    expect(Date.now() - Date.parse(saved.sessions[0]!.opened!)).toBeLessThan(5000);
  });

  it('writes nothing to a session that waits for the person', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Диалог', { id: 'p-1', mode: 'pane', pane: 'claude-aa' });
    const { sources, calls } = sendSources({
      live: [live('p-1', 'waiting', { waitingFor: 'permission: Bash' })],
      panes: [pane('claude-aa', { sessionId: 'p-1' })],
    });
    await expect(sendToNode(tree, node.id, 'да', { sources })).rejects.toThrow(NotSent);
    await expect(sendToNode(tree, node.id, 'да', { sources })).rejects.toThrow(
      /permission: Bash.*tmux -L brainyard attach -t claude-aa/,
    );
    expect(calls.typed).toEqual([]);
  });

  it('stops a background session that ended its turn and resumes it in the background with the message', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Фон', { id: 'bg-1' });
    const { sources, calls } = sendSources({ live: [live('bg-1', 'idle', { state: 'working' })], panes: [] });
    const sent = await sendToNode(tree, node.id, 'добавь тест', { sources });
    expect(sent.how).toBe('resumed');
    expect(calls.stopped).toEqual(['bg-1']);
    expect(calls.opened).toMatchObject([
      {
        brain: 'claude',
        cwd: tree.project.dir,
        resume: 'bg-1',
        prompt: 'добавь тест',
        background: true,
        env: { TREEYARD_NODE: node.id },
      },
    ]);
  });

  it('resumes a finished background session without stopping it, and leaves a busy one alone', async () => {
    const tree = emptyTree();
    const done = nodeWithSession(tree, 'Кончилась', { id: 'bg-1' });
    const busy = nodeWithSession(tree, 'Работает', { id: 'bg-2' });
    const { sources, calls } = sendSources({ live: [live('bg-2', 'busy')], panes: [] });
    await sendToNode(tree, done.id, 'ещё', { sources });
    expect(calls.stopped).toEqual([]);
    expect(calls.opened).toHaveLength(1);
    await expect(sendToNode(tree, busy.id, 'ещё', { sources })).rejects.toThrow(/ещё работает.*treeyard wait/);
    expect(calls.opened).toHaveLength(1);
  });

  it('wakes a sleeping pane with the message and remembers the new pane', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Спит', { id: 'p-9', mode: 'pane', pane: 'claude-old' });
    const { sources, calls } = sendSources({ live: [], panes: [] });
    const sent = await sendToNode(tree, node.id, 'продолжай', { sources, size: { width: 120, height: 30 } });
    expect(sent).toMatchObject({ how: 'woke', pane: 'claude-new' });
    expect(calls.panes).toMatchObject([
      {
        brain: 'claude',
        resume: 'p-9',
        prompt: 'продолжай',
        label: 'Спит',
        width: 120,
        env: { TREEYARD_NODE: node.id },
      },
    ]);
    expect(loadTree(tree.project.dir).nodes.get(node.id)!.sessions).toMatchObject([
      { id: 'p-9', mode: 'pane', pane: 'claude-new' },
    ]);
  });

  it('refuses a node without a session and a session open in a terminal', async () => {
    const tree = emptyTree();
    const bare = addNode(tree, { title: 'Пусто', status: 'active' });
    const terminal = nodeWithSession(tree, 'Терминал', { id: 't-1', mode: 'terminal' });
    const { sources } = sendSources({ live: [live('t-1', 'idle')], panes: [] });
    await expect(sendToNode(tree, bare.id, 'привет', { sources })).rejects.toThrow(/нет сессии.*treeyard open/);
    await expect(sendToNode(tree, terminal.id, 'привет', { sources })).rejects.toThrow(/открыта в терминале/);
  });
});
