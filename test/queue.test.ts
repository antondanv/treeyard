import type { LimitWindow, SessionInfo } from '@antondanv/brainyard';
import { describe, expect, it } from 'vitest';

import { fullWindow, type QueueEvent, type QueueSources, queueNodes, runQueue } from '../src/agents/queue.js';
import { setNeeds } from '../src/model/links.js';
import { addNode, attachSession, setStatus } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import type { Tree } from '../src/model/types.js';
import { emptyTree } from './helpers.js';

const later = (ms: number, act: () => void) => setTimeout(act, ms);

/** Brainyard and the launcher as the queue sees them; `live` is what each session is doing. */
function fakes(dir: string, options: { live?: Map<string, SessionInfo>; limits?: () => LimitWindow[] | null } = {}) {
  const live = options.live ?? new Map<string, SessionInfo>();
  const starts: string[] = [];
  const sources: QueueSources = {
    load: loadTree,
    live: async () => [...live.values()],
    panes: async () => [],
    paneSession: async () => undefined,
    capture: async () => undefined,
    idle: async (_panes, asked) => asked,
    watch: () => ({ stop: () => undefined }),
    now: () => Date.now(),
    start: async (tree, id) => {
      if (tree.nodes.get(id)?.title === 'Сломанный') throw new Error('CLI не установлен');
      starts.push(id);
      attachSession(tree, id, {
        brain: 'claude',
        id: `s-${id}`,
        mode: 'background',
        started: new Date().toISOString(),
      });
      setStatus(tree, id, 'active');
      live.set(`s-${id}`, {
        brain: 'claude',
        id: `s-${id}`,
        interactive: true,
        live: { status: 'busy', kind: 'background' },
      });
      return { session: `s-${id}` };
    },
    limits: async () => options.limits?.() ?? null,
  };
  return { sources, starts, live, dir };
}

function run(
  tree: Tree,
  ids: string[],
  f: ReturnType<typeof fakes>,
  extra: Partial<Parameters<typeof runQueue>[2]> = {},
) {
  const events: QueueEvent[] = [];
  const done = runQueue(tree.project.dir, ids, {
    launch: { brain: 'claude', start: 'do', background: true },
    parallel: 2,
    intervalMs: 5,
    graceMs: 60_000,
    sources: f.sources,
    onEvent: (event) => {
      events.push(event);
      extra.onEvent?.(event);
    },
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'onEvent')),
  });
  return { events, done };
}

const finish = (dir: string, id: string, status: 'review' | 'waiting' = 'review') =>
  setStatus(loadTree(dir), id, status, status === 'waiting' ? { waiting: 'нужен ключ' } : {});

