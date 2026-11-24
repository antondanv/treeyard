/**
 * Several nodes in one command: `treeyard add --parent <id> --from-json -`. The whole batch
 * is read and checked before the first node is written — a typo in the fifth node leaves the
 * tree as it was — then planted in order, children under their parents, and `needs` between
 * the new nodes resolved through their `key`s.
 */
import { t } from '../i18n/i18n.js';
import { normalizeRef, parseRef, setNeeds } from './links.js';
import { addNode } from './ops.js';
import { parseStatus } from './status-words.js';
import { ROOT, type Status, type Tree, type TreeNode, WHO, type Who } from './types.js';

export interface BatchNode {
  title: string;
  /** Top-level node's parent id (or `root`); overrides `--parent` for this item. */
  parent?: string;
  status?: Status;
  who?: Who;
  doneWhen?: string;
  check?: string;
  note?: string;
  waiting?: string;
  until?: string;
  /** Refs as given: a `key` of another node in the batch, an id of this tree, `../X#id`. */
  needs: string[];
  /** A name for this node inside the batch, for `needs` of the others. */
  key?: string;
  children: BatchNode[];
}

const KEYS = [
  'title',
  'parent',
  'status',
  'who',
  'done_when',
  'check',
  'note',
  'waiting',
  'until',
  'needs',
  'key',
  'children',
];

export class BatchError extends Error {}

/** The JSON of a batch: an array of nodes, or `{"nodes": […]}`. Throws `BatchError` saying where it is wrong. */
export function parseBatch(text: string): BatchNode[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new BatchError(t('не JSON: {error}', { error: (error as Error).message }));
  }
  const list = Array.isArray(data) ? data : (data as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(list) || list.length === 0)
    throw new BatchError(t('нужен массив узлов: [{"title": "…", "done_when": "…"}]'));
  const keys = new Set<string>();
  const read = (value: unknown, where: string, nested: boolean): BatchNode => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new BatchError(t('{where}: узел — это объект с title', { where }));
    const raw = value as Record<string, unknown>;
    const record: Record<string, unknown> = {};
    for (const [name, field] of Object.entries(raw)) record[name.replace(/-/g, '_')] = field;
    for (const name of Object.keys(record))
      if (!KEYS.includes(name))
        throw new BatchError(t('{where}: не знаю поле «{name}»; поля: {keys}', { where, name, keys: KEYS.join(', ') }));
    const text = (name: string): string | undefined => {
      const field = record[name];
      if (field === undefined || field === null) return undefined;
      if (typeof field !== 'string') throw new BatchError(t('{where}: {name} — строка', { where, name }));
      return field.trim() || undefined;
    };
    const title = text('title');
    if (!title) throw new BatchError(t('{where}: нет title', { where }));
    const label = `${where} «${title}»`;
    const node: BatchNode = { title, needs: [], children: [] };
    const parent = text('parent');
    if (parent) {
      if (nested)
        throw new BatchError(t('{where}: у узла внутри children свой родитель — убери parent', { where: label }));
      node.parent = parent;
    }
    const status = text('status');
    if (status) {
      const parsed = parseStatus(status);
      if (!parsed) throw new BatchError(t('{where}: «{status}» — не статус', { where: label, status }));
      node.status = parsed;
    }
    const who = text('who');
    if (who) {
      if (!(WHO as readonly string[]).includes(who))
        throw new BatchError(t('{where}: who бывает: agent, human, any', { where: label }));
      node.who = who as Who;
    }
    for (const [name, prop] of [
      ['done_when', 'doneWhen'],
      ['check', 'check'],
      ['note', 'note'],
      ['waiting', 'waiting'],
      ['until', 'until'],
    ] as const) {
      const value = text(name);
      if (value) node[prop] = value;
    }
    const key = text('key');
    if (key) {
      if (keys.has(key)) throw new BatchError(t('{where}: key «{key}» уже занят', { where: label, key }));
      keys.add(key);
      node.key = key;
    }
    const needs = record.needs;
    if (typeof needs === 'string')
      node.needs = needs
        .split(',')
        .map((ref) => ref.trim())
        .filter(Boolean);
    else if (Array.isArray(needs) && needs.every((ref) => typeof ref === 'string'))
      node.needs = needs.map((ref) => ref.trim()).filter(Boolean);
    else if (needs !== undefined && needs !== null)
      throw new BatchError(t('{where}: needs — строка или массив строк', { where: label }));
    const children = record.children;
    if (children !== undefined && children !== null) {
      if (!Array.isArray(children)) throw new BatchError(t('{where}: children — массив узлов', { where: label }));
      node.children = children.map((child, i) => read(child, `${label} › ${i + 1}`, true));
    }
    return node;
  };
  return list.map((item, i) => read(item, `#${i + 1}`, false));
}

