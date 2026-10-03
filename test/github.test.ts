import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import {
  boardOf,
  cardOf,
  connectRepo,
  createBoard,
  ensureHub,
  followStatuses,
  type Gh,
  ghReady,
  ghState,
  guessColumns,
  linkBoard,
  listBoards,
  offerShown,
  parseBoardRef,
  parseRepoUrl,
  repoOf,
  setOffer,
  settlePushes,
  statusFor,
  syncBoard,
} from '../src/github.js';
import { addNode, setStatus } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { emptyTree, tempDir } from './helpers.js';

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
    // Three cards and the GitHub node they went into.
    expect(loadTree(tree.project.dir).nodes.size).toBe(4);
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

describe('connecting github', () => {
  it('reads gh: missing, logged out, without the project scope, ready', async () => {
    const missing: Gh = async () => {
      throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
    };
    expect(await ghState(missing)).toEqual({ installed: false });
    const out: Gh = async () => {
      throw Object.assign(new Error('gh: To get started with GitHub CLI, please run:  gh auth login'), { code: 4 });
    };
    expect(ghReady(await ghState(out))).toBe(false);
    const noScope: Gh = async () => 'HTTP/2.0 200 OK\r\nX-Oauth-Scopes: repo, gist\r\n\r\n{"login":"anton"}';
    const state = await ghState(noScope);
    expect(state).toEqual({ installed: true, user: 'anton', scopes: ['repo', 'gist'] });
    expect(ghReady(state)).toBe(false);
    const ready: Gh = async () => 'HTTP/2.0 200 OK\r\nX-Oauth-Scopes: repo, project\r\n\r\n{"login":"anton"}';
    expect(ghReady(await ghState(ready))).toBe(true);
    // A fine-grained token has no scopes header: gh's own errors will say what is missing.
    expect(ghReady(await ghState(async () => 'HTTP/2.0 200 OK\r\n\r\n{"login":"anton"}'))).toBe(true);
  });

  it('finds the repository in git remotes and connects a chosen one', () => {
    expect(parseRepoUrl('git@github.com:antondanv/brainyard.git')).toEqual({ owner: 'antondanv', name: 'brainyard' });
    expect(parseRepoUrl('https://github.com/antondanv/SMHUB')).toEqual({ owner: 'antondanv', name: 'SMHUB' });
    expect(parseRepoUrl('https://gitlab.com/a/b.git')).toBeUndefined();
    const dir = tempDir();
    expect(repoOf(dir)).toBeUndefined();
    // No git yet: connecting makes one and adds origin.
    expect(connectRepo(dir, 'antondanv/treeyard')).toEqual({ owner: 'antondanv', name: 'treeyard' });
    expect(repoOf(dir)).toEqual({ owner: 'antondanv', name: 'treeyard' });
    // Origin taken by another host: the GitHub one goes next to it.
    const other = tempDir();
    spawnSync('git', ['init'], { cwd: other });
    spawnSync('git', ['remote', 'add', 'origin', 'https://gitlab.com/a/b.git'], { cwd: other });
    connectRepo(other, 'antondanv/b');
    expect(spawnSync('git', ['remote', 'get-url', 'github'], { cwd: other, encoding: 'utf8' }).stdout.trim()).toBe(
      'https://github.com/antondanv/b.git',
    );
    expect(repoOf(other)).toEqual({ owner: 'antondanv', name: 'b' });
  });

  it('lists open boards and creates one linked to the repository', async () => {
    const calls: string[][] = [];
    const run: Gh = async (args) => {
      calls.push(args);
      if (args[1] === 'list')
        return JSON.stringify({
          projects: [
            { number: 1, title: 'Delivery', closed: false },
            { number: 2, title: 'Old', closed: true },
          ],
        });
      if (args[1] === 'create') return JSON.stringify({ number: 3 });
      return '{}';
    };
    expect(await listBoards('anton', run)).toEqual([{ number: 1, title: 'Delivery', owner: 'anton' }]);
    expect(await createBoard({ owner: 'anton', name: 'app' }, 'app', run)).toEqual({
      number: 3,
      title: 'app',
      owner: 'anton',
    });
    expect(calls.at(-1)).toEqual(['project', 'link', '3', '--owner', 'anton', '--repo', 'anton/app']);
  });

  it('the offer shows until there is a GitHub node or a board, and can be hidden', async () => {
    const tree = emptyTree();
    expect(offerShown(tree)).toBe(true);
    setOffer(tree, false);
    expect(loadTree(tree.project.dir).project.extra.github).toBe('off');
    expect(offerShown(loadTree(tree.project.dir))).toBe(false);
    setOffer(tree, true);
    expect(offerShown(loadTree(tree.project.dir))).toBe(true);
    const hub = ensureHub(tree);
    expect(ensureHub(tree).id).toBe(hub.id);
    expect(offerShown(tree)).toBe(false);
    // Linking without --parent puts the cards into that node.
    const board = await linkBoard(tree, 'antondanv/1', undefined, fakeBoard().run);
    expect(board.parent).toBe(hub.id);
  });

  it('linking with no GitHub node makes one at the top', async () => {
    const tree = emptyTree();
    const board = await linkBoard(tree, 'antondanv/1', undefined, fakeBoard().run);
    const hub = loadTree(tree.project.dir).nodes.get(board.parent!)!;
    expect(hub).toMatchObject({ title: 'GitHub', parent: 'root' });
    expect(hub.extra.github).toBe('hub');
  });
});