describe('treeyard queue', () => {
  it('starts the children in order, two at a time, a node with needs after them, and ends when all have gone', async () => {
    const tree = emptyTree();
    const parent = addNode(tree, { title: 'Направление' });
    const a = addNode(tree, { title: 'А', parent: parent.id });
    const b = addNode(tree, { title: 'Б', parent: parent.id });
    const c = addNode(tree, { title: 'В', parent: parent.id });
    setNeeds(loadTree(tree.project.dir), c.id, [a.id], 'агент');
    addNode(loadTree(tree.project.dir), { title: 'Человеку', parent: parent.id, who: 'human' });
    const dir = tree.project.dir;
    expect(queueNodes(loadTree(dir), [parent.id])).toEqual([a.id, b.id, c.id]);
    const f = fakes(dir);
    const { events, done } = run(loadTree(dir), [parent.id], f, {
      onEvent: (event) => {
        if (event.type !== 'start') return;
        // Б finishes first: В still waits for А, so the free slot stays empty until А is in review.
        if (event.node === b.id) later(20, () => finish(dir, b.id));
        if (event.node === b.id) later(80, () => finish(dir, a.id));
        if (event.node === c.id) later(20, () => finish(dir, c.id, 'waiting'));
      },
    });
    const end = await done;
    expect(f.starts).toEqual([a.id, b.id, c.id]);
    expect(events.map((e) => `${e.type}:${'node' in e ? e.node : ''}`)).toEqual([
      `start:${a.id}`,
      `start:${b.id}`,
      `done:${b.id}`,
      `done:${a.id}`,
      `start:${c.id}`,
      `done:${c.id}`,
      'end:',
    ]);
    expect(end).toEqual({ type: 'end', started: 3, finished: 3, blocked: 0, stopped: false });
  });

  it('waits for a full window to reset before starting anything new', async () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'А' });
    let windows: LimitWindow[] = [{ window: 'five_hour', utilization: 0.95, resetsAt: Date.now() / 1000 + 3600 }];
    const f = fakes(tree.project.dir, { limits: () => windows });
    const { events, done } = run(tree, [a.id], f, {
      onEvent: (event) => {
        if (event.type === 'limit') later(20, () => (windows = [{ window: 'five_hour', utilization: 0.1 }]));
        if (event.type === 'start') later(10, () => finish(tree.project.dir, a.id));
      },
    });
    // The queue rereads the limits once a minute: the test moves its clock instead.
    const clock = Date.now();
    let shift = 0;
    f.sources.now = () => clock + shift;
    later(40, () => (shift = 61_000));
    await done;
    expect(events.map((e) => e.type)).toEqual(['limit', 'resume', 'start', 'done', 'end']);
    expect(events[0]).toMatchObject({ brain: 'claude', window: 'five_hour', utilization: 0.95 });
  });

  it('picks up a node already at work and counts it against the slots', async () => {
    const tree = emptyTree();
    const busy = addNode(tree, { title: 'Уже в работе', status: 'active' });
    attachSession(loadTree(tree.project.dir), busy.id, {
      brain: 'claude',
      id: 'old',
      mode: 'pane',
      pane: 'p',
      started: new Date().toISOString(),
    });
    const next = addNode(loadTree(tree.project.dir), { title: 'Следующий' });
    const f = fakes(tree.project.dir);
    f.live.set('old', { brain: 'claude', id: 'old', interactive: true, live: { status: 'busy', kind: 'interactive' } });
    const { events, done } = run(loadTree(tree.project.dir), [busy.id, next.id], f, {
      parallel: 1,
      onEvent: (event) => {
        if (event.type === 'start') later(10, () => finish(tree.project.dir, next.id));
      },
    });
    later(30, () => finish(tree.project.dir, busy.id));
    await done;
    expect(events.map((e) => `${e.type}:${'node' in e ? e.node : ''}`)).toEqual([
      `done:${busy.id}`,
      `start:${next.id}`,
      `done:${next.id}`,
      'end:',
    ]);
  });

  it('frees the slot of a session that ended, says when one asks, and ends with what cannot start', async () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'А' });
    const broken = addNode(loadTree(tree.project.dir), { title: 'Сломанный' });
    const outside = addNode(loadTree(tree.project.dir), { title: 'Чужой' });
    const stuck = addNode(loadTree(tree.project.dir), { title: 'Ждущий' });
    setNeeds(loadTree(tree.project.dir), stuck.id, [outside.id], 'агент');
    const f = fakes(tree.project.dir);
    const { events, done } = run(loadTree(tree.project.dir), [a.id, broken.id, stuck.id], f, {
      graceMs: 0,
      onEvent: (event) => {
        if (event.type === 'start')
          later(10, () =>
            f.live.set(`s-${a.id}`, { ...f.live.get(`s-${a.id}`)!, live: { status: 'idle', kind: 'background' } }),
          );
        if (event.type === 'asks') later(10, () => f.live.delete(`s-${a.id}`));
      },
    });
    const end = await done;
    expect(events).toEqual([
      { type: 'start', node: a.id, title: 'А', session: `s-${a.id}`, pane: null },
      { type: 'fail', node: broken.id, title: 'Сломанный', error: 'CLI не установлен' },
      { type: 'asks', node: a.id, title: 'А', state: 'idle' },
      { type: 'done', node: a.id, title: 'А', status: 'active', ended: true },
      { type: 'blocked', node: stuck.id, title: 'Ждущий', reason: '«Чужой»' },
      { type: 'end', started: 1, finished: 1, blocked: 1, stopped: false },
    ]);
    expect(end).toMatchObject({ blocked: 1 });
  });

  it('stops starting on abort and says it stopped', async () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'А' });
    const f = fakes(tree.project.dir, {
      limits: () => [{ window: 'seven_day', utilization: 0.95, resetsAt: Date.now() / 1000 + 86_400 }],
    });
    const controller = new AbortController();
    const { events, done } = run(tree, [a.id], f, {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'limit') later(10, () => controller.abort());
      },
    });
    expect(await done).toEqual({ type: 'end', started: 0, finished: 0, blocked: 0, stopped: true });
    expect(events.map((e) => e.type)).toEqual(['limit', 'end']);
    expect(f.starts).toEqual([]);
  });

  it('counts a window as full until it resets', () => {
    const now = Date.now();
    const soon = now / 1000 + 600;
    expect(fullWindow([{ window: 'w', utilization: 0.92, resetsAt: soon }], 0.9, now)?.window).toBe('w');
    expect(fullWindow([{ window: 'w', utilization: 0.92, resetsAt: now / 1000 - 1 }], 0.9, now)).toBeUndefined();
    expect(fullWindow([{ window: 'w', utilization: 0.5 }], 0.9, now)).toBeUndefined();
    expect(fullWindow(null, 0.9, now)).toBeUndefined();
  });
});
