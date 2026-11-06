import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { contextText } from '../src/agents/context.js';
import { bindHeadCommit, hookInstalled, hookStatus, installHook, removeHook } from '../src/commit-hook.js';
import { gitRepository } from '../src/git.js';
import { setLang } from '../src/i18n/i18n.js';
import { NODE_VAR, nodeEnv, PROJECT_VAR } from '../src/model/notes.js';
import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { emptyTree, tempDir } from './helpers.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

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
    { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_DIR: undefined } },
  ).trimEnd();

function repo(): string {
  const dir = tempDir();
  git(dir, 'init', '-q', '-b', 'main');
  return dir;
}

function commit(dir: string, file = 'a.txt', text = String(Math.random())): string {
  writeFileSync(join(dir, file), text);
  git(dir, 'add', '--', file);
  git(dir, 'commit', '-q', '-m', `edit ${file}`);
  return git(dir, 'rev-parse', 'HEAD');
}

/** A project tree inside a fresh repository with one node. */
function project() {
  const tree = emptyTree();
  const dir = tree.project.dir;
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, '.gitignore'), '.tree/\n');
  const node = addNode(tree, { title: 'Узел' });
  return { dir, id: node.id };
}

const commitsOf = (dir: string, id: string) => loadTree(dir).nodes.get(id)?.commits ?? [];

describe('refs for diff --add', () => {
  it('resolves HEAD, HEAD~1, a branch, a tag and a short SHA to the full SHA, and explains failures', async () => {
    const dir = repo();
    const first = commit(dir);
    const second = commit(dir);
    git(dir, 'tag', 'v1', first);
    git(dir, 'branch', 'topic', first);
    const repository = await gitRepository(dir);
    for (const [ref, sha] of [
      ['HEAD', second],
      ['HEAD~1', first],
      ['v1', first],
      ['topic', first],
      ['main', second],
      [second.slice(0, 7), second],
    ] as const)
      expect((await repository.commit(ref)).sha, ref).toBe(sha);
    await expect(repository.commit('nope')).rejects.toThrow('не найден');
    await expect(repository.commit('--all')).rejects.toThrow('укажи коммит');
    await expect(repository.commit('')).rejects.toThrow('укажи коммит');
  });

  it('the CLI attaches HEAD as a full SHA', async () => {
    const { dir, id } = project();
    const sha = commit(dir);
    const env: NodeJS.ProcessEnv = { ...process.env, TREEYARD_HOME: tempDir(), TREEYARD_LANG: 'ru' };
    delete env[NODE_VAR];
    await run(process.execPath, ['--import', tsx, cli, 'diff', id, '--add', 'HEAD'], { cwd: dir, env });
    expect(commitsOf(dir, id)).toEqual([sha]);
  });
});

