/**
 * Two nodes at work that change one file will meet in a merge conflict — and they find out only
 * when the second branch is merged. This reads it earlier, from git: what each node's worktree
 * committed on its branch and what it has not committed yet (`changedFiles`), and where the two
 * sets meet, the pair is told — to the coordinator in `wait` and `queue`, and to both sessions in
 * one letter, once per pair and file.
 *
 * A file the two changed to the same content is no conflict (a settings file copied into every
 * worktree, a deletion both made), and the tree's own files (`.tree/`) are merged by treeyard's
 * merge driver: neither counts.
 */
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';

import { t } from '../i18n/i18n.js';
import { TREE_DIR } from '../model/store.js';
import { nowIso } from '../model/time.js';
import type { Status, Tree, TreeNode } from '../model/types.js';
import { changedFiles, type NodeWorktree, worktreesOf } from '../worktree.js';

export interface OverlapNode {
  id: string;
  title: string;
  status: Status;
}

/** Two nodes and the files both change; the nodes in the order of their titles. */
export interface Overlap {
  nodes: [OverlapNode, OverlapNode];
  files: string[];
}

/** The nodes whose changes are not in the main folder's branch yet: at work, or waiting to be merged. */
const OPEN: readonly Status[] = ['active', 'review'];

/** Reads a node's changed files; tests put their own. */
export type ReadFiles = (project: string, wt: NodeWorktree) => string[];

const treeFile = (file: string) => /(^|\/)\.tree\//.test(file);

/** What a file is in a worktree now; none — it is not there. */
function content(wt: NodeWorktree, file: string): string | null {
  try {
    return createHash('sha1')
      .update(readFileSync(join(wt.path, file)))
      .digest('hex');
  } catch {
    return null;
  }
}

const ref = (node: TreeNode): OverlapNode => ({ id: node.id, title: node.title, status: node.status });

/**
 * The pairs of nodes that change one file, by title. `ids` — only the pairs where at least one of them is
 * named (what the coordinator hands out or waits for); none — every pair of the project.
 */
export function findOverlaps(tree: Tree, ids?: readonly string[], read: ReadFiles = changedFiles): Overlap[] {
  const project = tree.project.dir;
  const open: { wt: NodeWorktree; node: TreeNode }[] = [];
  for (const wt of worktreesOf(project)) {
    const node = tree.nodes.get(wt.id);
    if (node && OPEN.includes(node.status)) open.push({ wt, node });
  }
  // By title, so the same two nodes read the same way every time; ids are the tie-break.
  open.sort((a, b) => a.node.title.localeCompare(b.node.title) || (a.node.id < b.node.id ? -1 : 1));
  const wanted = ids ? new Set(ids) : undefined;
  if (open.length < 2 || (wanted && !open.some((each) => wanted.has(each.node.id)))) return [];
  const files = new Map(
    open.map((each) => [each.node.id, new Set(read(project, each.wt).filter((f) => !treeFile(f)))]),
  );
  const out: Overlap[] = [];
  for (const [at, a] of open.entries())
    for (const b of open.slice(at + 1)) {
      if (wanted && !wanted.has(a.node.id) && !wanted.has(b.node.id)) continue;
      const other = files.get(b.node.id)!;
      const shared = [...files.get(a.node.id)!]
        .filter((file) => other.has(file) && content(a.wt, file) !== content(b.wt, file))
        .sort();
      if (shared.length) out.push({ nodes: [ref(a.node), ref(b.node)], files: shared });
    }
  return out;
}

// ── The letters ─────────────────────────────────────────────────────────────

/** Files named in a letter or a line; the rest is counted. */
export const LISTED = 5;

export function fileList(files: readonly string[], limit = LISTED): string {
  const shown = files.slice(0, limit).join(', ');
  return files.length > limit ? `${shown}, ${t('… и ещё {p1}', { p1: files.length - limit })}` : shown;
}

/** What the session of one node is told about the other. */
export function overlapLetter(other: OverlapNode, files: readonly string[]): string {
  const params = { title: other.title, id: other.id, files: fileList(files, 8) };
  return files.length === 1
    ? t(
        'Письмо от treeyard, не от человека: узел «{title}» ({id}) в своём worktree правит тот же файл, что и ты: {files}. Ветки столкнутся при слиянии. Напиши ему — treeyard send {id} "…" — кто что меняет; свои правки в этом файле держи небольшими и коммить сразу. Влить ветки и развести конфликт — дело координатора.',
        params,
      )
    : t(
        'Письмо от treeyard, не от человека: узел «{title}» ({id}) в своём worktree правит те же файлы, что и ты: {files}. Ветки столкнутся при слиянии. Напиши ему — treeyard send {id} "…" — кто что меняет; свои правки в этих файлах держи небольшими и коммить сразу. Влить ветки и развести конфликт — дело координатора.',
        params,
      );
}

function claimsDir(project: string): string {
  return join(project, TREE_DIR, '.local', 'conflicts');
}

function claimPath(project: string, pair: readonly [string, string], file: string): string {
  const [a, b] = [...pair].sort();
  return join(claimsDir(project), `${a}-${b}-${createHash('sha1').update(file).digest('hex').slice(0, 16)}.json`);
}

/**
 * Takes the right to tell a pair about a file: true for the first caller only, whoever asks —
 * the file is made with `wx`, so a `wait` and a `queue` running together do not both send.
 */
export function claimNotice(project: string, pair: readonly [string, string], file: string): boolean {
  mkdirSync(claimsDir(project), { recursive: true });
  try {
    const fd = openSync(claimPath(project, pair, file), 'wx');
    try {
      writeSync(fd, `${JSON.stringify({ nodes: [...pair].sort(), file, at: nowIso() }, null, 2)}\n`);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

function releaseNotice(project: string, pair: readonly [string, string], file: string): void {
  try {
    unlinkSync(claimPath(project, pair, file));
  } catch {}
}

export interface Notice {
  /** The node whose session was written to. */
  to: string;
  /** The node it was told about. */
  other: string;
  files: string[];
}

/**
 * Writes to the sessions of the nodes of each pair, once per pair and file: a file already told
 * about stays quiet. Only a node at work is written to — one waiting for review has nobody to wake;
 * a letter that reached nobody leaves the file to the next look.
 */
export async function notifyOverlaps(
  tree: Tree,
  overlaps: readonly Overlap[],
  send: (id: string, text: string) => Promise<unknown>,
): Promise<Notice[]> {
  const project = tree.project.dir;
  const notices: Notice[] = [];
  for (const overlap of overlaps) {
    const [a, b] = overlap.nodes;
    const recipients = overlap.nodes.filter((node) => node.status === 'active');
    if (!recipients.length) continue;
    const fresh = overlap.files.filter((file) => claimNotice(project, [a.id, b.id], file));
    if (!fresh.length) continue;
    let reached = 0;
    for (const to of recipients) {
      const other = to.id === a.id ? b : a;
      try {
        await send(to.id, overlapLetter(other, fresh));
        notices.push({ to: to.id, other: other.id, files: fresh });
        reached++;
      } catch {
        // The other one may still get it; if none does, the next look tries again.
      }
    }
    if (!reached) for (const file of fresh) releaseNotice(project, [a.id, b.id], file);
  }
  return notices;
}
