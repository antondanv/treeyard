import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { paint, treeJson, treeText } from '../src/cli/print.js';
import { addNode, setStatus, shift } from '../src/model/ops.js';
import { GLYPH, overviewText } from '../src/model/overview.js';
import { loadTree, nodePath } from '../src/model/store.js';
import { childrenOf } from '../src/model/tree.js';
import { ROOT, type Status } from '../src/model/types.js';
import { snapshot } from '../src/tui/snapshot.js';
import { emptyTree } from './helpers.js';

const SHIFT_UP = '\u001b[1;2A';
const SHIFT_DOWN = '\u001b[1;2B';

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
