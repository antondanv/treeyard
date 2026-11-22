/**
 * The tree as plain text: for pipes, for agents (`treeyard show` is how they
 * look around), and for a quick look without the TUI.
 */

import { t } from '../i18n/i18n.js';
import { parseEntry, statusHistory, statusSteps } from '../model/history.js';
import { imagePath, listImages } from '../model/images.js';
import { description, journalEntries } from '../model/journal.js';
import { type Link, linkLabel, linksOf } from '../model/links.js';
import { type Letter, letterPeer, lettersOf } from '../model/mail.js';
import { STATUS_LABEL, WHO_LABEL } from '../model/ops.js';
import { GLYPH } from '../model/overview.js';
import { type Stale, staleLabel, staleNote } from '../model/stale.js';
import { ago } from '../model/time.js';
import {
  CLOSED,
  childrenByOrder,
  childrenOf,
  descendants,
  openWorkUnder,
  pathTo,
  progress,
  STATUS_ORDERS,
  summarize,
} from '../model/tree.js';
import { ROOT, type Status, type Tree, type TreeNode } from '../model/types.js';
import type { TreeEvent } from '../watch.js';

export interface Paint {
  on: boolean;
  c(hex: string, text: string): string;
  dim(text: string): string;
  bold(text: string): string;
}

