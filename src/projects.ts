/**
 * The folders with trees treeyard has seen, in `~/.treeyard/projects.json`
 * (or `$TREEYARD_HOME/projects.json`). A tree command or the TUI run on a
 * tree remembers its folder, so a program (Treeyard Web) finds the projects
 * by itself instead of keeping a hand-made list.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { projectFromText, TREE_DIR } from './model/store.js';
import { nowIso } from './model/time.js';
import { homeFolder } from './settings.js';

export interface SeenProject {
  /** The folder with `.tree/` in it, by its real path. */
  path: string;
  title: string;
  goal?: string;
  /** ISO time treeyard last saw the tree. */
  seen: string;
}

interface Entry {
  path: string;
  seen: string;
}

/** Seen again sooner than this: the file stays as it is, so many agents at once don't keep rewriting it. */
const REFRESH_MS = 10 * 60_000;
/** The file keeps this many folders, the most recent ones: temporary copies of trees don't pile up forever. */
const KEEP = 500;

export function projectsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeFolder(env), 'projects.json');
}

function readEntries(env: NodeJS.ProcessEnv): Entry[] {
  try {
    const data = JSON.parse(readFileSync(projectsPath(env), 'utf8')) as { projects?: unknown };
    if (!Array.isArray(data.projects)) return [];
    return data.projects.filter(
      (item): item is Entry =>
        typeof item?.path === 'string' && typeof item?.seen === 'string' && Number.isFinite(Date.parse(item.seen)),
    );
  } catch {
    return [];
  }
}

function real(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

/**
 * Whether `dir` is inside a linked git worktree: its `.tree/` is the branch's copy of the
 * main tree, and the person sees the main one. A submodule's `.git` file points to
 * `modules/`, not `worktrees/`, so a submodule with a tree of its own still counts.
 */
export function inLinkedWorktree(dir: string): boolean {
  for (let at = dir; ; ) {
    const git = join(at, '.git');
    try {
      if (statSync(git).isDirectory()) return false;
      const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(git, 'utf8'))?.[1]?.trim() ?? '';
      return /[\\/]worktrees[\\/][^\\/]+$/.test(gitdir);
    } catch {
      // No `.git` here: look further up.
    }
    const up = dirname(at);
    if (up === at) return false;
    at = up;
  }
}

/**
 * Notes that treeyard has seen the tree in `dir`. Never throws: a home folder that can't be
 * written must not break the command that only wanted to read the tree.
 */
export function rememberProject(dir: string, env: NodeJS.ProcessEnv = process.env, now = new Date()): void {
  try {
    const path = real(dir);
    if (inLinkedWorktree(path)) return;
    const entries = readEntries(env);
    const known = entries.find((entry) => entry.path === path);
    if (known && now.getTime() - Date.parse(known.seen) < REFRESH_MS) return;
    const rest = entries.filter((entry) => entry.path !== path);
    const projects = [{ path, seen: nowIso(now) }, ...rest]
      .sort((a, b) => Date.parse(b.seen) - Date.parse(a.seen))
      .slice(0, KEEP);
    const file = projectsPath(env);
    mkdirSync(dirname(file), { recursive: true });
    // A temporary file renamed into place: a reader never sees half of it.
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ projects }, null, 2)}\n`);
    renameSync(temp, file);
  } catch {
    // Not remembered this time; the next command tries again.
  }
}

/** The folders treeyard has seen that still hold a tree, the most recently seen first. */
export function seenProjects(env: NodeJS.ProcessEnv = process.env): SeenProject[] {
  const found: SeenProject[] = [];
  for (const entry of readEntries(env).sort((a, b) => Date.parse(b.seen) - Date.parse(a.seen))) {
    // A folder gone or without its tree stays in the file: a disk that isn't mounted comes back.
    const doc = join(entry.path, TREE_DIR, 'tree.md');
    if (!existsSync(doc) || inLinkedWorktree(entry.path)) continue;
    let text = '';
    try {
      text = readFileSync(doc, 'utf8');
    } catch {
      continue;
    }
    const project = projectFromText(text, entry.path);
    found.push({
      path: entry.path,
      title: project.title,
      ...(project.goal ? { goal: project.goal } : {}),
      seen: entry.seen,
    });
  }
  return found;
}
