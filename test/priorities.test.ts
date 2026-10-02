import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { paint, treeJson, treeText } from '../src/cli/print.js';
import { addNode, attachSession, setStatus, shift } from '../src/model/ops.js';
import { GLYPH, overviewText } from '../src/model/overview.js';
import { loadTree, nodePath } from '../src/model/store.js';
import { childrenOf, pathTo, progress } from '../src/model/tree.js';
import { ROOT, type Status } from '../src/model/types.js';
import { snapshot } from '../src/tui/snapshot.js';
import { doneGroupId, doneGroupsOnPath, treeViewRows } from '../src/tui/tree-view.js';
import { emptyTree } from './helpers.js';

const SHIFT_UP = '\u001b[1;2A';
const SHIFT_DOWN = '\u001b[1;2B';
const RIGHT = '\u001b[C';

function sample() {
  const tree = emptyTree();
  const branch = addNode(tree, { title: 'Ветка' });
  const first = addNode(tree, { title: 'Первый', parent: branch.id });
  const second = addNode(tree, { title: 'Второй', parent: branch.id });
  const active = addNode(tree, { title: 'Работаю', status: 'active', parent: branch.id });
  const review = addNode(tree, { title: 'Проверяю', status: 'review', parent: branch.id });
  const done = addNode(tree, { title: 'Подтверждено', status: 'done', parent: branch.id });
  return { tree, branch, first, second, active, review, done };
}

describe('status and manual priority', () => {
  it('adds a new node last within its status even when closed siblings have smaller order values', () => {
    const { tree, branch, first, second } = sample();
    const added = addNode(tree, { title: 'А новая задача', parent: branch.id });
    expect(
      childrenOf(tree, branch.id)
        .filter((node) => node.status === 'todo')
        .map((node) => node.id),
    ).toEqual([first.id, second.id, added.id]);
  });

  it('orders every parent by status and persists manual order within that status in every output', () => {
    const tree = emptyTree();
    const statuses: Status[] = ['dropped', 'done', 'idea', 'waiting', 'todo', 'review', 'active'];
    for (const status of statuses) addNode(tree, { title: status, status });
    const another = addNode(tree, { title: 'other todo' });
    shift(tree, another.id, -1);
    const expected = ['active', 'review', 'other todo', 'todo', 'waiting', 'idea', 'done', 'dropped'];
    const reread = loadTree(tree.project.dir);
    expect(childrenOf(reread, ROOT).map((node) => node.title)).toEqual(expected);
    expect((treeJson(reread) as { nodes: { title: string }[] }).nodes.map((node) => node.title)).toEqual(expected);
    const text = treeText(reread, paint(process.stdout));
    const overview = overviewText(reread);
    const positions = childrenOf(reread, ROOT).map((node) => text.indexOf(`${GLYPH[node.status]} ${node.title}`));
    const overviewPositions = expected.map((title) => overview.indexOf(`[${title}]`));
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(overviewPositions.every((index) => index >= 0)).toBe(true);
    expect(overviewPositions).toEqual([...overviewPositions].sort((a, b) => a - b));
    setStatus(reread, another.id, 'active');
    expect(
      childrenOf(loadTree(tree.project.dir), ROOT)
        .slice(0, 2)
        .map((node) => node.status),
    ).toEqual(['active', 'active']);
  });

  it('does not cross statuses or change files at a priority boundary', () => {
    const { tree, branch, active, first } = sample();
    const before = childrenOf(tree, branch.id).map((node) => readFileSync(nodePath(tree.project.dir, node.id), 'utf8'));
    shift(tree, active.id, 1);
    shift(tree, first.id, -1);
    expect(
      childrenOf(tree, branch.id).map((node) => readFileSync(nodePath(tree.project.dir, node.id), 'utf8')),
    ).toEqual(before);
  });

  it.each(['graph', 'list'] as const)(
    'reorders with Shift+arrows in %s, keeps selection, and undoes',
    async (treeMode) => {
      const { tree, branch, first, second } = sample();
      const ui = { selected: second.id, expanded: [branch.id], treeMode };
      const frame = await snapshot(tree.project.dir, { columns: 100, rows: 30, ui, keys: [SHIFT_UP] });
      expect(
        childrenOf(loadTree(tree.project.dir), branch.id)
          .filter((node) => node.status === 'todo')
          .map((node) => node.id),
      ).toEqual([second.id, first.id]);
      expect(frame).toContain('Второй» выше');
      await snapshot(tree.project.dir, { ui, keys: [SHIFT_DOWN, 'u'] });
      expect(
        childrenOf(loadTree(tree.project.dir), branch.id)
          .filter((node) => node.status === 'todo')
          .map((node) => node.id),
      ).toEqual([second.id, first.id]);
      await snapshot(tree.project.dir, { ui, keys: [SHIFT_DOWN] });
      expect(
        childrenOf(loadTree(tree.project.dir), branch.id)
          .filter((node) => node.status === 'todo')
          .map((node) => node.id),
      ).toEqual([first.id, second.id]);
    },
  );

  it('offers priority in the node menu and palette', async () => {
    const { tree, branch, first, second } = sample();
    const ui = { selected: second.id, expanded: [branch.id] };
    await snapshot(tree.project.dir, { ui, keys: ['\r', 'K'] });
    expect(
      childrenOf(loadTree(tree.project.dir), branch.id)
        .filter((node) => node.status === 'todo')
        .map((node) => node.id),
    ).toEqual([second.id, first.id]);
    await snapshot(tree.project.dir, { ui, keys: [':', 'Опустить приоритет', '\r'] });
    expect(
      childrenOf(loadTree(tree.project.dir), branch.id)
        .filter((node) => node.status === 'todo')
        .map((node) => node.id),
    ).toEqual([first.id, second.id]);
  });
});

