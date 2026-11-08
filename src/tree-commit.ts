/**
 * `treeyard commit <id>…`: a commit of the tree's own files — the nodes named, the overview
 * and `tree.md` — and nothing else. Other sessions share the work folder: their code, their
 * nodes and whatever they staged stay out of this commit and stay staged.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { t } from './i18n/i18n.js';
import { TREE_DIR } from './model/store.js';
import type { Tree } from './model/types.js';

export interface TreeCommit {
  sha: string;
  message: string;
  files: string[];
}

function git(dir: string, args: string[]): string {
  try {
    return execFileSync('git', ['--literal-pathspecs', '-c', 'core.quotepath=false', ...args], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LC_ALL: 'C' },
    });
  } catch (error) {
    const failed = error as Error & { code?: string; stderr?: string };
    if (failed.code === 'ENOENT') throw new Error(t('Git не установлен'));
    throw new Error(t('Git: {message}', { message: failed.stderr?.trim() || failed.message }));
  }
}

/** The tree's files of these nodes that differ from HEAD: changed, new or deleted. */
export function treeChanges(tree: Tree, ids: readonly string[]): string[] {
  const dir = tree.project.dir;
  const paths = [...ids.map((id) => `${TREE_DIR}/nodes/${id}.md`), `${TREE_DIR}/README.md`, `${TREE_DIR}/tree.md`];
  const status = git(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...paths]);
  const changed = new Set<string>();
  // `XY path\0`, a rename adds `\0old path`: the names are relative to the repository's root.
  const root = git(dir, ['rev-parse', '--show-prefix']).trim();
  for (const entry of status.split('\0')) {
    if (entry.length < 4 || entry[2] !== ' ') continue;
    const path = entry.slice(3);
    const mine = paths.find((own) => `${root}${own}` === path);
    if (mine) changed.add(mine);
  }
  return paths.filter((path) => changed.has(path));
}

/** `chore(tree): <titles>`, short enough for a subject line. */
export function treeMessage(tree: Tree, ids: readonly string[]): string {
  const titles = ids.map((id) => tree.nodes.get(id)?.title ?? id).join('; ');
  const subject = `chore(tree): ${titles}`;
  return subject.length > 100 ? `${subject.slice(0, 99)}…` : subject;
}

/** Commits exactly `files`, leaving everything else as it is; new files are added first. */
export function commitTree(tree: Tree, files: readonly string[], message: string): TreeCommit {
  const dir = tree.project.dir;
  const fresh = files.filter((file) => existsSync(join(dir, file)));
  if (fresh.length) git(dir, ['add', '--', ...fresh]);
  // `--only` with paths: the index of others stays staged and out of this commit.
  git(dir, ['commit', '--quiet', '--only', '-m', message, '--', ...files]);
  return { sha: git(dir, ['rev-parse', 'HEAD']).trim(), message, files: [...files] };
}
