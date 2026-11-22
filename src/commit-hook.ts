/**
 * The post-commit hook that binds a commit made in a node's session to that
 * node, or to the node the session's agent moved to. The hook itself is one
 * quiet shell line; the decisions live here.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import { t } from './i18n/i18n.js';
import { NODE_VAR, PROJECT_VAR, SESSION_VAR } from './model/notes.js';
import { attachCommit } from './model/ops.js';
import { findProject, loadTree, TREE_DIR } from './model/store.js';
import type { Tree } from './model/types.js';

const BEGIN = '# >>> treeyard';
const END = '# <<< treeyard';
/** Never breaks a commit and says nothing: no node, no treeyard on PATH, any failure — all silent. */
export const HOOK_LINE =
  '[ -n "$TREEYARD_NODE" ] && command -v treeyard >/dev/null 2>&1 && treeyard hook post-commit >/dev/null 2>&1 || true';
const BLOCK = `${BEGIN}\n${HOOK_LINE}\n${END}\n`;
const BLOCK_RE = /\n?# >>> treeyard\n[\s\S]*?# <<< treeyard\n?/;

/** Variables git sets for its hooks; they would redirect any git command to the repository being committed to. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|COMMON_DIR)$/.test(key)) delete env[key];
  return env;
}

function gitOut(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd,
      env: { ...cleanEnv(), LC_ALL: 'C' },
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

/** realpath of the deepest existing part, so a hooks folder that is not created yet can be compared. */
function real(path: string): string {
  const full = resolve(path);
  try {
    return realpathSync(full);
  } catch {
    const up = dirname(full);
    return up === full ? full : join(real(up), full.slice(up.length + 1));
  }
}

export interface HookPlace {
  dir: string;
  file: string;
  /** core.hooksPath points into the working tree (husky and the like): those files are in git, we do not write there. */
  tracked: boolean;
}

/** Where the post-commit hook of the repository of `cwd` lives; undefined outside a repository. */
export function hookPlace(cwd: string): HookPlace | undefined {
  const raw = gitOut(cwd, ['rev-parse', '--git-path', 'hooks']);
  if (!raw) return undefined;
  const dir = resolve(cwd, raw);
  const top = gitOut(cwd, ['rev-parse', '--show-toplevel']);
  const common = gitOut(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const inTree = top ? real(dir).startsWith(real(top) + sep) : false;
  const inGit = common ? real(dir).startsWith(real(common) + sep) : false;
  return { dir, file: join(dir, 'post-commit'), tracked: inTree && !inGit };
}

/** Whether the hook is in place; cheap and synchronous, the agent's context asks it. */
export function hookInstalled(cwd: string): boolean {
  const place = hookPlace(cwd);
  if (!place) return false;
  try {
    return readFileSync(place.file, 'utf8').includes('treeyard hook post-commit');
  } catch {
    return false;
  }
}

export type HookResult =
  | { kind: 'installed' | 'already' | 'removed' | 'absent'; file: string }
  /** The hook folder is in the repository: the person adds the line there themselves. */
  | { kind: 'manual'; file: string };

const SHELL = /^#!.*\b(?:sh|bash|zsh|dash|ksh)\b(?!\w)/;

function place(cwd: string): HookPlace {
  const found = hookPlace(cwd);
  if (!found) throw new Error(t('здесь нет Git-репозитория — хук ставить некуда'));
  return found;
}

export function installHook(cwd: string): HookResult {
  const { file, dir, tracked } = place(cwd);
  if (tracked) return { kind: 'manual', file };
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `#!/bin/sh\n${BLOCK}`);
    chmodSync(file, 0o755);
    return { kind: 'installed', file };
  }
  const text = readFileSync(file, 'utf8');
  if (BLOCK_RE.test(text)) return { kind: 'already', file };
  // A hook in another language cannot take a shell line; a file without a shebang is run by sh.
  if (text.startsWith('#!') && !SHELL.test(text.split('\n')[0]!))
    throw new Error(t('{file} — не shell-скрипт: добавь вызов treeyard hook post-commit сам', { file }));
  writeFileSync(file, `${text}${text.endsWith('\n') || !text ? '' : '\n'}${BLOCK}`);
  return { kind: 'installed', file };
}

