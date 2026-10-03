import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@antondanv/brainyard', async (original) => ({
  ...(await original<typeof import('@antondanv/brainyard')>()),
  ...backend,
}));

import { addNode } from '../src/model/ops.js';
import { loadTree, writeProject } from '../src/model/store.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { CONFIRM_GUARD_MS, ConfirmAssist } from '../src/tui/dialogs.js';
import { snapshot } from '../src/tui/snapshot.js';
import { emptyTree, tempDir } from './helpers.js';

const RIGHT = '\u001b[C';
const LEFT = '\u001b[D';
const DOWN = '\u001b[B';
/** Three fields: three downs come back to the same one — time passes, nothing changes. */
const idle = Array.from({ length: 9 }, () => DOWN);

const pause = (ms = 50) => new Promise((done) => setTimeout(done, ms));

beforeEach(() => {
  process.env.TREEYARD_HOME = tempDir('treeyard-home-');
  resetSettings({ ...DEFAULTS });
  backend.run.mockReset();
  backend.run.mockResolvedValue({
    ok: true,
    text: '```json\n{"children": [{"title": "Первый шаг"}], "done_when": "Видно в TUI"}\n```',
  });
});

afterEach(() => {
  cleanup();
  resetSettings({ ...DEFAULTS });
});

/** A project on Claude Code with its own model for agent jobs. */
function sample(assistModel = 'sonnet') {
  const tree = emptyTree();
  tree.project.assistModel = assistModel;
  writeProject(tree.project);
  const node = addNode(tree, { title: 'Корзина', status: 'active' });
  return { tree, node, settings: readFileSync(join(tree.project.dir, '.tree', 'tree.md'), 'utf8') };
}

describe('the confirmation of an agent job picks who does it', () => {
  it('another CLI drops the project model; coming back brings it back', async () => {
    const { node } = sample();
    const onConfirm = vi.fn();
    const app = render(
      <ConfirmAssist
        job="split"
        node={node}
        defaults={{ brain: 'claude', model: 'sonnet', effort: 'medium' }}
        width={100}
        onConfirm={onConfirm}
        onNever={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await pause();
    app.stdin.write(RIGHT);
    await pause(CONFIRM_GUARD_MS);
    app.stdin.write('\r');
    await pause();
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ brain: 'codex', effort: 'medium' });
    app.unmount();

    const back = vi.fn();
    const again = render(
      <ConfirmAssist
        job="criterion"
        node={node}
        defaults={{ brain: 'claude', model: 'sonnet', effort: 'low' }}
        width={100}
        onConfirm={back}
        onNever={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await pause();
    for (const key of [RIGHT, RIGHT, LEFT, LEFT]) {
      again.stdin.write(key);
      await pause();
    }
    expect(again.lastFrame()).toContain('Сформулировать «готово, когда»?');
    await pause(CONFIRM_GUARD_MS);
    again.stdin.write('\r');
    await pause();
    expect(back).toHaveBeenCalledExactlyOnceWith({ brain: 'claude', model: 'sonnet', effort: 'low' });
  });

  it('«!» starts the job with the chosen agent too', async () => {
    const { node } = sample();
    const onNever = vi.fn();
    const app = render(
      <ConfirmAssist
        job="split"
        node={node}
        defaults={{ brain: 'claude', effort: 'medium' }}
        width={100}
        onConfirm={vi.fn()}
        onNever={onNever}
        onCancel={vi.fn()}
      />,
    );
    await pause();
    app.stdin.write(LEFT);
    await pause();
    app.stdin.write('!');
    await pause();
    expect(onNever).toHaveBeenCalledOnce();
    expect(onNever.mock.calls[0]![0]).toMatchObject({ brain: 'antigravity' });
  });
});

describe('the job runs on the chosen agent; the project keeps its own', () => {
  it('S → Codex → Enter: Codex breaks the node down, tree.md is untouched', async () => {
    const { tree, settings } = sample();
    const frame = await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: ['S', RIGHT, ...idle, '\r'] });
    expect(backend.run).toHaveBeenCalledOnce();
    expect(backend.run.mock.calls[0]![0]).toMatchObject({ brain: 'codex', effort: 'medium', access: 'readonly' });
    expect(backend.run.mock.calls[0]![0]).not.toHaveProperty('model');
    expect(frame).toContain('Первый шаг');
    expect(readFileSync(join(tree.project.dir, '.tree', 'tree.md'), 'utf8')).toBe(settings);
    expect(loadTree(tree.project.dir).project).toMatchObject({ assistModel: 'sonnet' });
  });

  it('the criterion: Antigravity, and the next job starts from the project defaults again', async () => {
    const { tree, settings } = sample();
    const menu = [`\r`, DOWN.repeat(6), '\r'];
    await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: [...menu, LEFT, ...idle, '\r'] });
    expect(backend.run.mock.calls[0]![0]).toMatchObject({ brain: 'antigravity' });
    expect(backend.run.mock.calls[0]![0]).not.toHaveProperty('model');
    const frame = await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: [...menu, ...idle, '\r'] });
    expect(frame).toContain('Видно в TUI');
    expect(backend.run.mock.calls[1]![0]).toMatchObject({ brain: 'claude', model: 'sonnet', effort: 'low' });
    expect(readFileSync(join(tree.project.dir, '.tree', 'tree.md'), 'utf8')).toBe(settings);
  });

  it('without confirmations the job runs on the project defaults, as before', async () => {
    const { tree } = sample();
    await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: ['S'], settings: { confirm: false } });
    expect(backend.run.mock.calls[0]![0]).toMatchObject({ brain: 'claude', model: 'sonnet', effort: 'medium' });
  });

  it('an effort the model does not take is not sent: Haiku has none, the CLI would refuse it', async () => {
    const { tree } = sample('haiku');
    await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: ['S'], settings: { confirm: false } });
    expect(backend.run.mock.calls[0]![0]).toMatchObject({ brain: 'claude', model: 'haiku' });
    expect(backend.run.mock.calls[0]![0]).not.toHaveProperty('effort');
  });
});
