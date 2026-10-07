/**
 * Notes: one line about what gets in the way, written from any project into
 * the «Замечания» branch of one tree (the `notes` setting) without leaving
 * the work. A note says where it came from — the project and the node whose
 * session wrote it — so the review knows what was being done at the time.
 */
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import type { EnvOverrides } from '@antondanv/brainyard';

import { t } from '../i18n/i18n.js';
import { ownNodeEnv } from '../node-env.js';
import { addNode } from './ops.js';
import { findProject } from './store.js';
import { sessionOwners } from './tree.js';
import { ROOT, type Tree, type TreeNode } from './types.js';

/**
 * The `notes` setting from what the person typed: a folder with a tree, `~`
 * and relative paths resolved against `base`; `''` — not set. Throws when the
 * folder holds no tree of its own, so a typo never swallows the notes.
 */
export function notesFolder(value: string, base: string = process.cwd()): string {
  const text = value.trim();
  if (!text || /^(off|none|-)$/i.test(text)) return '';
  const dir = resolve(base, text.replace(/^~(?=$|\/)/, homedir()));
  if (findProject(dir) !== dir) throw new Error(t('нет дерева (.tree/tree.md): {dir}', { dir: homeShort(dir) }));
  return dir;
}

/** `~/Projects/Treeyard` rather than the whole home path. */
export function homeShort(dir: string): string {
  const home = homedir();
  return dir === home || dir.startsWith(`${home}/`) ? `~${dir.slice(home.length)}` : dir;
}

/** Every session started from a node gets the node's id here. */
export const NODE_VAR = 'TREEYARD_NODE';

/** The env of a session started from a node: its id, and without the NODE_ENV Treeyard set for itself. */
export function nodeEnv(id: string): EnvOverrides {
  return ownNodeEnv() ? { [NODE_VAR]: id, NODE_ENV: undefined } : { [NODE_VAR]: id };
}

export interface NoteOrigin {
  /** The project's title, or the folder's name outside a tree. */
  project: string;
  node?: TreeNode;
}

/**
 * Where a note is written from: the tree of the folder and the node — named
 * outright, the one the session was started from, or the one holding this
 * Claude Code session (sessions opened before `TREEYARD_NODE` existed).
 * Nothing is guessed beyond that.
 */
export function noteOrigin(
  tree: Tree | undefined,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  nodeId?: string,
): NoteOrigin {
  if (!tree) return { project: basename(cwd) };
  const session = env.CLAUDE_CODE_SESSION_ID?.trim();
  const node = [nodeId, env[NODE_VAR]?.trim(), session ? sessionOwners(tree).get(session) : undefined]
    .map((id) => (id ? tree.nodes.get(id) : undefined))
    .find((found) => found !== undefined);
  return { project: tree.project.title, ...(node ? { node } : {}) };
}

/** `my-app › «Закрыть один узел» (k3f9)`, or just the project. */
export function originText(origin: NoteOrigin): string {
  if (!origin.node) return origin.project;
  return `${origin.project} › «${origin.node.title}» (${origin.node.id})`;
}

const BRANCH_TITLES = ['замечания', 'notes'];

/** The «Замечания» branch, the one at the top first; planted when the tree has none. */
export function notesBranch(tree: Tree): TreeNode {
  const named = [...tree.nodes.values()].filter((node) => BRANCH_TITLES.includes(node.title.trim().toLowerCase()));
  const found = named.find((node) => node.parent === ROOT) ?? named[0];
  if (found) return found;
  return addNode(tree, {
    title: t('Замечания'),
    who: 'human',
    doneWhen: t('каждое замечание разобрано: в работу, в «Идеи» или в отказ'),
    body: t('Сюда падает `treeyard note` из любого проекта. Разбор раз в 2–3 дня.'),
  });
}

/** A note as an idea in the «Замечания» branch; where it came from goes in its description. */
export function addNote(tree: Tree, text: string, origin: NoteOrigin, source?: string): TreeNode {
  const branch = notesBranch(tree);
  return addNode(
    tree,
    {
      // A title is one line, whatever the shell passed.
      title: text.replace(/\s+/g, ' ').trim(),
      parent: branch.id,
      status: 'idea',
      body: t('Откуда: {from}', { from: originText(origin) }),
    },
    source,
  );
}
