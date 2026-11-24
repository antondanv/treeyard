import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PaneInfo } from '@antondanv/brainyard';
import { afterEach, describe, expect, it } from 'vitest';

import { claimNotice, findOverlaps, notifyOverlaps } from '../src/agents/overlap.js';
import { type QueueEvent, type QueueSources, runQueue } from '../src/agents/queue.js';
import { type SendSources, sendToNode } from '../src/agents/send.js';
import { type WaitSources, waitFor } from '../src/agents/wait.js';
import { paint } from '../src/cli/print.js';
import { overlapLines, waitJson, waitText } from '../src/cli/wait-text.js';
import { setLang } from '../src/i18n/i18n.js';
import { readMail } from '../src/model/mailbox.js';
import { addNode, attachSession, setStatus } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import type { Status, Tree } from '../src/model/types.js';
import { ensureWorktree, type NodeWorktree, worktreeParent } from '../src/worktree.js';
import { emptyTree, treeyardIn } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim();

const made: string[] = [];
afterEach(() => {
  setLang('ru');
  for (const dir of made.splice(0)) rmSync(worktreeParent(dir), { recursive: true, force: true });
});

interface Work {
  tree: Tree;
  main: string;
  /** The node id and its worktree, by name. */
  node: Record<string, { id: string; wt: NodeWorktree }>;
}

/** A git project with the given nodes at work, each in a worktree of its own (cleaned up after). */
async function project(titles: string[], status: Status = 'active'): Promise<Work> {
  const tree = emptyTree();
  const main = tree.project.dir;
  made.push(main);
  const nodes = titles.map((title) => addNode(tree, { title, status }));
  writeFileSync(join(main, 'app.txt'), 'один\nдва\nтри\n');
  writeFileSync(join(main, 'util.txt'), 'утилита\n');
  writeFileSync(join(main, 'dict.txt'), `${Array.from({ length: 20 }, (_, i) => `строка ${i + 1}`).join('\n')}\n`);
  writeFileSync(join(main, '.gitignore'), '.tree/.local/\n');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'start');
  const node: Work['node'] = {};
  for (const [at, title] of titles.entries()) {
    const { worktree } = await ensureWorktree(loadTree(main), nodes[at]!.id);
    node[title] = { id: nodes[at]!.id, wt: worktree };
  }
  return { tree: loadTree(main), main, node };
}

/** A file in a worktree; committed or left as it is. */
function edit(wt: NodeWorktree, name: string, text: string, commit = true): void {
  mkdirSync(dirname(join(wt.path, name)), { recursive: true });
  writeFileSync(join(wt.path, name), text);
  if (!commit) return;
  git(wt.path, 'add', name);
  git(wt.path, 'commit', '-q', '-m', `edit ${name}`);
}

const files = (work: Work, ids?: string[]) => findOverlaps(loadTree(work.main), ids).map((o) => o.files);

/** A node's status, written to the tree as it stands now. */
const setNode = (work: Work, id: string, status: Status, waiting?: string) =>
  setStatus(loadTree(work.main), id, status, waiting ? { waiting } : {});

