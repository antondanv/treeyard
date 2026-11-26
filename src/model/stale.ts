/**
 * «In progress» that nobody works on. A node is abandoned when it is `active`,
 * has no live session and has been quiet longer than the threshold. Quiet means
 * none of: the node was updated, a journal line was written, a session was
 * started or opened. A fresh node stays unmarked, because a coordinator may
 * hand it to a subagent that leaves no session in the node. A node with open
 * children is not marked either: its work happens in the children, and an
 * abandoned child gets the mark itself.
 */
import { t } from '../i18n/i18n.js';
import { journalEntries } from './journal.js';
import { duration } from './time.js';
import type { Tree, TreeNode } from './types.js';

export interface Stale {
  /** Whole hours without activity. */
  hours: number;
  /** Time of the last activity. */
  since: number;
  /** The newest journal line, as written. */
  lastEntry?: string;
}

const LINE = /^(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)\s*·/;

function parse(value: string | undefined): number {
  if (!value) return 0;
  const time = Date.parse(value.length === 16 ? `${value.replace(' ', 'T')}:00` : value);
  return Number.isFinite(time) ? time : 0;
}

/** The newest journal line with its time; none when the journal has no dated lines. */
export function lastJournalLine(node: TreeNode): { time: number; text: string } | undefined {
  let best: { time: number; text: string } | undefined;
  for (const text of journalEntries(node.body)) {
    const match = LINE.exec(text);
    if (!match) continue;
    const when = match[1]!;
    const time = parse(when.length === 10 ? `${when}T00:00:00` : when);
    if (!best || time >= best.time) best = { time, text };
  }
  return best;
}

/** The latest of: node updated, last journal line, session started or opened. */
export function lastActivity(node: TreeNode): number {
  const times = [parse(node.updated), lastJournalLine(node)?.time ?? 0];
  for (const ref of node.sessions) times.push(parse(ref.started), parse(ref.opened));
  return Math.max(...times);
}

export interface StaleOptions {
  /** Threshold in hours; 0 — the check is off. */
  afterHours: number;
  /** A session of the node is alive right now (live state or a pane). */
  live?: boolean;
  now?: number;
  /** The tree, to leave out nodes whose work lives in open children. */
  tree?: Tree;
}

function hasOpenChildren(tree: Tree, id: string): boolean {
  for (const node of tree.nodes.values())
    if (node.parent === id && node.status !== 'done' && node.status !== 'dropped') return true;
  return false;
}

export function staleOf(node: TreeNode, options: StaleOptions): Stale | undefined {
  if (node.status !== 'active' || options.afterHours <= 0 || options.live) return undefined;
  if (options.tree && hasOpenChildren(options.tree, node.id)) return undefined;
  const since = lastActivity(node);
  // A node with no dates at all cannot be judged.
  if (since <= 0) return undefined;
  const age = (options.now ?? Date.now()) - since;
  if (age < options.afterHours * 3_600_000) return undefined;
  const entry = lastJournalLine(node);
  return { hours: Math.floor(age / 3_600_000), since, ...(entry ? { lastEntry: entry.text } : {}) };
}

/** Abandoned nodes of the tree, the longest quiet first. */
export function staleNodes(
  tree: Tree,
  options: Omit<StaleOptions, 'live'> & { live?: (node: TreeNode) => boolean },
): { node: TreeNode; stale: Stale }[] {
  const out: { node: TreeNode; stale: Stale }[] = [];
  for (const node of tree.nodes.values()) {
    const stale = staleOf(node, { ...options, tree, live: options.live?.(node) ?? false });
    if (stale) out.push({ node, stale });
  }
  return out.sort((a, b) => a.stale.since - b.stale.since);
}

/** «no session for 14 h» */
export function staleLabel(stale: Stale): string {
  return t('без сессии {time}', { time: duration(0, stale.hours * 3_600_000) });
}

/** The card line: what is wrong and where to continue from. */
export function staleNote(stale: Stale): string {
  const time = duration(0, stale.hours * 3_600_000);
  return stale.lastEntry
    ? t('в работе, но живой сессии нет {time} — последняя запись журнала: {entry}', { time, entry: stale.lastEntry })
    : t('в работе, но живой сессии нет {time}', { time });
}