function resolveBatchParent(tree: Tree, title: string, parent: string): string {
  if (parent === ROOT) return ROOT;
  if (tree.nodes.has(parent)) return parent;
  const matches = [...tree.nodes.keys()].filter((known) => known.startsWith(parent));
  if (matches.length === 1) return matches[0]!;
  throw new BatchError(
    matches.length > 1
      ? t('«{title}»: parent «{parent}» подходит к нескольким узлам', { title, parent })
      : t('«{title}»: parent «{parent}» — нет такого узла в дереве', { title, parent }),
  );
}

/**
 * Every ref and per-node parent of the batch, checked against the batch's keys and the tree before
 * anything is written: a key, an id (a unique prefix is enough) of this tree, or another project's.
 */
export function resolveBatchRefs(tree: Tree, batch: readonly BatchNode[]): Map<string, string> {
  for (const node of batch) if (node.parent) resolveBatchParent(tree, node.title, node.parent);
  const keys = new Set<string>();
  const walk = (list: readonly BatchNode[], visit: (node: BatchNode) => void) => {
    for (const node of list) {
      visit(node);
      walk(node.children, visit);
    }
  };
  walk(batch, (node) => {
    if (node.key) keys.add(node.key);
  });
  const resolved = new Map<string, string>();
  walk(batch, (node) => {
    for (const ref of node.needs) {
      if (ref === node.key) throw new BatchError(t('«{title}»: узел не может ждать сам себя', { title: node.title }));
      if (keys.has(ref) || resolved.has(ref)) continue;
      if (normalizeRef(ref) === ref && parseRef(ref)) {
        resolved.set(ref, ref);
        continue;
      }
      const id = ref.replace(/^#/, '');
      const matches = tree.nodes.has(id) ? [id] : [...tree.nodes.keys()].filter((known) => known.startsWith(id));
      if (matches.length !== 1)
        throw new BatchError(
          t('«{title}»: needs «{ref}» — нет такого key в JSON и узла в дереве', { title: node.title, ref }),
        );
      resolved.set(ref, `.#${matches[0]}`);
    }
  });
  return resolved;
}

export interface Planted {
  node: TreeNode;
  depth: number;
}

/** Plants a checked batch under `parent`; `defaults` fill a status or who a node does not give. */
export function plantBatch(
  tree: Tree,
  parent: string,
  batch: readonly BatchNode[],
  source: string,
  defaults: { status?: Status; who?: Who } = {},
): Planted[] {
  const refs = resolveBatchRefs(tree, batch);
  const planted: Planted[] = [];
  const byKey = new Map<string, string>();
  const waits: { id: string; needs: string[] }[] = [];
  const walk = (list: readonly BatchNode[], under: string, depth: number) => {
    for (const item of list) {
      const status = item.status ?? defaults.status ?? 'todo';
      const who = item.who ?? defaults.who;
      const node = addNode(
        tree,
        {
          title: item.title,
          parent: under,
          status,
          ...(who ? { who } : {}),
          ...(item.doneWhen ? { doneWhen: item.doneWhen } : {}),
          ...(item.check ? { check: item.check } : {}),
          ...(item.note ? { body: item.note } : {}),
          ...(item.waiting ? { waiting: item.waiting } : {}),
          ...(item.until ? { until: item.until } : {}),
        },
        source,
      );
      planted.push({ node, depth });
      if (item.key) byKey.set(item.key, node.id);
      if (item.needs.length) waits.push({ id: node.id, needs: item.needs });
      walk(item.children, node.id, depth + 1);
    }
  };
  const fallback = parent || ROOT;
  for (const item of batch) walk([item], item.parent ? resolveBatchParent(tree, item.title, item.parent) : fallback, 0);
  for (const { id, needs } of waits)
    setNeeds(
      tree,
      id,
      needs.map((ref) => (byKey.has(ref) ? `.#${byKey.get(ref)}` : refs.get(ref)!)),
      source,
    );
  return planted;
}
