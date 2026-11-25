import { cleanup } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@antondanv/brainyard', async (original) => ({
  ...(await original<typeof import('@antondanv/brainyard')>()),
  ...backend,
}));

import { AssistCancelled, proposeSteps } from '../src/agents/assist.js';
import { addNode } from '../src/model/ops.js';
import { writeProject } from '../src/model/store.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { snapshot } from '../src/tui/snapshot.js';
import { emptyTree, tempDir } from './helpers.js';

const ESC = '\u001b';
const ANSWER = '```json\n{"children": [{"title": "Первый шаг"}]}\n```';
const stopped = { ok: false, text: '', error: { kind: 'stopped', message: 'stopped' } };

/** A model that never answers: the run ends only when its signal fires, as Brainyard does. */
const hang = (options: { signal?: AbortSignal }) =>
  new Promise((done) => {
    options.signal?.addEventListener('abort', () => done(stopped), { once: true });
  });

beforeEach(() => {
  process.env.TREEYARD_HOME = tempDir('treeyard-home-');
  resetSettings({ ...DEFAULTS });
  backend.run.mockReset();
});

afterEach(() => {
  cleanup();
  resetSettings({ ...DEFAULTS });
});

function sample() {
  const tree = emptyTree();
  writeProject(tree.project);
  const node = addNode(tree, { title: 'Корзина', status: 'active' });
  return { tree, node };
}

describe('a job without a session has a limit and a way out', () => {
  it('gives the CLI a time limit and the signal', async () => {
    backend.run.mockResolvedValue({ ok: true, text: ANSWER });
    const { tree, node } = sample();
    const controller = new AbortController();
    await proposeSteps(tree, node.id, { brain: 'claude', signal: controller.signal });
    expect(backend.run.mock.calls[0]![0]).toMatchObject({ timeoutMs: 8 * 60_000, signal: controller.signal });
  });

  it('a hung CLI is stopped by the timeout with a message that says what to do', async () => {
    backend.run.mockResolvedValue({
      ok: false,
      text: '',
      error: { kind: 'timeout', message: 'timed out after 180s' },
    });
    const { tree, node } = sample();
    await expect(proposeSteps(tree, node.id, { brain: 'claude', timeoutMs: 180_000 })).rejects.toThrow(
      'агент не ответил за 3 мин — задачу снял; попробуй ещё раз или выбери другой CLI',
    );
  });

  it('a stopped run is a cancellation, not a failure', async () => {
    backend.run.mockResolvedValue(stopped);
    const { tree, node } = sample();
    await expect(proposeSteps(tree, node.id, { brain: 'claude' })).rejects.toBeInstanceOf(AssistCancelled);
  });
});

describe('Esc in the tree cancels the job', () => {
  it('stops the CLI, frees the tree and says so; the next job starts without «подожди»', async () => {
    backend.run.mockImplementation(hang);
    const { tree } = sample();
    const frame = await snapshot(tree.project.dir, {
      columns: 120,
      rows: 34,
      keys: ['S', ESC],
      settings: { confirm: false },
    });
    expect(backend.run).toHaveBeenCalledOnce();
    expect(backend.run.mock.calls[0]![0].signal.aborted).toBe(true);
    expect(frame).toContain('отменено: ');
    expect(frame).not.toContain('подожди');

    backend.run.mockClear();
    const again = await snapshot(tree.project.dir, {
      columns: 120,
      rows: 34,
      keys: ['S', ESC, 'S'],
      settings: { confirm: false },
    });
    expect(backend.run).toHaveBeenCalledTimes(2);
    expect(backend.run.mock.calls[1]![0].signal.aborted).toBe(false);
    expect(again).not.toContain('подожди');
    expect(again).toContain('Esc — отменить');
  });

  it('an answer that arrives after the cancel is dropped', async () => {
    backend.run.mockImplementation(
      () => new Promise((done) => setTimeout(() => done({ ok: true, text: ANSWER }), 150)),
    );
    const { tree } = sample();
    const frame = await snapshot(tree.project.dir, {
      columns: 120,
      rows: 34,
      keys: ['S', ESC],
      settings: { confirm: false },
      settle: 400,
    });
    expect(frame).not.toContain('Первый шаг');
  });
});
