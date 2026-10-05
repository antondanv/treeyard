/**
 * Changing the tree. Every change is written to disk at once, and the
 * overview (`.tree/README.md`) is rebuilt, so what the TUI shows, what an
 * agent reads and what git commits are the same thing.
 */

import { labels, t } from '../i18n/i18n.js';
import { appendJournal, replaceDescription } from './journal.js';
import { closeNeeds, forgetLinked } from './links.js';
import { writeOverview } from './overview.js';
import { removeNode, writeNode } from './store.js';
import { nowIso, stamp, today } from './time.js';
import { childrenOf, descendants } from './tree.js';
import { ROOT, type SessionRef, type Status, type Tree, type TreeNode, type Who } from './types.js';

// No 0/o, 1/l/i: ids get read aloud and typed into prompts.
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export function newId(tree: Tree, length = 4): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let id = '';
    for (let i = 0; i < length; i++) id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!tree.nodes.has(id) && id !== ROOT) return id;
  }
  return newId(tree, length + 1);
}

export const STATUS_LABEL: Record<Status, string> = labels(() => ({
  idea: t('идея'),
  todo: t('к работе'),
  active: t('в работе'),
  waiting: t('ждёт'),
  review: t('на проверке'),
  done: t('готово'),
  dropped: t('отказ'),
}));

export const WHO_LABEL: Record<Who, string> = labels(() => ({
  agent: t('агент'),
  human: t('ты'),
  any: t('кто угодно'),
}));

export interface NewNode {
  title: string;
  parent?: string;
  status?: Status;
  who?: Who;
  doneWhen?: string;
  check?: string;
  waiting?: string;
  until?: string;
  body?: string;
  /** Put it right after this sibling instead of at the end. */
  after?: string;
}

export function addNode(tree: Tree, input: NewNode, source = 'treeyard'): TreeNode {
  const parent = input.parent && (input.parent === ROOT || tree.nodes.has(input.parent)) ? input.parent : ROOT;
  const siblings = childrenOf(tree, parent).filter((node) => node.status === (input.status ?? 'todo'));
  let order = (siblings.at(-1)?.order ?? 0) + 10;
  if (input.after) {
    const index = siblings.findIndex((node) => node.id === input.after);
    if (index >= 0) {
      const before = siblings[index]!.order;
      const next = siblings[index + 1]?.order;
      if (next === undefined) order = before + 10;
      else if (next - before > 1) order = Math.floor((before + next) / 2);
      else {
        // No room: renumber the siblings and slot in.
        renumber(tree, parent);
        return addNode(tree, input, source);
      }
    }
  }
  const node: TreeNode = {
    id: newId(tree),
    title: input.title.trim() || t('Новый узел'),
    parent,
    order,
    status: input.status ?? 'todo',
    sessions: [],
    created: today(),
    body: input.body?.trim() ?? '',
    extra: {},
  };
  if (input.who) node.who = input.who;
  if (input.doneWhen?.trim()) node.doneWhen = input.doneWhen.trim();
  if (input.check?.trim()) node.check = input.check.trim();
  if (node.status === 'waiting') {
    if (input.waiting?.trim()) node.waiting = input.waiting.trim();
    if (input.until?.trim()) node.until = input.until.trim();
  }
  if (node.status === 'done' || node.status === 'dropped') node.closed = today();
  if (source !== 'treeyard')
    node.body = appendJournal(
      node.body,
      t('{p1} · {source} · завёл узел', {
        p1: stamp(),
        source,
      }),
    );
  tree.nodes.set(node.id, node);
  save(tree, node);
  return node;
}

export interface NodePatch {
  title?: string;
  who?: Who | null;
  doneWhen?: string | null;
  check?: string | null;
  body?: string;
  description?: string;
}

