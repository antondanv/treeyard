import { describe, expect, it } from 'vitest';

import {
  isOwnLine,
  isStatusChange,
  lastOwnEntry,
  parseEntry,
  statusHistory,
  statusSteps,
} from '../src/model/history.js';
import { appendJournal, description, journalEntries, replaceEntry } from '../src/model/journal.js';
import { letterTo } from '../src/model/mail.js';
import { addNode, attachCommit, logToNode, setStatus } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { emptyTree, treeyardIn } from './helpers.js';

const SHA = 'a'.repeat(40);

describe('what the journal says about itself', () => {
  it('tells status changes and lines treeyard writes from what people wrote, in both languages', () => {
    expect(isStatusChange('в работе → на проверке')).toBe(true);
    expect(isStatusChange('к работе → ждёт: сервер')).toBe(true);
    expect(isStatusChange('in review → done. the check passed')).toBe(true);
    expect(isStatusChange('сделал в работе → на проверке')).toBe(false);
    for (const text of [
      'завёл узел',
      `привязан коммит ${SHA}`,
      'картинка добавлена: 001.png',
      'ждёт: X › «Y»',
      'готово. проверка прошла',
      'письмо от «Координатор»: «ответь одним словом»',
      'message to node «Site»: «a reply»',
      'письмо сессии claude 1a2b3c4d: «поправь тест»',
    ])
      expect(isOwnLine(text), text).toBe(true);
    expect(isOwnLine('Сделано: тесты зелёные')).toBe(false);
    expect(parseEntry('2026-11-08 12:19 · агент · итог · с точкой')).toEqual({
      when: '2026-11-08 12:19',
      source: 'агент',
      text: 'итог · с точкой',
    });
  });

  it('takes status changes apart for scripts: who, when, keys of both statuses, the rest as a comment', () => {
    const body = [
      '## Журнал',
      '',
      '- 2026-11-08 12:19 · агент · завёл узел',
      '- 2026-11-08 12:20 · агент · к работе → ждёт: сервер. до пятницы',
      '- 2026-11-09 09:00 · you · waiting → in review',
      '- 2026-11-09 10:00 · ты · готово. проверка прошла',
      '- 2026-11-09 10:05 · ты · на проверке → готово. проверка прошла',
      '- в работе → отказ',
    ].join('\n');
    expect(statusSteps(body)).toEqual([
      { at: '2026-11-08 12:20', who: 'агент', from: 'todo', to: 'waiting', comment: 'сервер. до пятницы' },
      { at: '2026-11-09 09:00', who: 'you', from: 'waiting', to: 'review' },
      { at: '2026-11-09 10:05', who: 'ты', from: 'review', to: 'done', comment: 'проверка прошла' },
      { from: 'active', to: 'dropped' },
    ]);
    expect(statusSteps(body)).toHaveLength(statusHistory(body).length);
  });

  it('the history is the status changes only; the last own entry skips what treeyard wrote', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Узел' }, 'агент');
    const other = addNode(tree, { title: 'Сосед' }, 'агент');
    setStatus(tree, node.id, 'active', { source: 'агент' });
    logToNode(tree, node.id, 'первая', 'агент');
    logToNode(tree, node.id, 'чужая', 'claude');
    attachCommit(tree, node.id, SHA, 'агент');
    // A letter the session sent is written under its name too, yet it is not its entry.
    logToNode(tree, node.id, letterTo(other, 'нужен ключ?', 1), 'агент');
    setStatus(tree, node.id, 'review', { source: 'агент' });
    const body = tree.nodes.get(node.id)!.body;
    expect(statusHistory(body).map((line) => parseEntry(line).text)).toEqual([
      'к работе → в работе',
      'в работе → на проверке',
    ]);
    expect(lastOwnEntry(body, 'агент')?.entry.text).toBe('первая');
    expect(lastOwnEntry(body, 'claude')?.entry.text).toBe('чужая');
    expect(lastOwnEntry(body, 'ты')).toBeUndefined();
  });

  it('replaces one entry and keeps the rest of the body, sections after the journal too', () => {
    let body = appendJournal('Описание', '2026-01-01 10:00 · ты · раз');
    body = appendJournal(body, '2026-01-01 11:00 · ты · два');
    body = `${body}\n## Потом\n\nхвост\n`;
    const fixed = replaceEntry(body, 0, '2026-01-01 10:00 · ты · один');
    expect(journalEntries(fixed)).toEqual(['2026-01-01 10:00 · ты · один', '2026-01-01 11:00 · ты · два']);
    expect(fixed).toContain('## Потом\n\nхвост');
    expect(description(fixed)).toBe('Описание');
  });
});