describe('files that two nodes both change', () => {
  it('are the files both branches committed — and only those', async () => {
    const work = await project(['Бот', 'Сайт']);
    const { Бот, Сайт } = work.node;
    edit(Бот!.wt, 'app.txt', 'один\nбот\nтри\n');
    edit(Бот!.wt, 'bot-only.txt', 'бот\n');
    edit(Сайт!.wt, 'app.txt', 'один\nсайт\nтри\n');
    edit(Сайт!.wt, 'site-only.txt', 'сайт\n');
    const found = findOverlaps(loadTree(work.main));
    expect(found).toHaveLength(1);
    expect(found[0]!.files).toEqual(['app.txt']);
    expect(found[0]!.nodes.map((node) => node.title).sort()).toEqual(['Бот', 'Сайт']);
    expect(found[0]!.nodes.map((node) => node.status)).toEqual(['active', 'active']);
  });

  it('count what is not committed yet, in either worktree, new files too', async () => {
    const work = await project(['Бот', 'Сайт']);
    const { Бот, Сайт } = work.node;
    // One committed, the other not yet.
    edit(Бот!.wt, 'util.txt', 'утилита бота\n');
    edit(Сайт!.wt, 'util.txt', 'утилита сайта\n', false);
    // Both not committed, a file neither has in git.
    edit(Бот!.wt, 'notes/plan.md', 'план бота\n', false);
    edit(Сайт!.wt, 'notes/plan.md', 'план сайта\n', false);
    expect(files(work)).toEqual([['notes/plan.md', 'util.txt']]);
  });

  it('leave out a file with the same content in both, and the tree’s own files', async () => {
    const work = await project(['Бот', 'Сайт']);
    const { Бот, Сайт } = work.node;
    // The same settings file in both worktrees, the same deletion, and the nodes' own `.tree/`.
    edit(Бот!.wt, 'settings.json', '{}\n', false);
    edit(Сайт!.wt, 'settings.json', '{}\n', false);
    for (const each of [Бот!, Сайт!]) {
      rmSync(join(each.wt.path, 'util.txt'));
      edit(each.wt, `.tree/nodes/${each.id}.md`, `${each.id}\n`);
      edit(each.wt, '.tree/README.md', `обзор ${each.id}\n`);
    }
    expect(files(work)).toEqual([]);
    edit(Сайт!.wt, 'settings.json', '{"a":1}\n', false);
    expect(files(work)).toEqual([['settings.json']]);
  });

  it('are found among nodes at work and in review, not in ones waiting or already merged', async () => {
    const work = await project(['Бот', 'Сайт']);
    const { Бот, Сайт } = work.node;
    edit(Бот!.wt, 'app.txt', 'один\nбот\nтри\n');
    edit(Сайт!.wt, 'app.txt', 'один\nдва\nсайт\n');
    expect(files(work)).toEqual([['app.txt']]);

    setNode(work, Бот!.id, 'review');
    expect(
      findOverlaps(loadTree(work.main))[0]!
        .nodes.map((node) => node.status)
        .sort(),
    ).toEqual(['active', 'review']);
    setNode(work, Бот!.id, 'waiting', 'ключ');
    expect(files(work)).toEqual([]);

    // Merged into the main folder's branch: nothing of Бот is left to meet.
    setNode(work, Бот!.id, 'review');
    git(work.main, 'merge', '-q', '--no-edit', `treeyard/${Бот!.id}`);
    expect(files(work)).toEqual([]);
  });

  it('are asked for the nodes the coordinator named: a pair needs one of them', async () => {
    const work = await project(['Бот', 'Сайт', 'Админка']);
    const { Бот, Сайт, Админка } = work.node;
    edit(Бот!.wt, 'app.txt', 'один\nбот\nтри\n');
    edit(Сайт!.wt, 'app.txt', 'один\nдва\nсайт\n');
    edit(Сайт!.wt, 'util.txt', 'утилита сайта\n');
    edit(Админка!.wt, 'util.txt', 'утилита админки\n');
    const pairs = (ids?: string[]) =>
      findOverlaps(loadTree(work.main), ids).map((o) => `${o.nodes.map((n) => n.title).join('+')}: ${o.files}`);
    expect(pairs().sort()).toEqual(['Админка+Сайт: util.txt', 'Бот+Сайт: app.txt']);
    expect(pairs([Бот!.id])).toEqual(['Бот+Сайт: app.txt']);
    expect(pairs([Админка!.id])).toEqual(['Админка+Сайт: util.txt']);
    expect(pairs([Сайт!.id]).sort()).toEqual(['Админка+Сайт: util.txt', 'Бот+Сайт: app.txt']);
    expect(pairs(['нет-такого'])).toEqual([]);
  });

  it('are none in a project that is not a repository, or with one node at work', async () => {
    const tree = emptyTree();
    addNode(tree, { title: 'Один', status: 'active' });
    addNode(tree, { title: 'Два', status: 'active' });
    expect(findOverlaps(loadTree(tree.project.dir))).toEqual([]);
    const work = await project(['Бот']);
    edit(work.node.Бот!.wt, 'app.txt', 'бот\n');
    expect(files(work)).toEqual([]);
  });
});

/** Replaces one 1-based line in a multi-line string. */
function replaceLine(text: string, line: number, value: string): string {
  const parts = text.split('\n');
  parts[line - 1] = value;
  return parts.join('\n');
}

