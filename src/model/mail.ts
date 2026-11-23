/**
 * Letters between the sessions of nodes (`treeyard send`). A letter is a journal entry on both
 * ends — «письмо от «A»» on the node that got it, «письмо узлу «B»» on the node whose session
 * sent it — so the tree shows the correspondence in the CLI and the TUI with nothing new to store.
 * A letter from outside a node (a person in a shell) names the session it went to instead.
 */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { EN } from '../i18n/en.js';
import { t } from '../i18n/i18n.js';
import { LETTER_FROM as FROM, parseEntry, LETTER_SESSION as SESSION, LETTER_TO as TO } from './history.js';
import { journalEntries } from './journal.js';
import { NODE_VAR, PROJECT_VAR } from './notes.js';
import type { Tree, TreeNode } from './types.js';

/** The journal shows what was written; the whole text is in the session. */
const TEXT = 300;

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > TEXT ? `${line.slice(0, TEXT - 1)}…` : line;
}

/** The entry on the node that got the letter from the session of node `from`. */
export function letterFrom(from: TreeNode, text: string): string {
  return t(FROM, { from: from.title, text: clip(text) });
}

/** The entry on the node whose session sent the letter to node `to`. */
export function letterTo(to: TreeNode, text: string): string {
  return t(TO, { to: to.title, text: clip(text) });
}

/** The entry on the node that got a letter from outside the tree's sessions. */
export function letterToSession(brain: string, short: string, text: string): string {
  return t(SESSION, { brain, short, text: clip(text) });
}

function samePlace(a: string, b: string): boolean {
  const real = (path: string) => {
    try {
      return realpathSync(path);
    } catch {
      return resolve(path);
    }
  };
  return real(a) === real(b);
}

/**
 * The node whose session runs this command, in this tree: the sender of a letter, the
 * coordinator of a session it opens. None in a person's shell or a session of another tree.
 */
export function senderNode(tree: Tree, env: NodeJS.ProcessEnv = process.env): TreeNode | undefined {
  const id = env[NODE_VAR]?.trim();
  const project = env[PROJECT_VAR]?.trim();
  if (!id || !project || !samePlace(project, tree.project.dir)) return undefined;
  return tree.nodes.get(id);
}

export interface Letter {
  /** `in` — the node got it; `out` — the node's session sent it. */
  direction: 'in' | 'out';
  /** The other node's title; none for a letter from outside the tree's sessions. */
  peer?: string;
  /** The session it went to, for a letter from outside: `claude 1a2b3c4d`. */
  session?: string;
  text: string;
  at: string;
  who: string;
}

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Both languages: a tree keeps the entries in whichever one wrote them. */
const shapes = (key: string) =>
  [key, EN[key] ?? key].map(
    (template) =>
      new RegExp(
        `^${literal(template)
          .replace('\\{text\\}', '(?<text>.*)')
          .replace(/\\\{(\w+)\\\}/g, (_m, name: string) => `(?<${name}>.+?)`)}$`,
      ),
  );
const FROM_RE = shapes(FROM);
const TO_RE = shapes(TO);
const SESSION_RE = shapes(SESSION);

/** A journal entry's letter, or undefined for any other entry. */
export function parseLetter(line: string): Letter | undefined {
  const entry = parseEntry(line);
  const match = (list: RegExp[]) => list.map((re) => re.exec(entry.text)).find(Boolean)?.groups;
  const base = { at: entry.when, who: entry.source };
  let groups = match(FROM_RE);
  if (groups) return { ...base, direction: 'in', peer: groups.from!, text: groups.text! };
  groups = match(TO_RE);
  if (groups) return { ...base, direction: 'out', peer: groups.to!, text: groups.text! };
  groups = match(SESSION_RE);
  if (groups) return { ...base, direction: 'in', session: `${groups.brain} ${groups.short}`, text: groups.text! };
  return undefined;
}

/** The node's letters, oldest first. */
export function lettersOf(node: TreeNode): Letter[] {
  return journalEntries(node.body)
    .map(parseLetter)
    .filter((letter): letter is Letter => Boolean(letter));
}

/** Who the letter went to or came from: «узлу «Сайт»», «от «Бот»», «от агента в сессию claude 1a2b3c4d». */
export function letterPeer(letter: Letter): string {
  if (letter.direction === 'out') return t('узлу «{peer}»', { peer: letter.peer ?? '' });
  if (letter.peer) return t('от «{peer}»', { peer: letter.peer });
  return t('от {who} в сессию {session}', { who: letter.who || '?', session: letter.session ?? '' });
}

/** `← от «Бот»: «текст»` — the arrow says the direction: ← got, → sent. */
export function letterText(letter: Letter): string {
  return `${letter.direction === 'out' ? '→' : '←'} ${letterPeer(letter)}: «${letter.text}»`;
}
