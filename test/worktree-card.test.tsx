import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { snapshot } from '../src/tui/snapshot.js';
import { ensureWorktree, worktreeParent } from '../src/worktree.js';
import { emptyTree, tempDir } from './helpers.js';

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

const projects: string[] = [];
beforeEach(() => {
  process.env.TREEYARD_HOME = tempDir('treeyard-home-');
  resetSettings({ ...DEFAULTS, animation: false, marquee: false });
});
afterEach(() => {
  resetSettings({ ...DEFAULTS });
  for (const dir of projects.splice(0)) rmSync(worktreeParent(dir), { recursive: true, force: true });
});

function project() {
  const tree = emptyTree();
  const main = tree.project.dir;
  projects.push(main);
  const node = addNode(tree, { title: 'Бот', doneWhen: 'бот отвечает', status: 'active' });
  writeFileSync(join(main, '.gitignore'), '.tree/.local/\n');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'start');
  return { tree: loadTree(main), main, id: node.id };
}

describe('the worktree in the tree', () => {
  it('the node card shows the branch, the folder and the commits of the branch', async () => {
    const { tree, main, id } = project();
    const { worktree } = await ensureWorktree(tree, id);
    writeFileSync(join(worktree.dir, 'a.txt'), 'a\n');
    git(worktree.dir, 'add', 'a.txt');
    git(worktree.dir, 'commit', '-q', '-m', 'a');
    const frame = await snapshot(main, { columns: 130, rows: 36, ui: { inspector: true, selected: id } });
    expect(frame).toContain(`worktree: ветка treeyard/${id}`);
    expect(frame).toMatch(/\.worktrees\/\w{4}/);
    // Nobody attached the commit: the branch is what the card reads.
    expect(frame).toContain('коммитов: 1 · V — дифы');
  });

  it('the launch form offers a worktree to every brain, not to Claude Code alone', async () => {
    const { main } = project();
    const LEFT = '\u001b[D';
    const DOWN = '\u001b[B';
    // Codex is the brain after Claude Code; the worktree row is the last one.
    const frame = await snapshot(main, {
      columns: 110,
      rows: 34,
      keys: ['o', '\u001b[C', ...Array.from({ length: 6 }, () => DOWN)],
    });
    expect(frame).toMatch(/Мозг\s+.*Codex/);
    expect(frame).toMatch(/Worktree\s+нет/);
    expect(frame).not.toContain('только Claude Code');
    expect(LEFT).toBeTruthy();
  });
});
