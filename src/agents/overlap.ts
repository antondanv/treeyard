/**
 * Two nodes at work that collide in a merge find out only when the second branch is merged. This
 * checks earlier, from git: what each node's worktree committed on its branch and what it has not
 * committed yet (`changedFiles`), plus active nodes working in the main folder without a worktree
 * (by their attached commits ahead of the other worktree and new/changed uncommitted edits since
 * their session-start baseline, so prior human edits stay out). For pairs touching the same files
 * it runs a trial three-way merge (`git merge-tree --write-tree`, no checkout, with uncommitted
 * edits snapshotted via a temporary index) so edits to different places of one file stay quiet.
 * Where changes genuinely collide, the pair is told — to the coordinator in `wait` and `queue`,
 * and to both sessions in one letter, once per pair and file.
 *
 * Identical content in both checkouts (a settings file copied into every worktree, a deletion both
 * made) and the tree's own files (`.tree/`, merged by treeyard's merge driver) do not count. If
 * `git merge-tree --write-tree` is unavailable or fails unexpectedly (or a test supplies a custom
 * `ReadFiles`), it falls back to comparing the shared files by content hash.
 */
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';

import { t } from '../i18n/i18n.js';
import { TREE_DIR } from '../model/store.js';
import { nowIso } from '../model/time.js';
import type { SessionRef, Status, Tree, TreeNode } from '../model/types.js';
import {
  changedFiles,
  commitChangedFiles,
  commitsAheadOf,
  headOf,
  mainDirtyFiles,
  mainNodeTree,
  type NodeWorktree,
  readMainBaseline,
  repoRoot,
  resolveCommit,
  sameFolder,
  trialMergeConflicts,
  type WorktreeTree,
  worktreesOf,
  worktreeTree,
} from '../worktree.js';

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

/** Runs a trial merge of two worktrees; returns conflicting paths, or `null` to fall back to file hashes. */
export type TrialMerge = (project: string, a: NodeWorktree, b: NodeWorktree) => string[] | null;

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

function newestSession(node: TreeNode): SessionRef | undefined {
  if (!node.sessions.length) return undefined;
  return [...node.sessions].sort((a, b) => (b.opened ?? b.started ?? '').localeCompare(a.opened ?? a.started ?? ''))[0];
}

function worksInMainFolder(node: TreeNode, project: string): boolean {
  if (node.status !== 'active') return false;
  const latest = newestSession(node);
  return Boolean(latest && (!latest.dir || sameFolder(latest.dir, project)));
}

type Participant =
  | { kind: 'worktree'; node: TreeNode; wt: NodeWorktree }
  | { kind: 'main'; node: TreeNode; root: string; ownDirty: string[]; wt: NodeWorktree };

function pairConflicts(
  project: string,
  a: NodeWorktree,
  b: NodeWorktree,
  candidates: readonly string[],
  tryMerge: TrialMerge,
): string[] | null {
  const merged = tryMerge(project, a, b);
  if (merged === null) return null;
  const candidateSet = new Set(candidates);
  const out = new Set<string>();
  for (const raw of merged) {
    if (treeFile(raw)) continue;
    if (candidateSet.has(raw)) {
      out.add(raw);
      continue;
    }
    // File/directory conflicts may append `~<oid>` or `~HEAD` to the colliding path.
    const base = raw.replace(/~[^/]+$/, '');
    if (candidateSet.has(base)) out.add(base);
  }
  return [...out].sort();
}

/**
 * The pairs of nodes whose changes collide in a trial merge, by title. `ids` — only the pairs
 * where at least one of them is named (what the coordinator hands out or waits for); none — every
 * pair of the project.
 */
