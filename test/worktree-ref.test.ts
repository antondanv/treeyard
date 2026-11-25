import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { emptyTree, tempDir, treeyardIn } from './helpers.js';

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

/** A project whose tree is in git, and a worktree on its own branch with one commit of its own. */
function worktreeProject() {
  const tree = emptyTree();
  const main = tree.project.dir;
  const node = addNode(tree, { title: 'Узел сессии', status: 'active' });
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'start');
  const mainHead = git(main, 'rev-parse', 'HEAD');
  const wt = join(tempDir(), 'wt');
  git(main, 'worktree', 'add', '-q', '-b', 'session', wt);
  writeFileSync(join(wt, 'work.txt'), 'работа сессии\n');
  git(wt, 'add', 'work.txt');
  git(wt, 'commit', '-q', '-m', 'work');
  return { main, wt, node: node.id, mainHead, wtHead: git(wt, 'rev-parse', 'HEAD') };
}

describe('HEAD from a git worktree', () => {
  it('is the worktree branch’s commit for log --commit and diff --add, with --project and without', async () => {
    const { main, wt, node, mainHead, wtHead } = worktreeProject();
    expect(wtHead).not.toBe(mainHead);
    const sh = treeyardIn(wt);

    // Without --project, a command in the worktree writes the main tree and resolves HEAD to the worktree's commit.
    const log = await sh('log', node, 'итог', '--commit', 'HEAD');
    expect(log.code, log.stderr).toBe(0);
    expect(loadTree(main).nodes.get(node)!.commits).toEqual([wtHead]);
    expect(loadTree(wt).nodes.get(node)!.commits).toBeUndefined();

    // With --project <main>, a second commit in the worktree attaches to the main tree too.
    writeFileSync(join(wt, 'more.txt'), 'ещё работа\n');
    git(wt, 'add', 'more.txt');
    git(wt, 'commit', '-q', '-m', 'more');
    const wtHead2 = git(wt, 'rev-parse', 'HEAD');
    const withFlag = await sh('diff', node, '--add', 'HEAD', '--project', main);
    expect(withFlag.code, withFlag.stderr).toBe(0);
    expect(loadTree(main).nodes.get(node)!.commits).toEqual([wtHead, wtHead2]);

    // Explicit --project . targets the worktree's own copy of the tree.
    const own = await sh('diff', node, '--add', 'HEAD', '--project', '.');
    expect(own.code, own.stderr).toBe(0);
    expect(loadTree(wt).nodes.get(node)!.commits).toEqual([wtHead2]);

    // From the main folder HEAD is still the main branch.
    const fromMain = await treeyardIn(main)('diff', node, '--add', 'HEAD');
    expect(fromMain.code, fromMain.stderr).toBe(0);
    expect(loadTree(main).nodes.get(node)!.commits).toEqual([wtHead, wtHead2, mainHead]);
  }, 60_000);

  it('leaves another repository’s HEAD out: the tree’s own repository decides', async () => {
    const { main, node, mainHead } = worktreeProject();
    const stranger = tempDir();
    git(stranger, 'init', '-q', '-b', 'main');
    writeFileSync(join(stranger, 'x.txt'), 'x\n');
    git(stranger, 'add', 'x.txt');
    git(stranger, 'commit', '-q', '-m', 'x');
    const res = await treeyardIn(stranger)('log', node, 'итог', '--commit', 'HEAD', '--project', main);
    expect(res.code, res.stderr).toBe(0);
    expect(loadTree(main).nodes.get(node)!.commits).toEqual([mainHead]);
  }, 60_000);
});
