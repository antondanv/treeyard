/**
 * What a review of the whole tree should not miss, found by treeyard itself instead of
 * being left for the agent to spot: a coordinator tidying a tree used to find all of these
 * by hand — finished branches still open, ideas left under closed ones, paragraph titles,
 * milestones past their date. The review gets them as lists and checks each one.
 */
import { isLongTitle } from './titles.js';
import { CLOSED, childrenOf } from './tree.js';
import type { Tree, TreeNode } from './types.js';

/** «Веха 3: …», «Milestone 2 — …»: how trees name their milestones. */
const MILESTONE = /^\s*(?:веха|milestone)(?![\p{L}\p{N}])/iu;

export function isMilestone(node: TreeNode): boolean {
  return MILESTONE.test(node.title);
}

export interface Finished {
  node: TreeNode;
  /** Children done. */
  done: number;
  /** Ideas left inside: they move elsewhere when the node closes. */
  ideas: number;
}

/**
 * Open parents with nothing left to do inside: at least one child done, the rest done,
 * dropped or ideas. A node in review waits for the person already, a waiting one has its
 * own reason: neither is a finding.
 */
export function finishedParents(tree: Tree): Finished[] {
  const out: Finished[] = [];
  for (const node of tree.nodes.values()) {
    if (CLOSED.has(node.status) || node.status === 'review' || node.status === 'waiting') continue;
    const kids = childrenOf(tree, node.id);
    const done = kids.filter((kid) => kid.status === 'done').length;
    if (!done || kids.some((kid) => !CLOSED.has(kid.status) && kid.status !== 'idea')) continue;
    out.push({ node, done, ideas: kids.filter((kid) => kid.status === 'idea').length });
  }
  return out;
}

export interface Orphan {
  node: TreeNode;
  /** The closed parent it is left under. */
  parent: TreeNode;
}

/**
 * Open nodes whose parent is done or dropped: nobody looks into a closed branch. Only the
 * topmost open node of such a branch: moving it moves everything under it.
 */
export function openUnderClosed(tree: Tree): Orphan[] {
  const out: Orphan[] = [];
  for (const node of tree.nodes.values()) {
    const parent = tree.nodes.get(node.parent);
    if (parent && CLOSED.has(parent.status) && !CLOSED.has(node.status)) out.push({ node, parent });
  }
  return out;
}

/** Open nodes with a paragraph for a title. Closed ones are folded away and cost nothing. */
export function longTitles(tree: Tree): TreeNode[] {
  return [...tree.nodes.values()].filter((node) => !CLOSED.has(node.status) && isLongTitle(node.title));
}

export interface Deadline {
  /** YYYY-MM-DD. */
  date: string;
  /** The words it was found in: «до 2026-10-16». */
  text: string;
}

const RU_MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const EN_MONTH = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?`;

/**
 * A date only counts after a word that makes it a deadline: «28.08 Сквозная проверка» is when
 * the work happened, «до 95 с» is no date at all. A date without a year falls on or after
 * the day the node was created.
 */
const BY = String.raw`(?<![\p{L}\p{N}])(?:до|к|не позже|не позднее|срок|дедлайн|by|before|until|till|due(?: by)?|deadline|no later than)\s*[:—–-]?\s*`;
const DATES = [
  String.raw`(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)`,
  String.raw`(\d{1,2})\.(\d{2})(?:\.(\d{4}|\d{2}))?(?!\d|[.,]\d)`,
  String.raw`(\d{1,2})\s+(${RU_MONTHS.join('|')})(?:\s+(\d{4}))?(?![\p{L}\p{N}])`,
  String.raw`(\d{1,2})\s+${EN_MONTH}(?:\s+(\d{4}))?(?![\p{L}\p{N}])`,
  String.raw`${EN_MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?![\p{L}\p{N}])`,
];
const DEADLINE = new RegExp(`${BY}(?:${DATES.map((date) => `(?:${date})`).join('|')})`, 'giu');

const pad = (value: number) => String(value).padStart(2, '0');

function dateOf(year: number | undefined, month: number, day: number, base: string): string | undefined {
  const fullYear = year === undefined ? Number(base.slice(0, 4)) : year < 100 ? 2000 + year : year;
  const check = new Date(Date.UTC(fullYear, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return undefined;
  const date = `${fullYear}-${pad(month)}-${pad(day)}`;
  return year === undefined && date < base ? dateOf(fullYear + 1, month, day, base) : date;
}

/** The latest deadline written in the text; `base` (YYYY-MM-DD) places dates without a year. */
export function deadlineIn(text: string, base: string): Deadline | undefined {
  let best: Deadline | undefined;
  for (const m of text.matchAll(DEADLINE)) {
    const n = (at: number) => (m[at] === undefined ? undefined : Number(m[at]));
    let date: string | undefined;
    if (m[1]) date = dateOf(n(1), n(2)!, n(3)!, base);
    else if (m[4]) date = dateOf(n(6), n(5)!, n(4)!, base);
    else if (m[7]) date = dateOf(n(9), RU_MONTHS.indexOf(m[8]!.toLowerCase()) + 1, n(7)!, base);
    else if (m[10]) date = dateOf(n(12), EN_MONTHS.indexOf(m[11]!.toLowerCase()) + 1, n(10)!, base);
    else if (m[13]) date = dateOf(n(15), EN_MONTHS.indexOf(m[13].toLowerCase()) + 1, n(14)!, base);
    if (date && (!best || date > best.date)) best = { date, text: m[0].trim() };
  }
  return best;
}

/** The node's deadline: from its title and criterion. */
export function deadlineOf(node: TreeNode, today: string): Deadline | undefined {
  return deadlineIn([node.title, node.doneWhen ?? ''].join('\n'), node.created ?? today);
}

export interface Overdue {
  node: TreeNode;
  deadline: Deadline;
  /** Whole days since the deadline. */
  days: number;
}

/** Open nodes past their deadline, the longest overdue first; a node in review waits for the person. */
export function overdueNodes(tree: Tree, today: string): Overdue[] {
  const out: Overdue[] = [];
  for (const node of tree.nodes.values()) {
    if (CLOSED.has(node.status) || node.status === 'review') continue;
    const deadline = deadlineOf(node, today);
    if (!deadline || deadline.date >= today) continue;
    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${deadline.date}T00:00:00Z`)) / 86_400_000);
    out.push({ node, deadline, days });
  }
  return out.sort((a, b) => b.days - a.days);
}