export function paint(stream: NodeJS.WriteStream): Paint {
  const on =
    (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0') ||
    (stream.isTTY === true && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb');
  const rgb = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`;
  };
  return {
    on,
    c: (hex, text) => (on ? `\u001b[38;2;${rgb(hex)}m${text}\u001b[39m` : text),
    dim: (text) => (on ? `\u001b[2m${text}\u001b[22m` : text),
    bold: (text) => (on ? `\u001b[1m${text}\u001b[22m` : text),
  };
}

const HEX: Record<Status, string | undefined> = {
  idea: '#d2a8ff',
  todo: undefined,
  active: '#8ab4ff',
  waiting: '#ffcf70',
  review: '#62d0e0',
  done: '#5fd38d',
  dropped: '#5c6370',
};

/** Which active nodes nobody works on; the CLI passes the threshold from the settings. */
export type StaleFn = (node: TreeNode) => Stale | undefined;

export interface TreeTextOptions {
  /** `false` hides done and dropped work. */
  closed?: boolean;
  /** The branch to print instead of the whole tree, without the project's header. */
  under?: string;
  /** Finished children fold into one «✓ готово: N» line, as in the TUI. */
  foldDone?: boolean;
  stale?: StaleFn;
  /** The status as a word after the id: off a terminal, so `grep` by a word finds it and nobody reads glyphs. */
  words?: boolean;
}

export function treeText(tree: Tree, p: Paint, options: TreeTextOptions = {}): string {
  const { project } = tree;
  const total = summarize(tree);
  const lines: string[] = [];
  if (!options.under) {
    lines.push(
      `${p.c('#7ee2a8', p.bold('◆'))} ${p.bold(project.title)}${
        project.goal
          ? p.dim(
              t(' — цель: {goal}', {
                goal: project.goal,
              }),
            )
          : ''
      }`,
    );
    lines.push(
      p.dim(
        t('  готово {done}/{total} · в работе {active} · на проверке {review} · ждут {waiting} · идей {ideas}', {
          done: total.done,
          total: total.total,
          active: total.active,
          review: total.review,
          waiting: total.waiting,
          ideas: total.ideas,
        }),
      ),
    );
  }
  const glyph = (node: TreeNode) => {
    const hex = HEX[node.status];
    return hex ? p.c(hex, GLYPH[node.status]) : GLYPH[node.status];
  };
  // A hidden or folded closed parent must not hide the open work under it.
  const openInside = openWorkUnder(tree);
  // Inside a folded closed node only the way to open work is shown.
  const walk = (parent: string, prefix: string, folded = false) => {
    const kids: { node: TreeNode; fold: boolean }[] = [];
    let doneCount = 0;
    let counterAt = -1;
    for (const kid of childrenOf(tree, parent)) {
      const closed = CLOSED.has(kid.status);
      const hide = closed && (folded || options.closed === false);
      // Like the TUI's «Готовые» group: finished children collapse into one counter at the first one's place.
      const count = !hide && options.foldDone === true && kid.status === 'done';
      if (!hide && !count) kids.push({ node: kid, fold: false });
      else if (openInside(kid.id)) kids.push({ node: kid, fold: true });
      else if (count) {
        if (counterAt < 0) counterAt = kids.length;
        doneCount += 1;
      }
    }
    const items: ({ node: TreeNode; fold: boolean } | number)[] = [...kids];
    if (doneCount) items.splice(counterAt, 0, doneCount);
    items.forEach((item, index) => {
      const last = index === items.length - 1;
      if (typeof item === 'number') {
        lines.push(`${prefix}${p.dim(`${last ? '└─ ' : '├─ '}✓ ${t('готово: {n}', { n: item })}`)}`);
        return;
      }
      const { node, fold } = item;
      const next = `${prefix}${last ? '   ' : p.dim('│  ')}`;
      if (fold) {
        // A closed parent of open work: one dim line, with how much of it stays hidden.
        const hidden = descendants(tree, node.id).filter(
          (down) => CLOSED.has(down.status) && !openInside(down.id),
        ).length;
        const status = options.words ? `  ${STATUS_LABEL[node.status]}` : '';
        const rest = hidden > 0 ? t('  · свёрнуто, скрыто {n}', { n: hidden }) : '';
        lines.push(
          `${prefix}${p.dim(last ? '└─ ' : '├─ ')}${glyph(node)} ${p.dim(`${node.title}  ${node.id}${status}${rest}`)}`,
        );
        walk(node.id, next, true);
        return;
      }
      let line = `${prefix}${p.dim(last ? '└─ ' : '├─ ')}${glyph(node)} ${node.status === 'done' ? p.dim(node.title) : node.title}`;
      line += p.dim(`  ${node.id}`);
      // A waiting node says «ждёт» further on, with its reason.
      if (options.words && node.status !== 'waiting') line += p.dim(`  ${STATUS_LABEL[node.status]}`);
      const grandkids = childrenOf(tree, node.id);
      if (grandkids.length > 0) {
        const { done, total } = progress(tree, node.id);
        if (total > 0) line += p.dim(`  ${done}/${total}`);
      }
      if (node.who === 'human' && node.status !== 'done') line += p.c('#ffcf70', t('  · ты'));
      for (const link of linksOf(tree, node).needs)
        line += link.node ? p.dim(`  → ${link.project} ${GLYPH[link.node.status]}`) : p.dim(`  → ${link.project} ?`);
      if (node.status === 'waiting') {
        line += p.c(
          '#ffcf70',
          t('  ждёт{p1}{p2}', {
            p1: node.waiting ? `: ${node.waiting}` : '',
            p2: node.until ? ` → ${node.until}` : '',
          }),
        );
      }
      const stale = options.stale?.(node);
      if (stale) line += p.dim(`  ${staleLabel(stale)}`);
      lines.push(line);
      walk(node.id, next);
    });
  };
  walk(options.under ?? ROOT, '');
  return lines.join('\n');
}

/** The parts of a node card, in the order the card shows them; `show <id> --only` picks some. */
export const NODE_PARTS = [
  'header',
  'criterion',
  'commits',
  'children',
  'sessions',
  'note',
  'journal',
  'history',
  'mail',
] as const;
export type NodePart = (typeof NODE_PARTS)[number];

export interface NodeTextOptions {
  /** Header, criterion and the last journal entries only: for agents that skim. */
  brief?: boolean;
  /** How many journal entries to show; `Infinity` for all. Default 12 (3 when brief). */
  journal?: number;
  /** An «in progress» node nobody works on: the mark in the status line and the card note. */
  stale?: Stale;
  /** Status words in the lines of the children, as in `treeText`. */
  words?: boolean;
  /** Only these parts, after the title line; an empty part says so instead of vanishing. */
  only?: ReadonlySet<NodePart>;
}

export function nodeText(tree: Tree, node: TreeNode, p: Paint, options: NodeTextOptions = {}): string {
  if (options.only) return partsText(tree, node, p, options.only, options);
  const brief = options.brief === true;
  const lines: string[] = [titleLine(node, p), ...headerLines(tree, node, p, options.stale, !brief), ''];
  lines.push(...criterionLines(tree, node, p));
  if (!brief && node.commits?.length) lines.push('', ...commitLines(node, p));
  const kids = childrenOf(tree, node.id);
  if (kids.length > 0 && brief) {
    const { done, total } = progress(tree, node.id);
    lines.push(p.dim(t('внутри: {total}, готово {done}', { total, done })));
  } else if (kids.length > 0) lines.push('', ...childrenLines(tree, node, p, options.words === true));
  if (!brief && node.sessions.length > 0) lines.push('', ...sessionLines(node, p));
  const about = brief ? undefined : description(node.body);
  if (about) lines.push('', about);
  const journal = journalLines(node, p, options.journal ?? (brief ? 3 : 12), brief || options.journal !== undefined);
  if (journal.length) lines.push('', ...journal);
  return lines.join('\n');
}

/** `show <id> --only journal,sessions`: the title line, then the asked parts in the card's order. */
function partsText(
  tree: Tree,
  node: TreeNode,
  p: Paint,
  only: ReadonlySet<NodePart>,
  options: NodeTextOptions,
): string {
  const none = p.dim('—');
  const titled = (label: string, body: string[]) =>
    body.length ? [p.dim(label), ...body] : [`${p.dim(label)} ${none}`];
  const sections: Record<NodePart, () => string[]> = {
    header: () => headerLines(tree, node, p, options.stale, true),
    criterion: () => criterionLines(tree, node, p),
    commits: () => (node.commits?.length ? commitLines(node, p) : titled(t('коммиты:'), [])),
    children: () =>
      childrenOf(tree, node.id).length
        ? childrenLines(tree, node, p, options.words === true)
        : titled(t('внутри:'), []),
    sessions: () => (node.sessions.length ? sessionLines(node, p) : titled(t('сессии:'), [])),
    note: () => titled(t('описание:'), description(node.body) ? [description(node.body)] : []),
    journal: () => {
      const lines = journalLines(node, p, options.journal ?? 12, true);
      return lines.length ? lines : titled(t('журнал:'), []);
    },
    history: () =>
      titled(
        t('история статусов:'),
        statusHistory(node.body).map((entry) => `  - ${entry}`),
      ),
    mail: () =>
      titled(
        t('письма:'),
        lettersOf(node).map((letter) => `  ${letterLine(letter, p)}`),
      ),
  };
  const blocks = NODE_PARTS.filter((part) => only.has(part)).map((part) => sections[part]().join('\n'));
  return [titleLine(node, p), ...blocks].join('\n');
}

function titleLine(node: TreeNode, p: Paint): string {
  return `${GLYPH[node.status]} ${p.bold(node.title)}  ${p.dim(node.id)}`;
}

/** The status line, the path (left out of the brief card) and the note of an abandoned «in progress». */
function headerLines(tree: Tree, node: TreeNode, p: Paint, stale: Stale | undefined, withPath: boolean): string[] {
  const lines = [
    p.dim(
      [
        STATUS_LABEL[node.status],
        stale ? staleLabel(stale) : undefined,
        node.who ? t('делает: {p1}', { p1: WHO_LABEL[node.who] }) : undefined,
        node.updated ? t('обновлён {p1}', { p1: ago(node.updated) }) : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
    ),
  ];
  const path = pathTo(tree, node.id);
  if (withPath && path.length > 1)
    lines.push(p.dim(t('путь: {p1}', { p1: [tree.project.title, ...path.map((step) => step.title)].join(' › ') })));
  if (stale) lines.push(p.dim(staleNote(stale)));
  return lines;
}

/** «Готово, когда», the check, what it waits for and the links both ways. */
function criterionLines(tree: Tree, node: TreeNode, p: Paint): string[] {
  const lines = [`${p.dim(t('готово, когда:'))} ${node.doneWhen ?? p.dim(t('не задано'))}`];
  if (node.check) lines.push(`${p.dim(t('проверка:'))} ${node.check}`);
  if (node.status === 'waiting') {
    lines.push(
      `${p.dim(t('ждёт:'))} ${node.waiting ?? '—'}${
        node.until ? p.dim(t(' · вернуться, когда: {until}', { until: node.until })) : ''
      }`,
    );
  }
  const links = linksOf(tree, node);
  const linkLine = (link: Link) =>
    link.node
      ? `${GLYPH[link.node.status]} ${linkLabel(link)} · ${STATUS_LABEL[link.node.status]}`
      : p.dim(linkLabel(link));
  for (const link of links.needs) lines.push(`${p.dim(t('ждёт:'))} ${linkLine(link)}`);
  for (const link of links.neededBy) lines.push(`${p.dim(t('нужен для:'))} ${linkLine(link)}`);
  return lines;
}

function commitLines(node: TreeNode, p: Paint): string[] {
  return [p.dim(t('коммиты:')), ...(node.commits ?? []).map((sha) => `  ${sha}`)];
}

function childrenLines(tree: Tree, node: TreeNode, p: Paint, words: boolean): string[] {
  return [p.dim(t('внутри:')), treeText(tree, p, { under: node.id, ...(words ? { words: true } : {}) })];
}

function sessionLines(node: TreeNode, p: Paint): string[] {
  return [
    p.dim(t('сессии:')),
    ...node.sessions.map(
      (ref) => `  ${ref.brain.padEnd(11)} ${ref.id}  ${p.dim(ref.name ?? '')} ${p.dim(ago(ref.opened ?? ref.started))}`,
    ),
  ];
}

/** The last `keep` entries; `notice` says how many are hidden. Nothing when the journal is empty. */
function journalLines(node: TreeNode, p: Paint, keep: number, notice: boolean): string[] {
  const journal = journalEntries(node.body);
  if (!journal.length) return [];
  const lines = [p.dim(t('журнал:'))];
  const hidden = Math.max(0, journal.length - keep);
  if (hidden > 0 && notice) lines.push(p.dim(t('  … ещё {n} (--journal all)', { n: hidden })));
  for (const entry of journal.slice(journal.length - Math.min(keep, journal.length))) lines.push(`  - ${entry}`);
  return lines;
}

/** `show <id> --only … --json`: the id and the title, and the fields of the asked parts. */
export function partsJson(
  tree: Tree,
  node: TreeNode,
  only: ReadonlySet<NodePart>,
  journal = 12,
): Record<string, unknown> {
  const out: Record<string, unknown> = { id: node.id, title: node.title };
  const fields = nodeFields(node);
  const take = (...keys: string[]) => {
    for (const key of keys) if (fields[key] !== undefined) out[key] = fields[key];
  };
  if (only.has('header')) {
    take('status', 'who');
    if (node.updated) out.updated = node.updated;
    out.parent = node.parent;
    out.path = pathBetween(tree, ROOT, node.id);
  }
  if (only.has('criterion')) take('done_when', 'check', 'waiting', 'until', 'needs', 'for');
  if (only.has('commits')) out.commits = node.commits ?? [];
  if (only.has('children')) out.children = (treeJson(tree, undefined, node.id) as { children: unknown[] }).children;
  if (only.has('sessions')) out.sessions = node.sessions;
  if (only.has('note')) out.note = description(node.body);
  if (only.has('journal')) {
    const entries = journalEntries(node.body);
    out.journal = entries.slice(entries.length - Math.min(journal, entries.length));
  }
  if (only.has('history')) out.history = statusHistory(node.body);
  if (only.has('mail')) out.mail = lettersOf(node);
  return out;
}

/** `← 2026-11-22 21:45  от «Сайт»: «текст»` — a letter the node got (←) or its session sent (→). */
function letterLine(letter: Letter, p: Paint): string {
  return `${letter.direction === 'out' ? '→' : '←'} ${p.dim(letter.at)}  ${letterPeer(letter)}: «${letter.text}»`;
}

/** One node's fields for `--json`; `children` nests its subtree. */
function nodeFields(node: TreeNode, stale?: StaleFn): Record<string, unknown> {
  return {
    id: node.id,
    title: node.title,
    status: node.status,
    ...(node.who ? { who: node.who } : {}),
    ...(node.doneWhen ? { done_when: node.doneWhen } : {}),
    ...(node.check ? { check: node.check } : {}),
    ...(node.waiting ? { waiting: node.waiting } : {}),
    ...(node.until ? { until: node.until } : {}),
    ...(node.needs ? { needs: node.needs } : {}),
    ...(node.neededBy ? { for: node.neededBy } : {}),
    ...(node.sessions.length ? { sessions: node.sessions } : {}),
    ...staleJson(stale?.(node)),
    ...(node.commits?.length ? { commits: node.commits } : {}),
  };
}

/** For scripts and agents: the tree as nested JSON — or one branch of it, `under` a node. */
export function treeJson(tree: Tree, stale?: StaleFn, under?: string): unknown {
  const nodeJson = (node: TreeNode): Record<string, unknown> => ({
    ...nodeFields(node, stale),
    children: childrenOf(tree, node.id).map(nodeJson),
  });
  const branch = under && under !== ROOT ? tree.nodes.get(under) : undefined;
  if (branch) return nodeJson(branch);
  return {
    title: tree.project.title,
    ...(tree.project.goal ? { goal: tree.project.goal } : {}),
    summary: summarize(tree),
    nodes: childrenOf(tree, ROOT).map(nodeJson),
  };
}

/**
 * The format of `show --json --all`. Grows when a field changes its meaning or goes away;
 * a new field does not change it, so a reader skips keys it does not know.
 */
export const JSON_VERSION = 1;

/**
 * `show --json --all`: everything about every node, so a program (Treeyard Web) never parses
 * the markdown — the description, the journal and the status changes taken apart, the pictures,
 * the dates and the place among siblings. `order` in the files means something only among
 * siblings of one status, so `position` is the place in that group (0 — first); children go
 * by status in the default order, not the personal one: the export must not depend on whose
 * settings printed it. `under` — one branch.
 */
export function fullTreeJson(tree: Tree, stale?: StaleFn, under?: string): unknown {
  const { dir } = tree.project;
  const rank = STATUS_ORDERS['active-first'];
  // A stable sort: within one status the siblings keep their own order.
  const kidsOf = (id: string) =>
    childrenByOrder(tree, id).sort((a, b) => rank.indexOf(a.status) - rank.indexOf(b.status));
  const nodeJson = (node: TreeNode, _index: number, siblings: TreeNode[]): Record<string, unknown> => ({
    ...nodeFields(node, stale),
    parent: node.parent,
    position: siblings.filter((kid) => kid.status === node.status).indexOf(node),
    ...(node.created ? { created: node.created } : {}),
    ...(node.updated ? { updated: node.updated } : {}),
    ...(node.closed ? { closed: node.closed } : {}),
    note: description(node.body),
    journal: journalEntries(node.body).map((line) => {
      const { when, source, text } = parseEntry(line);
      return { ...(when ? { at: when } : {}), ...(source ? { who: source } : {}), text };
    }),
    history: statusSteps(node.body),
    images: listImages(dir, node.id).map((image) => ({
      file: image.file,
      path: imagePath(dir, node.id, image.file),
      ...(image.note ? { note: image.note } : {}),
      added: image.added,
    })),
    children: kidsOf(node.id).map(nodeJson),
  });
  const branch = under && under !== ROOT ? tree.nodes.get(under) : undefined;
  if (branch) return { version: JSON_VERSION, ...nodeJson(branch, 0, kidsOf(branch.parent)) };
  return {
    version: JSON_VERSION,
    title: tree.project.title,
    ...(tree.project.goal ? { goal: tree.project.goal } : {}),
    ...(tree.project.created ? { created: tree.project.created } : {}),
    summary: summarize(tree),
    nodes: kidsOf(ROOT).map(nodeJson),
  };
}

/** The titles between `under` and the node, both left out: where a found node sits. */
export function pathBetween(tree: Tree, under: string, id: string): string[] {
  const path = pathTo(tree, id).slice(0, -1);
  const from = path.findIndex((step) => step.id === under);
  return path.slice(from + 1).map((step) => step.title);
}

/** Nodes found by status (or by text): one line each, the status as a word and where the node sits. */
export function nodeLine(tree: Tree, node: TreeNode, p: Paint, under: string = ROOT): string {
  const hex = HEX[node.status];
  const glyph = hex ? p.c(hex, GLYPH[node.status]) : GLYPH[node.status];
  const path = pathBetween(tree, under, node.id);
  return `${glyph} ${node.title}  ${p.dim(node.id)}  ${p.dim(STATUS_LABEL[node.status])}${
    path.length ? p.dim(`  (${clipStart(path.join(' › '), 90)})`) : ''
  }`;
}

/** Long paths keep their end: the parent says more than the top of the tree. */
function clipStart(text: string, limit: number): string {
  return text.length > limit ? `…${text.slice(text.length - limit + 1)}` : text;
}

/** A found node for `--json`: its fields, its parent and the titles on the way to it. */
export function foundJson(tree: Tree, node: TreeNode, under: string = ROOT): Record<string, unknown> {
  return { ...nodeFields(node), parent: node.parent, path: pathBetween(tree, under, node.id) };
}

/** The `stale` field of `--json`: whole hours without a live session or a record. */
export function staleJson(stale: Stale | undefined): { stale?: { hours: number } } {
  return stale ? { stale: { hours: stale.hours } } : {};
}

/** `treeyard watch` without `--json`: an event as one line — the time, the node and what happened. */
export function watchLine(event: TreeEvent, p: Paint): string {
  const time = Number.isFinite(Date.parse(event.at)) ? new Date(event.at) : new Date();
  const clock = [time.getHours(), time.getMinutes(), time.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
  const status = event.status;
  const hex = status ? HEX[status] : '#7ee2a8';
  const mark = status ? GLYPH[status] : '◆';
  const head = `${p.dim(clock)}  ${hex ? p.c(hex, mark) : mark} ${event.title}  ${p.dim(event.id)}  `;
  const last = event.journal?.at(-1);
  const entry = last ? clip([last.who, last.text].filter(Boolean).join(' · '), 100) : '';
  switch (event.type) {
    case 'added':
      return head + t('добавлен');
    case 'removed':
      return head + p.dim(t('удалён'));
    case 'status': {
      const move = `${STATUS_LABEL[event.from!]} → ${STATUS_LABEL[event.to!]}`;
      return head + (hex ? p.c(hex, move) : move) + (event.who ? p.dim(` · ${event.who}`) : '');
    }
    case 'journal':
      return (
        head +
        (event.journal!.length > 1
          ? t('записей: {n}, последняя: {entry}', { n: event.journal!.length, entry })
          : t('запись: {entry}', { entry }))
      );
    default:
      return head + p.dim(t('изменено: {fields}', { fields: (event.fields ?? []).join(', ') }));
  }
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
