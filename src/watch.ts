/**
 * `treeyard watch`: what changes in `.tree/`, a node at a time, for a program that keeps its
 * own copy of the tree (Treeyard Web) or a person who wants to see agents at work.
 *
 * The watcher keeps the text of every file it saw last. A change wakes it (`fs.watch`, and a
 * cheap look at the files' times as a backup); it waits until the files go quiet, reads them
 * again and compares. So a command that writes a node three times, or a checkout that rewrites
 * fifty files, gives one event per node — not one per write.
 */
import { type FSWatcher, readdirSync, readFileSync, watch } from 'node:fs';
import { basename, join } from 'node:path';

import { parseEntry, type StatusStep, statusSteps } from './model/history.js';
import { description, journalEntries } from './model/journal.js';
import { nodeFromText, projectFromText, TREE_DIR, treeStamp } from './model/store.js';
import { nowIso } from './model/time.js';
import { type Project, ROOT, type Status, type TreeNode } from './model/types.js';

/**
 * The format of the events. Grows when a field changes its meaning or goes away; a new field
 * does not change it, so a reader skips keys it does not know.
 */
export const WATCH_VERSION = 1;

/** What the watcher last saw: the text of each file and what it says. */
export interface Snapshot {
  root?: { text: string; project: Project };
  /** By node id, in the order of the files' names. */
  nodes: Map<string, { file: string; text: string; node: TreeNode }>;
}

/** A journal line taken apart, as `show --json --all` gives it. */
export interface JournalItem {
  at?: string;
  who?: string;
  text: string;
}

/**
 * The biggest thing that happened to a node since the last look: it appeared, it is gone, its
 * status changed, its journal grew, or something else in it changed.
 */
export type TreeEventType = 'added' | 'removed' | 'status' | 'journal' | 'changed';

export interface TreeEvent {
  type: TreeEventType;
  /** The node's id; `root` for `tree.md`. */
  id: string;
  /** ISO time: the node's new `updated` when the change wrote it, otherwise when the watcher saw it. */
  at: string;
  title: string;
  /** The status now; for `removed`, the last one. None for the root. */
  status?: Status;
  /** `added` and `removed`: where the node stands (or stood). */
  parent?: string;
  /** `status`: from which status to which, as keys. */
  from?: Status;
  to?: Status;
  /** `status`: who changed it, when the journal says. */
  who?: string;
  /** What changed, as the keys of `show --json --all`: `status`, `title`, `done_when`, `note`, `journal`… */
  fields?: string[];
  /** Entries added at the end of the journal, oldest first. */
  journal?: JournalItem[];
  /** The status changes among those entries: several when the node went through more than one. */
  history?: StatusStep[];
}

/**
 * Reads the tree's files. A file that is there but cannot be read (a hand edit half done) keeps
 * what `previous` had for it: it changed, it did not leave the tree.
 */
export function readSnapshot(dir: string, previous?: Snapshot): Snapshot {
  const root = join(dir, TREE_DIR);
  const snapshot: Snapshot = { nodes: new Map() };
  try {
    const text = readFileSync(join(root, 'tree.md'), 'utf8');
    snapshot.root = previous?.root?.text === text ? previous.root : { text, project: projectFromText(text, dir) };
  } catch {
    snapshot.root = previous?.root;
  }
  const before = new Map([...(previous?.nodes.values() ?? [])].map((entry) => [entry.file, entry]));
  let files: string[] = [];
  try {
    files = readdirSync(join(root, 'nodes')).filter((file) => file.endsWith('.md'));
  } catch {
    // No nodes yet.
  }
  for (const file of files.sort()) {
    const old = before.get(file);
    let entry = old;
    try {
      const text = readFileSync(join(root, 'nodes', file), 'utf8');
      if (text !== old?.text) entry = { file, text, node: nodeFromText(text, basename(file, '.md')) };
    } catch {
      // Gone between listing and reading, or not valid YAML yet: as it was.
    }
    // The same id in two files: the first one wins, as in `loadTree`.
    if (entry && !snapshot.nodes.has(entry.node.id)) snapshot.nodes.set(entry.node.id, entry);
  }
  return snapshot;
}

/** A node's fields under the keys of `show --json --all`, in the order `fields` lists them. */
function nodeRecord(node: TreeNode): Record<string, unknown> {
  const record: Record<string, unknown> = {
    title: node.title,
    status: node.status,
    parent: node.parent,
    order: node.order,
    who: node.who,
    done_when: node.doneWhen,
    check: node.check,
    waiting: node.waiting,
    until: node.until,
    needs: node.needs,
    for: node.neededBy,
    sessions: node.sessions,
    commits: node.commits,
    created: node.created,
    updated: node.updated,
    closed: node.closed,
    note: description(node.body),
    journal: journalEntries(node.body),
    // Whatever else the body holds: reported only when the description and the journal stayed.
    body: node.body,
  };
  for (const [key, value] of Object.entries(node.extra)) if (!(key in record)) record[key] = value;
  return record;
}

function projectRecord(project: Project): Record<string, unknown> {
  const record: Record<string, unknown> = {
    title: project.title,
    goal: project.goal,
    template: project.template,
    brain: project.brain,
    model: project.model,
    effort: project.effort,
    start: project.start,
    assist_model: project.assistModel,
    mail_limit: project.mailLimit,
    created: project.created,
    sessions: project.sessions,
    body: project.body,
  };
  for (const [key, value] of Object.entries(project.extra)) if (!(key in record)) record[key] = value;
  return record;
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const fields = keys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  return fields.includes('note') || fields.includes('journal') ? fields.filter((key) => key !== 'body') : fields;
}

