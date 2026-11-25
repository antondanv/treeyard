/**
 * Letters between the sessions of nodes (`treeyard send`). A letter is a journal entry on both
 * ends — «письмо №12 от «A»» on the node that got it, «письмо №12 узлу «B»» on the node whose
 * session sent it — so the tree shows the correspondence in the CLI and the TUI, in git too. The
 * whole text and whether it has reached the session yet live in the mailbox (mailbox.ts), per
 * machine; the journal line carries the letter's number, which joins the two.
 * A letter from outside a node (a person in a shell) names the session it went to instead.
 */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { EN } from '../i18n/en.js';
import { labels, t } from '../i18n/i18n.js';
import {
  LETTER_FROM as FROM,
  OLD_LETTER_FROM,
  OLD_LETTER_SESSION,
  OLD_LETTER_TO,
  parseEntry,
  LETTER_SESSION as SESSION,
  LETTER_SHELL as SHELL,
  LETTER_TO as TO,
} from './history.js';
import { journalEntries } from './journal.js';
import { type Delivery, type Hold, type MailItem, mailOfNode } from './mailbox.js';
import { NODE_VAR, PROJECT_VAR } from './notes.js';
import type { Tree, TreeNode } from './types.js';

/** The journal shows what was written; the whole text is in the mailbox and the session. */
const TEXT = 300;

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > TEXT ? `${line.slice(0, TEXT - 1)}…` : line;
}

/** The entry on the node that got letter `n` from the session of node `from`. */
export function letterFrom(from: TreeNode, text: string, n: number): string {
  return t(FROM, { n, from: from.title, text: clip(text) });
}

/** The entry on the node whose session sent letter `n` to node `to`. */
export function letterTo(to: TreeNode, text: string, n: number): string {
  return t(TO, { n, to: to.title, text: clip(text) });
}

/** The entry on the node that got a letter from outside the tree's sessions. */
export function letterToSession(brain: string, short: string, text: string, n: number): string {
  return t(SESSION, { n, brain, short, text: clip(text) });
}

/** The same, to a node with no session yet. */
export function letterFromShell(text: string, n: number): string {
  return t(SHELL, { n, text: clip(text) });
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
  /** Its number in the project; none in journals written before letters had numbers. */
  n?: number;
  /** `in` — the node got it; `out` — the node's session sent it. */
  direction: 'in' | 'out';
  /** The other node's title; none for a letter from outside the tree's sessions. */
  peer?: string;
  /** The session it went to, for a letter from outside: `claude 1a2b3c4d`. */
  session?: string;
  /** The journal's line, or the whole letter once the mailbox has it. */
  text: string;
  at: string;
  who: string;
  /** From the mailbox of this machine: still waiting, or with its session. */
  state?: 'queued' | 'delivered';
  held?: Hold;
  heldFor?: string;
  how?: Delivery;
  /** The letter this one answers. */
  replyTo?: number;
}

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Both languages: a tree keeps the entries in whichever one wrote them. */
const shapes = (...keys: string[]) =>
  keys.flatMap((key) =>
    [key, EN[key] ?? key].map(
      (template) =>
        new RegExp(
          `^${literal(template)
            .replace('\\{text\\}', '(?<text>.*)')
            .replace('\\{n\\}', '(?<n>\\d+)')
            .replace(/\\\{(\w+)\\\}/g, (_m, name: string) => `(?<${name}>.+?)`)}$`,
        ),
    ),
  );
const FROM_RE = shapes(FROM, OLD_LETTER_FROM);
const TO_RE = shapes(TO, OLD_LETTER_TO);
const SESSION_RE = shapes(SESSION, OLD_LETTER_SESSION);
const SHELL_RE = shapes(SHELL);

/** A journal entry's letter, or undefined for any other entry. */
export function parseLetter(line: string): Letter | undefined {
  const entry = parseEntry(line);
  const match = (list: RegExp[]) => list.map((re) => re.exec(entry.text)).find(Boolean)?.groups;
  const base = { at: entry.when, who: entry.source };
  const number = (groups: Record<string, string>) => (groups.n ? { n: Number(groups.n) } : {});
  let groups = match(FROM_RE);
  if (groups) return { ...number(groups), ...base, direction: 'in', peer: groups.from!, text: groups.text! };
  groups = match(TO_RE);
  if (groups) return { ...number(groups), ...base, direction: 'out', peer: groups.to!, text: groups.text! };
  groups = match(SESSION_RE);
  if (groups)
    return {
      ...number(groups),
      ...base,
      direction: 'in',
      session: `${groups.brain} ${groups.short}`,
      text: groups.text!,
    };
  groups = match(SHELL_RE);
  if (groups) return { ...number(groups), ...base, direction: 'in', text: groups.text! };
  return undefined;
}

/** The node's letters as its journal has them, oldest first. */
export function lettersOf(node: TreeNode): Letter[] {
  return journalEntries(node.body)
    .map(parseLetter)
    .filter((letter): letter is Letter => Boolean(letter));
}

function withItem(letter: Letter, item: MailItem): Letter {
  const out: Letter = { ...letter, text: item.text, state: item.state };
  if (item.held) out.held = item.held;
  if (item.heldFor) out.heldFor = item.heldFor;
  if (item.delivered) out.how = item.delivered.how;
  if (item.replyTo) out.replyTo = item.replyTo;
  return out;
}