describe('treeyard hook install | remove | status', () => {
  it('writes an executable hook into a clean repository and removes it entirely', () => {
    const dir = repo();
    expect(hookStatus(dir).installed).toBe(false);
    expect(installHook(dir).kind).toBe('installed');
    const file = join(dir, '.git', 'hooks', 'post-commit');
    expect(readFileSync(file, 'utf8')).toContain('treeyard hook post-commit');
    expect(statSync(file).mode & 0o111).not.toBe(0);
    expect(hookInstalled(dir)).toBe(true);
    expect(installHook(dir).kind).toBe('already');
    expect(readFileSync(file, 'utf8').match(/# >>> treeyard/g)).toHaveLength(1);
    expect(removeHook(dir).kind).toBe('removed');
    expect(existsSync(file)).toBe(false);
    expect(removeHook(dir).kind).toBe('absent');
  });

  it('appends to an existing shell hook and removes only its own block', () => {
    const dir = repo();
    const file = join(dir, '.git', 'hooks', 'post-commit');
    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
    writeFileSync(file, '#!/usr/bin/env bash\necho mine');
    chmodSync(file, 0o755);
    installHook(dir);
    expect(readFileSync(file, 'utf8')).toMatch(
      /^#!\/usr\/bin\/env bash\necho mine\n# >>> treeyard\n.*\n# <<< treeyard\n$/,
    );
    removeHook(dir);
    expect(readFileSync(file, 'utf8').trimEnd()).toBe('#!/usr/bin/env bash\necho mine');
    expect(hookInstalled(dir)).toBe(false);
  });

  it('refuses a hook in another language and leaves it alone', () => {
    const dir = repo();
    const file = join(dir, '.git', 'hooks', 'post-commit');
    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
    writeFileSync(file, '#!/usr/bin/env node\nconsole.log(1)\n');
    expect(() => installHook(dir)).toThrow('не shell-скрипт');
    expect(readFileSync(file, 'utf8')).toBe('#!/usr/bin/env node\nconsole.log(1)\n');
  });

  it('does not write into a hooks folder that lives in the repository, and says so', () => {
    const dir = repo();
    mkdirSync(join(dir, '.husky'));
    git(dir, 'config', 'core.hooksPath', '.husky');
    const result = installHook(dir);
    expect(result.kind).toBe('manual');
    expect(existsSync(join(dir, '.husky', 'post-commit'))).toBe(false);
    expect(hookStatus(dir)).toMatchObject({ installed: false, tracked: true });
    expect(removeHook(dir).kind).toBe('manual');
    // Once the person adds the line, status and the agent's context see it.
    writeFileSync(join(dir, '.husky', 'post-commit'), 'treeyard hook post-commit\n');
    expect(hookInstalled(dir)).toBe(true);
  });

  it('writes to an external core.hooksPath and fails outside a repository', () => {
    const dir = repo();
    const outside = tempDir();
    git(dir, 'config', 'core.hooksPath', outside);
    expect(installHook(dir).kind).toBe('installed');
    expect(existsSync(join(outside, 'post-commit'))).toBe(true);
    expect(() => installHook(tempDir())).toThrow('нет Git-репозитория');
  });

  it('is shared by git worktrees of the repository', () => {
    const dir = repo();
    commit(dir);
    const other = join(tempDir(), 'wt');
    git(dir, 'worktree', 'add', '-q', other);
    installHook(other);
    expect(hookInstalled(dir)).toBe(true);
  });
});

describe('treeyard hook post-commit', () => {
  it('binds HEAD to the node of the session and logs it', () => {
    const { dir, id } = project();
    const sha = commit(dir);
    expect(bindHeadCommit({ [NODE_VAR]: id, [PROJECT_VAR]: dir }, dir)).toBe(sha);
    expect(commitsOf(dir, id)).toEqual([sha]);
    expect(loadTree(dir).nodes.get(id)!.body).toContain('привязан коммит');
    // Twice is still once.
    bindHeadCommit({ [NODE_VAR]: id, [PROJECT_VAR]: dir }, dir);
    expect(commitsOf(dir, id)).toEqual([sha]);
  });

  it('falls back to the tree of the current folder when the session predates TREEYARD_PROJECT', () => {
    const { dir, id } = project();
    const sha = commit(dir);
    expect(bindHeadCommit({ [NODE_VAR]: id }, dir)).toBe(sha);
  });

  it('does nothing without a node, with an unknown node or without a tree', () => {
    const { dir, id } = project();
    commit(dir);
    expect(bindHeadCommit({}, dir)).toBeUndefined();
    expect(bindHeadCommit({ [NODE_VAR]: '' }, dir)).toBeUndefined();
    expect(bindHeadCommit({ [NODE_VAR]: 'zzzz', [PROJECT_VAR]: dir }, dir)).toBeUndefined();
    const bare = repo();
    commit(bare);
    expect(bindHeadCommit({ [NODE_VAR]: id }, bare)).toBeUndefined();
    expect(commitsOf(dir, id)).toEqual([]);
  });

  it('skips a commit in another repository', () => {
    const { dir, id } = project();
    const neighbour = repo();
    commit(neighbour);
    expect(bindHeadCommit({ [NODE_VAR]: id, [PROJECT_VAR]: dir }, neighbour)).toBeUndefined();
    expect(commitsOf(dir, id)).toEqual([]);
  });

  it('works from a git worktree of the project', () => {
    const { dir, id } = project();
    commit(dir);
    const other = join(tempDir(), 'wt');
    git(dir, 'worktree', 'add', '-q', '-b', 'side', other);
    const sha = commit(other, 'side.txt');
    expect(bindHeadCommit({ [NODE_VAR]: id, [PROJECT_VAR]: dir }, other)).toBe(sha);
    expect(commitsOf(dir, id)).toEqual([sha]);
  });
});

describe('end to end', () => {
  it('a commit made with the session env lands in the node, and a commit without it does not', async () => {
    const { dir, id } = project();
    // A treeyard on PATH that runs this source tree.
    const bin = tempDir();
    writeFileSync(join(bin, 'treeyard'), `#!/bin/sh\nexec "${process.execPath}" --import "${tsx}" "${cli}" "$@"\n`);
    chmodSync(join(bin, 'treeyard'), 0o755);
    const home = tempDir();
    installHook(dir);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TREEYARD_HOME: home, TREEYARD_LANG: 'ru' };
    const commitAs = (extra: NodeJS.ProcessEnv, file: string) => {
      writeFileSync(join(dir, file), file);
      git(dir, 'add', '--', file);
      return execFileSync(
        'git',
        ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', file],
        { cwd: dir, env: { ...env, ...extra, GIT_DIR: undefined }, encoding: 'utf8' },
      );
    };
    const stray = commitAs({}, 'plain.txt');
    expect(stray).not.toContain('treeyard');
    expect(commitsOf(dir, id)).toEqual([]);
    const output = commitAs({ [NODE_VAR]: id, [PROJECT_VAR]: dir }, 'bound.txt');
    expect(output).not.toMatch(/treeyard|привязан/);
    expect(commitsOf(dir, id)).toEqual([git(dir, 'rev-parse', 'HEAD')]);
    // The message of the commit carries no signature.
    expect(git(dir, 'log', '-1', '--format=%B').trim()).toBe('bound.txt');
  }, 30_000);
});

describe('the agent context', () => {
  it('asks for a manual --add HEAD without the hook and for nothing with it', () => {
    setLang('ru');
    const { dir, id } = project();
    const tree = loadTree(dir);
    expect(contextText(tree, id)).toContain(`diff ${id} --add HEAD`);
    expect(contextText(tree, id)).not.toContain('привязываются к узлу сами');
    installHook(dir);
    const text = contextText(tree, id);
    expect(text).toContain('привязываются к узлу сами');
    expect(text).toContain(`diff ${id} --add <ref>`);
    expect(text).not.toContain('--add HEAD');
  });

  it('the node env carries the tree of the session', () => {
    expect(nodeEnv('k3f9', '/p/tree')).toMatchObject({ [NODE_VAR]: 'k3f9', [PROJECT_VAR]: '/p/tree' });
    expect(nodeEnv('k3f9')).not.toHaveProperty(PROJECT_VAR);
    expect(nodeEnv('', '/p/tree')).not.toHaveProperty(PROJECT_VAR);
  });
});
