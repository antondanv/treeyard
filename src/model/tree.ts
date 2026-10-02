/**
 * Questions about the tree that do not change it: what is under a node, how
 * far along it is, what can be worked on right now and what is waiting.
 */
import { ROOT, type Status, type Tree, type TreeNode } from './types.js';

/** Statuses that are over: they do not count as open work. */
export const CLOSED: ReadonlySet<Status> = new Set(['done', 'dropped']);
/** Statuses that mean somebody can work on it. */
export const OPEN: ReadonlySet<Status> = new Set(['todo', 'active', 'review']);

const STATUS_ORDER: Record<Status, number> = {
  active: 0,
  review: 1,
  todo: 2,
  waiting: 3,
  idea: 4,
  done: 5,
  dropped: 6,
};

export function childrenOf(tree: Tree, id: string): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of tree.nodes.values()) if (node.parent === id) out.push(node);
  return out.sort(bySiblingOrder);
}

export function bySiblingOrder(a: TreeNode, b: TreeNode): number {
  return (
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    a.order - b.order ||
    (a.created ?? '').localeCompare(b.created ?? '') ||
    a.title.localeCompare(b.title)
  );
}

/** From the top-level node down to `id`, inclusive. */
export function pathTo(tree: Tree, id: string): TreeNode[] {
  const out: TreeNode[] = [];
  let node = tree.nodes.get(id);
  while (node) {
    out.unshift(node);
    node = node.parent === ROOT ? undefined : tree.nodes.get(node.parent);
  }
  return out;
}

export function descendants(tree: Tree, id: string): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (parent: string) => {
    for (const child of childrenOf(tree, parent)) {
      out.push(child);
      walk(child.id);
    }
  };
  walk(id);
  return out;
}

export interface Progress {
  done: number;
  total: number;
}

/**
 * Done leaves out of all leaves under `id` (the node itself when it is a
 * leaf). Ideas and dropped work are not part of the plan, so they do not
 * count either way.
 */
export function progress(tree: Tree, id: string): Progress {
  const result: Progress = { done: 0, total: 0 };
  const visit = (node: TreeNode) => {
    if (node.status === 'idea' || node.status === 'dropped') return;
    const kids = childrenOf(tree, node.id).filter((kid) => kid.status !== 'idea' && kid.status !== 'dropped');
    if (kids.length === 0 || node.status === 'done') {
      // A finished parent is finished, whatever is left under it.
      result.total += 1;
      if (node.status === 'done') result.done += 1;
      return;
    }
    for (const kid of kids) visit(kid);
  };
  if (id === ROOT) for (const top of childrenOf(tree, ROOT)) visit(top);
  else {
    const node = tree.nodes.get(id);
    if (node) visit(node);
  }
  return result;
}

/** The nearest ancestor that holds this node back: waiting, an idea, or closed. */
export function heldBy(tree: Tree, id: string): TreeNode | undefined {
  const node = tree.nodes.get(id);
  let up = node && node.parent !== ROOT ? tree.nodes.get(node.parent) : undefined;
  while (up) {
    if (up.status === 'waiting' || up.status === 'idea' || CLOSED.has(up.status)) return up;
    up = up.parent === ROOT ? undefined : tree.nodes.get(up.parent);
  }
  return undefined;
}

/**
 * What can be worked on now: open nodes with no open work under them and
 * nothing above them waiting. When one branch is stuck, these are the other
 * branches — the reason to keep a tree and not a list.
 */
export function actionable(tree: Tree): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of tree.nodes.values()) {
    if (!OPEN.has(node.status)) continue;
    const openKids = childrenOf(tree, node.id).some((kid) => OPEN.has(kid.status) || kid.status === 'waiting');
    if (openKids) continue;
    if (heldBy(tree, node.id)) continue;
    out.push(node);
  }
  const rank: Partial<Record<Status, number>> = { active: 0, review: 1, todo: 2 };
  return out.sort(
    (a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || treeOrder(tree, a.id) - treeOrder(tree, b.id),
  );
}