export function findOverlaps(
  tree: Tree,
  ids?: readonly string[],
  read: ReadFiles = changedFiles,
  merge?: TrialMerge,
): Overlap[] {
  const project = tree.project.dir;
  const open: Participant[] = [];
  const worktreeIds = new Set<string>();
  for (const wt of worktreesOf(project)) {
    worktreeIds.add(wt.id);
    const node = tree.nodes.get(wt.id);
    if (node && OPEN.includes(node.status)) open.push({ kind: 'worktree', wt, node });
  }
  // No worktree nodes open means nothing can merge against a worktree branch.
  if (!open.length) return [];

  const mainCandidates = [...tree.nodes.values()].filter(
    (node) => !worktreeIds.has(node.id) && worksInMainFolder(node, project),
  );
  if (mainCandidates.length) {
    const root = repoRoot(project);
    const mainHead = root ? headOf(root) : null;
    if (root && mainHead) {
      // With more than one active node in the main folder, uncommitted dirt cannot be attributed to one node.
      const singleMain = mainCandidates.length === 1;
      for (const node of mainCandidates) {
        const baseline = readMainBaseline(project, node.id);
        const ownDirty = singleMain ? mainDirtyFiles(project, root, node.id) : [];
        const wt: NodeWorktree = {
          id: node.id,
          branch: 'HEAD',
          path: root,
          dir: project,
          base: baseline?.head ?? mainHead,
          created: baseline?.at ?? '',
          prepared: true,
        };
        open.push({ kind: 'main', node, root, ownDirty, wt });
      }
    }
  }

  // By title, so the same two nodes read the same way every time; ids are the tie-break.
  open.sort((a, b) => a.node.title.localeCompare(b.node.title) || (a.node.id < b.node.id ? -1 : 1));
  const wanted = ids ? new Set(ids) : undefined;
  if (open.length < 2 || (wanted && !open.some((each) => wanted.has(each.node.id)))) return [];

  const wtFiles = new Map<string, Set<string>>();
  for (const each of open) {
    if (each.kind === 'worktree') {
      wtFiles.set(each.node.id, new Set(read(project, each.wt).filter((f) => !treeFile(f))));
    }
  }

  const resolvedCommits = new Map<string, string | null>();
  const commitFilesCache = new Map<string, string[]>();
  const wtHeads = new Map<string, string | null>();
  const aheadCache = new Map<string, Set<string>>();

  const mainFilesAgainst = (main: Extract<Participant, { kind: 'main' }>, wt: NodeWorktree): Set<string> => {
    const out = new Set<string>(main.ownDirty);
    if (!main.node.commits?.length) return out;
    if (!wtHeads.has(wt.id)) wtHeads.set(wt.id, headOf(wt.path));
    const wtHead = wtHeads.get(wt.id);
    if (!wtHead) return out;
    if (!aheadCache.has(wtHead)) aheadCache.set(wtHead, commitsAheadOf(main.root, wtHead));
    const ahead = aheadCache.get(wtHead)!;
    for (const raw of main.node.commits) {
      if (!resolvedCommits.has(raw)) resolvedCommits.set(raw, resolveCommit(main.root, raw));
      const oid = resolvedCommits.get(raw);
      if (!oid || !ahead.has(oid)) continue;
      if (!commitFilesCache.has(oid)) commitFilesCache.set(oid, commitChangedFiles(main.root, oid));
      for (const file of commitFilesCache.get(oid)!) out.add(file);
    }
    return out;
  };

  const useTrialMerge = merge !== undefined || read === changedFiles;
  const snapshots = new Map<string, WorktreeTree | null>();
  const snapshot = (each: Participant): WorktreeTree | null => {
    if (!snapshots.has(each.node.id)) {
      snapshots.set(
        each.node.id,
        each.kind === 'worktree' ? worktreeTree(each.wt) : mainNodeTree(each.root, each.ownDirty),
      );
    }
    return snapshots.get(each.node.id)!;
  };
  const byId = new Map(open.map((each) => [each.node.id, each]));
  const tryMerge: TrialMerge =
    merge ??
    ((proj, a, b) => {
      const partA = byId.get(a.id);
      const partB = byId.get(b.id);
      const treeA = partA ? snapshot(partA) : null;
      const treeB = partB ? snapshot(partB) : null;
      return treeA && treeB ? trialMergeConflicts(proj, treeA, treeB) : null;
    });

  const out: Overlap[] = [];
  for (const [at, a] of open.entries())
    for (const b of open.slice(at + 1)) {
      if (a.kind === 'main' && b.kind === 'main') continue;
      if (wanted && !wanted.has(a.node.id) && !wanted.has(b.node.id)) continue;
      let filesA: Set<string>;
      let filesB: Set<string>;
      if (a.kind === 'worktree' && b.kind === 'worktree') {
        filesA = wtFiles.get(a.node.id)!;
        filesB = wtFiles.get(b.node.id)!;
      } else if (a.kind === 'main' && b.kind === 'worktree') {
        filesA =
          read === changedFiles ? mainFilesAgainst(a, b.wt) : new Set(read(project, a.wt).filter((f) => !treeFile(f)));
        filesB = wtFiles.get(b.node.id)!;
      } else {
        // a is worktree, b is main
        const m = b as Extract<Participant, { kind: 'main' }>;
        filesA = wtFiles.get(a.node.id)!;
        filesB =
          read === changedFiles ? mainFilesAgainst(m, a.wt) : new Set(read(project, m.wt).filter((f) => !treeFile(f)));
      }
      const candidates = [...filesA].filter((file) => filesB.has(file)).sort();
      if (!candidates.length) continue;
      const conflicted = useTrialMerge ? pairConflicts(project, a.wt, b.wt, candidates, tryMerge) : null;
      const shared = conflicted ?? candidates.filter((file) => content(a.wt, file) !== content(b.wt, file));
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
