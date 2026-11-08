import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bindHeadCommit } from '../src/commit-hook.js';
import { NODE_VAR, PROJECT_VAR } from '../src/model/notes.js';
import { addNode, logToNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import type { Tree } from '../src/model/types.js';
import { emptyTree, treeyardIn } from './helpers.js';

// The machine's own git config must not leak in; the CLI commits with these names.
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const [key, value] of Object.entries(GIT_ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});
afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

/** A committed tree with two nodes and a code file. */
function committed(): { tree: Tree; a: string; b: string } {
  const tree = emptyTree();
  const dir = tree.project.dir;
  const a = addNode(tree, { title: 'Мой узел' }).id;
  const b = addNode(tree, { title: 'Чужой узел' }).id;
  writeFileSync(join(dir, 'app.js'), 'one\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'start');
  return { tree, a, b };
}

const files = (dir: string, ref = 'HEAD') =>
  git(dir, 'show', '--name-only', '--format=', ref).split('\n').filter(Boolean);

describe('treeyard commit', () => {
  it('commits the files of the named nodes and the overview, nothing of the others', async () => {
    const { tree, a, b } = committed();
    const dir = tree.project.dir;
    logToNode(tree, a, 'моя запись', 'агент');
    logToNode(tree, b, 'чужая запись', 'claude');
    const fresh = addNode(tree, { title: 'Новая идея', parent: a, status: 'idea' }, 'агент');
    writeFileSync(join(dir, 'app.js'), 'two\n');
    git(dir, 'add', 'app.js');
    const sh = treeyardIn(dir);
    const res = await sh('commit', a, fresh.id);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/^[0-9a-f]{7} chore\(tree\): Мой узел; Новая идея\n/);
    expect(files(dir).sort()).toEqual([`.tree/README.md`, `.tree/nodes/${a}.md`, `.tree/nodes/${fresh.id}.md`].sort());
    // The other node is still changed, and what somebody staged is still staged.
    expect(git(dir, 'status', '--porcelain')).toContain(`.tree/nodes/${b}.md`);
    expect(git(dir, 'diff', '--cached', '--name-only')).toBe('app.js');
    const again = await sh('commit', a);
    expect(again.stdout).toBe(`в дереве нечего коммитить: ${a}\n`);
  }, 40_000);

  it('takes the message from -m, the session node without ids, and a node deleted with rm', async () => {
    const { tree, a, b } = committed();
    const dir = tree.project.dir;
    logToNode(tree, a, 'запись', 'агент');
    const own = await treeyardIn(dir, { [NODE_VAR]: a })('commit', '-m', 'chore(tree): close the node');
    expect(own.code).toBe(0);
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('chore(tree): close the node');
    expect(files(dir)).toContain(`.tree/nodes/${a}.md`);
    const sh = treeyardIn(dir);
    expect((await sh('rm', b)).code).toBe(0);
    const removed = await sh('commit', b);
    expect(removed.code).toBe(0);
    expect(git(dir, 'show', '--name-status', '--format=', 'HEAD')).toContain(`D\t.tree/nodes/${b}.md`);
    expect((await sh('commit')).code).toBe(2);
  }, 40_000);

  it('the post-commit hook does not bind a commit of tree files only to the node', () => {
    const { tree, a } = committed();
    const dir = tree.project.dir;
    const env = { ...process.env, [NODE_VAR]: a, [PROJECT_VAR]: dir };
    logToNode(tree, a, 'запись', 'агент');
    git(dir, 'commit', '-q', '-am', 'chore(tree): only the tree');
    expect(bindHeadCommit(env, dir)).toBeUndefined();
    expect(loadTree(dir).nodes.get(a)!.commits).toBeUndefined();
    writeFileSync(join(dir, 'app.js'), 'three\n');
    git(dir, 'commit', '-q', '-am', 'feat: work');
    expect(bindHeadCommit(env, dir)).toBe(git(dir, 'rev-parse', 'HEAD'));
  });
});
