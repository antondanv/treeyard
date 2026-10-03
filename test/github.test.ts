import { afterEach, describe, expect, it } from 'vitest';

import {
  boardOf,
  cardOf,
  followStatuses,
  type Gh,
  guessColumns,
  linkBoard,
  parseBoardRef,
  settlePushes,
  statusFor,
  syncBoard,
} from '../src/github.js';
import { addNode, setStatus } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { emptyTree } from './helpers.js';

/** A board in memory, answering the `gh project …` calls treeyard makes. */
function fakeBoard(columns = ['Todo', 'In Progress', 'Review', 'Done']) {
  const options = columns.map((name, i) => ({ id: `opt${i}`, name }));
  const items: { id: string; title: string; status?: string; url?: string }[] = [];
  const calls: string[][] = [];
  let fail = false;
  const run: Gh = async (args) => {
    calls.push(args);
    if (fail) throw new Error('HTTP 502\nmore');
    const [, verb] = args;
    if (verb === 'view') return JSON.stringify({ id: 'PVT_1' });
    if (verb === 'field-list')
      return JSON.stringify({
        fields: [
          { id: 'F_title', name: 'Title' },
          { id: 'F_status', name: 'Status', options },
        ],
      });
    if (verb === 'item-list')
      return JSON.stringify({
        items: items.map((item) => ({
          id: item.id,
          title: item.title,
          ...(item.status ? { status: item.status } : {}),
          content: { type: 'Issue', title: item.title, ...(item.url ? { url: item.url } : {}) },
        })),
      });
    if (verb === 'item-edit') {
      const id = args[args.indexOf('--id') + 1];
      const option = args[args.indexOf('--single-select-option-id') + 1];
      const item = items.find((entry) => entry.id === id)!;
      item.status = options.find((entry) => entry.id === option)!.name;
      return '{}';
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  return {
    run,
    items,
    calls,
    failing: (value: boolean) => {
      fail = value;
    },
  };
}

let unfollow: (() => void) | undefined;
afterEach(() => {
  unfollow?.();
  unfollow = undefined;
});

describe('github board', () => {
  it('reads a board from owner/number or its URL', () => {
    expect(parseBoardRef('antondanv/1')).toEqual({ owner: 'antondanv', number: 1 });
    expect(parseBoardRef('https://github.com/orgs/acme/projects/12/views/3')).toEqual({ owner: 'acme', number: 12 });
    expect(parseBoardRef('antondanv')).toBeUndefined();
  });

  it('guesses which column each status lives in', () => {
    expect(guessColumns(['Todo', 'In Progress', 'Review', 'Done'])).toEqual({
      todo: 'Todo',
      active: 'In Progress',
      review: 'Review',
      done: 'Done',
    });
    expect(guessColumns(['Backlog', 'Ready', 'In progress', 'In review', 'Blocked', 'Done'])).toEqual({
      idea: 'Backlog',
      todo: 'Ready',
      active: 'In progress',
      review: 'In review',
      waiting: 'Blocked',
      done: 'Done',
    });
    // No to-do column: ideas and tasks share the backlog.
    expect(guessColumns(['Backlog', 'Doing', 'Done']).todo).toBe('Backlog');
  });

  it('links the tree to a board and keeps it in tree.md', async () => {
    const tree = emptyTree();
    const parent = addNode(tree, { title: 'С доски' });
    const board = await linkBoard(tree, 'antondanv/1', parent.id, fakeBoard().run);
    expect(board.columns.active).toBe('In Progress');
    const again = boardOf(loadTree(tree.project.dir))!;
    expect(again).toMatchObject({ owner: 'antondanv', number: 1, projectId: 'PVT_1', fieldId: 'F_status' });
    expect(again.parent).toBe(parent.id);
    expect(again.options.Review).toBe('opt2');
    expect(statusFor(again, 'Review')).toBe('review');
    expect(statusFor(again, undefined)).toBe('idea');
  });

  it('brings open cards in once, leaves done cards on the board', async () => {
    const tree = emptyTree();
    const fake = fakeBoard();
    await linkBoard(tree, 'antondanv/1', undefined, fake.run);
    fake.items.push(
      { id: 'I1', title: 'Логин', status: 'Todo', url: 'https://github.com/a/b/issues/1' },
      { id: 'I2', title: 'Оплата', status: 'In Progress' },
      { id: 'I3', title: 'Без колонки' },
      { id: 'I4', title: 'Старое', status: 'Done' },
    );
    const first = await syncBoard(tree, fake.run);
    expect(first.added.map((node) => [node.title, node.status])).toEqual([
      ['Логин', 'todo'],
      ['Оплата', 'active'],
      ['Без колонки', 'idea'],
    ]);
    expect(first.skipped).toBe(1);
    const login = loadTree(tree.project.dir).nodes.get(first.added[0]!.id)!;
    expect(cardOf(login)).toEqual({ item: 'I1', url: 'https://github.com/a/b/issues/1', column: 'Todo' });
    expect(login.body).toContain('https://github.com/a/b/issues/1');

    const second = await syncBoard(loadTree(tree.project.dir), fake.run);
    expect(second.added).toEqual([]);
    expect(second.pulled).toEqual([]);
    expect(second.pushed).toEqual([]);
    expect(loadTree(tree.project.dir).nodes.size).toBe(3);
  });

  it('a card moved on the board moves its node, and is not pushed back', async () => {
    const tree = emptyTree();
    const fake = fakeBoard();
    await linkBoard(tree, 'antondanv/1', undefined, fake.run);
    fake.items.push({ id: 'I1', title: 'Логин', status: 'Todo' });
    const [node] = (await syncBoard(tree, fake.run)).added;
    fake.items[0]!.status = 'Review';
    unfollow = followStatuses(fake.run);
    const result = await syncBoard(tree, fake.run);
    expect(result.pulled.map((item) => item.id)).toEqual([node!.id]);
    expect(await settlePushes()).toEqual([]);
    const after = loadTree(tree.project.dir).nodes.get(node!.id)!;
    expect(after.status).toBe('review');
    expect(cardOf(after)?.column).toBe('Review');
    expect(after.body).toContain('github');
    expect(fake.calls.filter((args) => args[1] === 'item-edit')).toEqual([]);
  });

  it('a status changed in the tree moves the card at once', async () => {
    const tree = emptyTree();
    const fake = fakeBoard();
    await linkBoard(tree, 'antondanv/1', undefined, fake.run);
    fake.items.push({ id: 'I1', title: 'Логин', status: 'Todo' });
    const [node] = (await syncBoard(tree, fake.run)).added;
    unfollow = followStatuses(fake.run);
    setStatus(tree, node!.id, 'active');
    expect(await settlePushes()).toMatchObject([{ column: 'In Progress' }]);
    expect(fake.items[0]!.status).toBe('In Progress');
    expect(cardOf(loadTree(tree.project.dir).nodes.get(node!.id)!)?.column).toBe('In Progress');
    // A status without a column of its own leaves the card where it is.
    setStatus(tree, node!.id, 'waiting', { waiting: 'сервер' });
    expect(await settlePushes()).toEqual([]);
    // A node without a card is none of the board's business.
    const plain = addNode(tree, { title: 'Свой' });
    setStatus(tree, plain.id, 'active');
    expect(await settlePushes()).toEqual([]);
  });

  it('a failed move goes to the journal, and the next sync makes up for it', async () => {
    const tree = emptyTree();
    const fake = fakeBoard();
    await linkBoard(tree, 'antondanv/1', undefined, fake.run);
    fake.items.push({ id: 'I1', title: 'Логин', status: 'Todo' });
    const [node] = (await syncBoard(tree, fake.run)).added;
    unfollow = followStatuses(fake.run);
    fake.failing(true);
    setStatus(tree, node!.id, 'review');
    expect(await settlePushes()).toMatchObject([{ column: 'Review', error: 'HTTP 502' }]);
    const failed = loadTree(tree.project.dir);
    expect(failed.nodes.get(node!.id)!.body).toContain('HTTP 502');
    expect(fake.items[0]!.status).toBe('Todo');

    fake.failing(false);
    const result = await syncBoard(failed, fake.run);
    expect(result.pushed.map((item) => item.id)).toEqual([node!.id]);
    expect(fake.items[0]!.status).toBe('Review');
    expect(loadTree(tree.project.dir).nodes.get(node!.id)!.status).toBe('review');
  });

  it('sync without a board says how to link one', async () => {
    await expect(syncBoard(emptyTree(), fakeBoard().run)).rejects.toThrow('github link');
  });
});
