import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { addNode, logToNode } from '../src/model/ops.js';
import { loadTree, nodePath } from '../src/model/store.js';
import { emptyTree, treeyardIn } from './helpers.js';

describe('treeyard rm', () => {
  it('deletes nodes added by mistake: only «завёл узел» in the journal, nothing inside', async () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'Дубль', body: 'описание не мешает' }, 'агент');
    const b = addNode(tree, { title: 'Ещё дубль' });
    const sh = treeyardIn(tree.project.dir);
    const res = await sh('rm', a.id, b.id);
    expect(res.code).toBe(0);
    expect(res.stdout).toBe(`${a.id} · удалён · Дубль\n${b.id} · удалён · Ещё дубль\n`);
    expect(existsSync(nodePath(tree.project.dir, a.id))).toBe(false);
    expect(loadTree(tree.project.dir).nodes.size).toBe(0);
  }, 40_000);

  it('a node with a history is not deleted, and then neither is any other; the command says why', async () => {
    const tree = emptyTree();
    const fresh = addNode(tree, { title: 'Свежий' }, 'агент');
    const worked = addNode(tree, { title: 'С историей' }, 'агент');
    logToNode(tree, worked.id, 'сделал половину', 'агент');
    const parent = addNode(tree, { title: 'Родитель' });
    addNode(tree, { title: 'Ребёнок', parent: parent.id });
    const sh = treeyardIn(tree.project.dir);
    const res = await sh('rm', fresh.id, worked.id, parent.id);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain(`treeyard set ${fresh.id} ${worked.id} ${parent.id} status=dropped`);
    expect(res.stderr).toContain(`${worked.id} «С историей»: записей в журнале: 1`);
    expect(res.stderr).toContain(`${parent.id} «Родитель»: внутри узлов: 1`);
    expect(loadTree(tree.project.dir).nodes.size).toBe(4);
    expect((await sh('rm', 'root')).code).toBe(2);
    expect((await sh('rm', 'zzzz')).code).toBe(2);
  }, 40_000);
});

describe('treeyard decide', () => {
  it('adds a dated line to «Решения» and lists them without text', async () => {
    const tree = emptyTree();
    const sh = treeyardIn(tree.project.dir);
    const res = await sh('decide', 'SQLite, а не Postgres: один пользователь');
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(
      /^в «Решения» \.tree\/tree\.md: SQLite, а не Postgres: один пользователь \(\d{4}-\d\d-\d\d\)\n$/,
    );
    await sh('decide', 'Ролики — в Motionlab (2026-10-07)');
    const body = loadTree(tree.project.dir).project.body;
    const section = body.slice(body.indexOf('## Решения'));
    expect(section).toMatch(
      /- SQLite, а не Postgres: один пользователь \(\d{4}-\d\d-\d\d\)\n- Ролики — в Motionlab \(2026-10-07\)/,
    );
    // The rest of tree.md stays.
    expect(body).toContain('## Правила для агентов');
    const list = await sh('decide');
    expect(list.stdout).toContain('- Ролики — в Motionlab (2026-10-07)');
  }, 40_000);
});
