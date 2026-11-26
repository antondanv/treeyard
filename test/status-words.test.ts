import { describe, expect, it } from 'vitest';

import { contextText } from '../src/agents/context.js';
import { addNode } from '../src/model/ops.js';
import { parseStatus, parseStatuses, UnknownStatus } from '../src/model/status-words.js';
import { loadTree } from '../src/model/store.js';
import { emptyTree, treeyardIn } from './helpers.js';

describe('statuses as words', () => {
  it('a status by its key, its label in either language, an alias or the glyph', () => {
    expect(parseStatus('review')).toBe('review');
    expect(parseStatus('на проверке')).toBe('review');
    expect(parseStatus('In Review')).toBe('review');
    expect(parseStatus('in-review')).toBe('review');
    expect(parseStatus('проверка')).toBe('review');
    expect(parseStatus('◎')).toBe('review');
    expect(parseStatus('wip')).toBe('active');
    expect(parseStatus('in_progress')).toBe('active');
    expect(parseStatus('в работе')).toBe('active');
    expect(parseStatus('ждет')).toBe('waiting');
    expect(parseStatus('к работе')).toBe('todo');
    expect(parseStatus('идеи')).toBe('idea');
    expect(parseStatus('отказ')).toBe('dropped');
    expect(parseStatus('✓')).toBe('done');
    expect(parseStatus('soon')).toBeUndefined();
  });

  it('a list: commas or bars, each status once, an unknown word named', () => {
    expect(parseStatuses('review,idea')).toEqual(['review', 'idea']);
    expect(parseStatuses('на проверке | идея, review')).toEqual(['review', 'idea']);
    expect(() => parseStatuses('review,soon')).toThrow(UnknownStatus);
    expect(() => parseStatuses(' , ')).toThrow(UnknownStatus);
  });

  it('the CLI takes aliases where it takes a status, and names the choices otherwise', async () => {
    const tree = emptyTree();
    const sh = treeyardIn(tree.project.dir);
    const added = await sh('add', 'Через алиас', '--status', 'wip');
    const id = added.stdout.trim();
    expect(loadTree(tree.project.dir).nodes.get(id)!.status).toBe('active');
    const set = await sh('set', id, 'status=проверка');
    expect(set.stdout).toContain('на проверке');
    const bad = await sh('set', id, 'status=soon');
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('review (на проверке)');
  }, 40_000);

  it('off a terminal tree lines carry the status as a word', async () => {
    const tree = emptyTree();
    const parent = addNode(tree, { title: 'Ветка', status: 'active' });
    addNode(tree, { title: 'Внутри', parent: parent.id, status: 'review' });
    addNode(tree, { title: 'Стоит', parent: parent.id, status: 'waiting', waiting: 'сервер' });
    const sh = treeyardIn(tree.project.dir);
    const whole = (await sh('show')).stdout;
    expect(whole).toMatch(new RegExp(`◐ Ветка {2}${parent.id} {2}в работе`));
    expect(whole).toMatch(/◎ Внутри {2}\w+ {2}на проверке/);
    // A waiting node keeps one «waiting», with its reason.
    expect(whole).toMatch(/Стоит {2}\w+ {2}ждёт: сервер/);
    expect((await sh('show', parent.id)).stdout).toMatch(/◎ Внутри {2}\w+ {2}на проверке/);
  }, 40_000);

  it('the context names the neighbours’ statuses in words', () => {
    const tree = emptyTree();
    const parent = addNode(tree, { title: 'Ветка' });
    const node = addNode(tree, { title: 'Узел', parent: parent.id });
    const sibling = addNode(tree, { title: 'Сосед', parent: parent.id, status: 'review' });
    expect(contextText(tree, node.id)).toContain(`Соседи: ◎ Сосед (${sibling.id}, на проверке)`);
  });
});