describe('trial merge of node branches', () => {
  it('stays quiet when two nodes edit different places of one file — committed, dirty, or mixed', async () => {
    const work = await project(['Бот', 'Сайт']);
    const { Бот, Сайт } = work.node;
    const base = readFileSync(join(work.main, 'dict.txt'), 'utf8');

    // Both committed, different parts of the same file.
    const bot1 = replaceLine(base, 1, 'бот 1');
    const site1 = replaceLine(base, 20, 'сайт 20');
    edit(Бот!.wt, 'dict.txt', bot1, true);
    edit(Сайт!.wt, 'dict.txt', site1, true);
    expect(files(work)).toEqual([]);

    // One branch committed, the other has uncommitted edits elsewhere in the file.
    const bot2 = replaceLine(bot1, 2, 'бот 2');
    const site2 = replaceLine(site1, 19, 'сайт 19');
    edit(Бот!.wt, 'dict.txt', bot2, true);
    edit(Сайт!.wt, 'dict.txt', site2, false);
    expect(files(work)).toEqual([]);

    // Both dirty, still in different places.
    edit(Бот!.wt, 'dict.txt', replaceLine(bot2, 3, 'бот 3'), false);
    edit(Сайт!.wt, 'dict.txt', replaceLine(site2, 18, 'сайт 18'), false);
    expect(files(work)).toEqual([]);
  });

  it('signals only the files that actually collide: same-place edits, add/add, and modify/delete', async () => {
    const work = await project(['Бот', 'Сайт']);
    const { Бот, Сайт } = work.node;
    const base = readFileSync(join(work.main, 'dict.txt'), 'utf8');

    // Clean edits to different places of dict.txt — must NOT be reported.
    edit(Бот!.wt, 'dict.txt', replaceLine(base, 1, 'бот 1'), true);
    edit(Сайт!.wt, 'dict.txt', replaceLine(base, 20, 'сайт 20'), false);

    // Same place committed.
    edit(Бот!.wt, 'app.txt', 'один\nбот\nтри\n', true);
    edit(Сайт!.wt, 'app.txt', 'один\nсайт\nтри\n', true);

    // Modify vs delete (uncommitted).
    edit(Бот!.wt, 'util.txt', 'утилита бота\n', false);
    rmSync(join(Сайт!.wt.path, 'util.txt'));

    // Untracked new file with different text in both worktrees.
    edit(Бот!.wt, 'fresh.txt', 'новый от бота\n', false);
    edit(Сайт!.wt, 'fresh.txt', 'новый от сайта\n', false);

    // Same place, both dirty.
    edit(Бот!.wt, 'dirty-clash.txt', 'общий черновик А\n', false);
    edit(Сайт!.wt, 'dirty-clash.txt', 'общий черновик Б\n', false);

    expect(files(work)).toEqual([['app.txt', 'dirty-clash.txt', 'fresh.txt', 'util.txt']]);
  });

  it('ignores identical edits in both branches and conflicts inside .tree/', async () => {
    const work = await project(['Бот', 'Сайт']);
    const { Бот, Сайт } = work.node;
    const base = readFileSync(join(work.main, 'dict.txt'), 'utf8');
    const same = replaceLine(base, 10, 'одинаковая правка');
    edit(Бот!.wt, 'dict.txt', same, true);
    edit(Сайт!.wt, 'dict.txt', same, false);
    edit(Бот!.wt, '.tree/README.md', 'версия бота\n', true);
    edit(Сайт!.wt, '.tree/README.md', 'версия сайта\n', false);
    expect(files(work)).toEqual([]);
  });

  it('does not alter either worktree or its git index', async () => {
    const work = await project(['Бот', 'Сайт']);
    const { Бот, Сайт } = work.node;
    const base = readFileSync(join(work.main, 'dict.txt'), 'utf8');

    // Stage one file, leave another modified unstaged, and leave an untracked file in each worktree.
    edit(Бот!.wt, 'staged-bot.txt', 'в индексе бота\n', false);
    git(Бот!.wt.path, 'add', 'staged-bot.txt');
    edit(Бот!.wt, 'dict.txt', replaceLine(base, 1, 'бот 1'), false);
    edit(Бот!.wt, 'untracked-bot.txt', 'новый бота\n', false);

    edit(Сайт!.wt, 'staged-site.txt', 'в индексе сайта\n', false);
    git(Сайт!.wt.path, 'add', 'staged-site.txt');
    edit(Сайт!.wt, 'dict.txt', replaceLine(base, 1, 'сайт 1'), false);
    edit(Сайт!.wt, 'untracked-site.txt', 'новый сайта\n', false);

    const snapshot = (wt: NodeWorktree) => ({
      head: git(wt.path, 'rev-parse', 'HEAD'),
      status: git(wt.path, 'status', '--porcelain=v1', '--untracked-files=all'),
      cached: git(wt.path, 'diff', '--cached'),
      unstaged: git(wt.path, 'diff'),
      dict: readFileSync(join(wt.path, 'dict.txt'), 'utf8'),
    });
    const before = { bot: snapshot(Бот!.wt), site: snapshot(Сайт!.wt) };

    expect(files(work)).toEqual([['dict.txt']]);

    expect({ bot: snapshot(Бот!.wt), site: snapshot(Сайт!.wt) }).toEqual(before);
  });

  it('falls back to file-hash comparison when trial merge fails or a custom reader is passed', async () => {
    const work = await project(['Бот', 'Сайт']);
    const { Бот, Сайт } = work.node;
    const base = readFileSync(join(work.main, 'dict.txt'), 'utf8');
    edit(Бот!.wt, 'dict.txt', replaceLine(base, 1, 'бот 1'), true);
    edit(Сайт!.wt, 'dict.txt', replaceLine(base, 20, 'сайт 20'), true);

    const tree = loadTree(work.main);
    expect(findOverlaps(tree)).toEqual([]);
    // Unavailable git merge-tree (returns null) -> falls back to sha1 comparison.
    expect(findOverlaps(tree, undefined, undefined, () => null).map((o) => o.files)).toEqual([['dict.txt']]);
    // Custom ReadFiles -> skips trial merge and compares by content hash.
    expect(findOverlaps(tree, undefined, () => ['dict.txt']).map((o) => o.files)).toEqual([['dict.txt']]);
  });
});