export function updateNode(tree: Tree, id: string, patch: NodePatch): TreeNode {
  const node = need(tree, id);
  const body = patch.description === undefined ? patch.body : replaceDescription(node.body, patch.description);
  if (patch.title?.trim()) node.title = patch.title.trim();
  if (patch.who !== undefined) {
    if (patch.who) node.who = patch.who;
    else delete node.who;
  }
  if (patch.doneWhen !== undefined) {
    if (patch.doneWhen?.trim()) node.doneWhen = patch.doneWhen.trim();
    else delete node.doneWhen;
  }
  if (patch.check !== undefined) {
    if (patch.check?.trim()) node.check = patch.check.trim();
    else delete node.check;
  }
  if (body !== undefined) node.body = body;
  save(tree, node);
  return node;
}

export interface StatusChange {
  waiting?: string;
  until?: string;
  /** Who made the change, for the journal: `ты`, `claude`… */
  source?: string;
  /** A sentence for the journal along with the change. */
  note?: string;
}

/** Called after a node's status changed and was written: the GitHub board follows it this way. */
export type StatusListener = (tree: Tree, node: TreeNode, before: Status) => void;

const statusListeners = new Set<StatusListener>();

export function onStatusChange(listener: StatusListener): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function setStatus(tree: Tree, id: string, status: Status, change: StatusChange = {}): TreeNode {
  const node = need(tree, id);
  const before = node.status;
  node.status = status;
  if (status === 'waiting') {
    if (change.waiting !== undefined) node.waiting = change.waiting.trim() || undefined;
    if (change.until !== undefined) node.until = change.until.trim() || undefined;
  } else {
    delete node.waiting;
    delete node.until;
  }
  if (status === 'done' || status === 'dropped') node.closed ??= today();
  else delete node.closed;
  if (before !== status || change.note) {
    let line = `${stamp()} · ${change.source ?? t('ты')} · `;
    line += before !== status ? `${STATUS_LABEL[before]} → ${STATUS_LABEL[status]}` : STATUS_LABEL[status];
    if (status === 'waiting' && node.waiting) line += `: ${node.waiting}`;
    if (change.note) line += `. ${change.note}`;
    node.body = appendJournal(node.body, line);
  }
  save(tree, node);
  if (status === 'done' && before !== 'done' && node.needs) closeNeeds(tree, node, change.source ?? t('ты'));
  if (before !== status) for (const listener of statusListeners) listener(tree, node, before);
  return node;
}

export function logToNode(tree: Tree, id: string, text: string, source = t('ты')): TreeNode {
  const node = need(tree, id);
  node.body = appendJournal(node.body, `${stamp()} · ${source} · ${text}`);
  save(tree, node);
  return node;
}

/** A commit is attached explicitly: a shared work folder cannot tell whose changes it contains. */
export function attachCommit(tree: Tree, id: string, sha: string, source = t('ты')): TreeNode {
  const node = need(tree, id);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha)) throw new Error(t('нужен полный SHA коммита'));
  const value = sha.toLowerCase();
  if (node.commits?.includes(value)) return node;
  node.commits = [...(node.commits ?? []), value];
  return logToNode(tree, id, t('привязан коммит {sha}', { sha: value }), source);
}

export function detachCommit(tree: Tree, id: string, sha: string, source = t('ты')): TreeNode {
  const node = need(tree, id);
  if (!node.commits?.includes(sha)) return node;
  node.commits = node.commits.filter((ref) => ref !== sha);
  if (!node.commits.length) delete node.commits;
  return logToNode(tree, id, t('убрана привязка коммита {sha}', { sha }), source);
}

/** Records a session on a node; opening it again only refreshes `opened`. */
export function attachSession(tree: Tree, id: string, ref: SessionRef, journal?: string): TreeNode {
  const node = need(tree, id);
  const existing = node.sessions.find((session) => session.brain === ref.brain && session.id === ref.id);
  if (existing) {
    existing.opened = ref.opened ?? nowIso();
    if (ref.name && !existing.name) existing.name = ref.name;
  } else {
    node.sessions.push({ ...ref, opened: ref.opened ?? nowIso() });
  }
  if (journal) node.body = appendJournal(node.body, `${stamp()} · ${ref.brain} · ${journal}`);
  save(tree, node);
  return node;
}

