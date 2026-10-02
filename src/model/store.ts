/**
 * Reading and writing `.tree/`. Every write goes to a temporary file first
 * and is renamed into place: an agent reading the tree never sees half a
 * file, and a crash never leaves one.
 *
 * Reading forgives: agents edit these files too, and a typo in one node must
 * not hide the other ninety-nine. What cannot be read becomes a problem in
 * `tree.problems`, and the rest loads.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { t } from '../i18n/i18n.js';
import { parseDocument, stringifyDocument } from './frontmatter.js';
import { nowIso } from './time.js';
import {
  type BrainId,
  type Project,
  ROOT,
  type SessionRef,
  START_MODES,
  STATUSES,
  type StartMode,
  type Status,
  type Tree,
  type TreeNode,
  WHO,
  type Who,
} from './types.js';

export const TREE_DIR = '.tree';
const BRAINS: readonly BrainId[] = ['claude', 'codex', 'antigravity'];

/** The folder that holds `.tree/`, looking up from `start`. */
export function findProject(start: string = process.cwd()): string | undefined {
  let dir = resolve(start);
  const stop = homedir();
  for (;;) {
    if (existsSync(join(dir, TREE_DIR, 'tree.md'))) return dir;
    const up = dirname(dir);
    if (up === dir || dir === stop) return undefined;
    dir = up;
  }
}

export function treeDir(dir: string): string {
  return join(dir, TREE_DIR);
}

export function nodePath(dir: string, id: string): string {
  return join(dir, TREE_DIR, 'nodes', `${id}.md`);
}

export function loadTree(dir: string): Tree {
  const problems: string[] = [];
  const project = readProject(dir, problems);
  const nodes = new Map<string, TreeNode>();
  const folder = join(dir, TREE_DIR, 'nodes');
  let files: string[] = [];
  try {
    files = readdirSync(folder).filter((file) => file.endsWith('.md'));
  } catch {
    // No nodes yet.
  }
  for (const file of files.sort()) {
    const path = join(folder, file);
    let node: TreeNode;
    try {
      node = nodeFromText(readFileSync(path, 'utf8'), basename(file, '.md'), problems);
    } catch (error) {
      problems.push(`${file}: ${(error as Error).message}`);
      continue;
    }
    if (nodes.has(node.id)) {
      problems.push(
        t('{file}: id {id} уже занят другим узлом — файл пропущен', {
          file,
          id: node.id,
        }),
      );
      continue;
    }
    nodes.set(node.id, node);
  }
  // A parent that does not exist puts the node at the top, where it is seen.
  for (const node of nodes.values()) {
    if (node.parent !== ROOT && !nodes.has(node.parent)) {
      problems.push(
        t('{id}: родитель {parent} не найден — узел поднят наверх', {
          id: node.id,
          parent: node.parent,
        }),
      );
      node.parent = ROOT;
    }
  }
  // A cycle (an agent set a node's parent to its own child) is broken at the first repeat.
  for (const node of nodes.values()) {
    const seen = new Set<string>([node.id]);
    let up = nodes.get(node.parent);
    while (up) {
      if (seen.has(up.id)) {
        problems.push(
          t('{id}: родители замкнулись в круг — узел поднят наверх', {
            id: node.id,
          }),
        );
        node.parent = ROOT;
        break;
      }
      seen.add(up.id);
      up = nodes.get(up.parent);
    }
  }
  return { project, nodes, problems };
}

function readProject(dir: string, problems: string[]): Project {
  const path = join(dir, TREE_DIR, 'tree.md');
  let data: Record<string, unknown> = {};
  let body = '';
  try {
    const doc = parseDocument(readFileSync(path, 'utf8'));
    data = doc.data;
    body = doc.body;
  } catch (error) {
    problems.push(`tree.md: ${(error as Error).message}`);
  }
  const extra: Record<string, unknown> = { ...data };
  const take = (key: string) => {
    const value = extra[key];
    delete extra[key];
    return value;
  };
  const project: Project = {
    dir,
    title: str(take('title')) || basename(dir),
    body,
    extra,
  };
  const goal = str(take('goal'));
  if (goal) project.goal = goal;
  const template = str(take('template'));
  if (template) project.template = template;
  const brain = str(take('brain'));
  if (brain && (BRAINS as readonly string[]).includes(brain)) project.brain = brain as BrainId;
  const model = str(take('model'));
  if (model) project.model = model;
  const effort = str(take('effort'));
  if (effort) project.effort = effort;
  const assistModel = str(take('assist_model'));
  if (assistModel) project.assistModel = assistModel;
  const start = str(take('start'));
  if (start && (START_MODES as readonly string[]).includes(start)) project.start = start as StartMode;
  const created = dateStr(take('created'));
  if (created) project.created = created;
  return project;
}

