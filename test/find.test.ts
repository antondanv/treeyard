import { describe, expect, it } from 'vitest';

import { findNodes, queryParts } from '../src/model/find.js';
import { addNode, logToNode, setStatus } from '../src/model/ops.js';
import type { Tree } from '../src/model/types.js';
import { emptyTree, treeyardIn } from './helpers.js';

function planted(): { tree: Tree; ids: { money: string; round: string; report: string; old: string } } {
  const tree = emptyTree();
  const money = addNode(tree, { title: 'Деньги', body: 'Всё про копейки.' });
  const round = addNode(tree, {
    title: 'Округление',
    parent: money.id,
    doneWhen: 'tip 10.05 даёт 1.01 — ровно до копейки',
    check: 'npm test',
  });
  const report = addNode(tree, { title: 'Отчёт', parent: money.id, status: 'waiting', waiting: 'ждём выписку банка' });
  const old = addNode(tree, { title: 'Старое', status: 'done' });
  logToNode(tree, old.id, 'Перенёс расчёт копеек в money', 'агент');
  logToNode(tree, round.id, 'первая запись', 'агент');
  setStatus(tree, round.id, 'active', { source: 'агент' });
  return { tree, ids: { money: money.id, round: round.id, report: report.id, old: old.id } };
}

describe('find', () => {
  it('looks through titles, criteria, checks, waits, descriptions and journals, done nodes too', () => {
    const { tree, ids } = planted();
    const found = findNodes(tree, 'копе');
    expect(found.map((item) => item.node.id)).toEqual([ids.money, ids.round, ids.old]);
    expect(found[0]!.hits.map((hit) => hit.field)).toEqual(['note']);
    expect(found[1]!.hits[0]).toMatchObject({ field: 'done_when' });
    const journal = found[2]!.hits[0]!;
    expect(journal.field).toBe('journal');
    expect(journal.when).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d$/);
    expect(journal.snippet.slice(journal.at, journal.at + journal.length)).toBe('копе');
    expect(findNodes(tree, 'выписку')[0]!.hits[0]!.field).toBe('waiting');
    expect(findNodes(tree, 'npm test')[0]!.hits[0]!.field).toBe('check');
  });

  it('title matches come first; case and ё do not matter; a|b finds either', () => {
    const { tree, ids } = planted();
    expect(findNodes(tree, 'ОТЧЕТ').map((item) => item.node.id)).toEqual([ids.report]);
    const either = findNodes(tree, 'выписк|округл');
    expect(either.map((item) => item.node.id)).toEqual([ids.round, ids.report]);
    expect(queryParts(' a | |B ')).toEqual(['a', 'b']);
    // An id finds the node itself.
    expect(findNodes(tree, ids.old)[0]!.node.id).toBe(ids.old);
  });

  it('narrows by status and by branch', () => {
    const { tree, ids } = planted();
    expect(findNodes(tree, 'копе', { statuses: ['done'] }).map((item) => item.node.id)).toEqual([ids.old]);
    expect(findNodes(tree, 'копе', { under: ids.money }).map((item) => item.node.id)).toEqual([ids.round]);
  });

  it('a long text is cut around the match', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Длинный', body: `${'слово '.repeat(40)}иголка${' хвост'.repeat(40)}` });
    const hit = findNodes(tree, 'иголка')[0]!.hits[0]!;
    expect(hit.snippet.startsWith('…')).toBe(true);
    expect(hit.snippet.endsWith('…')).toBe(true);
    expect(hit.snippet.length).toBeLessThan(120);
    expect(node.id).toBeTruthy();
  });

  it('the CLI prints a line per node with the status as a word and the matching pieces', async () => {
    const { tree, ids } = planted();
    const sh = treeyardIn(tree.project.dir);
    const res = await sh('find', 'копе');
    expect(res.code).toBe(0);
    const lines = res.stdout.split('\n');
    expect(lines[0]).toBe('«копе» · 3 узла');
    expect(lines[1]).toMatch(new RegExp(`^○ Деньги {2}${ids.money} {2}к работе$`));
    expect(lines[2]).toBe('    описание: Всё про копейки.');
    expect(res.stdout).toMatch(new RegExp(`◐ Округление {2}${ids.round} {2}в работе {2}\\(Деньги\\)`));
    expect(res.stdout).toMatch(
      /✓ Старое {2}\w+ {2}готово\n {4}журнал: \d{4}-\d\d-\d\d \d\d:\d\d Перенёс расчёт копеек/,
    );
    const none = await sh('find', 'нет такого', '--status', 'done');
    expect(none.stdout).toBe('по «нет такого» ничего не нашлось · готово\n');
    const limited = await sh('find', 'копе', '--limit', '1');
    expect(limited.stdout).toContain('… ещё 2');
    const json = JSON.parse((await sh('find', 'копе', '--under', ids.money, '--json')).stdout);
    expect(json).toEqual([
      expect.objectContaining({
        id: ids.round,
        status: 'active',
        path: [],
        hits: [expect.objectContaining({ field: 'done_when' })],
      }),
    ]);
    expect((await sh('find')).code).toBe(2);
  }, 40_000);
});