describe('the letter about a shared file', () => {
  it('goes to the sessions of both nodes once per pair and file', async () => {
    const work = await project(['Бот', 'Сайт']);
    const { Бот, Сайт } = work.node;
    edit(Бот!.wt, 'app.txt', 'один\nбот\nтри\n');
    edit(Сайт!.wt, 'app.txt', 'один\nдва\nсайт\n');
    const sent: [string, string][] = [];
    const send = async (id: string, text: string) => void sent.push([id, text]);

    const found = findOverlaps(loadTree(work.main));
    const first = await notifyOverlaps(work.tree, found, send);
    expect(first).toHaveLength(2);
    expect(first).toContainEqual({ to: Бот!.id, other: Сайт!.id, files: ['app.txt'] });
    expect(first).toContainEqual({ to: Сайт!.id, other: Бот!.id, files: ['app.txt'] });
    expect(sent.map(([id]) => id).sort()).toEqual([Бот!.id, Сайт!.id].sort());
    // Each is told about the other, with the file and how to write to it.
    const toБот = sent.find(([id]) => id === Бот!.id)![1];
    expect(toБот).toContain(`«Сайт» (${Сайт!.id})`);
    expect(toБот).toContain('app.txt');
    expect(toБот).toContain(`treeyard send ${Сайт!.id} "…"`);
    expect(toБот).toContain('не от человека');
    expect(sent.find(([id]) => id === Сайт!.id)![1]).toContain(`«Бот» (${Бот!.id})`);

    // The same pair and file again: nothing. A new file of the pair: a letter about that file only.
    expect(await notifyOverlaps(work.tree, found, send)).toEqual([]);
    edit(Бот!.wt, 'util.txt', 'утилита бота\n');
    edit(Сайт!.wt, 'util.txt', 'утилита сайта\n');
    const more = await notifyOverlaps(work.tree, findOverlaps(loadTree(work.main)), send);
    expect(more.map((notice) => notice.files)).toEqual([['util.txt'], ['util.txt']]);
    expect(sent).toHaveLength(4);
    expect(sent[2]![1]).toContain('util.txt');
    expect(sent[2]![1]).not.toContain('app.txt');
    // Memory of it is in the project's `.local`, which stays out of git.
    expect(readdirSync(join(work.main, '.tree', '.local', 'conflicts'))).toHaveLength(2);
  });

  it('is not written to a node waiting for review, and is retried when nobody got it', async () => {
    const work = await project(['Бот', 'Сайт']);
    const { Бот, Сайт } = work.node;
    edit(Бот!.wt, 'app.txt', 'один\nбот\nтри\n');
    edit(Сайт!.wt, 'app.txt', 'один\nдва\nсайт\n');
    setNode(work, Бот!.id, 'review');
    const found = findOverlaps(loadTree(work.main));
    const sent: string[] = [];
    // The session of the node at work cannot be reached this time: the file is not marked as told.
    await notifyOverlaps(work.tree, found, async () => Promise.reject(new Error('нет связи')));
    await notifyOverlaps(work.tree, found, async (id) => void sent.push(id));
    expect(sent).toEqual([Сайт!.id]);
    expect(await notifyOverlaps(work.tree, found, async (id) => void sent.push(id))).toEqual([]);
  });

  it('is claimed by one of two callers that ask together', async () => {
    const work = await project(['Бот', 'Сайт']);
    const pair: [string, string] = [work.node.Бот!.id, work.node.Сайт!.id];
    expect([claimNotice(work.main, pair, 'a.ts'), claimNotice(work.main, [pair[1], pair[0]], 'a.ts')]).toEqual([
      true,
      false,
    ]);
    expect(claimNotice(work.main, pair, 'b.ts')).toBe(true);
  });
});

