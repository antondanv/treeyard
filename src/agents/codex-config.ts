/**
 * What Codex's sandbox lets a session do, as `~/.codex/config.toml` sets it, and the
 * flags that open exactly what an agent from the tree needs on top of that: the tmux
 * socket (`treeyard send`, panes) and the project's `.git` (`git commit`).
 *
 * workspace-write keeps the network and `.git` shut by default. With
 * `sandbox_workspace_write.network_access = true` the tmux socket is reachable, and a
 * `.git` in `writable_roots` takes commits. Only these keys are read: no TOML parser
 * for three of them.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { TREE_DIR } from '../model/store.js';

export interface CodexSandbox {
  /** The config.toml this was read from. */
  file: string;
  /** The top-level `sandbox_mode`; undefined — not set (Codex picks by itself). */
  mode?: string;
  /** `[sandbox_workspace_write] network_access`; undefined — not set (closed). */
  network?: boolean;
  /** `[sandbox_workspace_write] writable_roots`. */
  roots: string[];
}

/** `$CODEX_HOME/config.toml`, else `~/.codex/config.toml`. */
export function codexConfigFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CODEX_HOME?.trim() || join(env.HOME?.trim() || homedir(), '.codex'), 'config.toml');
}

/** A line without its `# comment`; a `#` inside a string stays. */
function bare(line: string): string {
  let quote = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return line.slice(0, i);
  }
  return line;
}

/** How many `[` are still open in this text, strings aside. */
function depth(text: string): number {
  let quote = '';
  let open = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[') open += 1;
    else if (ch === ']') open -= 1;
  }
  return open;
}

function strings(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)) {
    // Basic strings escape `\\` and `\"`: all a path needs.
    out.push(match[2] ?? (match[1] ?? '').replace(/\\(["\\])/g, '$1'));
  }
  return out;
}

const unquote = (value: string): string | undefined => strings(value)[0];

/** The sandbox keys of a config.toml's text. */
export function parseSandbox(text: string): Omit<CodexSandbox, 'file'> {
  const out: Omit<CodexSandbox, 'file'> = { roots: [] };
  let table = '';
  const lines = text.split(/\r?\n/);
  const set = (key: string, value: string) => {
    if (key === 'sandbox_mode') {
      const mode = unquote(value);
      if (mode) out.mode = mode;
    } else if (key === 'sandbox_workspace_write.network_access') {
      if (/^(true|false)\b/.test(value)) out.network = value.startsWith('true');
    } else if (key === 'sandbox_workspace_write.writable_roots') out.roots = strings(value);
    else if (key === 'sandbox_workspace_write' && value.startsWith('{')) {
      // An inline table: the same two keys inside.
      const network = /\bnetwork_access\s*=\s*(true|false)\b/.exec(value)?.[1];
      if (network) out.network = network === 'true';
      const roots = /\bwritable_roots\s*=\s*(\[[^\]]*\])/.exec(value)?.[1];
      if (roots) out.roots = strings(roots);
    }
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = bare(lines[i]!).trim();
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (header) {
      table = header[1]!;
      continue;
    }
    const pair = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line);
    if (!pair) continue;
    let value = pair[2]!;
    // An array may run over several lines.
    while (depth(value) > 0 && i + 1 < lines.length) {
      i += 1;
      value += ` ${bare(lines[i]!).trim()}`;
    }
    set(table ? `${table}.${pair[1]}` : pair[1]!, value.trim());
  }
  return out;
}

/** The sandbox keys of the person's config.toml; none set when there is no file. */
export function readSandbox(env: NodeJS.ProcessEnv = process.env): CodexSandbox {
  const file = codexConfigFile(env);
  try {
    return { file, ...parseSandbox(readFileSync(file, 'utf8')) };
  } catch {
    return { file, roots: [] };
  }
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

const gitDirs = new Map<string, string | undefined>();

/**
 * The repository's own `.git`, by its real path — the one folder that takes a commit made
 * from any worktree of it. Undefined outside a git repository.
 */
export function gitDirOf(dir: string): string | undefined {
  const key = real(dir);
  if (gitDirs.has(key)) return gitDirs.get(key);
  let found: string | undefined;
  try {
    const out = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, LC_ALL: 'C' },
    }).trim();
    if (out) found = real(resolve(dir, out));
  } catch {
    // Not a repository, or no git: nothing to open.
  }
  gitDirs.set(key, found);
  return found;
}

/** What config.toml alone gives a session in this project. */
export interface Reach {
  /** `sandbox_mode = "danger-full-access"`: nothing is shut. */
  full: boolean;
  /** The network (and so the tmux socket) is open. */
  network: boolean;
  /** The project's `.git` takes writes; true when the project has none. */
  git: boolean;
  /** `.git` to add to the writable roots; undefined — nothing to add. */
  gitDir?: string;
}

export function reach(sandbox: CodexSandbox, dir: string): Reach {
  const full = sandbox.mode === 'danger-full-access';
  const gitDir = gitDirOf(dir);
  const roots = sandbox.roots.map((root) => real(root));
  const git = full || !gitDir || roots.includes(gitDir);
  return {
    full,
    network: full || sandbox.network === true,
    git,
    ...(gitDir && !git ? { gitDir } : {}),
  };
}

/** `["a","b"]` as a TOML array of strings. */
function array(items: string[]): string {
  return `[${items.map((item) => JSON.stringify(item)).join(',')}]`;
}

/**
 * Flags for `codex` and `codex resume`: workspace-write with the network open and the
 * project's `.git` and `.tree` among the writable roots; approvals, model and the rest stay as
 * config.toml has them. The person's own writable roots stay too: a `-c` array replaces.
 */
export function sandboxArgs(dir: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const own = readSandbox(env);
  const args = ['--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true'];
  const gitDir = gitDirOf(dir);
  // A session in a node's git worktree works outside the project folder, yet its treeyard
  // commands write the project's tree and mailbox.
  const treeDir = join(dir, TREE_DIR);
  const tree = existsSync(treeDir) ? [treeDir] : [];
  const roots = [...new Set([...own.roots, ...(gitDir ? [gitDir] : []), ...tree])];
  if (roots.length) args.push('-c', `sandbox_workspace_write.writable_roots=${array(roots)}`);
  return args;
}

/**
 * The lines to put in config.toml so that every Codex start — not only treeyard's —
 * reaches the tmux socket and the project's `.git`; empty when it already does.
 */
export function configLines(sandbox: CodexSandbox, dir: string): string[] {
  const state = reach(sandbox, dir);
  if (state.full || (state.network && state.git)) return [];
  const lines: string[] = [];
  // A top-level key stands before the first [table], so it goes first.
  if (sandbox.mode === 'read-only') lines.push('sandbox_mode = "workspace-write"');
  lines.push('[sandbox_workspace_write]');
  if (!state.network) lines.push('network_access = true');
  if (!state.git && state.gitDir) lines.push(`writable_roots = ${array([...sandbox.roots, state.gitDir])}`);
  return lines;
}
