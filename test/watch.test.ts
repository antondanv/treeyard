import { spawn } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { watchLine } from '../src/cli/print.js';
import { replaceEntry } from '../src/model/journal.js';
import { NODE_VAR } from '../src/model/notes.js';
import { addNode, deleteNode, logToNode, setStatus, updateNode } from '../src/model/ops.js';
import { loadTree, nodePath, writeNode, writeProject } from '../src/model/store.js';
import type { Tree } from '../src/model/types.js';
import { readSnapshot, type TreeEvent, treeEvents, watchTree } from '../src/watch.js';
import { emptyTree, tempDir, treeyardIn } from './helpers.js';

const NOW = '2026-11-12T12:00:00+03:00';
const OLD = '2026-01-01T10:00:00+03:00';

/** A node whose `updated` is long past, so a change that writes it shows a new time. */
function oldNode(tree: Tree, title: string, parent?: string) {
  const node = addNode(tree, { title, ...(parent ? { parent } : {}) }, 'агент');
  node.updated = OLD;
  writeNode(tree.project.dir, node, false);
  return node;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function until(check: () => boolean, timeout = 10_000): Promise<void> {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(25);
  }
}

describe('treeEvents', () => {
  it('a status change: from, to, at, who, and the journal lines that came with it', () => {
    const tree = emptyTree();
    const dir = tree.project.dir;
    const node = oldNode(tree, 'Узел');
    const before = readSnapshot(dir);
    setStatus(tree, node.id, 'active', { source: 'claude' });
    const after = readSnapshot(dir, before);
    const events = treeEvents(before, after, NOW);
    expect(events).toHaveLength(1);
    const updated = loadTree(dir).nodes.get(node.id)!.updated;
    expect(events[0]).toMatchObject({
      type: 'status',
      id: node.id,
      at: updated,
      title: 'Узел',
      status: 'active',
      from: 'todo',
      to: 'active',
      who: 'claude',
      history: [{ who: 'claude', from: 'todo', to: 'active' }],
    });
    expect(events[0]!.at).not.toBe(OLD);
    expect(events[0]!.fields).toEqual(expect.arrayContaining(['status', 'journal']));
    expect(events[0]!.journal).toEqual([expect.objectContaining({ who: 'claude', text: 'к работе → в работе' })]);
  });

  it('several steps at once: from and to are the net change, history has each step', () => {
    const tree = emptyTree();
    const node = oldNode(tree, 'Узел');
    const before = readSnapshot(tree.project.dir);
    setStatus(tree, node.id, 'active', { source: 'claude' });
    logToNode(tree, node.id, 'сделал', 'claude');
    setStatus(tree, node.id, 'review', { source: 'claude' });
    const [event] = treeEvents(before, readSnapshot(tree.project.dir), NOW);
    expect(event).toMatchObject({ type: 'status', from: 'todo', to: 'review', who: 'claude' });
    expect(event!.history!.map((step) => step.to)).toEqual(['active', 'review']);
    expect(event!.journal!.map((entry) => entry.text)).toEqual([
      'к работе → в работе',
      'сделал',
      'в работе → на проверке',
    ]);
  });

  it('a new journal entry, another edit, a corrected entry', () => {
    const tree = emptyTree();
    const dir = tree.project.dir;
    const a = oldNode(tree, 'Журнал');
    const b = oldNode(tree, 'Правка');
    const c = oldNode(tree, 'Исправление');
    const before = readSnapshot(dir);
    logToNode(tree, a.id, 'что сделано; что осталось', 'агент');
    updateNode(tree, b.id, { title: 'Правка 2', doneWhen: 'видно на экране', description: 'зачем' });
    updateNode(tree, c.id, { body: replaceEntry(c.body, 0, 'исправленная строка') });
    const events = treeEvents(before, readSnapshot(dir, before), NOW);
    const by = new Map(events.map((event) => [event.id, event]));
    expect(by.get(a.id)).toMatchObject({
      type: 'journal',
      status: 'todo',
      journal: [{ who: 'агент', text: 'что сделано; что осталось' }],
    });
    expect(by.get(b.id)).toMatchObject({ type: 'changed', title: 'Правка 2' });
    expect(by.get(b.id)!.fields).toEqual(['title', 'done_when', 'updated', 'note']);
    // A rewritten line is a change of the journal, not a new entry.
    expect(by.get(c.id)).toMatchObject({ type: 'changed', fields: ['updated', 'journal'] });
    expect(by.get(c.id)!.journal).toBeUndefined();
  });

  it('added (a parent before its child), removed, the root; nothing for a file rewritten as it was', () => {
    const tree = emptyTree();
    const dir = tree.project.dir;
    const gone = oldNode(tree, 'Уйдёт');
    const same = oldNode(tree, 'Тот же');
    const before = readSnapshot(dir);
    const parent = addNode(tree, { title: 'Родитель' }, 'агент');
    const child = addNode(tree, { title: 'Ребёнок', parent: parent.id, status: 'idea' }, 'агент');
    deleteNode(tree, gone.id);
    writeNode(dir, tree.nodes.get(same.id)!, false);
    tree.project.goal = 'новая цель';
    writeProject(tree.project);
    const events = treeEvents(before, readSnapshot(dir, before), NOW);
    // Root, the new parent, its new child, the gone node; nothing for the one rewritten as it was.
    expect(events.map((event) => `${event.type} ${event.id}`)).toEqual([
      'changed root',
      `added ${parent.id}`,
      `added ${child.id}`,
      `removed ${gone.id}`,
    ]);
    expect(events[0]).toEqual({ type: 'changed', id: 'root', at: NOW, title: 'Тест', fields: ['goal'] });
    expect(events.find((event) => event.id === child.id)).toMatchObject({
      at: NOW,
      title: 'Ребёнок',
      status: 'idea',
      parent: parent.id,
      journal: [{ who: 'агент', text: 'завёл узел' }],
    });
    expect(events.at(-1)).toEqual({
      type: 'removed',
      id: gone.id,
      at: NOW,
      title: 'Уйдёт',
      status: 'todo',
      parent: 'root',
    });
  });

  it('a file that cannot be read keeps its last state: changed, not gone', () => {
    const tree = emptyTree();
    const dir = tree.project.dir;
    const node = oldNode(tree, 'Узел');
    const before = readSnapshot(dir);
    writeFileSync(nodePath(dir, node.id), '---\nid: [не закрыта\n---\n');
    const half = readSnapshot(dir, before);
    expect(treeEvents(before, half, NOW)).toEqual([]);
    // The tree in memory still has the node: writing it repairs the file.
    setStatus(tree, node.id, 'active');
    expect(treeEvents(half, readSnapshot(dir, half), NOW)).toEqual([
      expect.objectContaining({ type: 'status', id: node.id, from: 'todo', to: 'active' }),
    ]);
  });
});

