import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseDocument, stringifyDocument } from '../src/model/frontmatter.js';
import { appendJournal, description, journalEntries } from '../src/model/journal.js';
import {
  addNode,
  attachSession,
  deleteNode,
  indent,
  logToNode,
  moveNode,
  outdent,
  setStatus,
  shift,
  updateNode,
} from '../src/model/ops.js';
import { overviewText } from '../src/model/overview.js';
import { loadTree, nodePath } from '../src/model/store.js';
import { actionable, childrenOf, flatten, heldBy, progress, summarize, waitingNodes } from '../src/model/tree.js';
import { ROOT } from '../src/model/types.js';
import { emptyTree } from './helpers.js';

describe('front matter', () => {
  it('round-trips data and body, dropping empty values', () => {
    const text = stringifyDocument({ id: 'ab12', title: 'Узел: с двоеточием', empty: '', list: [] }, 'Описание\n');
    expect(text).toContain('title: "Узел: с двоеточием"');
    expect(text).not.toContain('empty');
    const doc = parseDocument(text);
    expect(doc.data).toEqual({ id: 'ab12', title: 'Узел: с двоеточием' });
    expect(doc.body.trim()).toBe('Описание');
  });

  it('reads a file without front matter as body only', () => {
    expect(parseDocument('just text')).toEqual({ data: {}, body: 'just text' });
  });
});

describe('journal', () => {
  it('adds a section, then appends to it, keeping what follows', () => {
    let body = 'Описание узла.';
    body = appendJournal(body, 'первое');
    body = appendJournal(body, 'второе');
    expect(journalEntries(body)).toEqual(['первое', 'второе']);
    expect(description(body)).toBe('Описание узла.');

    const withTail = `${body}\n## Потом\n\nхвост\n`;
    const next = appendJournal(withTail, 'третье');
    expect(journalEntries(next)).toEqual(['первое', 'второе', 'третье']);
    expect(next).toContain('## Потом\n\nхвост');
  });
});

describe('tree operations', () => {
  it('adds nodes in order, after a sibling, and persists them', () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'A' });
    const c = addNode(tree, { title: 'C' });
    const b = addNode(tree, { title: 'B', after: a.id });
    expect(childrenOf(tree, ROOT).map((node) => node.title)).toEqual(['A', 'B', 'C']);
    const reread = loadTree(tree.project.dir);
    expect(childrenOf(reread, ROOT).map((node) => node.id)).toEqual([a.id, b.id, c.id]);
    expect(readFileSync(join(tree.project.dir, '.tree', 'README.md'), 'utf8')).toContain('[A](nodes/');
  });

  it('records status changes in the journal, with the reason for waiting', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Деплой' });
    setStatus(tree, node.id, 'waiting', { waiting: 'нет сервера', until: 'появится VPS' });
    expect(node.waiting).toBe('нет сервера');
    expect(journalEntries(node.body).at(-1)).toMatch(/к работе → ждёт: нет сервера/);
    setStatus(tree, node.id, 'done');
    expect(node.waiting).toBeUndefined();
    expect(node.closed).toBeTruthy();
    const text = readFileSync(nodePath(tree.project.dir, node.id), 'utf8');
    expect(text).toContain('status: done');
    expect(text).not.toContain('waiting:');
  });

  it('moves, indents, outdents and shifts like an outliner', () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'A' });
    const b = addNode(tree, { title: 'B' });
    const c = addNode(tree, { title: 'C' });
    indent(tree, b.id);
    expect(b.parent).toBe(a.id);
    indent(tree, c.id);
    expect(c.parent).toBe(a.id);
    shift(tree, c.id, -1);
    expect(childrenOf(tree, a.id).map((node) => node.title)).toEqual(['C', 'B']);
    outdent(tree, c.id);
    expect(childrenOf(tree, ROOT).map((node) => node.title)).toEqual(['A', 'C']);
    expect(() => moveNode(tree, a.id, b.id)).toThrow(/внутрь самого себя/);
  });

  it('deletes a node and lifts its children, or takes them along', () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'A' });
    const kid = addNode(tree, { title: 'kid', parent: a.id });
    deleteNode(tree, a.id);
    expect(tree.nodes.has(a.id)).toBe(false);
    expect(tree.nodes.get(kid.id)?.parent).toBe(ROOT);

    const b = addNode(tree, { title: 'B' });
    const inner = addNode(tree, { title: 'inner', parent: b.id });
    deleteNode(tree, b.id, true);
    expect(tree.nodes.has(inner.id)).toBe(false);
  });

  it('keeps sessions without duplicates and logs them', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'X' });
    attachSession(tree, node.id, { brain: 'claude', id: 's-1', name: 'Тест · X' }, 'новая сессия');
    attachSession(tree, node.id, { brain: 'claude', id: 's-1' });
    expect(node.sessions).toHaveLength(1);
    expect(loadTree(tree.project.dir).nodes.get(node.id)?.sessions[0]).toMatchObject({ brain: 'claude', id: 's-1' });
    logToNode(tree, node.id, 'сделал половину', 'claude');
    expect(journalEntries(node.body).at(-1)).toMatch(/claude · сделал половину/);
    updateNode(tree, node.id, { doneWhen: 'тесты зелёные', who: 'agent' });
    expect(loadTree(tree.project.dir).nodes.get(node.id)).toMatchObject({ doneWhen: 'тесты зелёные', who: 'agent' });
  });
});