/** Brainyard that knows no sessions: the nodes at work have none, the letters wait in the mailbox. */
const quiet = (): SendSources =>
  ({
    live: async () => [],
    panes: async () => [] as PaneInfo[],
    type: async () => undefined,
    startPane: async () => {
      throw new Error('no pane should start');
    },
    open: async () => {
      throw new Error('nothing should open');
    },
    stop: async () => 'stopped',
    pause: async () => undefined,
  }) as unknown as SendSources;

function waitSources(): WaitSources {
  return {
    load: loadTree,
    live: async () => [],
    panes: async () => [],
    paneSession: async () => undefined,
    capture: async () => undefined,
    idle: async (_panes, known) => known,
    watch: () => ({ stop: () => undefined }),
    // The real way to write to a session, with Brainyard stood in for.
    notify: async (tree, id, text) => {
      await sendToNode(tree, id, text, { source: 'treeyard', sources: quiet(), spawn: () => undefined });
    },
    now: () => Date.now(),
  };
}

describe('treeyard wait', () => {
  it('returns the pairs of nodes that change one file, and writes to both sessions once', async () => {
    const work = await project(['Бот', 'Сайт']);
    const { Бот, Сайт } = work.node;
    // A node with an ended session: wait returns at once, with the conflict next to it.
    attachSession(work.tree, Бот!.id, {
      brain: 'claude',
      id: 's-1',
      mode: 'background',
      started: '2026-11-20T10:00:00Z',
    });
    edit(Бот!.wt, 'app.txt', 'один\nбот\nтри\n');
    edit(Сайт!.wt, 'app.txt', 'один\nдва\nсайт\n', false);

    const first = await waitFor(work.main, [Бот!.id, Сайт!.id], {
      intervalMs: 5,
      timeoutMs: 60,
      sources: waitSources(),
    });
    expect(first.timedOut || first.settled.length > 0).toBe(true);
    expect(first.conflicts).toMatchObject([{ files: ['app.txt'] }]);
    expect(first.conflicts![0]!.nodes.map((node) => node.id).sort()).toEqual([Бот!.id, Сайт!.id].sort());

    const letters = readMail(work.main);
    expect(letters.map((letter) => letter.to).sort()).toEqual([Бот!.id, Сайт!.id].sort());
    expect(letters.every((letter) => !letter.from && letter.who === 'treeyard')).toBe(true);
    expect(letters.find((letter) => letter.to === Бот!.id)!.text).toContain('«Сайт»');

    // Looked at again: the same conflict is shown, nobody is written to a second time.
    const again = await waitFor(work.main, [Бот!.id, Сайт!.id], {
      intervalMs: 5,
      timeoutMs: 60,
      sources: waitSources(),
    });
    expect(again.conflicts).toHaveLength(1);
    expect(readMail(work.main)).toHaveLength(2);
  });

  it('has no conflicts when the nodes change different files, and no fuss without a repository', async () => {
    const work = await project(['Бот', 'Сайт']);
    edit(work.node.Бот!.wt, 'bot.txt', 'бот\n');
    edit(work.node.Сайт!.wt, 'site.txt', 'сайт\n');
    const result = await waitFor(work.main, [work.node.Бот!.id], {
      intervalMs: 5,
      timeoutMs: 40,
      sources: waitSources(),
    });
    expect(result.conflicts).toEqual([]);
    expect(readMail(work.main)).toEqual([]);

    const bare = emptyTree();
    const node = addNode(bare, { title: 'Без git', status: 'review' });
    const plain = await waitFor(bare.project.dir, [node.id], { sources: waitSources() });
    expect(plain.conflicts).toEqual([]);
  });

  it('prints «A» и «B» правят один файл: путь, in either language, and has the field conflicts in --json', async () => {
    const work = await project(['Бот', 'Сайт']);
    const { Бот, Сайт } = work.node;
    edit(Бот!.wt, 'app.txt', 'один\nбот\nтри\n');
    edit(Сайт!.wt, 'app.txt', 'один\nдва\nсайт\n');
    setNode(work, Бот!.id, 'review');
    setNode(work, Сайт!.id, 'review');
    const result = await waitFor(work.main, [Бот!.id, Сайт!.id], { all: true, sources: waitSources() });
    const plain = paint({ isTTY: false } as NodeJS.WriteStream);
    expect(waitText(result, plain)).toContain('⚠ «Бот» и «Сайт» правят один файл: app.txt\n');
    const json = waitJson(result) as { conflicts: { nodes: { node: string; title: string }[]; files: string[] }[] };
    expect(json.conflicts).toHaveLength(1);
    expect(json.conflicts[0]!.files).toEqual(['app.txt']);
    expect(json.conflicts[0]!.nodes).toHaveLength(2);
    expect(json.conflicts[0]!.nodes).toContainEqual({ node: Бот!.id, title: 'Бот', status: 'review' });
    expect(json.conflicts[0]!.nodes).toContainEqual({ node: Сайт!.id, title: 'Сайт', status: 'review' });
    setLang('en');
    expect(waitText(result, plain)).toContain('⚠ «Бот» and «Сайт» edit the same file: app.txt\n');
    // Nothing was written to nodes that are not at work.
    expect(readMail(work.main)).toEqual([]);
  });

  it('names a few files and counts the rest', () => {
    const many = Array.from({ length: 8 }, (_, at) => `src/f${at}.ts`);
    const lines = overlapLines('А', 'Б', many);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe('«А» и «Б» правят один файл: src/f0.ts');
    expect(lines[5]).toBe('… и ещё 3');
  });
});

