import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import {
  boardOf,
  cardOf,
  connectRepo,
  createBoard,
  createRepo,
  ensureHub,
  followStatuses,
  type Gh,
  ghReady,
  ghState,
  guessColumns,
  issueOf,
  linkBoard,
  linkedRepo,
  linkRepo,
  listBoards,
  offerShown,
  parseBoardRef,
  parseRepoRef,
  parseRepoUrl,
  repoExists,
  repoOf,
  setOffer,
  settlePushes,
  statusFor,
  syncBoard,
  syncIssues,
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

/** A repository in memory, answering the `gh repo view` and `gh issue …` calls treeyard makes. */
function fakeRepo(repo = 'anton/app') {
  const issues: { number: number; title: string; state: 'OPEN' | 'CLOSED'; reason?: string }[] = [];
  const calls: string[][] = [];
  let fail = false;
  const url = (number: number) => `https://github.com/${repo}/issues/${number}`;
  const find = (args: string[]) => issues.find((issue) => issue.number === Number(args[2]));
  const run: Gh = async (args) => {
    calls.push(args);
    if (fail) throw new Error('HTTP 502\nmore');
    if (args[0] === 'repo' && args[1] === 'view') {
      if (args[2] !== repo) throw new Error(`GraphQL: Could not resolve to a Repository with the name '${args[2]}'.`);
      return '{"name":"app"}';
    }
    expect(args.slice(args.indexOf('-R'), args.indexOf('-R') + 2)).toEqual(['-R', repo]);
    if (args[1] === 'list')
      return JSON.stringify(
        issues
          .filter((issue) => issue.state === 'OPEN')
          .map((issue) => ({ number: issue.number, title: issue.title, url: url(issue.number) })),
      );
    const issue = find(args);
    if (!issue)
      throw new Error(`GraphQL: Could not resolve to an issue or pull request with the number of ${args[2]}.`);
    if (args[1] === 'view') return JSON.stringify({ state: issue.state, stateReason: issue.reason ?? '' });
    if (args[1] === 'close') {
      issue.state = 'CLOSED';
      issue.reason = args.includes('not planned') ? 'NOT_PLANNED' : 'COMPLETED';
      return '';
    }
    if (args[1] === 'reopen') {
      issue.state = 'OPEN';
      issue.reason = 'REOPENED';
      return '';
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  const open = (number: number, title: string) => issues.push({ number, title, state: 'OPEN' });
  return {
    run,
    issues,
    calls,
    open,
    url,
    issue: (number: number) => issues.find((issue) => issue.number === number)!,
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

describe('github issues', () => {
  it('reads a repository from owner/name or its URL, and not a board', () => {
    expect(parseRepoRef('anton/app')).toEqual({ owner: 'anton', name: 'app' });
    expect(parseRepoRef('https://github.com/anton/app/issues')).toEqual({ owner: 'anton', name: 'app' });
    expect(parseRepoRef('https://github.com/anton/app.git')).toEqual({ owner: 'anton', name: 'app' });
    expect(parseRepoRef('anton/1')).toBeUndefined();
    expect(parseRepoRef('https://github.com/users/anton/projects/1')).toBeUndefined();
  });

  it('links the tree to a repository next to a board, and to one GitHub has', async () => {
    const tree = emptyTree();
    const board = await linkBoard(tree, 'anton/1', undefined, fakeBoard().run);
    const repo = fakeRepo();
    expect(await linkRepo(tree, 'anton/app', undefined, repo.run)).toEqual({ owner: 'anton', name: 'app' });
    const again = loadTree(tree.project.dir);
    expect(linkedRepo(again)).toEqual({ owner: 'anton', name: 'app' });
    // The board stays, and issues go where the cards go.
    expect(boardOf(again)).toMatchObject({ owner: 'anton', number: 1, parent: board.parent });
    // Linking the board again keeps the repository.
    await linkBoard(again, 'anton/1', undefined, fakeBoard().run);
    expect(linkedRepo(loadTree(tree.project.dir))).toEqual({ owner: 'anton', name: 'app' });
    await expect(linkRepo(emptyTree(), 'anton/nope', undefined, repo.run)).rejects.toThrow('anton/nope');
    expect(offerShown(again)).toBe(false);
  });

  it('brings open issues in once, as ideas', async () => {
    const tree = emptyTree();
    const repo = fakeRepo();
    await linkRepo(tree, 'anton/app', undefined, repo.run);
    // gh gives the newest first.
    repo.open(2, 'Тёмная тема');
    repo.open(1, 'Падает вход');
    const first = await syncIssues(tree, repo.run);
    expect(first.added.map((node) => [node.title, node.status])).toEqual([
      ['Падает вход', 'idea'],
      ['Тёмная тема', 'idea'],
    ]);
    const login = loadTree(tree.project.dir).nodes.get(first.added[0]!.id)!;
    expect(issueOf(login)).toEqual({ number: 1, url: repo.url(1), state: 'open' });
    expect(login.body).toContain(repo.url(1));
    expect(login.parent).toBe((loadTree(tree.project.dir).project.extra.github as { parent: string }).parent);

    const second = await syncIssues(loadTree(tree.project.dir), repo.run);
    expect(second).toMatchObject({ added: [], pulled: [], pushed: [], failed: [] });
    // Two issues and the GitHub node they went into; nothing asked about issues that are open.
    expect(loadTree(tree.project.dir).nodes.size).toBe(3);
    expect(repo.calls.filter((args) => args[1] === 'view' && args[0] === 'issue')).toEqual([]);
  });

  it('an issue closed on GitHub closes its node, as done or dropped, and is not closed back', async () => {
    const tree = emptyTree();
    const repo = fakeRepo();
    await linkRepo(tree, 'anton/app', undefined, repo.run);
    repo.open(1, 'Сделали');
    repo.open(2, 'Не будем');
    const [done, dropped] = (await syncIssues(tree, repo.run)).added;
    repo.issue(1).state = 'CLOSED';
    repo.issue(1).reason = 'COMPLETED';
    repo.issue(2).state = 'CLOSED';
    repo.issue(2).reason = 'NOT_PLANNED';
    unfollow = followStatuses(repo.run);
    const result = await syncIssues(tree, repo.run);
    expect(result.pulled.map((node) => node.id)).toEqual([done!.id, dropped!.id]);
    expect(await settlePushes()).toEqual([]);
    const after = loadTree(tree.project.dir);
    expect(after.nodes.get(done!.id)!.status).toBe('done');
    expect(after.nodes.get(dropped!.id)!.status).toBe('dropped');
    expect(issueOf(after.nodes.get(done!.id)!)?.state).toBe('closed');
    expect(after.nodes.get(done!.id)!.body).toContain('github');
    expect(repo.calls.filter((args) => args[1] === 'close')).toEqual([]);

    // Closed on both sides: the next sync does not ask about it again.
    const views = repo.calls.length;
    await syncIssues(after, repo.run);
    expect(repo.calls.length - views).toBe(1);

    // Reopened on GitHub: the node is back to work.
    repo.issue(1).state = 'OPEN';
    const reopened = await syncIssues(loadTree(tree.project.dir), repo.run);
    expect(reopened.pulled.map((node) => [node.id, node.status])).toEqual([[done!.id, 'todo']]);
  });

  it('a node done in the tree closes its issue at once; dropped closes it as not planned', async () => {
    const tree = emptyTree();
    const repo = fakeRepo();
    await linkRepo(tree, 'anton/app', undefined, repo.run);
    repo.open(1, 'Вход');
    repo.open(2, 'Лишнее');
    const [one, two] = (await syncIssues(tree, repo.run)).added;
    unfollow = followStatuses(repo.run);
    // Review does not close it: done is the person's word.
    setStatus(tree, one!.id, 'review');
    expect(await settlePushes()).toEqual([]);
    setStatus(tree, one!.id, 'done');
    expect(await settlePushes()).toMatchObject([{ text: 'issue #1 закрыта' }]);
    expect(repo.issue(1)).toMatchObject({ state: 'CLOSED', reason: 'COMPLETED' });
    expect(issueOf(loadTree(tree.project.dir).nodes.get(one!.id)!)?.state).toBe('closed');
    setStatus(tree, two!.id, 'dropped');
    await settlePushes();
    expect(repo.issue(2)).toMatchObject({ state: 'CLOSED', reason: 'NOT_PLANNED' });
    // Back to work in the tree: the issue opens again.
    setStatus(tree, one!.id, 'active');
    expect(await settlePushes()).toMatchObject([{ text: 'issue #1 открыта снова' }]);
    expect(repo.issue(1).state).toBe('OPEN');
    // And sync has nothing to add.
    const result = await syncIssues(loadTree(tree.project.dir), repo.run);
    expect(result).toMatchObject({ added: [], pulled: [], pushed: [] });
  });

  it('a failed close goes to the journal, and the next sync makes up for it', async () => {
    const tree = emptyTree();
    const repo = fakeRepo();
    await linkRepo(tree, 'anton/app', undefined, repo.run);
    repo.open(1, 'Вход');
    const [node] = (await syncIssues(tree, repo.run)).added;
    unfollow = followStatuses(repo.run);
    repo.failing(true);
    setStatus(tree, node!.id, 'done');
    expect(await settlePushes()).toMatchObject([{ text: 'issue #1 закрыта', error: 'HTTP 502' }]);
    const failed = loadTree(tree.project.dir);
    expect(failed.nodes.get(node!.id)!.body).toContain('HTTP 502');
    expect(repo.issue(1).state).toBe('OPEN');

    repo.failing(false);
    const result = await syncIssues(failed, repo.run);
    expect(result.pushed.map((item) => item.id)).toEqual([node!.id]);
    expect(repo.issue(1).state).toBe('CLOSED');
    expect(loadTree(tree.project.dir).nodes.get(node!.id)!.status).toBe('done');
  });

  it('an issue deleted on GitHub is noted once, and its node stays', async () => {
    const tree = emptyTree();
    const repo = fakeRepo();
    await linkRepo(tree, 'anton/app', undefined, repo.run);
    repo.open(1, 'Вход');
    const [node] = (await syncIssues(tree, repo.run)).added;
    repo.issues.length = 0;
    const result = await syncIssues(tree, repo.run);
    expect(result.gone.map((item) => item.id)).toEqual([node!.id]);
    const after = loadTree(tree.project.dir).nodes.get(node!.id)!;
    expect(after.status).toBe('idea');
    expect(after.body).toContain('#1');
    expect((await syncIssues(loadTree(tree.project.dir), repo.run)).gone).toEqual([]);
  });

  it('an issue that is a card on the board is one node, whichever came first', async () => {
    const issueFirst = emptyTree();
    const board = fakeBoard();
    const repo = fakeRepo();
    await linkBoard(issueFirst, 'anton/1', undefined, board.run);
    await linkRepo(issueFirst, 'anton/app', undefined, repo.run);
    repo.open(1, 'Вход');
    const [node] = (await syncIssues(issueFirst, repo.run)).added;
    board.items.push({ id: 'I1', title: 'Вход', status: 'In Progress', url: repo.url(1) });
    const cards = await syncBoard(issueFirst, board.run);
    expect(cards.added).toEqual([]);
    const joined = loadTree(issueFirst.project.dir).nodes.get(node!.id)!;
    expect(cardOf(joined)).toEqual({ item: 'I1', url: repo.url(1), column: 'In Progress' });
    expect(issueOf(joined)).toMatchObject({ number: 1, state: 'open' });
    expect(joined.status).toBe('active');

    const cardFirst = emptyTree();
    await linkBoard(cardFirst, 'anton/1', undefined, board.run);
    await linkRepo(cardFirst, 'anton/app', undefined, repo.run);
    const [card] = (await syncBoard(cardFirst, board.run)).added;
    expect((await syncIssues(cardFirst, repo.run)).added).toEqual([]);
    expect(issueOf(loadTree(cardFirst.project.dir).nodes.get(card!.id)!)).toMatchObject({ number: 1 });
    expect(loadTree(cardFirst.project.dir).nodes.size).toBe(2);
  });

  it('sync without a repository says how to link one', async () => {
    await expect(syncIssues(emptyTree(), fakeRepo().run)).rejects.toThrow('github link');
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
    expect(parseRepoUrl('https://github.com/acme/Widgets')).toEqual({ owner: 'acme', name: 'Widgets' });
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

  it('a repository deleted on GitHub is told apart from one that is there', async () => {
    const repo = { owner: 'antondanv', name: 'Treeyard' };
    expect(await repoExists(repo, async () => '{"name":"Treeyard"}')).toBe(true);
    const gone: Gh = async () => {
      throw new Error("GraphQL: Could not resolve to a Repository with the name 'antondanv/Treeyard'. (repository)");
    };
    expect(await repoExists(repo, gone)).toBe(false);
    // Anything else (no network) is an error, not a missing repository.
    const offline: Gh = async () => {
      throw new Error('error connecting to api.github.com');
    };
    await expect(repoExists(repo, offline)).rejects.toThrow('api.github.com');
  });

  it('a new or chosen repository takes over the remote of a deleted one', async () => {
    const dir = tempDir();
    connectRepo(dir, 'antondanv/Treeyard');
    const calls: string[][] = [];
    const run: Gh = async (args) => {
      calls.push(args);
      return 'https://github.com/antondanv/Treeyard2\n';
    };
    expect(await createRepo(dir, 'Treeyard2', false, run)).toEqual({ owner: 'antondanv', name: 'Treeyard2' });
    expect(calls).toEqual([['repo', 'create', 'Treeyard2', '--public']]);
    const remotes = () => spawnSync('git', ['remote', '-v'], { cwd: dir, encoding: 'utf8' }).stdout;
    expect(remotes()).toContain('origin\thttps://github.com/antondanv/Treeyard2.git');
    expect(remotes()).not.toMatch(/^github\t/m);
    connectRepo(dir, 'antondanv/brainyard');
    expect(repoOf(dir)).toEqual({ owner: 'antondanv', name: 'brainyard' });
    expect(remotes().trim().split('\n')).toHaveLength(2);
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
