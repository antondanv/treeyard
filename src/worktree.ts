/**
 * A git worktree of a node: its own folder and branch, so sessions of any CLI
 * work in parallel without stepping on each other, and what a node's session
 * committed is the node's — read from its branch, no hook and no `--add`.
 *
 * Treeyard makes the worktree, not the CLI (Claude Code's own `--worktree`
 * would leave Codex, OpenCode and Antigravity in one folder): the branch is
 * `treeyard/<id>`, the folder stands next to the project, and a registry in
 * `.tree/.local/` (per machine, out of git) remembers where, and from which
 * commit the branch started. Commands run in the worktree write the main
 * tree, not the branch's copy of `.tree/`.
 *
 * Work is not lost: a worktree with uncommitted changes or commits that are
 * not in the main folder's branch is not removed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { pick, t } from './i18n/i18n.js';
import { PROJECT_VAR } from './model/notes.js';
import { attachCommits } from './model/ops.js';
import { findProject, TREE_DIR } from './model/store.js';
import { nowIso } from './model/time.js';
import type { SessionRef, Tree, TreeNode } from './model/types.js';
import { childEnv } from './node-env.js';

/** The branch of a node: its id is in the name, so a branch finds its node and back. */
export const BRANCH_PREFIX = 'treeyard/';

export function branchOf(id: string): string {
  return `${BRANCH_PREFIX}${id}`;
}

/** The node a branch belongs to, from its name. */
export function nodeOfBranch(branch: string): string | undefined {
  return branch.startsWith(BRANCH_PREFIX) ? branch.slice(BRANCH_PREFIX.length) || undefined : undefined;
}

/**
 * What a launch wants of worktrees: `true` — the node's own, made if need be, or the launch fails;
 * `false` — the project's folder; `'auto'` — one if it can be made (treeyard split the nodes between
 * folders by itself), else the project's folder; not said — the node's worktree if it has one.
 */
export type WorktreeWish = boolean | 'auto';

/** Files to copy into a new worktree: untracked ones that match these patterns (gitignore syntax). */
export const INCLUDE_FILE = '.worktreeinclude';

/** A copy of more files than this is a pattern gone wrong (`node_modules`), not a settings file. */
const MAX_COPIED = 20_000;

export interface NodeWorktree {
  id: string;
  branch: string;
  /** The checkout's top folder. */
  path: string;
  /** Where the session works: the project's folder inside the checkout; `path` unless the tree is in a subfolder. */
  dir: string;
  /** The commit the branch started from: what the branch added is what comes after it. */
  base: string;
  created: string;
  /** The setup command ran (or there was none): a worktree that is not prepared gets it again before a session. */
  prepared: boolean;
}

// ── git ─────────────────────────────────────────────────────────────────────

interface Git {
  ok: boolean;
  status: number | null;
  out: string;
  err: string;
}

/** Variables git sets for its hooks would redirect any git command to the repository being committed to. */
function gitEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' };
  for (const key of Object.keys(env))
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|COMMON_DIR)$/.test(key)) delete env[key];
  return extra ? { ...env, ...extra } : env;
}

