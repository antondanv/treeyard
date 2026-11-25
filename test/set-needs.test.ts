import { describe, expect, it } from 'vitest';

import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { emptyTree, treeyardIn } from './helpers.js';

describe('treeyard set needs+= / needs-= / needs=', () => {
  it('adds and removes one link, and needs= replaces the list and says what it was', async () => {
    const tree = emptyTree();
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((title) => addNode(tree, { title, status: 'idea' }));
    const sh = treeyardIn(tree.project.dir);
    const needs = (id: string) => loadTree(tree.project.dir).nodes.get(id)!.needs ?? [];

    expect((await sh('set', d!.id, `needs=${a!.id}`)).code).toBe(0);
    expect((await sh('set', d!.id, `needs+=${b!.id}`)).code).toBe(0);
    // Adding one that is already there changes nothing.
    expect((await sh('set', d!.id, `needs+=${a!.id},${c!.id}`)).code).toBe(0);
    expect(needs(d!.id)).toEqual([`.#${a!.id}`, `.#${b!.id}`, `.#${c!.id}`]);
    expect(loadTree(tree.project.dir).nodes.get(b!.id)!.neededBy).toEqual([`.#${d!.id}`]);

    expect((await sh('set', d!.id, `needs-=${b!.id}`)).code).toBe(0);
    expect(needs(d!.id)).toEqual([`.#${a!.id}`, `.#${c!.id}`]);
    expect(loadTree(tree.project.dir).nodes.get(b!.id)!.neededBy).toBeUndefined();

    const res = await sh('set', d!.id, `needs=${b!.id}`);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`needs было: ${a!.id}, ${c!.id}`);
    expect(needs(d!.id)).toEqual([`.#${b!.id}`]);
  }, 60_000);

  it('refuses a link that is not there, a clash and an empty list, and changes nothing', async () => {
    const tree = emptyTree();
    const [a, b] = ['A', 'B'].map((title) => addNode(tree, { title, status: 'idea' }));
    const sh = treeyardIn(tree.project.dir);
    await sh('set', a!.id, `needs=${b!.id}`);
    const cases: [string[], string][] = [
      [[`needs-=${a!.id}`], 'не ждёт'],
      [[`needs+=${a!.id}`], 'сам себя'],
      [['needs+='], 'хотя бы один id'],
      [[`needs+=${b!.id}`, `needs-=${b!.id}`], 'один раз'],
    ];
    for (const [args, message] of cases) {
      const res = await sh('set', a!.id, ...args);
      expect(res.code, args.join(' ')).toBe(2);
      expect(res.stderr, args.join(' ')).toContain(message);
    }
    expect(loadTree(tree.project.dir).nodes.get(a!.id)!.needs).toEqual([`.#${b!.id}`]);
  }, 60_000);
});