export function removeHook(cwd: string): HookResult {
  const { file, tracked } = place(cwd);
  if (tracked) return { kind: 'manual', file };
  if (!existsSync(file)) return { kind: 'absent', file };
  const text = readFileSync(file, 'utf8');
  if (!BLOCK_RE.test(text)) return { kind: 'absent', file };
  const rest = text.replace(BLOCK_RE, '\n');
  // Our file, with nothing of the person's in it, goes away entirely.
  if (rest.replace(/^#!.*$/m, '').trim() === '') unlinkSync(file);
  else writeFileSync(file, rest.replace(/\n{3,}/g, '\n\n'));
  return { kind: 'removed', file };
}

export interface HookStatus {
  installed: boolean;
  file: string;
  tracked: boolean;
}

export function hookStatus(cwd: string): HookStatus {
  const { file, tracked } = place(cwd);
  return { installed: hookInstalled(cwd), file, tracked };
}

/** Where the sessions' moves are kept: per machine, out of git, like the rest of `.tree/.local/`. */
function movesFile(dir: string): string {
  return join(dir, TREE_DIR, '.local', 'sessions.json');
}

interface Move {
  /** The node the session was opened from. */
  from: string;
  /** The node its agent set to «в работе» last. */
  node: string;
  at: string;
}

/** A move older than this belongs to a session long gone. */
const MOVE_DAYS = 30;

function readMoves(dir: string): Record<string, Move> {
  try {
    const data = JSON.parse(readFileSync(movesFile(dir), 'utf8')) as Record<string, Partial<Move>>;
    const moves: Record<string, Move> = {};
    for (const [session, move] of Object.entries(data ?? {}))
      if (typeof move?.from === 'string' && typeof move.node === 'string' && typeof move.at === 'string')
        moves[session] = { from: move.from, node: move.node, at: move.at };
    return moves;
  } catch {
    return {};
  }
}

/**
 * The agent of a node's session set node `id` of the session's own tree to «в работе»: the work
 * moved there, and the session's commits follow it. The node the session was opened from moves
 * them back. Sessions without a mark (started before TREEYARD_SESSION) and other trees keep
 * binding to the opening node.
 */
export function noteMove(tree: Tree, id: string, env: NodeJS.ProcessEnv = process.env): void {
  const session = env[SESSION_VAR]?.trim();
  const from = env[NODE_VAR]?.trim();
  const project = env[PROJECT_VAR]?.trim();
  if (!session || !from || !project || real(project) !== real(tree.project.dir)) return;
  const dir = tree.project.dir;
  const moves = readMoves(dir);
  if (id === from) {
    if (!moves[session]) return;
    delete moves[session];
  } else moves[session] = { from, node: id, at: new Date().toISOString() };
  const since = Date.now() - MOVE_DAYS * 86_400_000;
  for (const [key, move] of Object.entries(moves)) if (!(Date.parse(move.at) >= since)) delete moves[key];
  try {
    mkdirSync(dirname(movesFile(dir)), { recursive: true });
    writeFileSync(movesFile(dir), `${JSON.stringify(moves, null, 2)}\n`);
  } catch {
    // The status is written already; without the move the commits just stay with the opening node.
  }
}

/** The node a commit of the session belongs to: where its agent moved, or the node it was opened from. */
export function sessionNode(tree: Tree, env: NodeJS.ProcessEnv): string | undefined {
  const opened = env[NODE_VAR]?.trim();
  if (!opened) return undefined;
  const session = env[SESSION_VAR]?.trim();
  const move = session ? readMoves(tree.project.dir)[session] : undefined;
  // A node removed since then takes nothing.
  if (move && move.from === opened && tree.nodes.has(move.node)) return move.node;
  return tree.nodes.has(opened) ? opened : undefined;
}

/** Binds HEAD of the repository of `cwd` to the session's node; undefined (and no noise) when it does not apply. */
export function bindHeadCommit(env: NodeJS.ProcessEnv, cwd: string): string | undefined {
  if (!env[NODE_VAR]?.trim()) return undefined;
  // Sessions from before TREEYARD_PROJECT: the tree of the current folder.
  const project = env[PROJECT_VAR]?.trim() || findProject(cwd);
  if (!project) return undefined;
  const tree = loadTree(project);
  const id = sessionNode(tree, env);
  if (!id) return undefined;
  // A commit in another repository (the agent stepped into a neighbour) is not this tree's work.
  const here = gitOut(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const there = gitOut(project, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!here || !there || real(here) !== real(there)) return undefined;
  const sha = gitOut(cwd, ['rev-parse', 'HEAD']);
  if (!sha) return undefined;
  // A commit of the tree's own files (`treeyard commit`) is not work on the node; binding it would
  // write the node file again and leave the tree changed right after its commit.
  const files = gitOut(cwd, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD']);
  const paths = files?.split('\0').filter(Boolean) ?? [];
  if (paths.length && paths.every((path) => /(^|\/)\.tree\//.test(path))) return undefined;
  attachCommit(tree, id, sha, env.TREEYARD_AS?.trim() || t('агент'));
  return sha;
}
