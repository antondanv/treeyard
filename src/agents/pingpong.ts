/**
 * The brake on letters that go round in a circle: two sessions answering each other for ever burn
 * the subscription's limits and move nothing. A pair of nodes may exchange `mail_limit` letters
 * (6 by default) in a row; while neither node has done anything else since — a journal entry that
 * is not a letter, a change of status, a commit — the next one is not sent: the sender is told what
 * to do instead (ask the coordinator or the person, or `--force` once they said to go on).
 *
 * "Did something else" is read from what the tree already keeps, no extra state: the journals (a
 * status change and an attached commit are journal lines too), and the node's worktree branch for
 * commits nobody attached yet. A letter from a shell outside the nodes' sessions is never braked.
 */
import { spawnSync } from 'node:child_process';

import { parseEntry } from '../model/history.js';
import { journalEntries } from '../model/journal.js';
import { parseLetter } from '../model/mail.js';
import { readMail } from '../model/mailbox.js';
import type { Project, Tree, TreeNode } from '../model/types.js';
import { branchCommits } from '../worktree.js';

/** Letters a pair of nodes may exchange in a row, when the project does not say. */
export const DEFAULT_MAIL_LIMIT = 6;

/** The limit of a project: 0 — no brake. */
export function mailLimit(project: Pick<Project, 'mailLimit'>): number {
  return project.mailLimit ?? DEFAULT_MAIL_LIMIT;
}

/** Why a letter is not sent. */
export interface PingPong {
  /** The letters the pair exchanged since either of them did anything else. */
  letters: number;
  limit: number;
  /** The node whose session writes and the node it writes to. */
  from: string;
  to: string;
}

/** Commit time (ms) of the last commit of a node's branch; none without a worktree or commits. */
function branchCommitAt(project: string, id: string): number | undefined {
  const last = branchCommits(project, id).at(-1);
  if (!last) return undefined;
  const run = spawnSync('git', ['show', '-s', '--format=%ct', last, '--'], {
    cwd: project,
    env: { ...process.env, LC_ALL: 'C' },
    encoding: 'utf8',
    timeout: 5000,
  });
  const seconds = Number(run.stdout?.trim());
  return run.status === 0 && Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

/** The end of the minute (or of the day) a journal stamp names: a line may have come at any second of it. */
function stampEnd(when: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(when);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const date =
    match[4] === undefined
      ? new Date(year, month, day, 23, 59, 59, 999)
      : new Date(year, month, day, Number(match[4]), Number(match[5]), 59, 999);
  const time = date.getTime();
  return Number.isFinite(time) ? time : undefined;
}

/**
 * When the node last did something that is not a letter: the newest such journal line (taken at the
 * end of its minute — in doubt a letter is not counted against the node) or branch commit.
 */
export function lastWork(node: TreeNode, project: string, commitAt = branchCommitAt): number {
  let latest = 0;
  for (const line of journalEntries(node.body)) {
    const entry = parseEntry(line);
    if (parseLetter(line)) continue;
    const at = stampEnd(entry.when);
    if (at !== undefined && at > latest) latest = at;
  }
  return Math.max(latest, commitAt(project, node.id) ?? 0);
}

export interface PingPongOptions {
  /** Commit time of a node's branch; tests put their own. */
  commitAt?: (project: string, id: string) => number | undefined;
}

/**
 * Whether the session of node `from` may write to node `to` now: nothing — it may; otherwise how
 * many letters the pair has exchanged without either one doing anything else.
 */
export function pingPong(tree: Tree, from: string, to: string, options: PingPongOptions = {}): PingPong | undefined {
  const limit = mailLimit(tree.project);
  if (limit <= 0 || from === to) return undefined;
  const dir = tree.project.dir;
  const between = readMail(dir).filter(
    (item) => item.from && ((item.from === from && item.to === to) || (item.from === to && item.to === from)),
  );
  // Too few letters to matter: no journals to read, no git to ask.
  if (between.length < limit) return undefined;
  let since = 0;
  for (const id of [from, to]) {
    const node = tree.nodes.get(id);
    if (node) since = Math.max(since, lastWork(node, dir, options.commitAt));
  }
  const letters = between.filter((item) => Date.parse(item.at) > since).length;
  // The letter now asked for would be one more than the limit.
  return letters >= limit ? { letters, limit, from, to } : undefined;
}
