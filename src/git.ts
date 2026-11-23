/** Read-only Git data shared by the node's CLI and TUI diff viewers. */
import { execFile, execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { promisify } from 'node:util';
import { t } from './i18n/i18n.js';

const exec = promisify(execFile);
const MAX_BYTES = 8 * 1024 * 1024;
const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--no-textconv', '--find-renames'];

async function git(dir: string, args: string[], difference = false): Promise<string> {
  try {
    const result = await exec('git', ['--no-pager', '--literal-pathspecs', '-c', 'core.quotepath=false', ...args], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: MAX_BYTES,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    });
    return result.stdout;
  } catch (error) {
    const failed = error as Error & { code?: string | number; stdout?: string; stderr?: string; killed?: boolean };
    // --no-index reports a difference with exit 1, even when it succeeded.
    if (difference && failed.code === 1) return failed.stdout ?? '';
    if (failed.code === 'ENOENT') throw new Error(t('Git не установлен'));
    if (failed.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
      throw new Error(t('диф слишком большой для просмотра (больше 8 МБ)'));
    if (failed.killed) throw new Error(t('Git не ответил за 15 секунд'));
    throw new Error(t('Git: {message}', { message: failed.stderr?.trim() || failed.message }));
  }
}

export interface GitCommit {
  sha: string;
  subject: string;
  date: string;
  parents: string[];
}

export interface GitFile {
  path: string;
  oldPath?: string;
  status: string;
  added: number | null;
  removed: number | null;
  binary: boolean;
}

export type WorkingKind = 'staged' | 'unstaged' | 'untracked';
export type DiffSource =
  | { kind: 'commit'; commit: GitCommit }
  | { kind: 'staged' }
  | { kind: 'unstaged' }
  | { kind: 'untracked' };
export type WorkingChanges = Record<WorkingKind, GitFile[]>;

/** Names are NUL-delimited: tabs, newlines and rename arrows can belong to a filename. */
function nameStatus(text: string): GitFile[] {
  const parts = text.split('\0');
  const files: GitFile[] = [];
  let at = 0;
  while (parts[at]) {
    const status = parts[at++]!;
    const path = parts[at++];
    if (!path) break;
    const renamed = status.startsWith('R') || status.startsWith('C');
    const next = renamed ? parts[at++] : path;
    if (!next) break;
    files.push({
      path: next,
      ...(renamed ? { oldPath: path } : {}),
      status,
      added: null,
      removed: null,
      binary: false,
    });
  }
  return files;
}

function withStats(files: GitFile[], text: string): GitFile[] {
  const stats = new Map<string, { added: number | null; removed: number | null; binary: boolean }>();
  const parts = text.split('\0');
  for (let at = 0; at < parts.length; at++) {
    const row = parts[at]!;
    const first = row.indexOf('\t');
    const second = row.indexOf('\t', first + 1);
    if (first < 0 || second < 0) continue;
    const added = row.slice(0, first);
    const removed = row.slice(first + 1, second);
    let path = row.slice(second + 1);
    if (!path) {
      at += 2;
      path = parts[at] ?? '';
    }
    stats.set(path, {
      added: added === '-' ? null : Number(added),
      removed: removed === '-' ? null : Number(removed),
      binary: added === '-' || removed === '-',
    });
  }
  return files.map((file) => ({ ...file, ...stats.get(file.path) }));
}

function commitRow(row: string): GitCommit {
  const [sha = '', date = '', parents = '', subject = ''] = row.trimEnd().split('\0');
  return { sha, date, parents: parents.split(' ').filter(Boolean), subject };
}

export async function gitRepository(dir: string): Promise<GitRepository> {
  try {
    const root = (await git(dir, ['rev-parse', '--show-toplevel'])).replace(/\n$/, '');
    return new GitRepository(root);
  } catch (error) {
    if ((error as Error).message.includes('not a git repository'))
      throw new Error(t('здесь нет Git-репозитория — дифы недоступны'));
    throw error;
  }
}

/**
 * The repository whose refs a command means. From a git worktree of the same repository (a
 * session's own branch) `HEAD` is that branch's commit even when the tree is the main folder's
 * (`--project`); elsewhere — the repository of the tree's folder.
 */
export async function refRepository(dir: string, cwd = process.cwd()): Promise<GitRepository> {
  try {
    const common = async (where: string) =>
      realpathSync((await git(where, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim());
    if ((await common(cwd)) === (await common(dir))) return await gitRepository(cwd);
  } catch {
    // Outside a repository, or another one: the tree's folder decides.
  }
  return gitRepository(dir);
}

export class GitRepository {
  constructor(readonly dir: string) {}

  async commit(ref: string): Promise<GitCommit> {
    // A ref is anything git resolves (HEAD, a branch, a tag, a short SHA); an option is not a ref.
    if (!ref.trim() || ref.startsWith('-')) throw new Error(t('укажи коммит: SHA, HEAD, ветку или тег'));
    let sha: string;
    try {
      sha = (await git(this.dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim();
    } catch {
      throw new Error(t('коммит {sha} не найден или ссылка неоднозначна', { sha: ref }));
    }
    return commitRow(await git(this.dir, ['show', '-s', '--format=%H%x00%cs%x00%P%x00%s', sha, '--']));
  }

  async recent(limit = 100, skip = 0): Promise<GitCommit[]> {
    // A new repository has no HEAD; its uncommitted files are still viewable.
    try {
      await git(this.dir, ['rev-parse', '--verify', 'HEAD']);
    } catch {
      return [];
    }
    const text = await git(this.dir, [
      'log',
      '--all',
      `--max-count=${limit}`,
      `--skip=${skip}`,
      '--format=%H%x00%cs%x00%P%x00%s',
      '--',
    ]);
    return text.trimEnd() ? text.trimEnd().split('\n').map(commitRow) : [];
  }

  private comparison(source: Exclude<DiffSource, { kind: 'untracked' }>): string[] {
    if (source.kind === 'staged') return ['diff', '--cached'];
    if (source.kind === 'unstaged') return ['diff'];
    const { commit } = source;
    // A merge is compared with its first parent, rather than hiding its patch as a combined diff.
    return commit.parents[0]
      ? ['diff', commit.parents[0], commit.sha]
      : ['diff-tree', '--root', '--no-commit-id', '-r', commit.sha];
  }

  async files(source: Exclude<DiffSource, { kind: 'untracked' }>): Promise<GitFile[]> {
    const base = [...this.comparison(source), ...DIFF_FLAGS];
    const [names, stats] = await Promise.all([
      git(this.dir, [...base, '--name-status', '-z', '--']),
      git(this.dir, [...base, '--numstat', '-z', '--']),
    ]);
    return withStats(nameStatus(names), stats);
  }

  async working(): Promise<WorkingChanges> {
    const [staged, unstaged, names] = await Promise.all([
      this.files({ kind: 'staged' }),
      this.files({ kind: 'unstaged' }),
      git(this.dir, ['ls-files', '--others', '--exclude-standard', '-z']),
    ]);
    const untracked = names
      .split('\0')
      .filter(Boolean)
      .map((path): GitFile => ({ path, status: '?', added: null, removed: null, binary: false }));
    return { staged, unstaged, untracked };
  }

  async patch(source: DiffSource, file?: GitFile): Promise<string> {
    if (source.kind === 'untracked') {
      if (!file) throw new Error(t('выбери новый файл для просмотра'));
      return git(this.dir, ['diff', '--no-index', ...DIFF_FLAGS, '--', '/dev/null', file.path], true);
    }
    const paths = file ? [...(file.oldPath ? [file.oldPath] : []), file.path] : [];
    return git(this.dir, [...this.comparison(source), ...DIFF_FLAGS, '--patch', '--', ...paths]);
  }
}

const uncommittedCache = new Map<string, { at: number; paths: string[] }>();

/**
 * Paths under `dir` with uncommitted changes — staged, unstaged or untracked — relative to
 * it; [] outside Git or when Git fails. Synchronous for an agent context, which is built in
 * one go; a TUI re-renders that context, so an answer lives for two seconds.
 */
export function uncommittedPaths(dir: string): string[] {
  const cached = uncommittedCache.get(dir);
  if (cached && Date.now() - cached.at < 2000) return cached.paths;
  const run = (args: string[]) =>
    execFileSync('git', ['--literal-pathspecs', '-c', 'core.quotepath=false', ...args], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    });
  let paths: string[] = [];
  try {
    const prefix = run(['rev-parse', '--show-prefix']).trim();
    const entries = run(['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--', '.']).split('\0');
    for (let at = 0; at < entries.length; at++) {
      const entry = entries[at]!;
      if (entry.length < 4) continue;
      // `XY path`, relative to the repository's root; a rename is followed by its old path.
      if (entry[0] === 'R' || entry[0] === 'C') at++;
      const path = entry.slice(3);
      paths.push(path.startsWith(prefix) ? path.slice(prefix.length) : path);
    }
  } catch {
    paths = [];
  }
  uncommittedCache.set(dir, { at: Date.now(), paths });
  return paths;
}

/** Keep filenames and code from sending terminal controls; tabs still show indentation. */
export function diffText(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: render terminal controls visibly.
  return text.replace(/\t/g, '    ').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, (char) => {
    if (char === '\r') return '␍';
    return `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`;
  });
}

export function fileLabel(file: GitFile): string {
  return diffText(file.oldPath ? `${file.oldPath} → ${file.path}` : file.path).replace(/\n/g, '↵');
}

export function fileStats(file: GitFile): string {
  if (file.binary) return t('бинарный файл');
  if (file.added === null || file.removed === null) return file.status === '?' ? t('новый файл') : '';
  return `+${file.added} −${file.removed}`;
}