export function detachSession(tree: Tree, id: string, sessionId: string): TreeNode {
  const node = need(tree, id);
  node.sessions = node.sessions.filter((session) => session.id !== sessionId);
  save(tree, node);
  return node;
}

/** Moves a node under `parent`, after `after` (or first when `after` is null, last when undefined). */
export function moveNode(tree: Tree, id: string, parent: string, after?: string | null): TreeNode {
  const node = need(tree, id);
  if (parent !== ROOT && (parent === id || descendants(tree, id).some((kid) => kid.id === parent))) {
    throw new Error(t('нельзя перенести узел внутрь самого себя'));
  }
  node.parent = parent;
  const siblings = childrenOf(tree, parent).filter((kid) => kid.id !== id);
  let ordered: TreeNode[];
  if (after === undefined) ordered = [...siblings, node];
  else if (after === null) ordered = [node, ...siblings];
  else {
    const index = siblings.findIndex((kid) => kid.id === after);
    ordered = index < 0 ? [...siblings, node] : [...siblings.slice(0, index + 1), node, ...siblings.slice(index + 1)];
  }
  ordered.forEach((kid, index) => {
    const order = (index + 1) * 10;
    if (kid.order !== order || kid === node) {
      kid.order = order;
      writeNode(tree.project.dir, kid, kid === node);
    }
  });
  writeOverview(tree);
  return node;
}

/** One step up or down among siblings of the same status. */
export function shift(tree: Tree, id: string, step: -1 | 1): TreeNode {
  const node = need(tree, id);
  const siblings = childrenOf(tree, node.parent).filter((kid) => kid.status === node.status);
  const index = siblings.findIndex((kid) => kid.id === id);
  const target = index + step;
  if (target < 0 || target >= siblings.length) return node;
  if (step < 0) return moveNode(tree, id, node.parent, target === 0 ? null : siblings[target - 1]!.id);
  return moveNode(tree, id, node.parent, siblings[target]!.id);
}

/** Makes a node the last child of its previous sibling (Tab in an outliner). */
export function indent(tree: Tree, id: string): TreeNode {
  const node = need(tree, id);
  const siblings = childrenOf(tree, node.parent);
  const index = siblings.findIndex((kid) => kid.id === id);
  if (index <= 0) return node;
  return moveNode(tree, id, siblings[index - 1]!.id);
}

/** Makes a node the next sibling of its parent (Shift+Tab). */
export function outdent(tree: Tree, id: string): TreeNode {
  const node = need(tree, id);
  if (node.parent === ROOT) return node;
  const parent = need(tree, node.parent);
  return moveNode(tree, id, parent.parent, parent.id);
}

/** Deletes a node; its children move up to its parent unless `withChildren`. */
export function deleteNode(tree: Tree, id: string, withChildren = false): void {
  const node = need(tree, id);
  const kids = childrenOf(tree, id);
  if (withChildren) {
    for (const kid of descendants(tree, id)) {
      tree.nodes.delete(kid.id);
      removeNode(tree.project.dir, kid.id);
    }
  } else {
    let after = node.id;
    for (const kid of kids) {
      moveNode(tree, kid.id, node.parent, after);
      after = kid.id;
    }
  }
  tree.nodes.delete(id);
  removeNode(tree.project.dir, id);
  writeOverview(tree);
}

function renumber(tree: Tree, parent: string): void {
  childrenOf(tree, parent).forEach((kid, index) => {
    kid.order = (index + 1) * 10;
    writeNode(tree.project.dir, kid, false);
  });
}

function save(tree: Tree, node: TreeNode): void {
  writeNode(tree.project.dir, node);
  writeOverview(tree);
  forgetLinked(tree.project.dir);
}

function need(tree: Tree, id: string): TreeNode {
  const node = tree.nodes.get(id);
  if (!node)
    throw new Error(
      t('нет узла {id}', {
        id,
      }),
    );
  return node;
}