describe('questions about the tree', () => {
  it('counts progress over leaves, ignoring ideas and dropped work', () => {
    const tree = emptyTree();
    const stage = addNode(tree, { title: 'Этап' });
    addNode(tree, { title: '1', parent: stage.id, status: 'done' });
    addNode(tree, { title: '2', parent: stage.id });
    addNode(tree, { title: 'идея', parent: stage.id, status: 'idea' });
    addNode(tree, { title: 'нет', parent: stage.id, status: 'dropped' });
    expect(progress(tree, stage.id)).toEqual({ done: 1, total: 2 });
    expect(summarize(tree)).toMatchObject({ done: 1, total: 2, ideas: 1 });
  });

  it('shows what can be done now: open leaves, nothing waiting above them', () => {
    const tree = emptyTree();
    const product = addNode(tree, { title: 'Продукт' });
    const feature = addNode(tree, { title: 'Фича', parent: product.id, status: 'active' });
    const deploy = addNode(tree, { title: 'Публикация' });
    const server = addNode(tree, { title: 'Сервер', parent: deploy.id });
    setStatus(tree, deploy.id, 'waiting', { waiting: 'нет сервера' });
    const ideas = addNode(tree, { title: 'Идеи', status: 'idea' });
    addNode(tree, { title: 'Сторис', parent: ideas.id });

    const now = actionable(tree).map((node) => node.title);
    expect(now).toEqual(['Фича']);
    expect(heldBy(tree, server.id)?.id).toBe(deploy.id);
    expect(waitingNodes(tree).map((node) => node.title)).toEqual(['Публикация']);
    expect(feature.status).toBe('active');
  });

  it('flattens with guides, collapse and a filter that opens the way to matches', () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'Альфа' });
    addNode(tree, { title: 'Бета', parent: a.id });
    const c = addNode(tree, { title: 'Гамма', parent: a.id });
    addNode(tree, { title: 'Дельта', parent: c.id, status: 'done' });

    expect(flatten(tree, { expanded: new Set(), showClosed: true }).map((row) => row.node.title)).toEqual(['Альфа']);
    const open = flatten(tree, { expanded: new Set([a.id, c.id]), showClosed: true });
    expect(open.map((row) => `${row.depth}${row.node.title}`)).toEqual(['0Альфа', '1Бета', '1Гамма', '2Дельта']);
    expect(open[1]?.last).toBe(false);
    expect(open[2]?.last).toBe(true);

    const hidden = flatten(tree, { expanded: new Set([a.id, c.id]), showClosed: false });
    expect(hidden.map((row) => row.node.title)).not.toContain('Дельта');

    const found = flatten(tree, { expanded: new Set(), showClosed: false, filter: 'дельт' });
    expect(found.map((row) => row.node.title)).toEqual(['Альфа', 'Гамма', 'Дельта']);
    expect(found.filter((row) => row.match).map((row) => row.node.title)).toEqual(['Дельта']);
  });

  it('builds a readable overview', () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'Запуск [prod]', who: 'human' });
    setStatus(tree, a.id, 'waiting', { waiting: 'нет сервера' });
    const text = overviewText(tree);
    expect(text).toContain('**Цель:** всё работает');
    expect(text).toContain('‖ [Запуск \\[prod\\]]');
    expect(text).toContain('*ты*');
    expect(text).toContain('ждёт: нет сервера');
  });
});

describe('reading forgives', () => {
  it('loads the rest when one node is broken, and lifts orphans and cycles to the top', () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'A' });
    const b = addNode(tree, { title: 'B', parent: a.id });
    const dir = tree.project.dir;
    writeFileSync(join(dir, '.tree', 'nodes', 'zzzz.md'), '---\ntitle: [broken\n---\n');
    writeFileSync(
      join(dir, '.tree', 'nodes', 'orph.md'),
      '---\nid: orph\ntitle: Сирота\nparent: nope\nstatus: weird\n---\n',
    );
    // A cycle: A under B, B under A.
    const text = readFileSync(nodePath(dir, a.id), 'utf8').replace('parent: root', `parent: ${b.id}`);
    writeFileSync(nodePath(dir, a.id), text);

    const reread = loadTree(dir);
    expect(reread.nodes.get('orph')).toMatchObject({ parent: ROOT, status: 'todo' });
    expect(reread.problems.join('\n')).toMatch(/zzzz\.md/);
    expect(reread.problems.join('\n')).toMatch(/неизвестный статус/);
    expect(reread.problems.join('\n')).toMatch(/круг/);
    const top = childrenOf(reread, ROOT).map((node) => node.id);
    expect(top.some((id) => id === a.id || id === b.id)).toBe(true);
  });
});