describe('watchTree', () => {
  it('a burst of writes to many files gives one event per node', async () => {
    const tree = emptyTree();
    const dir = tree.project.dir;
    const nodes = ['Первый', 'Второй', 'Третий', 'Четвёртый'].map((title) => oldNode(tree, title));
    const [first, ...rest] = nodes;
    const events: TreeEvent[] = [];
    const flushes: number[] = [];
    const watcher = watchTree(
      dir,
      (batch) => {
        flushes.push(batch.length);
        events.push(...batch);
      },
      { quiet: 400, maxWait: 5000, poll: 100 },
    );
    try {
      // Each write comes before the files go quiet: the node of three writes is still one event.
      const writes = [
        () => setStatus(tree, first!.id, 'active', { source: 'claude' }),
        () => logToNode(tree, first!.id, 'сделал', 'claude'),
        ...rest.map((node) => () => logToNode(tree, node.id, 'запись', 'агент')),
        () => setStatus(tree, first!.id, 'review', { source: 'claude' }),
        () => addNode(tree, { title: 'Новый' }, 'агент'),
      ];
      for (const write of writes) {
        write();
        await sleep(20);
      }
      await until(() => events.length >= 5);
      await sleep(600);
      expect(events).toHaveLength(5);
      expect(new Set(events.map((event) => event.id)).size).toBe(5);
      expect(events.find((event) => event.id === first!.id)).toMatchObject({
        type: 'status',
        from: 'todo',
        to: 'review',
      });
      for (const node of rest) expect(events.find((event) => event.id === node.id)).toMatchObject({ type: 'journal' });
      expect(events.filter((event) => event.type === 'added')).toHaveLength(1);
      expect(flushes).toEqual([5]);

      // A later change is a new event.
      updateNode(tree, rest[0]!.id, { title: 'Переименован' });
      await until(() => events.length === 6);
      expect(events[5]).toMatchObject({ type: 'changed', id: rest[0]!.id, title: 'Переименован' });
    } finally {
      watcher.stop();
    }
  });
});