describe('treeyard queue', () => {
  it('says once, as an event, which nodes change one file — and the sessions get their letters', async () => {
    const work = await project(['Бот', 'Сайт']);
    const { Бот, Сайт } = work.node;
    edit(Бот!.wt, 'app.txt', 'один\nбот\nтри\n');
    edit(Сайт!.wt, 'app.txt', 'один\nдва\nсайт\n');
    const controller = new AbortController();
    const events: QueueEvent[] = [];
    const sources: QueueSources = {
      ...waitSources(),
      start: async () => {
        throw new Error('nothing starts: both nodes are at work already');
      },
      limits: async () => null,
    };
    await runQueue(work.main, [Бот!.id, Сайт!.id], {
      launch: { brain: 'claude', start: 'do', background: true },
      parallel: 2,
      intervalMs: 5,
      graceMs: 60_000,
      sources,
      signal: controller.signal,
      onEvent: (event) => {
        events.push(event);
        if (event.type === 'overlap') setTimeout(() => controller.abort(), 60);
      },
    });
    const overlaps = events.filter((event) => event.type === 'overlap');
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ files: ['app.txt'] });
    expect(readMail(work.main)).toHaveLength(2);
  });
});

describe('treeyard wait in a shell', () => {
  it('prints the shared file, and --json carries conflicts', async () => {
    const work = await project(['Бот', 'Сайт']);
    const { Бот, Сайт } = work.node;
    edit(Бот!.wt, 'app.txt', 'один\nбот\nтри\n');
    edit(Сайт!.wt, 'app.txt', 'один\nдва\nсайт\n', false);
    setNode(work, Бот!.id, 'review');
    setNode(work, Сайт!.id, 'review');
    const sh = treeyardIn(work.main);

    const text = await sh('wait', Бот!.id, Сайт!.id, '--all');
    expect(text.code).toBe(0);
    expect(text.stdout).toContain('«Бот» и «Сайт» правят один файл: app.txt');

    const json = JSON.parse((await sh('wait', Бот!.id, Сайт!.id, '--all', '--json')).stdout) as {
      conflicts: { files: string[] }[];
    };
    expect(json.conflicts).toMatchObject([{ files: ['app.txt'] }]);

    // One node alone is read against the node beside it: the same pair.
    expect((await sh('wait', Бот!.id)).stdout).toContain('правят один файл: app.txt');
    expect(existsSync(join(work.main, '.tree', '.local', 'conflicts'))).toBe(false);
  }, 60_000);
});
