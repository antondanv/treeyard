/**
 * The project's Markdown documents, for the root's «Документы» window: which
 * ones there are, and reading and saving one. Git decides what belongs to the
 * project (tracked and new files, not ignored ones); without Git the folder
 * is walked. Nodes and the generated overview are the tree, not documents.
 */
import { execFile } from 'node:child_process';
import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { plural, t } from './i18n/i18n.js';
import { parseDocument } from './model/frontmatter.js';
import { atomicWrite } from './model/store.js';

const exec = promisify(execFile);

/** The root itself: goal, method, rules for agents, decisions. */
export const TREE_DOC = '.tree/tree.md';
const FIRST = ['README.md', 'AGENTS.md', 'CLAUDE.md'];
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', 'target']);
const MAX_FILES = 1000;
const MAX_DEPTH = 8;

export interface DocFile {
  /** From the project folder, with `/`. */
  path: string;
  /** What to call the document in a list: see `docTitle`. */
  title: string;
  lines: number;
  /** Milliseconds, as `statSync` gives them. */
  mtime: number;
}

export interface DocText {
  /** With `\n` line ends, whatever the file uses. */
  text: string;
  crlf: boolean;
  mtime: number;
}

const isMarkdown = (path: string) => /\.(md|markdown)$/i.test(path);

/** What the tree writes itself is not a document: nodes, the overview, local state. */
function inTree(path: string): boolean {
  return path.startsWith('.tree/') && path !== TREE_DOC;
}

async function gitPaths(dir: string): Promise<string[] | undefined> {
  try {
    const { stdout } = await exec(
      'git',
      ['-c', 'core.quotepath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: dir, encoding: 'utf8', timeout: 10_000, maxBuffer: 32 * 1024 * 1024 },
    );
    return stdout.split('\0').filter((path) => path && isMarkdown(path));
  } catch {
    // Not a repository, or no Git: walk the folder instead.
    return undefined;
  }
}

function walkPaths(dir: string): string[] {
  const out: string[] = [];
  const visit = (folder: string, depth: number) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(join(dir, folder), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      const path = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIP.has(entry.name) || depth >= MAX_DEPTH) continue;
        visit(path, depth + 1);
      } else if (entry.isFile() && isMarkdown(entry.name)) out.push(path);
    }
  };
  visit('', 0);
  return out;
}

/** tree.md first, then README, AGENTS, CLAUDE, then the rest of the top folder, then folders. */
function rank(path: string): [number, number, string] {
  if (path === TREE_DOC) return [0, 0, path];
  const top = !path.includes('/');
  const first = FIRST.findIndex((name) => name.toLowerCase() === path.toLowerCase());
  if (top && first >= 0) return [1, first, path];
  return [top ? 2 : 3, 0, path.toLowerCase()];
}

export function sortDocs<T extends { path: string }>(docs: T[]): T[] {
  return [...docs].sort((a, b) => {
    const [ga, fa, pa] = rank(a.path);
    const [gb, fb, pb] = rank(b.path);
    return ga - gb || fa - fb || pa.localeCompare(pb);
  });
}

/** The window «Документы» and `treeyard docs` list the same files in the same order, from here. */
export async function projectDocs(dir: string): Promise<DocFile[]> {
  const found = (await gitPaths(dir)) ?? walkPaths(dir);
  const paths = new Set(found.filter((path) => !inTree(path)));
  if (existsSync(join(dir, TREE_DOC))) paths.add(TREE_DOC);
  // Sorted before the cut, so a big project keeps tree.md and README.
  const kept = sortDocs([...paths].map((path) => ({ path }))).slice(0, MAX_FILES);
  const docs: DocFile[] = [];
  for (const { path } of kept) {
    try {
      const full = join(dir, path);
      const stat = statSync(full);
      if (!stat.isFile()) continue;
      const text = readFileSync(full, 'utf8');
      docs.push({
        path,
        title: docTitle(path, text),
        lines: lineCount(text),
        mtime: stat.mtimeMs,
      });
    } catch {
      // Deleted but still in the index, or unreadable: not a document to open.
    }
  }
  return docs;
}

/**
 * A document's name for a list: `title` of its front matter, else its first top-level heading
 * (`# …`, `…` over `===`, `<h1>…</h1>`; code blocks don't count), else the file name.
 * tree.md is named as the root's menu names it: its `title` is the project's.
 */
export function docTitle(path: string, text: string): string {
  if (path === TREE_DOC) return t('Цель, правила и решения');
  let body = text.replace(/\r\n/g, '\n');
  try {
    const { data, body: rest } = parseDocument(body);
    if (typeof data.title === 'string' && plainText(data.title)) return plainText(data.title);
    body = rest;
  } catch {
    // Broken front matter: the heading may still be there.
  }
  const lines = body.split('\n');
  let fence: string | undefined;
  for (const [index, line] of lines.entries()) {
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      // Closed by the same character, at least as many times, with nothing after it.
      if (mark && mark[0] === fence[0] && mark.length >= fence.length && !line.trim().slice(mark.length).trim())
        fence = undefined;
      continue;
    }
    if (mark) {
      fence = mark;
      continue;
    }
    const heading =
      /^ {0,3}#[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line)?.[1] ??
      /<h1\b[^>]*>(.*?)<\/h1>/i.exec(line)?.[1] ??
      (/^ {0,3}=+[ \t]*$/.test(lines[index + 1] ?? '') && /^ {0,3}\S/.test(line) && !/^ {0,3}[#>|-]/.test(line)
        ? line
        : undefined);
    const title = heading === undefined ? '' : plainText(heading);
    if (title) return title;
  }
  return basename(path).replace(/\.(md|markdown)$/i, '');
}

/** A heading without its Markdown and HTML: links and pictures keep their text. */
function plainText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|`)(.+?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `12 стр.` · `1 line`, `12 lines`. */
export function linesLabel(n: number): string {
  return `${n} ${plural(n, ['стр.', 'стр.', 'стр.'], ['line', 'lines'])}`;
}

/** Lines as an editor numbers them: a final line break does not start another one. */
export function lineCount(text: string): number {
  return text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
}

/** A document's path inside the project; anything that leads out of it is refused. */
export function docPath(dir: string, path: string): string {
  const full = resolve(dir, path);
  const inside = relative(resolve(dir), full);
  if (!inside || inside.startsWith('..') || isAbsolute(inside))
    throw new Error(t('{path} — не в папке проекта', { path }));
  return full;
}

/** Modification time, or 0 when the file is gone. */
export function docStamp(dir: string, path: string): number {
  try {
    return statSync(docPath(dir, path)).mtimeMs;
  } catch {
    return 0;
  }
}

export function readDoc(dir: string, path: string): DocText {
  const full = docPath(dir, path);
  const raw = readFileSync(full, 'utf8');
  return { text: raw.replace(/\r\n/g, '\n'), crlf: raw.includes('\r\n'), mtime: statSync(full).mtimeMs };
}

/**
 * Saves a document in one step (temporary file and rename). tree.md with
 * front matter that does not parse is refused: the tree would not load.
 */
export function writeDoc(dir: string, path: string, text: string, crlf = false): void {
  if (path === TREE_DOC) {
    try {
      parseDocument(text);
    } catch (error) {
      throw new Error(t('tree.md не сохранён: {message}', { message: (error as Error).message }));
    }
  }
  atomicWrite(docPath(dir, path), crlf ? text.replace(/\n/g, '\r\n') : text);
}
