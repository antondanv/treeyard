import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionInfo } from '@antondanv/brainyard';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  startPane: vi.fn(),
  listPanes: vi.fn(),
  sessions: vi.fn(),
  setPaneSession: vi.fn(),
  closePane: vi.fn(),
}));
vi.mock('@antondanv/brainyard', async (original) => ({
  ...(await original<typeof import('@antondanv/brainyard')>()),
  ...backend,
}));

import { codexIdleTail, withPaneIdle } from '../src/agents/pane-idle.js';
import {
  isPending,
  launchInPane,
  nodePane,
  type Pane,
  paneFor,
  panesToSleep,
  settlePending,
  sleepingRef,
  wakeInPane,
} from '../src/agents/panes.js';
import { addNode, attachSession } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { DEFAULTS, loadSettings, saveSettings } from '../src/settings.js';
import { emptyTree, tempDir } from './helpers.js';

const now = Date.parse('2026-10-02T12:00:00Z');
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const pane = (name: string, minutes: number, patch: Partial<Pane> = {}): Pane => ({
  pane: name,
  brain: 'claude',
  sessionId: name,
  cwd: '/project',
  startedAt: ago(60),
  activityAt: ago(minutes),
  attached: false,
  width: 80,
  height: 20,
  ...patch,
});
const idle = (...ids: string[]) =>
  new Map(
    ids.map((id) => [
      id,
      { brain: 'claude', id, interactive: true, live: { status: 'idle', kind: 'interactive' } } as SessionInfo,
    ]),
  );

beforeEach(() => {
  vi.clearAllMocks();
  backend.listPanes.mockResolvedValue([]);
  backend.sessions.mockResolvedValue([]);
  backend.setPaneSession.mockResolvedValue(true);
});

describe('pane lifecycle', () => {
  it('persists a new pane, its mode and id; waking updates the same reference', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Terminal work' });
    backend.startPane.mockResolvedValue({
      pane: 'claude-one',
      sessionId: 'conversation',
      startedAt: ago(0),
      warnings: [],
    });
    await launchInPane(tree, node.id, { brain: 'claude', start: 'chat', pane: true }, { width: 60, height: 12 });
    const saved = loadTree(tree.project.dir).nodes.get(node.id)!;
    expect(saved.status).toBe('active');
    expect(saved.sessions).toMatchObject([{ id: 'conversation', mode: 'pane', pane: 'claude-one' }]);
    backend.startPane.mockResolvedValue({
      pane: 'claude-two',
      sessionId: 'conversation',
      startedAt: ago(0),
      warnings: [],
    });
    // Something was said: the CLI has the conversation in its history.
    backend.sessions.mockResolvedValue([{ brain: 'claude', id: 'conversation' }]);
    await wakeInPane(tree, node.id, saved.sessions[0]!, { width: 60, height: 12 });
    expect(backend.startPane.mock.lastCall?.[0]).toMatchObject({ resume: 'conversation' });
    expect(loadTree(tree.project.dir).nodes.get(node.id)!.sessions).toMatchObject([
      { id: 'conversation', pane: 'claude-two' },
    ]);
  });

  it('does not create a duplicate CLI when the conversation already runs', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Work' });
    const ref = { brain: 'claude' as const, id: 'conversation', mode: 'pane' as const, pane: 'claude-one' };
    backend.listPanes.mockResolvedValue([pane('claude-one', 0, { sessionId: ref.id })]);
    expect(await wakeInPane(tree, node.id, ref, { width: 60, height: 12 })).toBe('claude-one');
    expect(backend.startPane).not.toHaveBeenCalled();
  });

  it('settles two Codex launches separately and recovers an id after the pane closed', async () => {
    const tree = emptyTree();
    const first = addNode(tree, { title: 'First' });
    const second = addNode(tree, { title: 'Second' });
    attachSession(tree, first.id, {
      brain: 'codex',
      id: 'pane:codex-a',
      pane: 'codex-a',
      mode: 'pane',
      started: ago(2),
    });
    attachSession(tree, second.id, {
      brain: 'codex',
      id: 'pane:codex-b',
      pane: 'codex-b',
      mode: 'pane',
      started: ago(1),
    });
    backend.sessions.mockResolvedValue([
      { brain: 'codex', id: 'b', startedAt: ago(1), interactive: true },
      { brain: 'codex', id: 'a', startedAt: ago(2), interactive: true },
      { brain: 'codex', id: 'old', startedAt: ago(10), interactive: true },
    ]);
    const running = pane('codex-b', 0, { brain: 'codex', sessionId: undefined });
    expect(await settlePending(tree, [running])).toBe(true);
    const saved = loadTree(tree.project.dir);
    expect(saved.nodes.get(first.id)!.sessions[0]!.id).toBe('a');
    expect(saved.nodes.get(second.id)!.sessions[0]!.id).toBe('b');
    expect(backend.setPaneSession).toHaveBeenCalledWith('codex-b', 'b');
    expect(await settlePending(tree, [running])).toBe(false);
  });

  it('keeps Antigravity metadata, recognises sleeping sessions and rejects an unsaved resume', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Agy work' });
    attachSession(tree, node.id, {
      brain: 'antigravity',
      id: 'pane:agy-one',
      pane: 'agy-one',
      mode: 'pane',
      started: ago(1),
    });
    const running = pane('agy-one', 0, { brain: 'antigravity', sessionId: 'agy-history' });
    expect(await settlePending(tree, [running])).toBe(true);
    const ref = tree.nodes.get(node.id)!.sessions[0]!;
    expect(nodePane(tree.nodes.get(node.id), [running])?.pane).toBe(running);
    expect(sleepingRef(tree.nodes.get(node.id), [])).toBe(ref);
    expect(paneFor({ brain: 'codex', id: ref.id }, [running])).toBeUndefined();
    const pending = { brain: 'codex' as const, id: 'pane:missing', mode: 'pane' as const };
    expect(isPending(pending)).toBe(true);
    await expect(wakeInPane(tree, node.id, pending, { width: 60, height: 12 })).rejects.toThrow(/не сохранил/);
  });
});