/** The first line of a letter from a node's session: who wrote it and how to answer. */
export function letterHeading(sender: Pick<TreeNode, 'id' | 'title'>): string {
  return t('Письмо от сессии узла «{title}» ({id}), не от человека; ответ — treeyard send {id} "…":', {
    title: sender.title,
    id: sender.id,
  });
}

/**
 * What the session reads: each letter under the line that says whose it is. A letter from a shell
 * outside the tree's sessions reads as the person's own message, as before there was a mailbox.
 */
export function letterBody(tree: Tree, letters: readonly MailItem[]): string {
  return letters
    .map((letter) => {
      if (!letter.from) return letter.text;
      const sender = tree.nodes.get(letter.from) ?? { id: letter.from, title: letter.from };
      return `${letterHeading(sender)}\n${letter.text}`;
    })
    .join('\n\n');
}

/** `2026-11-23T23:05:12+03:00` → `2026-11-23 23:05`, as the journal stamps entries. */
function stamp(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16);
}

/**
 * The node's letters, oldest first: the journal's lines with the whole text and the state from
 * this machine's mailbox, and letters the mailbox has but the journal does not (yet).
 */
export function mailOf(tree: Tree, node: TreeNode): Letter[] {
  const items = mailOfNode(tree.project.dir, node.id);
  const used = new Set<number>();
  const letters = lettersOf(node).map((letter) => {
    const item =
      letter.n === undefined
        ? undefined
        : items.find(
            (each) => each.n === letter.n && (letter.direction === 'in' ? each.to === node.id : each.from === node.id),
          );
    if (!item) return letter;
    used.add(item.n);
    return withItem(letter, item);
  });
  for (const item of items) {
    if (used.has(item.n)) continue;
    const out = item.from === node.id && item.to !== node.id;
    const peer = tree.nodes.get(out ? item.to : (item.from ?? ''))?.title;
    letters.push(
      withItem(
        {
          n: item.n,
          direction: out ? 'out' : 'in',
          ...(peer ? { peer } : {}),
          text: item.text,
          at: stamp(item.at),
          who: item.who ?? '',
        },
        item,
      ),
    );
  }
  // Stable: letters of one minute keep the journal's order.
  return letters.sort((a, b) => a.at.localeCompare(b.at));
}

/** Who the letter went to or came from: «узлу «Сайт»», «от «Бот»», «от агента в сессию claude 1a2b3c4d». */
export function letterPeer(letter: Letter): string {
  if (letter.direction === 'out') return t('узлу «{peer}»', { peer: letter.peer ?? '' });
  if (letter.peer) return t('от «{peer}»', { peer: letter.peer });
  if (!letter.session) return t('от {who}', { who: letter.who || '?' });
  return t('от {who} в сессию {session}', { who: letter.who || '?', session: letter.session });
}

/** Why a letter still waits, as the person reads it. */
export const HOLD_TEXT: Record<Hold, string> = labels(() => ({
  busy: t('сессия занята — придёт, когда она закончит ход'),
  waiting: t('сессия ждёт человека — придёт, когда он ответит'),
  terminal: t(
    'сессия открыта в терминале человека. С хуком или плагином писем (Claude Code, Codex, Antigravity, OpenCode) письмо придёт с очередным запросом, иначе — после закрытия сессии',
  ),
  starting: t('сессия ещё запускается — придёт через несколько секунд'),
  none: t('у узла нет сессии — письмо получит первая'),
}));

/** How a letter reached its session. */
export const DELIVERY_TEXT: Record<Delivery, string> = labels(() => ({
  typed: t('набрано в панели'),
  woke: t('панель проснулась с ним'),
  resumed: t('фоновая сессия продолжена с ним'),
  first: t('в первом сообщении новой сессии'),
  wait: t('показано в treeyard wait'),
  turn: t('посреди хода'),
  prompt: t('вместе с запросом'),
}));

/** `в очереди: сессия занята — …` or `доставлено: набрано в панели`; nothing without the mailbox. */
export function letterState(letter: Pick<Letter, 'state' | 'held' | 'heldFor' | 'how'>): string {
  if (letter.state === 'delivered')
    return letter.how ? t('доставлено: {how}', { how: DELIVERY_TEXT[letter.how] }) : t('доставлено');
  if (letter.state !== 'queued') return '';
  if (!letter.held) return t('в очереди');
  const why = letter.held === 'waiting' && letter.heldFor ? ` (${letter.heldFor})` : '';
  return t('в очереди: {why}', { why: `${HOLD_TEXT[letter.held]}${why}` });
}

/** `← №12 от «Бот»: «текст»` — the arrow says the direction: ← got, → sent. */
export function letterText(letter: Letter): string {
  const n = letter.n === undefined ? '' : `${t('№{n}', { n: letter.n })} `;
  return `${letter.direction === 'out' ? '→' : '←'} ${n}${letterPeer(letter)}${answers(letter)}: «${letter.text}»`;
}

/** ` (ответ на №12)` for an answer; nothing otherwise. */
export function answers(letter: Pick<Letter, 'replyTo'>): string {
  return letter.replyTo ? ` (${t('ответ на №{n}', { n: letter.replyTo })})` : '';
}
