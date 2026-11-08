import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { journalEntries } from '../src/model/journal.js';
import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import type { Tree } from '../src/model/types.js';
import { emptyTree, treeyardIn } from './helpers.js';

// The machine's own git config (a global hooksPath, signing) must not leak into these repositories.
const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_SYSTEM = '/dev/null';
});
afterAll(() => {
  for (const [key, value] of [
    ['GIT_CONFIG_GLOBAL', saved.global],
    ['GIT_CONFIG_SYSTEM', saved.system],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const git = (dir: string, ...args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd: dir, encoding: 'utf8' },
  ).trim();

/** A tree in a git repository with two commits of work: returns their SHAs. */
function repoTree(): { tree: Tree; shas: [string, string] } {
  const tree = emptyTree();
  const dir = tree.project.dir;
  git(dir, 'init', '-q', '-b', 'main');
  const shas: string[] = [];
  for (const name of ['a.txt', 'b.txt']) {
    writeFileSync(join(dir, name), name);
    git(dir, 'add', name);
    git(dir, 'commit', '-q', '-m', `work ${name}`);
    shas.push(git(dir, 'rev-parse', 'HEAD'));
  }
  return { tree, shas: shas as [string, string] };
}

const entries = (tree: Tree, id: string) =>
  journalEntries(loadTree(tree.project.dir).nodes.get(id)!.body).map((line) => line.split(' · ').slice(1).join(' · '));

describe('treeyard log --status --commit', () => {
  it('writes the commits, the entry and the status in one command, in that order', async () => {
    const { tree, shas } = repoTree();
    const node = addNode(tree, { title: 'Узел', status: 'active' });
    const sh = treeyardIn(tree.project.dir);
    const res = await sh('log', node.id, 'Сделано; npm test — 3/3', '--status', 'review', '--commit', 'HEAD~1', 'HEAD');
    expect(res.code).toBe(0);
    expect(res.stdout).toBe(`${node.id} · записано · привязано коммитов: 2 · в работе → на проверке\n`);
    const reread = loadTree(tree.project.dir).nodes.get(node.id)!;
    expect(reread.status).toBe('review');
    expect(reread.commits).toEqual(shas);
    expect(entries(tree, node.id)).toEqual([
      `агент · привязан коммит ${shas[0]}`,
      `агент · привязан коммит ${shas[1]}`,
      'агент · Сделано; npm test — 3/3',
      'агент · в работе → на проверке',
    ]);
  }, 40_000);

  it('takes refs separated by commas or repeated flags, and the text after the flags', async () => {
    const { tree, shas } = repoTree();
    const a = addNode(tree, { title: 'A', status: 'active' });
    const b = addNode(tree, { title: 'B', status: 'active' });
    const sh = treeyardIn(tree.project.dir);
    await sh('log', a.id, '--commit', `${shas[0].slice(0, 7)},HEAD`, '--status', 'проверка', 'итог словами');
    expect(loadTree(tree.project.dir).nodes.get(a.id)!.commits).toEqual(shas);
    expect(entries(tree, a.id)).toContain('агент · итог словами');
    await sh('log', b.id, 'итог', '--commit', 'HEAD', '--commit', 'HEAD~1');
    expect(loadTree(tree.project.dir).nodes.get(b.id)!.commits).toEqual([shas[1], shas[0]]);
    // An already attached commit is not attached twice.
    await sh('log', b.id, 'ещё итог', '--commit', 'HEAD');
    expect(loadTree(tree.project.dir).nodes.get(b.id)!.commits).toEqual([shas[1], shas[0]]);
  }, 40_000);

  it('a ref git does not know writes nothing at all', async () => {
    const { tree } = repoTree();
    const node = addNode(tree, { title: 'Узел', status: 'active' });
    const before = loadTree(tree.project.dir).nodes.get(node.id)!.body;
    const res = await treeyardIn(tree.project.dir)(
      'log',
      node.id,
      'итог',
      '--status',
      'review',
      '--commit',
      'HEAD',
      'nope123',
    );
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('nope123');
    const after = loadTree(tree.project.dir).nodes.get(node.id)!;
    expect(after.body).toBe(before);
    expect(after.status).toBe('active');
    expect(after.commits).toBeUndefined();
  }, 40_000);

  it('done from an agent becomes review and says so on stdout; the person closes', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Узел', status: 'active' });
    const sh = treeyardIn(tree.project.dir);
    const agent = await sh('log', node.id, 'итог', '--status', 'done');
    expect(agent.stdout).toBe(`${node.id} · записано · в работе → на проверке · не готово: готово ставит человек\n`);
    const typo = await sh('log', node.id, 'итог', '--status', 'done', '--as', 'ty');
    expect(typo.stdout).toContain('не готово: «ty» — не человек');
    const person = await sh('log', node.id, 'принято', '--status', 'done', '--as', 'ты');
    expect(person.stdout).toBe(`${node.id} · записано · на проверке → готово\n`);
    expect(loadTree(tree.project.dir).nodes.get(node.id)!.status).toBe('done');
  }, 40_000);

  it('waiting takes its reason and its return; without --status waiting they are refused', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Узел', status: 'active' });
    const sh = treeyardIn(tree.project.dir);
    const bad = await sh('log', node.id, 'итог', '--waiting', 'сервер');
    expect(bad.code).toBe(2);
    await sh(
      'log',
      node.id,
      'упёрся в сервер',
      '--status',
      'waiting',
      '--waiting',
      'нет VPS',
      '--until',
      'VPS оплачен',
    );
    const reread = loadTree(tree.project.dir).nodes.get(node.id)!;
    expect(reread.status).toBe('waiting');
    expect(reread.waiting).toBe('нет VPS');
    expect(reread.until).toBe('VPS оплачен');
  }, 40_000);
});