describe('treeyard log --fix and set note=', () => {
  it('--fix corrects the author’s last entry of their own, keeps its time and the status lines', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Узел', status: 'active' });
    logToNode(tree, node.id, 'итог с опечаткой: 3/4 теста', 'агент');
    setStatus(tree, node.id, 'review', { source: 'агент' });
    const when = parseEntry(journalEntries(tree.nodes.get(node.id)!.body).at(-2)!).when;
    const sh = treeyardIn(tree.project.dir);
    const res = await sh('log', node.id, '--fix', 'итог: 4/4 теста');
    expect(res.code).toBe(0);
    expect(res.stdout).toBe(`${node.id} · запись от ${when} исправлена\n`);
    const entries = journalEntries(loadTree(tree.project.dir).nodes.get(node.id)!.body);
    expect(entries).toEqual([
      `${when} · агент · итог: 4/4 теста`,
      expect.stringContaining('агент · в работе → на проверке'),
    ]);
  }, 40_000);

  it('--fix corrects the entry before a letter the session sent, and leaves the letter as it was', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Узел', status: 'active' });
    const other = addNode(tree, { title: 'Сосед' });
    logToNode(tree, node.id, 'итог с опечаткой', 'агент');
    logToNode(tree, node.id, letterTo(other, 'нужен ключ?', 1), 'агент');
    const [summary, letter] = journalEntries(tree.nodes.get(node.id)!.body).slice(-2);
    const res = await treeyardIn(tree.project.dir)('log', node.id, '--fix', 'итог');
    expect(res.code).toBe(0);
    expect(journalEntries(loadTree(tree.project.dir).nodes.get(node.id)!.body).slice(-2)).toEqual([
      `${parseEntry(summary!).when} · агент · итог`,
      letter,
    ]);
  }, 40_000);

  it('--fix refuses without an own entry and next to --status; nothing changes', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Узел', status: 'active' });
    logToNode(tree, node.id, 'чужая запись', 'claude');
    const before = loadTree(tree.project.dir).nodes.get(node.id)!.body;
    const sh = treeyardIn(tree.project.dir);
    const none = await sh('log', node.id, '--fix', 'новый текст');
    expect(none.code).toBe(2);
    expect(none.stderr).toContain('нет записей «агент»');
    expect((await sh('log', node.id, '--fix', 'текст', '--as', 'claude', '--status', 'review')).code).toBe(2);
    expect(loadTree(tree.project.dir).nodes.get(node.id)!.body).toBe(before);
    // Named author: the entry is theirs to correct.
    expect((await sh('log', node.id, '--fix', 'исправлено', '--as', 'claude')).code).toBe(0);
    expect(journalEntries(loadTree(tree.project.dir).nodes.get(node.id)!.body)[0]).toContain('claude · исправлено');
  }, 40_000);

  it('note= replaces the description and leaves the journal; a journal heading in it is refused', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Узел', body: 'Старое описание' }, 'агент');
    const sh = treeyardIn(tree.project.dir);
    const res = await sh('set', node.id, 'note=Новое описание узла');
    expect(res.code).toBe(0);
    const reread = loadTree(tree.project.dir).nodes.get(node.id)!;
    expect(description(reread.body)).toBe('Новое описание узла');
    expect(journalEntries(reread.body)[0]).toContain('завёл узел');
    const bad = await sh('set', node.id, 'note=текст\n## Журнал\n- подделка');
    expect(bad.code).toBe(2);
    expect(description(loadTree(tree.project.dir).nodes.get(node.id)!.body)).toBe('Новое описание узла');
  }, 40_000);
});
