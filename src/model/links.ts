/**
 * Links between the trees of different projects. A node that waits for work
 * in another project keeps `needs: [../Brainyard#hv95]`; that node keeps the
 * other side, `for: [../Treeyard#g9ph]`. The path goes from the project's
 * folder, like `file:../Brainyard` in package.json: no registry of projects.
 *
 * Reading forgives here too: a folder that moved or a node that was deleted
 * shows as «не найдено», and nothing else breaks.
 */
import { realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import { t } from '../i18n/i18n.js';
import { appendJournal } from './journal.js';
import { addNode, type NewNode, setStatus } from './ops.js';
import { writeOverview } from './overview.js';
import { findProject, loadTree, treeStamp, writeNode } from './store.js';
import { stamp } from './time.js';
import { ROOT, type Tree, type TreeNode } from './types.js';

export interface LinkRef {
  /** The other project's folder, relative to this project's. */
  path: string;
  id: string;
}

export interface Link {
  ref: string;
  /** The other project's title, or the folder's name when its tree is gone. */
  project: string;
  node?: TreeNode;
  missing?: 'project' | 'node' | 'format';
}

export function parseRef(ref: string): LinkRef | undefined {
  const cut = ref.lastIndexOf('#');
  if (cut <= 0) return undefined;
  const path = ref.slice(0, cut).trim();
  const id = ref.slice(cut + 1).trim();
  return path && id ? { path, id } : undefined;
}

/** `../Brainyard#hv95`: how a node in `fromDir` names node `id` in `toDir`. */
export function refTo(fromDir: string, toDir: string, id: string): string {
  const path = relative(real(fromDir), real(toDir)).split(sep).join('/') || '.';
  return `${path}#${id}`;
}

/** The project folder a ref points to, from the folder of the tree that holds it. */
export function refDir(fromDir: string, ref: LinkRef): string {
  return resolve(fromDir, ref.path);
}

const cache = new Map<string, { tree: Tree; stamp: number; checked: number }>();

/**
 * Another project's tree, read again only when its files change. The TUI
 * asks on every frame, so the files are looked at no more than once a second.
 */
export function linkedTree(dir: string, now = Date.now()): Tree | undefined {
  const cached = cache.get(dir);
  if (cached && now - cached.checked < 1000) return cached.tree;
  if (findProject(dir) !== dir) {
    cache.delete(dir);
    return undefined;
  }
  const current = treeStamp(dir);
  if (cached && cached.stamp === current) {
    cached.checked = now;
    return cached.tree;
  }
  const tree = loadTree(dir);
  cache.set(dir, { tree, stamp: current, checked: now });
  return tree;
}

/** A tree was written here: the next read of it as a linked tree goes to disk. */
export function forgetLinked(dir: string): void {
  cache.delete(dir);
}

export function resolveLink(fromDir: string, ref: string): Link {
  const parsed = parseRef(ref);
  if (!parsed) return { ref, project: ref, missing: 'format' };
  const dir = refDir(fromDir, parsed);
  const tree = linkedTree(dir);
  const folder = parsed.path.split('/').filter(Boolean).at(-1) ?? parsed.path;
  if (!tree) return { ref, project: folder, missing: 'project' };
  const node = tree.nodes.get(parsed.id);
  return node ? { ref, project: tree.project.title, node } : { ref, project: tree.project.title, missing: 'node' };
}

/** What a node waits for in other trees, and what waits for it. */
export function linksOf(tree: Tree, node: TreeNode): { needs: Link[]; neededBy: Link[] } {
  const dir = tree.project.dir;
  return {
    needs: (node.needs ?? []).map((ref) => resolveLink(dir, ref)),
    neededBy: (node.neededBy ?? []).map((ref) => resolveLink(dir, ref)),
  };
}

/** Every node it waits for is done: the work can go on. */
export function needsMet(tree: Tree, node: TreeNode): boolean {
  const { needs } = linksOf(tree, node);
  return needs.length > 0 && needs.every((link) => link.node?.status === 'done');
}

/** `Brainyard › Релиз 0.2`, or `../Brainyard#c67r — не найдено`: one line wherever a link is shown. */
export function linkLabel(link: Link): string {
  if (!link.node) return t('{ref} — не найдено', { ref: link.ref });
  return `${link.project} › ${link.node.title}`;
}

/** `Brainyard › «Релиз 0.2» (c67r)` — for journals and notes. */
export function linkText(project: string, node: TreeNode): string {
  return `${project} › «${node.title}» (${node.id})`;
}

/**
 * Links two nodes: `needs` in the one that waits, `for` in the other, a line
 * in both journals. Both trees are written at once.
 */
export function linkNodes(from: Tree, fromId: string, to: Tree, toId: string, source: string): void {
  const waiter = need(from, fromId);
  const target = need(to, toId);
  const forward = refTo(from.project.dir, to.project.dir, toId);
  const back = refTo(to.project.dir, from.project.dir, fromId);
  if (!(waiter.needs ?? []).includes(forward)) {
    waiter.needs = [...(waiter.needs ?? []), forward];
    waiter.body = appendJournal(
      waiter.body,
      `${stamp()} · ${source} · ${t('ждёт: {link}', { link: linkText(to.project.title, target) })}`,
    );
    save(from, waiter);
  }
  if (!(target.neededBy ?? []).includes(back)) {
    target.neededBy = [...(target.neededBy ?? []), back];
    target.body = appendJournal(
      target.body,
      `${stamp()} · ${source} · ${t('нужен для: {link}', { link: linkText(from.project.title, waiter) })}`,
    );
    save(to, target);
  }
}

const SHARED_TITLES = ['совместные узлы', 'shared nodes'];

/** The «Совместные узлы» branch, the one at the top first; planted when the tree has none. */
export function sharedBranch(tree: Tree): TreeNode {
  const named = [...tree.nodes.values()].filter((node) => SHARED_TITLES.includes(node.title.trim().toLowerCase()));
  const found = named.find((node) => node.parent === ROOT) ?? named[0];
  if (found) return found;
  return addNode(tree, {
    title: t('Совместные узлы'),
    body: t(
      'Сюда падают узлы, заведённые из других проектов (`treeyard add "…" --project … --for <id>`): там их ждут. Каждый закрывается по своему критерию.',
    ),
  });
}

/**
 * A node in another project's tree for work this node needs (`treeyard add
 * --project ../X --for <id>`): in «Совместные узлы» unless a parent is named,
 * where it came from in its description, and linked both ways.
 */
export function addLinkedNode(from: Tree, fromId: string, to: Tree, input: NewNode, source: string): TreeNode {
  const waiter = need(from, fromId);
  const origin = t('Откуда: {from}', { from: linkText(from.project.title, waiter) });
  const node = addNode(
    to,
    {
      ...input,
      parent: input.parent ?? sharedBranch(to).id,
      who: input.who ?? 'agent',
      body: input.body?.trim() ? `${origin}\n\n${input.body.trim()}` : origin,
    },
    source,
  );
  linkNodes(from, fromId, to, node.id, source);
  return node;
}

/**
 * When a node is done, what it waited for in other trees is done too: the
 * person closes their own node and is not asked to go and close the other
 * project's. A node needed by several others closes with the last of them.
 */
export function closeNeeds(tree: Tree, node: TreeNode, source: string): TreeNode[] {
  const closed: TreeNode[] = [];
  for (const ref of node.needs ?? []) {
    const other = otherTree(tree, ref);
    const target = other?.tree.nodes.get(other.id);
    if (!other || !target || target.status === 'done' || target.status === 'dropped') continue;
    const waiting = (target.neededBy ?? []).some((back) => {
      const parsed = parseRef(back);
      if (!parsed) return false;
      const dir = refDir(other.tree.project.dir, parsed);
      const owner = real(dir) === real(tree.project.dir) ? tree : findProject(dir) === dir ? loadTree(dir) : undefined;
      const status = owner?.nodes.get(parsed.id)?.status;
      return status !== undefined && status !== 'done' && status !== 'dropped';
    });
    if (waiting) continue;
    setStatus(other.tree, target.id, 'done', {
      source,
      note: t('закрыт вместе с {link}', { link: linkText(tree.project.title, node) }),
    });
    cache.delete(other.tree.project.dir);
    closed.push(target);
  }
  return closed;
}

/**
 * Replaces what a node waits for (`treeyard set <id> needs=…`). The other
 * side follows where it is found: `for` is added to new targets and removed
 * from dropped ones. A ref that leads nowhere is kept — it shows «не найдено».
 */
export function setNeeds(tree: Tree, id: string, refs: string[], source: string): Link[] {
  const node = need(tree, id);
  for (const ref of refs) if (!parseRef(ref)) throw new Error(t('«{ref}» — нужно ../Проект#id', { ref }));
  const before = node.needs ?? [];
  for (const ref of before.filter((old) => !refs.includes(old))) {
    const other = otherTree(tree, ref);
    const target = other?.tree.nodes.get(other.id);
    if (!other || !target) continue;
    const back = refTo(other.tree.project.dir, tree.project.dir, id);
    if (!(target.neededBy ?? []).includes(back)) continue;
    target.neededBy = target.neededBy!.filter((item) => item !== back);
    if (target.neededBy.length === 0) delete target.neededBy;
    target.body = appendJournal(
      target.body,
      `${stamp()} · ${source} · ${t('больше не нужен для: {link}', { link: linkText(tree.project.title, node) })}`,
    );
    save(other.tree, target);
  }
  node.needs = before.filter((ref) => refs.includes(ref));
  if (node.needs.length === 0) delete node.needs;
  if (before.some((ref) => !refs.includes(ref))) save(tree, node);
  for (const ref of refs.filter((item) => !before.includes(item))) {
    const other = otherTree(tree, ref);
    if (other?.tree.nodes.has(other.id)) linkNodes(tree, id, other.tree, other.id, source);
    else {
      node.needs = [...(node.needs ?? []), ref];
      node.body = appendJournal(node.body, `${stamp()} · ${source} · ${t('ждёт: {link}', { link: ref })}`);
      save(tree, node);
    }
  }
  return linksOf(tree, node).needs;
}

/** A fresh read, not the cache: it is about to be written. */
function otherTree(tree: Tree, ref: string): { tree: Tree; id: string } | undefined {
  const parsed = parseRef(ref);
  if (!parsed) return undefined;
  const dir = refDir(tree.project.dir, parsed);
  if (findProject(dir) !== dir) return undefined;
  return { tree: loadTree(dir), id: parsed.id };
}

function save(tree: Tree, node: TreeNode): void {
  writeNode(tree.project.dir, node);
  writeOverview(tree);
  cache.delete(tree.project.dir);
}

function need(tree: Tree, id: string): TreeNode {
  const node = tree.nodes.get(id);
  if (!node) throw new Error(t('нет узла {id}', { id }));
  return node;
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
