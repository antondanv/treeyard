import { describe, expect, it } from 'vitest';

import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { childrenOf } from '../src/model/tree.js';
import { ROOT, type Tree } from '../src/model/types.js';
import { emptyTree, treeyardIn } from './helpers.js';

/** Titles of the children of `parent` as they are shown, read back from disk. */
function titles(tree: Tree, parent = ROOT): string[] {
  return childrenOf(loadTree(tree.project.dir), parent).map((node) => node.title);
}

describe('treeyard set after=', () => {
  it('puts a node after a sibling, first or last, and renumbers in steps of 10', async () => {
    const tree = emptyTree();
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((title) => addNode(tree, { title }));
    const sh = treeyardIn(tree.project.dir);

    const moved = await sh('set', d!.id, `after=${a!.id}`);
    expect(moved.code).toBe(0);
    expect(titles(tree)).toEqual(['A', 'D', 'B', 'C']);
    expect(childrenOf(loadTree(tree.project.dir), ROOT).map((node) => node.order)).toEqual([10, 20, 30, 40]);

    await sh('set', c!.id, 'after=first');
    expect(titles(tree)).toEqual(['C', 'A', 'D', 'B']);
    await sh('set', c!.id, 'after=last');
    expect(titles(tree)).toEqual(['A', 'D', 'B', 'C']);
    // An id prefix is enough, like everywhere else; a node already in place stays there.
    await sh('set', b!.id, `after=${d!.id.slice(0, 3)}`);
    expect(titles(tree)).toEqual(['A', 'D', 'B', 'C']);
  });

  it('works under any parent, and together with parent=', async () => {
    const tree = emptyTree();
    const box = addNode(tree, { title: 'Box' });
    const other = addNode(tree, { title: 'Other' });
    const [x, y, z] = ['X', 'Y', 'Z'].map((title) => addNode(tree, { title, parent: box.id }));
    const loose = addNode(tree, { title: 'Loose' });
    const sh = treeyardIn(tree.project.dir);

    await sh('set', z!.id, `after=${x!.id}`);
    expect(titles(tree, box.id)).toEqual(['X', 'Z', 'Y']);
    // Into another parent, right after one of its children.
    const inner = addNode(loadTree(tree.project.dir), { title: 'Inner', parent: other.id });
    const moved = await sh('set', loose.id, `parent=${other.id}`, `after=first`);
    expect(moved.code).toBe(0);
    expect(titles(tree, other.id)).toEqual(['Loose', 'Inner']);
    await sh('set', y!.id, `parent=${other.id}`, `after=${inner.id}`);
    expect(titles(tree, other.id)).toEqual(['Loose', 'Inner', 'Y']);
    expect(titles(tree, box.id)).toEqual(['X', 'Z']);
  });

  it('refuses a node that is not a sibling, the node itself, an unknown id and a bare number', async () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'A' });
    const b = addNode(tree, { title: 'B' });
    const kid = addNode(tree, { title: 'Kid', parent: a.id });
    const sh = treeyardIn(tree.project.dir);

    const stranger = await sh('set', b.id, `after=${kid.id}`);
    expect(stranger.code).not.toBe(0);
    expect(stranger.stderr).toContain('не узел того же родителя');
    const self = await sh('set', b.id, `after=${b.id}`);
    expect(self.code).not.toBe(0);
    expect(self.stderr).toContain('на сам узел');
    const unknown = await sh('set', b.id, 'after=zzzz');
    expect(unknown.code).not.toBe(0);
    expect(unknown.stderr).toContain('нет узла');
    const order = await sh('set', b.id, 'order=5');
    expect(order.code).not.toBe(0);
    expect(order.stderr).toContain('after=<id брата>|first|last');
    // Nothing moved.
    expect(titles(tree)).toEqual(['A', 'B']);
    expect(titles(tree, a.id)).toEqual(['Kid']);
  });

  it('goes by order whatever the sibling status; the node stays in its own status group', async () => {
    const tree = emptyTree();
    // Shown status-major: active, then todo, then done. Within a group — by order.
    const todo = ['T1', 'T2', 'T3'].map((title) => addNode(tree, { title }));
    const active = addNode(tree, { title: 'Act', status: 'active' });
    const done = addNode(tree, { title: 'Done', status: 'done' });
    const sh = treeyardIn(tree.project.dir);
    expect(titles(tree)).toEqual(['Act', 'T1', 'T2', 'T3', 'Done']);

    // After a node of an earlier group: first of its own group.
    await sh('set', todo[2]!.id, `after=${active.id}`);
    expect(titles(tree)).toEqual(['Act', 'T3', 'T1', 'T2', 'Done']);
    // After a node of a later group: last of its own group.
    await sh('set', todo[0]!.id, `after=${done.id}`);
    expect(titles(tree)).toEqual(['Act', 'T3', 'T2', 'T1', 'Done']);
    // And the status itself is never touched.
    const reread = loadTree(tree.project.dir);
    expect(reread.nodes.get(todo[0]!.id)!.status).toBe('todo');
    expect(reread.nodes.get(active.id)!.status).toBe('active');
  });

  it('shows after= and add --after in the help', async () => {
    const tree = emptyTree();
    const help = await treeyardIn(tree.project.dir)('help');
    expect(help.stdout).toContain('after=<id брата>|first|last');
    expect(help.stdout).toContain('[--after id]');
  });
});