function git(cwd: string, args: string[], timeout = 30_000, extraEnv?: NodeJS.ProcessEnv): Git {
  const run = spawnSync('git', ['--no-pager', ...args], {
    cwd,
    env: gitEnv(extraEnv),
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    ok: run.status === 0,
    status: run.status,
    out: run.stdout ?? '',
    err: (run.stderr ?? run.error?.message ?? '').trim(),
  };
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function insideFolder(path: string, folder: string): boolean {
  const [a, b] = [real(path), real(folder)];
  return a === b || a.startsWith(b + sep);
}

/** Whether two paths point to the same folder (handling symlinks like `/var` vs `/private/var`). */
export function sameFolder(a: string, b: string): boolean {
  return a === b || real(a) === real(b);
}

/** Top-level folder of the git repository containing `dir`, or `undefined` outside git. */
export function repoRoot(dir: string): string | undefined {
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  return top.ok && top.out.trim() ? top.out.trim() : undefined;
}

// ── The registry ────────────────────────────────────────────────────────────

type Entry = Omit<NodeWorktree, 'id'>;

function registryFile(project: string): string {
  return join(project, TREE_DIR, '.local', 'worktrees.json');
}

const registryCache = new Map<string, { mtime: number; size: number; data: Record<string, Entry> }>();

function readRegistry(project: string): Record<string, Entry> {
  const file = registryFile(project);
  let mtime: number;
  let size: number;
  try {
    ({ mtimeMs: mtime, size } = statSync(file));
  } catch {
    return {};
  }
  const known = registryCache.get(project);
  // A tree of hundreds of nodes asks for every one of them: the file is read once while it stays as it is.
  if (known && known.mtime === mtime && known.size === size) return structuredClone(known.data);
  const data = parseRegistry(file);
  registryCache.set(project, { mtime, size, data });
  return structuredClone(data);
}

function parseRegistry(file: string): Record<string, Entry> {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Partial<Entry>>;
    const out: Record<string, Entry> = {};
    for (const [id, entry] of Object.entries(data ?? {})) {
      if (typeof entry?.path !== 'string' || typeof entry.branch !== 'string' || typeof entry.base !== 'string')
        continue;
      out[id] = {
        path: entry.path,
        branch: entry.branch,
        dir: typeof entry.dir === 'string' ? entry.dir : entry.path,
        base: entry.base,
        created: typeof entry.created === 'string' ? entry.created : '',
        prepared: entry.prepared !== false,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeRegistry(project: string, data: Record<string, Entry>): void {
  const file = registryFile(project);
  mkdirSync(dirname(file), { recursive: true });
  registryCache.delete(project);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(temp, file);
}

/** Whether the checkout is still there: a folder somebody removed by hand is no worktree. */
function alive(entry: Entry): boolean {
  try {
    return statSync(join(entry.path, '.git')).isFile();
  } catch {
    return false;
  }
}

/** The worktree of a node that stands on disk; undefined when it has none. */
export function worktreeFor(project: string, id: string): NodeWorktree | undefined {
  const entry = readRegistry(project)[id];
  return entry && alive(entry) ? { id, ...entry } : undefined;
}

/** Every worktree of the project that stands on disk. */
export function worktreesOf(project: string): NodeWorktree[] {
  return Object.entries(readRegistry(project))
    .filter(([, entry]) => alive(entry))
    .map(([id, entry]) => ({ id, ...entry }));
}

const dirsCache = new Map<string, { at: number; mtime: number; dirs: string[] }>();

/**
 * The folders of the project's worktrees: sessions started there are the project's too. Read
 * on every pane check, so it stays cheap: the file's time says whether it changed.
 */
export function worktreeDirs(project: string): string[] {
  let mtime = 0;
  try {
    mtime = statSync(registryFile(project)).mtimeMs;
  } catch {
    return [];
  }
  const now = Date.now();
  const known = dirsCache.get(project);
  // A folder removed by hand drops out within a few seconds.
  if (known && known.mtime === mtime && now - known.at < 5000) return known.dirs;
  const dirs = worktreesOf(project).map((wt) => wt.dir);
  dirsCache.set(project, { at: now, mtime, dirs });
  return dirs;
}

/** Whether `dir` is the project's folder or one of its worktrees. */
export function inProjectFolders(project: string, dir: string): boolean {
  return real(dir) === real(project) || worktreeDirs(project).some((wt) => insideFolder(dir, wt));
}

/** The folder a session runs in: where it was started (its worktree), the project's folder for the rest. */
export function sessionFolder(project: string, ref: Pick<SessionRef, 'dir'>): string {
  return ref.dir && existsSync(ref.dir) ? ref.dir : project;
}

/**
 * The main tree for a command run inside a linked git worktree: one treeyard made, or one whose
 * main checkout holds the tree named in `TREEYARD_PROJECT` (a session opened from a node that
 * moved into Claude Code's own worktree, or a helper given `TREEYARD_PROJECT`). Commands write to
 * the main tree, not the branch's copy of `.tree/`. Undefined for any other folder, including a
 * person's own git worktree without `TREEYARD_PROJECT` or a different repository.
 */
export function treeOfWorktree(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (let at = resolve(cwd); ; ) {
    const dotGit = join(at, '.git');
    try {
      if (statSync(dotGit).isDirectory()) return undefined;
      const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim();
      if (!gitdir || !/[\\/]worktrees[\\/][^\\/]+$/.test(gitdir)) return undefined;
      const common = dirname(dirname(resolve(at, gitdir)));
      if (basename(common) !== '.git') return undefined;
      const main = dirname(common);
      const project = findProject(join(main, relative(real(at), real(cwd))));
      if (project && insideFolder(project, main) && worktreesOf(project).some((wt) => real(wt.path) === real(at)))
        return project;
      const fromEnv = env[PROJECT_VAR]?.trim();
      if (!fromEnv) return undefined;
      const envPath = resolve(cwd, fromEnv.replace(/^~(?=$|\/)/, homedir()));
      const envDir = existsSync(envPath) ? findProject(envPath) : undefined;
      if (!envDir || !insideFolder(envDir, main)) return undefined;
      return project && real(envDir) === real(project) ? project : real(envDir);
    } catch {
      // No `.git` here: look further up.
    }
    const up = dirname(at);
    if (up === at) return undefined;
    at = up;
  }
}

// ── Making one ──────────────────────────────────────────────────────────────

/** Where the worktrees of a repository stand: next to it, so no tool of the project scans them. */
export function worktreeParent(top: string): string {
  return join(dirname(top), `${basename(top)}.worktrees`);
}

export interface Prepared {
  worktree: NodeWorktree;
  /** The worktree was made now (and not found as it was). */
  created: boolean;
  /** Files copied from the main folder by `.worktreeinclude`. */
  copied: number;
  warnings: string[];
}

/**
 * The worktree of a node: found, or made — the branch `treeyard/<id>` from the commit the main
 * folder stands on, the files `.worktreeinclude` names, the project's `setup` command. A setup
 * that fails throws: a session in a folder that is not ready would only find out by itself.
 * The worktree stays, and the next call runs the setup again.
 */
export async function ensureWorktree(tree: Tree, id: string): Promise<Prepared> {
  const project = tree.project.dir;
  const warnings: string[] = [];
  let created = false;
  let copied = 0;
  let wt = worktreeFor(project, id);
  if (!wt) {
    wt = makeWorktree(project, id);
    created = true;
    copied = copyIncluded(project, wt, warnings) + copyLocalHooks(project, wt);
  }
  if (!wt.prepared) {
    const setup = tree.project.setup;
    if (setup) {
      const result = await runSetup(setup, wt.dir, id, project);
      if (!result.ok)
        throw new Error(
          t('подготовка worktree не прошла ({setup}): {output} — поправь и повтори: treeyard worktree setup {id}', {
            setup,
            output: result.output || t('без вывода'),
            id,
          }),
        );
    }
    wt = markPrepared(project, wt);
  }
  return { worktree: wt, created, copied, warnings };
}

function makeWorktree(project: string, id: string): NodeWorktree {
  const top = git(project, ['rev-parse', '--show-toplevel']);
  if (!top.ok) throw new CannotMake(t('worktree нужен git-репозиторий, а здесь его нет'));
  const root = top.out.trim();
  const head = git(project, ['rev-parse', '--verify', 'HEAD']);
  if (!head.ok) throw new CannotMake(t('в репозитории ещё нет ни одного коммита — worktree не от чего заводить'));
  const branch = branchOf(id);
  const path = join(worktreeParent(root), id);
  if (existsSync(path))
    throw new CannotMake(t('папка {path} уже занята — убери её или назови другой узел', { path: path }));
  mkdirSync(dirname(path), { recursive: true });
  const exists = git(project, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
  let base = head.out.trim();
  if (exists) {
    // A branch left from an earlier worktree: the node goes on where it stopped.
    const added = git(project, ['worktree', 'add', path, branch]);
    if (!added.ok) throw new CannotMake(t('git worktree: {message}', { message: added.err }));
    const mergeBase = git(project, ['merge-base', branch, 'HEAD']);
    if (mergeBase.ok && mergeBase.out.trim()) base = mergeBase.out.trim();
  } else {
    const added = git(project, ['worktree', 'add', '-b', branch, path, base]);
    if (!added.ok) throw new CannotMake(t('git worktree: {message}', { message: added.err }));
  }
  const entry: Entry = {
    path,
    dir: join(path, relative(real(root), real(project))),
    branch,
    base,
    created: nowIso(),
    prepared: false,
  };
  const registry = readRegistry(project);
  registry[id] = entry;
  writeRegistry(project, registry);
  return { id, ...entry };
}

function markPrepared(project: string, wt: NodeWorktree): NodeWorktree {
  const registry = readRegistry(project);
  const entry = registry[wt.id];
  if (entry) {
    entry.prepared = true;
    writeRegistry(project, registry);
  }
  return { ...wt, prepared: true };
}

const LOCAL_HOOK_FILES = [
  ['.claude', 'settings.local.json'],
  ['.codex', 'hooks.json'],
] as const;

/**
 * Project-local settings and mail hooks (`.claude/settings.local.json`, `.codex/hooks.json`) go to
 * the node's worktree too: it is the same project, and Claude Code and Codex read them from the
 * folder the session runs in. Tracked or already-present files in the worktree are left alone.
 */
function copyLocalHooks(project: string, wt: NodeWorktree): number {
  let copied = 0;
  for (const parts of LOCAL_HOOK_FILES) {
    const from = join(project, ...parts);
    const to = join(wt.path, ...parts);
    if (!existsSync(from) || existsSync(to)) continue;
    try {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      copied++;
    } catch {
      // Only a convenience.
    }
  }
  return copied;
}

/** `.worktreeinclude`: untracked files of the main folder that match its patterns go to the new worktree. */
function copyIncluded(project: string, wt: NodeWorktree, warnings: string[]): number {
  const root = git(project, ['rev-parse', '--show-toplevel']).out.trim();
  const file = join(root, INCLUDE_FILE);
  if (!root || !existsSync(file)) return 0;
  const listed = git(root, ['ls-files', '-z', '--others', '--ignored', `--exclude-from=${file}`]);
  if (!listed.ok) {
    warnings.push(t('{file} не прочитан: {message}', { file: INCLUDE_FILE, message: listed.err }));
    return 0;
  }
  const names = listed.out.split('\0').filter(Boolean);
  if (names.length > MAX_COPIED) {
    warnings.push(
      t('{file} назвал {n} файлов — это больше {max}, ничего не копирую; сузь шаблоны', {
        file: INCLUDE_FILE,
        n: names.length,
        max: MAX_COPIED,
      }),
    );
    return 0;
  }
  let copied = 0;
  for (const name of names) {
    const from = join(root, name);
    const to = join(wt.path, name);
    // Never out of the repository, never over what the worktree already has.
    if (!insideFolder(from, root) || existsSync(to)) continue;
    try {
      mkdirSync(dirname(to), { recursive: true });
      const stat = lstatSync(from);
      if (stat.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
      else if (stat.isFile()) copyFileSync(from, to);
      else continue;
      copied++;
    } catch (error) {
      warnings.push(t('не скопирован {name}: {message}', { name, message: (error as Error).message }));
    }
  }
  return copied;
}

export interface SetupResult {
  ok: boolean;
  /** The tail of what the command printed. */
  output: string;
}

const SETUP_TIMEOUT_MS = 10 * 60_000;

/** Runs the project's setup command in the worktree: `npm install`, a build, whatever the project needs there. */
export function runSetup(command: string, cwd: string, id: string, project: string): Promise<SetupResult> {
  return new Promise((done) => {
    const child = spawn('sh', ['-c', command], {
      cwd,
      env: childEnv({ TREEYARD_WORKTREE: cwd, TREEYARD_NODE: id, TREEYARD_PROJECT: project }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const take = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-2000);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => child.kill('SIGTERM'), SETUP_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      done({ ok: false, output: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ ok: code === 0, output: output.trim() });
    });
  });
}

/** Copies the files and runs the setup again in a worktree that stands: after a change of `.worktreeinclude` or the setup. */
export async function prepareAgain(tree: Tree, id: string): Promise<Prepared> {
  const project = tree.project.dir;
  const wt = worktreeFor(project, id);
  if (!wt) throw new Error(t('у узла нет worktree — treeyard worktree add {id}', { id }));
  const warnings: string[] = [];
  const copied = copyIncluded(project, wt, warnings) + copyLocalHooks(project, wt);
  markUnprepared(project, id);
  return { ...(await ensureWorktree(tree, id)), created: false, copied, warnings };
}

function markUnprepared(project: string, id: string): void {
  const registry = readRegistry(project);
  const entry = registry[id];
  if (!entry) return;
  entry.prepared = false;
  writeRegistry(project, registry);
}

/**
 * Where a session of a node starts. `want`: true — in the node's worktree (made if need be); false —
 * in the project's folder; undefined — in the worktree the node already has, else in the folder.
 */
export async function sessionPlace(
  tree: Tree,
  id: string,
  want: WorktreeWish | undefined,
): Promise<{ dir: string; worktree?: NodeWorktree; created: boolean; warnings: string[] }> {
  const project = tree.project.dir;
  const own = id === 'root' ? undefined : worktreeFor(project, id);
  if (want === false || (want === undefined && !own)) return { dir: project, created: false, warnings: [] };
  if (id === 'root')
    return {
      dir: project,
      created: false,
      warnings: [t('у сессии про весь проект нет worktree — она в папке проекта')],
    };
  // Not a repository: there are no worktrees to split the nodes between, as before.
  if (want === 'auto' && !own && !git(project, ['rev-parse', '--show-toplevel']).ok)
    return { dir: project, created: false, warnings: [] };
  try {
    const prepared = await ensureWorktree(tree, id);
    return {
      dir: prepared.worktree.dir,
      worktree: prepared.worktree,
      created: prepared.created,
      warnings: prepared.warnings,
    };
  } catch (error) {
    // The split was treeyard's idea: a worktree that cannot be made is a warning, not a failed launch.
    if (want === 'auto' && error instanceof CannotMake)
      return { dir: project, created: false, warnings: [`${error.message} — ${t('сессия в папке проекта')}`] };
    throw error;
  }
}

/** A worktree that could not be made (no repository, no commit, the folder taken) — as opposed to a setup that failed. */
export class CannotMake extends Error {}

/**
 * Which of the nodes started together get a worktree: all but the first — that one stays in the
 * project's folder — unless the person said (`--worktree`, `--no-worktree`). One node, or nodes
 * started one after another, need none.
 */
export function togetherWorktrees(count: number, explicit: WorktreeWish | undefined): (WorktreeWish | undefined)[] {
  return Array.from({ length: count }, (_, at) => (explicit !== undefined ? explicit : at > 0 ? 'auto' : undefined));
}

// ── What is in it ───────────────────────────────────────────────────────────

export interface WorktreeState {
  /** Changed, staged or new files not committed yet. */
  dirty: string[];
  /** Commits of the branch that the main folder's branch does not have yet, oldest first. */
  unmerged: string[];
  /** All commits the branch made since it started, oldest first. */
  commits: string[];
  /** The branch is gone (deleted by hand). */
  noBranch: boolean;
}

export function worktreeState(project: string, wt: NodeWorktree): WorktreeState {
  const status = git(wt.path, ['status', '--porcelain=v1', '--untracked-files=all', '-z']);
  const dirty = status.out
    .split('\0')
    .filter(Boolean)
    // A rename names two paths; the second has no status in front of it.
    .filter((entry) => /^[ MADRCU?!]{2} /.test(entry))
    .map((entry) => entry.slice(3));
  const noBranch = !git(project, ['rev-parse', '--verify', '--quiet', `refs/heads/${wt.branch}`]).ok;
  const list = (range: string) =>
    noBranch
      ? []
      : git(project, ['rev-list', '--reverse', range])
          .out.split('\n')
          .map((sha) => sha.trim())
          .filter(Boolean);
  return { dirty, unmerged: list(`HEAD..${wt.branch}`), commits: list(`${wt.base}..${wt.branch}`), noBranch };
}

/**
 * The files a node's worktree changes against the main folder's branch: what its branch committed
 * since the two parted (`HEAD...branch` — a branch that was merged, or caught up with the main one,
 * counts only what is its own) and what is not committed yet. Paths from the repository's root, each
 * once; deleted and renamed ones as both names. No branch, no repository — nothing.
 */
export function changedFiles(project: string, wt: NodeWorktree): string[] {
  const names = (run: Git) => run.out.split('\0').filter(Boolean);
  const committed = git(project, ['diff', '--name-only', '--no-renames', '-z', `HEAD...${wt.branch}`]);
  const status = git(wt.path, ['status', '--porcelain=v1', '--untracked-files=all', '--no-renames', '-z']);
  const dirty = names(status)
    .filter((entry) => /^[ MADRCU?!]{2} /.test(entry))
    .map((entry) => entry.slice(3));
  return [...new Set([...(committed.ok ? names(committed) : []), ...dirty])].sort();
}

const OID = /^[0-9a-f]{40,64}$/;

const treeFile = (file: string) => /(^|\/)\.tree\//.test(file);

function fileSha1(root: string, file: string): string | null {
  try {
    return createHash('sha1')
      .update(readFileSync(join(root, file)))
      .digest('hex');
  } catch {
    return null;
  }
}

function statusDirty(cwd: string): string[] | null {
  const status = git(cwd, ['status', '--porcelain=v1', '--untracked-files=all', '--no-renames', '-z']);
  if (!status.ok) return null;
  return status.out
    .split('\0')
    .filter(Boolean)
    .filter((entry) => /^[ MADRCU?!]{2} /.test(entry))
    .map((entry) => entry.slice(3))
    .filter((file) => !treeFile(file));
}

/** Current HEAD commit OID in `dir`, or `null` if none (outside git or unborn branch). */
export function headOf(dir: string): string | null {
  const run = git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  const oid = run.out.trim();
  return run.ok && OID.test(oid) ? oid : null;
}

/** Resolves a commit SHA or ref to its full OID, or `null` if unknown. */
export function resolveCommit(root: string, ref: string): string | null {
  const run = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  const oid = run.out.trim();
  return run.ok && OID.test(oid) ? oid : null;
}

/** Full commit OIDs reachable from `HEAD` that `baseRef` does not have yet. */
export function commitsAheadOf(root: string, baseRef: string): Set<string> {
  const run = git(root, ['rev-list', `${baseRef}..HEAD`]);
  if (!run.ok) return new Set();
  return new Set(
    run.out
      .split('\n')
      .map((sha) => sha.trim())
      .filter((sha) => OID.test(sha)),
  );
}

/** Files touched by a single commit (paths from the repository root, excluding `.tree/`). */
export function commitChangedFiles(root: string, oid: string): string[] {
  const run = git(root, [
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '--no-renames',
    '-r',
    '-m',
    '--root',
    '-z',
    oid,
  ]);
  if (!run.ok) return [];
  return [...new Set(run.out.split('\0').filter((file) => file && !treeFile(file)))].sort();
}

/** Snapshot of the main folder at session start: separates a main-folder node's own edits from prior human dirt. */
export interface MainBaseline {
  head: string;
  /** Dirty files at session start (repo-root-relative, no `.tree/`): sha1 on disk, or `null` when deleted. */
  dirty: Record<string, string | null>;
  at: string;
}

function mainBaselinePath(project: string, id: string): string {
  return join(project, TREE_DIR, '.local', 'main-baseline', `${id}.json`);
}

/**
 * Saves a snapshot of the main folder's HEAD and dirty files (excluding `.tree/`) when a node starts
 * a session without its own worktree. Returns `null` outside a git repository or without commits.
 */
export function saveMainBaseline(project: string, id: string): MainBaseline | null {
  const root = repoRoot(project);
  if (!root) return null;
  const head = headOf(root);
  if (!head) return null;
  const dirtyList = statusDirty(root);
  if (!dirtyList) return null;
  const dirty: Record<string, string | null> = {};
  for (const file of dirtyList) dirty[file] = fileSha1(root, file);
  const baseline: MainBaseline = { head, dirty, at: nowIso() };
  const file = mainBaselinePath(project, id);
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(baseline, null, 2)}\n`);
  renameSync(temp, file);
  return baseline;
}

/** Reads the main-folder baseline saved when node `id` started its session; undefined if none. */
export function readMainBaseline(project: string, id: string): MainBaseline | undefined {
  try {
    const raw = JSON.parse(readFileSync(mainBaselinePath(project, id), 'utf8')) as Partial<MainBaseline>;
    if (typeof raw?.head !== 'string' || !OID.test(raw.head) || typeof raw.dirty !== 'object' || !raw.dirty)
      return undefined;
    const dirty: Record<string, string | null> = {};
    for (const [path, sha] of Object.entries(raw.dirty)) {
      if (typeof sha === 'string' || sha === null) dirty[path] = sha;
    }
    return { head: raw.head, dirty, at: typeof raw.at === 'string' ? raw.at : '' };
  } catch {
    return undefined;
  }
}

/**
 * Uncommitted files in the main folder that are new or changed compared to the node's session-start
 * baseline (by content sha1; without a baseline, every current dirty file). Excludes `.tree/`.
 */
export function mainDirtyFiles(project: string, root: string, id: string): string[] {
  const dirty = statusDirty(root);
  if (!dirty?.length) return [];
  const baseline = readMainBaseline(project, id);
  if (!baseline) return [...new Set(dirty)].sort();
  const out: string[] = [];
  for (const file of dirty) {
    if (!Object.hasOwn(baseline.dirty, file) || fileSha1(root, file) !== baseline.dirty[file]) out.push(file);
  }
  return [...new Set(out)].sort();
}

/** A worktree's HEAD and the tree of its current files (HEAD itself when clean, or a snapshot tree with uncommitted edits). */
export interface WorktreeTree {
  head: string;
  tree: string;
}

/**
 * Builds a tree-ish representing the worktree as it stands on disk (committed + uncommitted edits,
 * including untracked and deleted files) without touching its real git index or working tree.
 */
export function worktreeTree(wt: NodeWorktree): WorktreeTree | null {
  const head = headOf(wt.path);
  if (!head) return null;
  const dirty = statusDirty(wt.path);
  if (!dirty) return null;
  if (!dirty.length) return { head, tree: head };
  const tempDir = mkdtempSync(join(tmpdir(), 'treeyard-merge-'));
  const env = { GIT_INDEX_FILE: join(tempDir, 'index') };
  try {
    if (!git(wt.path, ['read-tree', 'HEAD'], 30_000, env).ok) return null;
    if (!git(wt.path, ['add', '-A'], 30_000, env).ok) return null;
    const written = git(wt.path, ['write-tree'], 30_000, env);
    const tree = written.out.trim();
    return written.ok && OID.test(tree) ? { head, tree } : null;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Builds a tree-ish for a node working in the main folder: `HEAD` plus only the uncommitted files
 * attributed to this node (never prior baseline-dirty files of the person and never `.tree/`),
 * using a temporary index so the real working tree and index stay untouched.
 */
export function mainNodeTree(root: string, ownDirty: readonly string[]): WorktreeTree | null {
  const head = headOf(root);
  if (!head) return null;
  const files = ownDirty.filter((file) => !treeFile(file));
  if (!files.length) return { head, tree: head };
  const tempDir = mkdtempSync(join(tmpdir(), 'treeyard-merge-'));
  const env = { GIT_INDEX_FILE: join(tempDir, 'index') };
  try {
    if (!git(root, ['read-tree', 'HEAD'], 30_000, env).ok) return null;
    const existing: string[] = [];
    const missing: string[] = [];
    for (const file of files) {
      try {
        lstatSync(join(root, file));
        existing.push(file);
      } catch {
        missing.push(file);
      }
    }
    const chunkSize = 200;
    for (let at = 0; at < existing.length; at += chunkSize) {
      if (!git(root, ['add', '--', ...existing.slice(at, at + chunkSize)], 30_000, env).ok) return null;
    }
    for (let at = 0; at < missing.length; at += chunkSize) {
      if (
        !git(
          root,
          ['rm', '--cached', '--ignore-unmatch', '--quiet', '--', ...missing.slice(at, at + chunkSize)],
          30_000,
          env,
        ).ok
      )
        return null;
    }
    const written = git(root, ['write-tree'], 30_000, env);
    const tree = written.out.trim();
    return written.ok && OID.test(tree) ? { head, tree } : null;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Runs a trial three-way merge of two worktree snapshots (`git merge-tree --write-tree`, no checkout,
 * no changes to either working tree or index). Returns the conflicting paths (empty on a clean merge),
 * or `null` if git could not perform the trial merge (old git, missing merge-base, unexpected error).
 */
export function trialMergeConflicts(project: string, a: WorktreeTree, b: WorktreeTree): string[] | null {
  const baseRun = git(project, ['merge-base', a.head, b.head]);
  const base = baseRun.out.trim();
  if (!baseRun.ok || !OID.test(base)) return null;
  const merged = git(project, [
    'merge-tree',
    '--write-tree',
    '--name-only',
    '--no-messages',
    '-z',
    `--merge-base=${base}`,
    a.tree,
    b.tree,
  ]);
  if (merged.status === 0) return [];
  if (merged.status !== 1) return null;
  // Exit 1 is a real conflict only when stdout begins with the merged tree OID; otherwise it is an error.
  const parts = merged.out.split('\0');
  if (!OID.test(parts[0] ?? '')) return null;
  const files: string[] = [];
  for (let at = 1; at < parts.length; at++) {
    const file = parts[at];
    if (!file) break;
    files.push(file);
  }
  return [...new Set(files)].sort();
}

const commitsCache = new Map<string, { at: number; shas: string[] }>();

/** The commits a node's branch made since it started, oldest first; none without a worktree or branch. */
export function branchCommits(project: string, id: string): string[] {
  const entry = readRegistry(project)[id];
  if (!entry) return [];
  const key = `${project}\0${id}`;
  const known = commitsCache.get(key);
  // The tree asks while drawing; a few seconds of age is fine.
  if (known && Date.now() - known.at < 3000) return known.shas;
  const wt: NodeWorktree = { id, ...entry };
  const shas = git(project, ['rev-parse', '--verify', '--quiet', `refs/heads/${wt.branch}`]).ok
    ? git(project, ['rev-list', '--reverse', `${wt.base}..${wt.branch}`])
        .out.split('\n')
        .map((sha) => sha.trim())
        .filter(Boolean)
    : [];
  commitsCache.set(key, { at: Date.now(), shas });
  return shas;
}

/** A node's commits: the ones attached to it and the ones its branch made, each once. */
export function nodeCommits(project: string, node: Pick<TreeNode, 'id' | 'commits'>): string[] {
  const own = node.commits ?? [];
  return [...new Set([...own, ...branchCommits(project, node.id)])];
}

/** What stands in the way of removing a worktree, a line each; none — it can go. */
export function blockers(state: WorktreeState): string[] {
  const out: string[] = [];
  if (state.dirty.length)
    out.push(
      t('не закоммичено файлов: {n} ({files})', {
        n: state.dirty.length,
        files: state.dirty.slice(0, 3).join(', ') + (state.dirty.length > 3 ? ', …' : ''),
      }),
    );
  if (state.unmerged.length) out.push(t('не влито коммитов в ветку основной папки: {n}', { n: state.unmerged.length }));
  return out;
}

export class WorktreeBusy extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join('; '));
  }
}

/**
 * Removes a node's worktree and its branch — only when nothing would be lost: no uncommitted files,
 * no commits that the main folder's branch lacks. The commits the branch made stay with the node.
 */
export function removeWorktree(tree: Tree, id: string): { worktree: NodeWorktree; attached: number } {
  const project = tree.project.dir;
  const wt = worktreeFor(project, id);
  if (!wt) throw new Error(t('у узла нет worktree'));
  const state = worktreeState(project, wt);
  const reasons = blockers(state);
  if (reasons.length) throw new WorktreeBusy(reasons);
  const gone = git(project, ['worktree', 'remove', wt.path]);
  if (!gone.ok) throw new WorktreeBusy([gone.err]);
  if (!state.noBranch) {
    const deleted = git(project, ['branch', '-d', wt.branch]);
    if (!deleted.ok) throw new WorktreeBusy([deleted.err]);
  }
  const node = tree.nodes.get(id);
  const fresh = state.commits.filter((sha) => !node?.commits?.includes(sha));
  if (node && fresh.length) attachCommits(tree, id, fresh, t('ветка {branch} влита и убрана', { branch: wt.branch }));
  const registry = readRegistry(project);
  delete registry[id];
  writeRegistry(project, registry);
  commitsCache.delete(`${project}\0${id}`);
  return { worktree: wt, attached: fresh.length };
}

/** What the session of a node in its worktree is told: where it stands, and that the tree is not here. */
export function worktreeNote(wt: NodeWorktree, project: string): string {
  return pick({
    ru:
      `## Worktree\n\nТы работаешь в отдельном git worktree: папка \`${wt.dir}\`, ветка \`${wt.branch}\`. ` +
      'Коммить сюда, в эту ветку: коммиты видны в узле и в `treeyard diff` сами. ' +
      `Команды treeyard пишут в основное дерево (\`${project}\`), а не в копию \`.tree/\` в этой ветке. ` +
      'Вливает ветку координатор или человек — сам её не вливай и worktree не убирай.',
    en:
      `## Worktree\n\nYou work in a separate git worktree: folder \`${wt.dir}\`, branch \`${wt.branch}\`. ` +
      'Commit here, into this branch: the commits show in the node and in `treeyard diff` by themselves. ' +
      `treeyard commands write to the main tree (\`${project}\`), not to the copy of \`.tree/\` in this branch. ` +
      'The branch is merged by the coordinator or the person — do not merge it yourself and do not remove the worktree.',
  });
}

/** `коммитов: 3 · не влито: 3 · не закоммичено: 2` — what the worktree holds, in a few words. */
export function stateText(state: WorktreeState): string {
  const parts = [t('коммитов: {n}', { n: state.commits.length })];
  if (state.unmerged.length) parts.push(t('не влито: {n}', { n: state.unmerged.length }));
  else if (state.commits.length) parts.push(t('влито'));
  if (state.dirty.length) parts.push(t('не закоммичено: {n}', { n: state.dirty.length }));
  else parts.push(t('чисто'));
  if (state.noBranch) parts.push(t('ветки нет'));
  return parts.join(' · ');
}

/** `~/Projects/X.worktrees/ahhv` rather than the whole home path. */
export function shortPath(path: string): string {
  const home = process.env.HOME ?? '';
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}