export function waitingNodes(tree: Tree): TreeNode[] {
  return [...tree.nodes.values()]
    .filter((node) => node.status === 'waiting')
    .sort((a, b) => (a.updated ?? '').localeCompare(b.updated ?? ''));
}

export function ideaNodes(tree: Tree): TreeNode[] {
  return [...tree.nodes.values()]
    .filter((node) => node.status === 'idea')
    .sort((a, b) => treeOrder(tree, a.id) - treeOrder(tree, b.id));
}

/** Position of a node in a full depth-first walk: keeps lists in tree order. */
export function treeOrder(tree: Tree, id: string): number {
  let index = 0;
  let found = -1;
  const walk = (parent: string) => {
    for (const child of childrenOf(tree, parent)) {
      if (child.id === id) found = index;
      index += 1;
      if (found >= 0) return;
      walk(child.id);
      if (found >= 0) return;
    }
  };
  walk(ROOT);
  return found < 0 ? Number.MAX_SAFE_INTEGER : found;
}

export interface Summary {
  done: number;
  total: number;
  active: number;
  review: number;
  waiting: number;
  ideas: number;
  now: number;
}

export function summarize(tree: Tree): Summary {
  const { done, total } = progress(tree, ROOT);
  let active = 0;
  let review = 0;
  let waiting = 0;
  let ideas = 0;
  for (const node of tree.nodes.values()) {
    if (node.status === 'active') active += 1;
    else if (node.status === 'review') review += 1;
    else if (node.status === 'waiting') waiting += 1;
    else if (node.status === 'idea') ideas += 1;
  }
  return { done, total, active, review, waiting, ideas, now: actionable(tree).length };
}

/** One visible line of the tree. */
export interface Row {
  node: TreeNode;
  depth: number;
  /** For each ancestor level: whether a vertical guide continues there. */
  guides: boolean[];
  /** Last among its visible siblings. */
  last: boolean;
  hasChildren: boolean;
  expanded: boolean;
  /** Under a waiting, idea or closed ancestor. */
  held: boolean;
  /** Matches the filter (when there is one); its ancestors are shown for context. */
  match: boolean;
}

export interface FlattenOptions {
  expanded: ReadonlySet<string>;
  /** Show done and dropped nodes. */
  showClosed: boolean;
  /** Text to search titles for; ancestors of matches are shown and opened. */
  filter?: string;
}

export function flatten(tree: Tree, options: FlattenOptions): Row[] {
  const query = options.filter?.trim().toLowerCase() ?? '';
  const matches = new Set<string>();
  const keep = new Set<string>();
  if (query) {
    for (const node of tree.nodes.values()) {
      if (`${node.title} ${node.id}`.toLowerCase().includes(query)) {
        matches.add(node.id);
        for (const step of pathTo(tree, node.id)) keep.add(step.id);
      }
    }
  }
  const visible = (node: TreeNode) => {
    if (query) return keep.has(node.id);
    if (!options.showClosed && CLOSED.has(node.status)) return false;
    return true;
  };
  const rows: Row[] = [];
  const walk = (parent: string, depth: number, guides: boolean[], held: boolean) => {
    const kids = childrenOf(tree, parent).filter(visible);
    kids.forEach((node, index) => {
      const last = index === kids.length - 1;
      const hasChildren = childrenOf(tree, node.id).some(visible);
      const expanded = hasChildren && (query ? true : options.expanded.has(node.id));
      rows.push({ node, depth, guides, last, hasChildren, expanded, held, match: query ? matches.has(node.id) : true });
      if (expanded) {
        const holds = node.status === 'waiting' || node.status === 'idea' || CLOSED.has(node.status);
        walk(node.id, depth + 1, [...guides, !last], held || holds);
      }
    });
  };
  walk(ROOT, 0, [], false);
  return rows;
}

/** Ids of every node that has children: "expand all". */
export function parents(tree: Tree): string[] {
  const out = new Set<string>();
  for (const node of tree.nodes.values()) if (node.parent !== ROOT) out.add(node.parent);
  return [...out];
}
