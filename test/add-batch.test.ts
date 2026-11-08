import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BatchError, parseBatch } from '../src/model/batch.js';
import { journalEntries } from '../src/model/journal.js';
import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { childrenOf } from '../src/model/tree.js';
import { emptyTree, tempDir, treeyardIn } from './helpers.js';

describe('add --from-json', () => {
  it('reads an array or {nodes}, with words for statuses and hyphens in field names', () => {
    expect(parseBatch('[{"title": "A", "status": "идея", "done-when": "видно"}]')).toEqual([
      { title: 'A', status: 'idea', doneWhen: 'видно', needs: [], children: [] },
    ]);
    expect(parseBatch('{"nodes": [{"title": "B", "needs": "x, y"}]}')[0]!.needs).toEqual(['x', 'y']);
    for (const bad of [
      'not json',
      '[]',
      '[{"done_when": "без названия"}]',
      '[{"title": "A", "status": "soon"}]',
      '[{"title": "A", "who": "robot"}]',
      '[{"title": "A", "done": "опечатка в поле"}]',
      '[{"title": "A", "key": "k"}, {"title": "B", "key": "k"}]',
      '[{"title": "A", "children": {"title": "B"}}]',
    ])
      expect(() => parseBatch(bad), bad).toThrow(BatchError);
  });

  it('plants the batch under the parent, children and needs between new nodes included', async () => {
    const tree = emptyTree();
    const parent = addNode(tree, { title: 'Ветка' });
    const old = addNode(tree, { title: 'Старый' });
    const file = join(tempDir(), 'nodes.json');
    writeFileSync(
      file,
      JSON.stringify([
        { title: 'Исследовать', key: 'research', done_when: 'отчёт в docs/' },
        { title: 'Решить', needs: ['research', old.id], who: 'human', note: 'после исследования' },
        { title: 'Сделать', status: 'todo', children: [{ title: 'Тесты' }, { title: 'Код', check: 'npm test' }] },
      ]),
    );
    const sh = treeyardIn(tree.project.dir);
    const res = await sh('add', '--parent', parent.id, '--status', 'idea', '--from-json', file);
    expect(res.code).toBe(0);
    const lines = res.stdout.trimEnd().split('\n');
    expect(lines.map((line) => line.replace(/\w{4} {2}/, 'id  '))).toEqual([
      'id  Исследовать',
      'id  Решить',
      'id  Сделать',
      '  id  Тесты',
      '  id  Код',
    ]);
    const reread = loadTree(tree.project.dir);
    const kids = childrenOf(reread, parent.id);
    const byTitle = (title: string) => [...reread.nodes.values()].find((node) => node.title === title)!;
    expect(kids.map((node) => node.title).sort()).toEqual(['Исследовать', 'Решить', 'Сделать']);
    // The command's --status fills in what a node does not say.
    expect(byTitle('Исследовать').status).toBe('idea');
    expect(byTitle('Сделать').status).toBe('todo');
    expect(byTitle('Решить').who).toBe('human');
    expect(byTitle('Решить').needs).toEqual([`.#${byTitle('Исследовать').id}`, `.#${old.id}`]);
    expect(byTitle('Код').parent).toBe(byTitle('Сделать').id);
    expect(byTitle('Код').check).toBe('npm test');
    expect(journalEntries(byTitle('Тесты').body)[0]).toContain('агент · завёл узел');
  }, 40_000);

  it('an error anywhere in the batch adds no node at all', async () => {
    const tree = emptyTree();
    const sh = treeyardIn(tree.project.dir);
    const dir = tempDir();
    for (const [name, batch] of [
      ['status', [{ title: 'A' }, { title: 'B', children: [{ title: 'C', status: 'soon' }] }]],
      ['ref', [{ title: 'A', needs: ['nope'] }]],
      ['self', [{ title: 'A', key: 'a', needs: ['a'] }]],
    ] as const) {
      const file = join(dir, `${name}.json`);
      writeFileSync(file, JSON.stringify(batch));
      const res = await sh('add', '--from-json', file);
      expect(res.code, name).toBe(2);
      expect(loadTree(tree.project.dir).nodes.size, name).toBe(0);
    }
    expect((await sh('add', 'Название', '--from-json', '-')).code).toBe(2);
    expect((await sh('add', '--from-json', '-', '--done-when', 'x')).stderr).toContain('задаётся в JSON');
  }, 40_000);
});