describe('automatic sleep', () => {
  it('protects busy, waiting, watched, attached, unknown and unsaved panes', () => {
    const list = [
      pane('idle', 40),
      pane('busy', 40),
      pane('waiting', 40),
      pane('watched', 40),
      pane('attached', 40, { attached: true }),
      pane('unknown', 40),
      pane('pending', 40, { sessionId: undefined }),
      pane('other', 40, { cwd: '/elsewhere' }),
      pane('new', 0.5),
    ];
    const live = idle(...list.map((p) => p.pane));
    live.get('busy')!.live!.status = 'busy';
    live.get('waiting')!.live!.status = 'waiting';
    live.delete('unknown');
    const out = panesToSleep(list, {
      dir: '/project',
      now,
      rules: { sleepAfter: 30, maxPanes: 3 },
      live,
      watched: 'watched',
    });
    expect(out.map((p) => p.pane.pane)).toEqual(['idle']);
  });

  it('sleeps the longest idle first and counts timeout sleep towards the limit', () => {
    const list = [pane('third', 5), pane('first', 40), pane('second', 20), pane('fourth', 2)];
    const live = idle(...list.map((p) => p.pane));
    expect(
      panesToSleep(list, { dir: '/project', now, rules: { sleepAfter: 30, maxPanes: 2 }, live }).map((p) => [
        p.pane.pane,
        p.reason,
      ]),
    ).toEqual([
      ['first', 'quiet'],
      ['second', 'limit'],
    ]);
    expect(panesToSleep(list, { dir: '/project', now, rules: { sleepAfter: 0, maxPanes: 0 }, live })).toEqual([]);
  });

  it('requires a completed Codex turn, even when a long active turn lost its opening event', () => {
    const event = (type: string) => JSON.stringify({ type: 'event_msg', payload: { type } });
    expect(codexIdleTail(event('task_complete'))).toBe(true);
    expect(codexIdleTail([event('task_complete'), event('task_started'), event('agent_message')].join('\n'))).toBe(
      false,
    );
    expect(codexIdleTail(event('agent_message'))).toBe(false);
    expect(codexIdleTail([event('task_complete'), event('request_user_input')].join('\n'))).toBe(false);
    expect(codexIdleTail('partial JSON\n' + event('turn_aborted'))).toBe(true);
    expect(
      codexIdleTail(JSON.stringify({ type: 'event_msg', timestamp: ago(2), payload: { type: 'task_complete' } }), now),
    ).toBe(false);
  });

  it('reads positive idle evidence for Codex and Antigravity from isolated stores', async () => {
    const home = tempDir();
    mkdirSync(join(home, 'sessions'));
    writeFileSync(
      join(home, 'sessions', 'rollout-idle-codex.jsonl'),
      JSON.stringify({ timestamp: ago(1), type: 'event_msg', payload: { type: 'task_complete' } }),
    );
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(home, 'conversation_summaries.db'));
    db.exec(
      'CREATE TABLE conversation_summaries (conversation_id TEXT, status TEXT, not_fully_idle INTEGER, killed INTEGER, last_modified_time TEXT)',
    );
    const insert = db.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, 0, ?)');
    insert.run('agy-idle', 'CASCADE_RUN_STATUS_IDLE', 0, ago(1));
    insert.run('agy-working', 'CASCADE_RUN_STATUS_IDLE', 1, ago(1));
    insert.run('agy-waiting', 'CASCADE_RUN_STATUS_WAITING', 0, ago(1));
    insert.run('agy-old', 'CASCADE_RUN_STATUS_IDLE', 0, ago(120));
    db.close();
    const list = [
      pane('idle-codex', 10, { brain: 'codex' }),
      ...['agy-idle', 'agy-working', 'agy-waiting', 'agy-old'].map((id) => pane(id, 10, { brain: 'antigravity' })),
    ];
    const states = await withPaneIdle(list, new Map(), { codex: home, antigravity: home });
    expect([...states.keys()]).toEqual(['idle-codex', 'agy-idle']);
    expect(states.get('agy-idle')?.live?.status).toBe('idle');
  });

  it('persists pane settings and ignores unsupported values', () => {
    const env = { TREEYARD_HOME: tempDir() };
    saveSettings({ ...DEFAULTS, open: 'terminal', sleepAfter: 60, maxPanes: 3 }, env);
    expect(loadSettings(env)).toMatchObject({ open: 'terminal', sleepAfter: 60, maxPanes: 3 });
    saveSettings({ ...DEFAULTS, sleepAfter: -1, maxPanes: -1 }, env);
    expect(loadSettings(env)).toMatchObject({ sleepAfter: DEFAULTS.sleepAfter, maxPanes: DEFAULTS.maxPanes });
  });
});
