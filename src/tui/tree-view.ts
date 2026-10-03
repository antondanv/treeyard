/** Completed groups and the GitHub offer are a view of the tree, never nodes written to disk. */
import { GITHUB_TITLE, offerShown } from '../github.js';
import { t } from '../i18n/i18n.js';
import { childrenOf, type FlattenOptions, flatten, type Row } from '../model/tree.js';
import { ROOT, type Tree, type TreeNode } from '../model/types.js';

const DONE_GROUP = 'done:';

export function doneGroupId(parent: string): string {
  return `${DONE_GROUP}${parent}`;
}

export function isDoneGroup(id: string | undefined): boolean {
  return Boolean(id?.startsWith(DONE_GROUP));
}

export function doneGroupParent(id: string): string {
  return id.slice(DONE_GROUP.length);
}

/** The «GitHub» node of a tree with no board yet: ⏎ on it connects one. */
export const GITHUB_OFFER = 'github:';

export function isGithubOffer(id: string | undefined): boolean {
  return id === GITHUB_OFFER;
}

/** A node of the view only: a folded group or the offer. No node actions apply to it. */
export function isViewOnly(id: string | undefined): boolean {
  return isDoneGroup(id) || isGithubOffer(id);
}

function githubOffer(): TreeNode {
  return {
    id: GITHUB_OFFER,
    parent: ROOT,
    title: GITHUB_TITLE,
    status: 'idea',
    // Last among the top-level ideas.
    order: Number.MAX_SAFE_INTEGER,
    sessions: [],
    body: '',
    extra: {},
  };
}

export function treeViewRows(tree: Tree, options: FlattenOptions): Row[] {
  // Search follows the real paths, including completed work in folded groups.
  if (options.filter?.trim()) return flatten(tree, options);
  const nodes = new Map(tree.nodes);
  if (offerShown(tree)) nodes.set(GITHUB_OFFER, githubOffer());
  if (!options.showClosed) return flatten({ ...tree, nodes }, options);
  const parents = new Set([ROOT, ...[...tree.nodes.values()].map((node) => node.parent)]);
  for (const parent of parents) {
    const done = childrenOf(tree, parent).filter((node) => node.status === 'done');
    if (!done.length) continue;
    const id = doneGroupId(parent);
    const group: TreeNode = {
      id,
      parent,
      title: t('Готовые · {n}', { n: done.length }),
      status: 'done',
      order: 0,
      sessions: [],
      body: '',
      extra: {},
    };
    nodes.set(id, group);
    for (const node of done) nodes.set(node.id, { ...node, parent: id });
  }
  return flatten({ ...tree, nodes }, options);
}

/** Open both real ancestors and any completed groups on the path to a node. */
export function doneGroupsOnPath(path: readonly TreeNode[]): string[] {
  return path.filter((node) => node.status === 'done').map((node) => doneGroupId(node.parent));
}
