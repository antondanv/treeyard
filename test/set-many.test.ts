import { describe, expect, it } from 'vitest';

import { journalEntries } from '../src/model/journal.js';
import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { childrenOf } from '../src/model/tree.js';
import { ROOT, type Tree } from '../src/model/types.js';
import { emptyTree, treeyardIn } from './helpers.js';

function titles(tree: Tree, parent = ROOT): string[] {
  return childrenOf(loadTree(tree.project.dir), parent).map((node) => node.title);
}

describe('treeyard set for several nodes', () => {
  it('changes every node in one call and prints a line for each', async () => {
    const tree = emptyTree();
    const [a, b, c] = ['A', 'B', 'C'].map((title) => addNode(tree, { title, status: 'idea' }));
    const sh = treeyardIn(tree.project.dir);
    const res = await sh('set', a!.id, b!.id, c!.id, 'status=todo', 'who=agent');
    expect(res.code).toBe(0);
    expect(res.stdout.trim().split('\n')).toEqual([
      `${a!.id} · к работе · A`,
      `${b!.id} · к работе · B`,
      `${c!.id} · к работе · C`,
    ]);
    const reread = loadTree(tree.project.dir);
    for (const node of [a!, b!, c!]) {
      expect(reread.nodes.get(node.id)!.status).toBe('todo');
      expect(reread.nodes.get(node.id)!.who).toBe('agent');
      expect(journalEntries(reread.nodes.get(node.id)!.body).at(-1)).toContain('идея → к работе');
    }
  }, 40_000);

  it('after= puts them one after another in the order given; parent= moves them all', async () => {
    const tree = emptyTree();
    const box = addNode(tree, { title: 'Box' });
    const [x, y, z, w] = ['X', 'Y', 'Z', 'W'].map((title) => addNode(tree, { title, parent: box.id }));
    const sh = treeyardIn(tree.project.dir);
    await sh('set', w!.id, z!.id, `after=${x!.id}`);
    expect(titles(tree, box.id)).toEqual(['X', 'W', 'Z', 'Y']);
    await sh('set', y!.id, x!.id, 'after=first');
    expect(titles(tree, box.id)).toEqual(['Y', 'X', 'W', 'Z']);
    const other = addNode(loadTree(tree.project.dir), { title: 'Other' });
    await sh('set', z!.id, y!.id, `parent=${other.id}`);
    expect(titles(tree, other.id)).toEqual(['Z', 'Y']);
    expect(titles(tree, box.id)).toEqual(['X', 'W']);
  }, 40_000);

  it('an unknown id, a bad value or an impossible move change no node at all', async () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'A', status: 'idea' });
    const b = addNode(tree, { title: 'B', status: 'idea' });
    const kid = addNode(tree, { title: 'Kid', parent: a.id });
    const sh = treeyardIn(tree.project.dir);
    const before = () =>
      [...loadTree(tree.project.dir).nodes.values()].map((node) => `${node.id}:${node.status}:${node.parent}`).sort();
    const snapshot = before();
    for (const args of [
      [a.id, 'zzzz', 'status=todo'],
      [a.id, b.id, 'status=soon'],
      [a.id, b.id, 'who=robot'],
      [a.id, b.id, 'title=Одно'],
      [b.id, a.id, `parent=${kid.id}`],
      [kid.id, b.id, `after=${b.id}`],
      [kid.id, b.id, 'after=first'],
      [a.id, b.id, `needs=${a.id}`],
      [a.id, 'status', '=', 'todo'],
    ]) {
      const res = await sh('set', ...args);
      expect(res.code, args.join(' ')).toBe(2);
      expect(before(), args.join(' ')).toEqual(snapshot);
    }
    expect((await sh('set', a.id, b.id, 'title=Одно')).stderr).toContain('меняй по одному');
    expect((await sh('set', kid.id, b.id, 'after=first')).stderr).toContain('один родитель');
    expect((await sh('set', a.id, 'status', '=', 'todo')).stderr).toContain('«status» — нужно ключ=значение');
  }, 60_000);

  it('done from an agent becomes review for each node, with one warning', async () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'A', status: 'active' });
    const b = addNode(tree, { title: 'B', status: 'active' });
    const res = await treeyardIn(tree.project.dir)('set', a.id, b.id, 'status=done');
    expect(res.stdout).toContain(`${a.id} · на проверке · A`);
    expect(res.stdout).toContain(`${b.id} · на проверке · B`);
    expect(res.stderr.match(/готово ставит человек/g)).toHaveLength(1);
  }, 40_000);
});
