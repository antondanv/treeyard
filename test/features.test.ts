import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { json, splitPrompt } from '../src/agents/assist.js';
import { runCheck } from '../src/agents/check.js';
import { activity } from '../src/model/activity.js';
import { addNode, logToNode, setStatus } from '../src/model/ops.js';
import { loadTree, nodePath } from '../src/model/store.js';
import { fuzzyScore } from '../src/tui/dialogs.js';
import { History } from '../src/tui/history.js';
import { emptyTree } from './helpers.js';

describe('undo', () => {
  it('puts back what a change did: edits, new files, deleted files', () => {
    const tree = emptyTree();
    const history = new History(tree.project.dir);
    const node = history.record('add', () => addNode(tree, { title: 'A' }));
    history.record('done', () => setStatus(tree, node.id, 'done'));
    expect(loadTree(tree.project.dir).nodes.get(node.id)?.status).toBe('done');
    expect(history.undo()?.label).toBe('done');
    expect(loadTree(tree.project.dir).nodes.get(node.id)?.status).toBe('todo');
    expect(history.undo()?.label).toBe('add');
    expect(loadTree(tree.project.dir).nodes.has(node.id)).toBe(false);
    expect(history.undo()).toBeUndefined();
  });

  it('leaves alone a file someone changed after us', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'A' });
    const history = new History(tree.project.dir);
    history.record('done', () => setStatus(tree, node.id, 'done'));
    // An agent writes to the same node afterwards.
    const path = nodePath(tree.project.dir, node.id);
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n- агент дописал\n`);
    expect(history.undo()).toEqual({ label: 'done', skipped: 1 });
    expect(readFileSync(path, 'utf8')).toContain('агент дописал');
  });

  it('does not remember a change that changed nothing', () => {
    const tree = emptyTree();
    const history = new History(tree.project.dir);
    history.record('nothing', () => undefined);
    expect(history.size).toBe(0);
  });
});

describe('activity', () => {
  it('collects journal lines of all nodes, newest first', () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'A' });
    const b = addNode(tree, { title: 'B' });
    a.body = '## Журнал\n\n- 2026-10-01 10:00 · ты · первое\n- 2026-10-02 09:00 · claude · третье\n';
    b.body = '## Журнал\n\n- 2026-10-01 12:30 · codex · второе\n- просто строка без даты\n';
    const events = activity(tree);
    expect(events.map((event) => event.text)).toEqual(['третье', 'второе', 'первое']);
    expect(events[0]).toMatchObject({ who: 'claude', when: '2026-10-02 09:00' });
    logToNode(tree, b.id, 'сейчас');
    expect(activity(tree)[0]?.text).toBe('сейчас');
  });
});

describe('palette search', () => {
  it('needs every word, in any order; scattered letters do not count', () => {
    expect(fuzzyScore('Человек со стороны проходит мастер', 'мастер')).toBeGreaterThan(0);
    expect(fuzzyScore('Настоящие метрики настоящего канала', 'мастер')).toBe(-1);
    expect(fuzzyScore('Установка с нуля на чистой машине', 'чист устан')).toBeGreaterThan(0);
    expect(fuzzyScore('Claude Code по узлу', 'claude')).toBeGreaterThan(fuzzyScore('Открыть в Claude', 'claude'));
  });
});

describe('agent proposals', () => {
  it('reads JSON out of an answer with prose around it', () => {
    expect(json('Вот:\n```json\n{"children": [{"title": "A"}]}\n```\nГотово.')).toEqual({ children: [{ title: 'A' }] });
    expect(json('{"done_when": "x"}')).toEqual({ done_when: 'x' });
    expect(() => json('нет тут ничего')).toThrow(/нет JSON/);
  });

  it('asks for steps with the node context and without repeating existing children', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Оплата', doneWhen: 'платёж проходит' });
    addNode(tree, { title: 'Выбрать эквайринг', parent: node.id });
    const prompt = splitPrompt(tree, node.id);
    expect(prompt).toContain('Твой узел: Оплата');
    expect(prompt).toContain('- Выбрать эквайринг');
    expect(prompt).toContain('"children"');
  });
});

describe('check', () => {
  it('runs the command in the project folder and reports the code and the output', async () => {
    const tree = emptyTree();
    const ok = await runCheck('echo hello && pwd', tree.project.dir);
    expect(ok).toMatchObject({ ok: true, code: 0, timedOut: false });
    expect(ok.output).toContain('hello');
    const bad = await runCheck('echo nope >&2; exit 3', tree.project.dir);
    expect(bad).toMatchObject({ ok: false, code: 3 });
    expect(bad.output).toContain('nope');
  });
});
