import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { childrenByOrder, childrenOf } from '../src/model/tree.js';
import { ROOT, type Tree } from '../src/model/types.js';
import { emptyTree, treeyardIn } from './helpers.js';

/** Children of `parent` read back from disk: as shown (by status) and by order alone, with the orders. */
function reread(tree: Tree, parent = ROOT) {
  const fresh = loadTree(tree.project.dir);
  const kids = childrenByOrder(fresh, parent);
  return {
    shown: childrenOf(fresh, parent).map((node) => node.title),
    byOrder: kids.map((node) => node.title),
    orders: kids.map((node) => node.order),
    count: fresh.nodes.size,
  };
}

describe('treeyard add --after', () => {
  it('puts the node right after a sibling of another status and says which group it went to', async () => {
    const tree = emptyTree();
    const box = addNode(tree, { title: 'Box' });
    const [t1] = ['T1', 'T2'].map((title) => addNode(tree, { title, parent: box.id }));
    addNode(tree, { title: 'I1', parent: box.id, status: 'idea' });
    const sh = treeyardIn(tree.project.dir);

    const added = await sh('add', 'New', '--parent', box.id, '--after', t1!.id, '--status', 'idea');
    expect(added.code).toBe(0);
    expect(added.stderr).toContain(`--after ${t1!.id}: у брата статус «к работе», у нового узла — «идея»`);
    expect(added.stderr).toContain('в группе «идея»');
    const after = reread(tree, box.id);
    // By order — right after T1; shown — the nearest place among the ideas; no order twice.
    expect(after.byOrder).toEqual(['T1', 'New', 'T2', 'I1']);
    expect(after.shown).toEqual(['T1', 'T2', 'New', 'I1']);
    expect(new Set(after.orders).size).toBe(after.orders.length);
    // The overview lists siblings by order alone: New stands right after T1 there too.
    const overview = readFileSync(join(tree.project.dir, '.tree', 'README.md'), 'utf8');
    expect(overview.indexOf('[New]')).toBeGreaterThan(overview.indexOf('[T1]'));
    expect(overview.indexOf('[New]')).toBeLessThan(overview.indexOf('[T2]'));

    // A sibling of the same status: nothing to say.
    const same = await sh('add', 'Same', '--parent', box.id, '--after', t1!.id);
    expect(same.code).toBe(0);
    expect(same.stderr).toBe('');
    expect(reread(tree, box.id).shown).toEqual(['T1', 'Same', 'T2', 'New', 'I1']);
  });

  it('takes the parent from --after alone and refuses a node of another parent or the root', async () => {
    const tree = emptyTree();
    const box = addNode(tree, { title: 'Box' });
    const kid = addNode(tree, { title: 'Kid', parent: box.id });
    addNode(tree, { title: 'Last', parent: box.id });
    const loose = addNode(tree, { title: 'Loose' });
    const sh = treeyardIn(tree.project.dir);

    const stranger = await sh('add', 'X', '--parent', box.id, '--after', loose.id);
    expect(stranger.code).not.toBe(0);
    expect(stranger.stderr).toContain(`--after ${loose.id}: это узел другого родителя, не ${box.id}`);
    const root = await sh('add', 'X', '--after', ROOT);
    expect(root.code).not.toBe(0);
    expect(root.stderr).toContain('нет узла');
    expect(reread(tree).count).toBe(4);

    const inferred = await sh('add', 'Y', '--after', kid.id.slice(0, 3));
    expect(inferred.code).toBe(0);
    expect(reread(tree, box.id).shown).toEqual(['Kid', 'Y', 'Last']);
  });

  it('never repeats an order: not without --after, not next to an old duplicate', () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'A' });
    addNode(tree, { title: 'B' });
    // Counted per status, the first idea used to get the order of A.
    const idea = addNode(tree, { title: 'Idea', status: 'idea' });
    expect(idea.order).not.toBe(a.order);
    expect(new Set(reread(tree).orders).size).toBe(3);

    // Trees written before still hold such duplicates; slotting in after one renumbers them.
    idea.order = a.order;
    const next = addNode(tree, { title: 'Next', after: a.id });
    const after = reread(tree);
    expect(after.byOrder.indexOf('Next')).toBe(after.byOrder.indexOf('A') + 1);
    expect(new Set(after.orders).size).toBe(4);
    expect(next.order).toBeGreaterThan(a.order);
  });
});