export function nodeFromText(text: string, fallbackId: string, problems: string[] = []): TreeNode {
  const { data, body } = parseDocument(text);
  const extra: Record<string, unknown> = { ...data };
  const take = (key: string) => {
    const value = extra[key];
    delete extra[key];
    return value;
  };
  const id = str(take('id')) || fallbackId;
  const rawStatus = str(take('status')) || 'todo';
  let status: Status = 'todo';
  if ((STATUSES as readonly string[]).includes(rawStatus)) status = rawStatus as Status;
  else
    problems.push(
      t('{id}: неизвестный статус «{rawStatus}» — считаю «к работе»', {
        id,
        rawStatus,
      }),
    );
  const order = Number(take('order'));
  const node: TreeNode = {
    id,
    title: str(take('title')) || t('(без названия)'),
    parent: str(take('parent')) || ROOT,
    order: Number.isFinite(order) ? order : 0,
    status,
    sessions: sessionsFrom(take('sessions')),
    body,
    extra,
  };
  const who = str(take('who'));
  if (who && (WHO as readonly string[]).includes(who)) node.who = who as Who;
  const doneWhen = str(take('done_when'));
  if (doneWhen) node.doneWhen = doneWhen;
  const check = str(take('check'));
  if (check) node.check = check;
  const waiting = str(take('waiting'));
  if (waiting) node.waiting = waiting;
  const until = str(take('until'));
  if (until) node.until = until;
  const created = dateStr(take('created'));
  if (created) node.created = created;
  const updated = dateStr(take('updated'));
  if (updated) node.updated = updated;
  const closed = dateStr(take('closed'));
  if (closed) node.closed = closed;
  return node;
}

function sessionsFrom(value: unknown): SessionRef[] {
  if (!Array.isArray(value)) return [];
  const out: SessionRef[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const brain = str(record.brain);
    const id = str(record.id);
    if (!id || !(BRAINS as readonly string[]).includes(brain)) continue;
    const ref: SessionRef = { brain: brain as BrainId, id };
    const name = str(record.name);
    if (name) ref.name = name;
    const started = dateStr(record.started);
    if (started) ref.started = started;
    const opened = dateStr(record.opened);
    if (opened) ref.opened = opened;
    const mode = str(record.mode);
    if (mode === 'terminal' || mode === 'background' || mode === 'pane') ref.mode = mode;
    const pane = str(record.pane);
    if (pane) ref.pane = pane;
    out.push(ref);
  }
  return out;
}

export function nodeToText(node: TreeNode): string {
  const data: Record<string, unknown> = {
    id: node.id,
    title: node.title,
    parent: node.parent,
    order: node.order,
    status: node.status,
    who: node.who,
    done_when: node.doneWhen,
    check: node.check,
    waiting: node.status === 'waiting' ? node.waiting : undefined,
    until: node.status === 'waiting' ? node.until : undefined,
    sessions: node.sessions.map((ref) => ({
      brain: ref.brain,
      id: ref.id,
      ...(ref.name ? { name: ref.name } : {}),
      ...(ref.started ? { started: ref.started } : {}),
      ...(ref.opened ? { opened: ref.opened } : {}),
      ...(ref.mode ? { mode: ref.mode } : {}),
      ...(ref.pane ? { pane: ref.pane } : {}),
    })),
    created: node.created,
    updated: node.updated,
    closed: node.closed,
    ...node.extra,
  };
  return stringifyDocument(data, node.body);
}

export function projectToText(project: Project): string {
  const data: Record<string, unknown> = {
    title: project.title,
    goal: project.goal,
    template: project.template,
    brain: project.brain,
    model: project.model,
    effort: project.effort,
    start: project.start,
    assist_model: project.assistModel,
    created: project.created,
    ...project.extra,
  };
  return stringifyDocument(data, project.body);
}

export function writeNode(dir: string, node: TreeNode, touch = true): void {
  if (touch) node.updated = nowIso();
  atomicWrite(nodePath(dir, node.id), nodeToText(node));
}

export function writeProject(project: Project): void {
  atomicWrite(join(project.dir, TREE_DIR, 'tree.md'), projectToText(project));
}

export function removeNode(dir: string, id: string): void {
  rmSync(nodePath(dir, id), { force: true });
}

export function atomicWrite(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

/** Last modification of any file in the tree: a cheap way to notice an agent's edit. */
export function treeStamp(dir: string): number {
  let latest = 0;
  const visit = (folder: string) => {
    let entries: string[];
    try {
      entries = readdirSync(folder);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      try {
        latest = Math.max(latest, statSync(join(folder, entry)).mtimeMs);
      } catch {
        // Renamed under us.
      }
    }
    try {
      latest = Math.max(latest, statSync(folder).mtimeMs);
    } catch {
      // Gone.
    }
  };
  visit(join(dir, TREE_DIR));
  visit(join(dir, TREE_DIR, 'nodes'));
  return latest;
}

function str(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** YAML turns `2026-10-01` into a Date; we keep the text. */
function dateStr(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  return str(value);
}