describe('watchLine', () => {
  const plain = {
    on: false,
    c: (_: string, text: string) => text,
    dim: (text: string) => text,
    bold: (text: string) => text,
  };
  const at = '2026-11-12T12:34:56+03:00';
  const local = new Date(at).toTimeString().slice(0, 8);

  it('says what happened to the node, in a line', () => {
    const base = { id: 'k3f9', at, title: 'Узел', status: 'review' as const };
    expect(watchLine({ ...base, type: 'status', from: 'active', to: 'review', who: 'claude' }, plain)).toBe(
      `${local}  ◎ Узел  k3f9  в работе → на проверке · claude`,
    );
    expect(watchLine({ ...base, type: 'added' }, plain)).toBe(`${local}  ◎ Узел  k3f9  добавлен`);
    expect(watchLine({ ...base, type: 'removed' }, plain)).toBe(`${local}  ◎ Узел  k3f9  удалён`);
    expect(watchLine({ ...base, type: 'journal', journal: [{ who: 'агент', text: 'итог' }] }, plain)).toBe(
      `${local}  ◎ Узел  k3f9  запись: агент · итог`,
    );
    expect(
      watchLine({ ...base, type: 'journal', journal: [{ text: 'раз' }, { who: 'агент', text: 'два' }] }, plain),
    ).toBe(`${local}  ◎ Узел  k3f9  записей: 2, последняя: агент · два`);
    expect(watchLine({ type: 'changed', id: 'root', at, title: 'Проект', fields: ['goal'] }, plain)).toBe(
      `${local}  ◆ Проект  root  изменено: goal`,
    );
  });
});

const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

describe('treeyard watch', () => {
  it('--json: a ready line, then a JSON line per change; Ctrl+C ends it with 0', async () => {
    const tree = emptyTree();
    const dir = tree.project.dir;
    const node = oldNode(tree, 'Узел');
    const env: NodeJS.ProcessEnv = { ...process.env, TREEYARD_HOME: tempDir('treeyard-home-'), NO_COLOR: '1' };
    delete env[NODE_VAR];
    delete env.CLAUDE_CODE_SESSION_ID;
    delete env.FORCE_COLOR;
    const child = spawn(process.execPath, ['--import', tsx, cli, 'watch', '--json'], { cwd: dir, env });
    const lines: string[] = [];
    let buffer = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const parts = buffer.split('\n');
      buffer = parts.pop()!;
      lines.push(...parts);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exit = new Promise<number | null>((done) => child.on('exit', (code) => done(code)));
    try {
      await until(() => lines.length > 0, 20_000);
      expect(JSON.parse(lines[0]!)).toMatchObject({
        type: 'ready',
        version: 1,
        dir: realpathSync(dir),
        at: expect.any(String),
      });

      setStatus(tree, node.id, 'review', { source: 'claude' });
      await until(() => lines.length > 1);
      logToNode(tree, node.id, 'итог', 'агент');
      await until(() => lines.length > 2);
      const [status, entry] = lines.slice(1).map((line) => JSON.parse(line) as TreeEvent);
      expect(status).toMatchObject({ type: 'status', id: node.id, from: 'todo', to: 'review', who: 'claude' });
      expect(Date.parse(status!.at)).toBeGreaterThan(Date.parse(OLD));
      expect(entry).toMatchObject({ type: 'journal', id: node.id, journal: [{ who: 'агент', text: 'итог' }] });
    } finally {
      child.kill('SIGINT');
    }
    expect(await exit).toBe(0);
    expect(stderr).toBe('');
  }, 40_000);

  it('takes no arguments and needs a tree', async () => {
    const tree = emptyTree();
    const extra = await treeyardIn(tree.project.dir)('watch', 'k3f9');
    expect(extra.code).toBe(2);
    expect(extra.stderr).toContain('treeyard watch [--json] [--project <папка>]');
    const none = await treeyardIn(tempDir())('watch', '--json');
    expect(none.code).toBe(2);
    expect(none.stderr).toContain('здесь нет дерева');
  }, 40_000);
});