function journalItems(lines: string[]): JournalItem[] {
  return lines.map((line) => {
    const { when, source, text } = parseEntry(line);
    return { ...(when ? { at: when } : {}), ...(source ? { who: source } : {}), text };
  });
}

/** What happened to one node between two looks; undefined when nothing that matters did. */
function nodeEvent(before: TreeNode, after: TreeNode, now: string): TreeEvent | undefined {
  const fields = changedFields(nodeRecord(before), nodeRecord(after));
  if (!fields.length) return undefined;
  const was = journalEntries(before.body);
  const is = journalEntries(after.body);
  // The journal only grows; `log --fix` rewrites a line in place and counts as a change, not a new entry.
  const added = is.length > was.length ? is.slice(was.length) : [];
  const oldSteps = statusSteps(before.body);
  const newSteps = statusSteps(after.body);
  const steps = newSteps.length > oldSteps.length ? newSteps.slice(oldSteps.length) : [];
  const moved = before.status !== after.status;
  const last = steps.at(-1);
  return {
    type: moved ? 'status' : added.length ? 'journal' : 'changed',
    id: after.id,
    at: after.updated && after.updated !== before.updated ? after.updated : now,
    title: after.title,
    status: after.status,
    ...(moved ? { from: before.status, to: after.status } : {}),
    ...(moved && last?.to === after.status && last.who ? { who: last.who } : {}),
    fields,
    ...(added.length ? { journal: journalItems(added) } : {}),
    ...(steps.length ? { history: steps } : {}),
  };
}

/**
 * The events between two looks at the tree, one per node at most: the root first, then new
 * nodes (a parent before its children), changed ones, and the ones that are gone.
 */
export function treeEvents(before: Snapshot, after: Snapshot, now: string = nowIso()): TreeEvent[] {
  const events: TreeEvent[] = [];
  if (before.root && after.root && before.root.text !== after.root.text) {
    const fields = changedFields(projectRecord(before.root.project), projectRecord(after.root.project));
    if (fields.length) events.push({ type: 'changed', id: ROOT, at: now, title: after.root.project.title, fields });
  }
  const fresh = [...after.nodes.values()].filter((entry) => !before.nodes.has(entry.node.id)).map((e) => e.node);
  const placed = new Set<string>();
  const place = (node: TreeNode) => {
    if (placed.has(node.id)) return;
    placed.add(node.id);
    const parent = fresh.find((other) => other.id === node.parent);
    if (parent) place(parent);
    const entries = journalEntries(node.body);
    events.push({
      type: 'added',
      id: node.id,
      // A checkout brings a node with an old `updated`: it appeared now.
      at: now,
      title: node.title,
      status: node.status,
      parent: node.parent,
      ...(entries.length ? { journal: journalItems(entries) } : {}),
    });
  };
  for (const node of fresh) place(node);
  for (const [id, entry] of after.nodes) {
    const old = before.nodes.get(id);
    if (!old || old.text === entry.text) continue;
    const event = nodeEvent(old.node, entry.node, now);
    if (event) events.push(event);
  }
  for (const [id, { node }] of before.nodes) {
    if (after.nodes.has(id)) continue;
    events.push({ type: 'removed', id, at: now, title: node.title, status: node.status, parent: node.parent });
  }
  return events;
}

export interface WatchOptions {
  /** How long the files must stay quiet before they are read, ms: one command writes a node several times. */
  quiet?: number;
  /** The longest a steady stream of writes holds the events back, ms. */
  maxWait?: number;
  /** How often the files' times are checked, ms: a backup for a change `fs.watch` misses. */
  poll?: number;
  /** The clock of `at` when the change itself does not say. */
  now?: () => string;
}

export interface Watcher {
  stop(): void;
}

/** Calls `onEvents` with the events of every change of the tree in `dir` until `stop()`. */
export function watchTree(dir: string, onEvents: (events: TreeEvent[]) => void, options: WatchOptions = {}): Watcher {
  const { quiet = 150, maxWait = 1000, poll = 1000, now = nowIso } = options;
  const root = join(dir, TREE_DIR);
  const nodes = join(root, 'nodes');
  // The time first, then the files: a write between the two is seen again, never missed.
  let stamp = treeStamp(dir);
  let snapshot = readSnapshot(dir);
  let timer: NodeJS.Timeout | undefined;
  let first = 0;

  const flush = () => {
    timer = undefined;
    first = 0;
    stamp = treeStamp(dir);
    const next = readSnapshot(dir, snapshot);
    const events = treeEvents(snapshot, next, now());
    snapshot = next;
    if (events.length) onEvents(events);
  };
  const touch = () => {
    const at = Date.now();
    if (!first) first = at;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, Math.max(0, Math.min(quiet, first + maxWait - at)));
  };

  const watchers = new Map<string, FSWatcher>();
  const follow = (folder: string) => {
    if (watchers.has(folder)) return;
    try {
      const watcher = watch(folder, (_event, name) => {
        // A temporary file of an atomic write is not the tree yet; its rename into place is.
        if (!name || String(name).endsWith('.md')) touch();
        if (folder === root && String(name) === 'nodes') follow(nodes);
      });
      watcher.on('error', () => {
        watcher.close();
        watchers.delete(folder);
      });
      watchers.set(folder, watcher);
    } catch {
      // Not there yet, or the system cannot watch it: the poll still sees the change.
    }
  };
  follow(root);
  follow(nodes);

  const interval = setInterval(() => {
    follow(root);
    follow(nodes);
    const current = treeStamp(dir);
    if (current !== stamp) {
      stamp = current;
      touch();
    }
  }, poll);

  return {
    stop() {
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}