describe('completed groups', () => {
  it('groups done siblings per parent without changing real parents, sessions, files or progress', () => {
    const { tree, branch, done, review } = sample();
    const topDone = addNode(tree, { title: 'Сверху готово', status: 'done' });
    const nested = addNode(tree, { title: 'Глубже', parent: done.id, status: 'done' });
    attachSession(tree, done.id, { brain: 'codex', id: 'kept-session' });
    const before = [...tree.nodes.values()].map((node) => readFileSync(nodePath(tree.project.dir, node.id), 'utf8'));
    const beforeProgress = progress(tree, ROOT);
    const expanded = new Set([branch.id]);
    const rows = treeViewRows(tree, { expanded, showClosed: true });
    expect(rows.map((row) => row.node.id)).toContain(doneGroupId(ROOT));
    expect(rows.map((row) => row.node.id)).toContain(doneGroupId(branch.id));
    expect(rows.map((row) => row.node.id)).toContain(review.id);
    expect(rows.map((row) => row.node.id)).not.toContain(done.id);
    expect(rows.map((row) => row.node.id)).not.toContain(topDone.id);
    const path = pathTo(tree, nested.id);
    const opened = new Set([...expanded, ...path.map((node) => node.id), ...doneGroupsOnPath(path)]);
    expect(treeViewRows(tree, { expanded: opened, showClosed: true }).map((row) => row.node.id)).toContain(nested.id);
    expect(tree.nodes.get(done.id)?.parent).toBe(branch.id);
    expect(tree.nodes.get(nested.id)?.parent).toBe(done.id);
    expect(tree.nodes.get(done.id)?.sessions[0]?.id).toBe('kept-session');
    expect(progress(tree, ROOT)).toEqual(beforeProgress);
    expect([...tree.nodes.values()].map((node) => readFileSync(nodePath(tree.project.dir, node.id), 'utf8'))).toEqual(
      before,
    );
  });

  it.each([
    { treeMode: 'graph', graphStyle: 'line' },
    { treeMode: 'graph', graphStyle: 'card' },
    { treeMode: 'list', graphStyle: 'line' },
  ] as const)('folds, opens with space and reaches sessions in $treeMode/$graphStyle', async (style) => {
    const { tree, branch, done } = sample();
    attachSession(tree, done.id, { brain: 'codex', id: 'kept-session', name: 'Готовый разговор' });
    const ui = { ...style, selected: doneGroupId(branch.id), expanded: [branch.id] };
    const opts = { columns: 100, rows: 30, ui };
    const folded = await snapshot(tree.project.dir, opts);
    expect(folded).toContain('Готовые · 1');
    expect(folded).not.toContain('Подтверждено');
    const opened = await snapshot(tree.project.dir, { ...opts, keys: [' '] });
    expect(opened).toContain('Подтверждено');
    const closed = await snapshot(tree.project.dir, { ...opts, keys: [' ', ' '] });
    expect(closed).not.toContain('Подтверждено');
    const menu = await snapshot(tree.project.dir, { ...opts, keys: [' ', RIGHT, '\r'] });
    expect(menu).toContain('Готовый разговор');
  });

  it('finds completed work through search and the palette, and opens its group on a jump', async () => {
    const { tree, branch, done } = sample();
    const ui = { selected: branch.id, expanded: [branch.id] };
    const search = await snapshot(tree.project.dir, { ui, keys: ['/', 'Подтверждено', '\r'] });
    expect(search).toContain('Подтверждено');
    const jump = await snapshot(tree.project.dir, { ui, keys: [':', 'Подтверждено', '\r'] });
    expect(jump).toContain('Готовые · 1');
    expect(jump).toContain('Подтверждено');
    expect(jump).toContain(done.id);
  });

  it('cannot edit a virtual group, hides it with dot and expands it with plus', async () => {
    const { tree, branch, done } = sample();
    const before = readFileSync(nodePath(tree.project.dir, done.id), 'utf8');
    const ui = { selected: doneGroupId(branch.id), expanded: [branch.id] };
    const frame = await snapshot(tree.project.dir, { ui, keys: ['r', 'd', 's', 'D', '\t', 'K', 'J'] });
    expect(frame).toContain('Готовые · 1');
    expect(readFileSync(nodePath(tree.project.dir, done.id), 'utf8')).toBe(before);
    const hidden = await snapshot(tree.project.dir, { ui, keys: ['.'] });
    expect(hidden).not.toContain('Готовые · 1');
    expect(hidden).not.toContain('Подтверждено');
    const expanded = await snapshot(tree.project.dir, { ui, keys: ['+'] });
    expect(expanded).toContain('Подтверждено');
  });
});
