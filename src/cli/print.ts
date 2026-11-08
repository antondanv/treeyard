/**
 * The tree as plain text: for pipes, for agents (`treeyard show` is how they
 * look around), and for a quick look without the TUI.
 */

import { t } from '../i18n/i18n.js';
import { description, journalEntries } from '../model/journal.js';
import { type Link, linkLabel, linksOf } from '../model/links.js';
import { STATUS_LABEL, WHO_LABEL } from '../model/ops.js';
import { GLYPH } from '../model/overview.js';
import { type Stale, staleLabel, staleNote } from '../model/stale.js';
import { ago } from '../model/time.js';
import { childrenOf, pathTo, progress, summarize } from '../model/tree.js';
import { ROOT, type Status, type Tree, type TreeNode } from '../model/types.js';

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
  const walk = (parent: string, prefix: string) => {
    const all = childrenOf(tree, parent).filter(
      (kid) => options.closed !== false || (kid.status !== 'done' && kid.status !== 'dropped'),
    );
    // Like the TUI's «Готовые» group: finished children collapse into one counter at the first one's place.
    const doneCount = options.foldDone ? all.filter((kid) => kid.status === 'done').length : 0;
    const kids: (TreeNode | number)[] = [];
    for (const kid of all) {
      if (doneCount && kid.status === 'done') {
        if (!kids.some((item) => typeof item === 'number')) kids.push(doneCount);
      } else kids.push(kid);
    }
    kids.forEach((node, index) => {
      const last = index === kids.length - 1;
      if (typeof node === 'number') {
        lines.push(`${prefix}${p.dim(`${last ? '└─ ' : '├─ '}✓ ${t('готово: {n}', { n: node })}`)}`);
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
      walk(node.id, `${prefix}${last ? '   ' : p.dim('│  ')}`);
    });
  };
  walk(options.under ?? ROOT, '');
  return lines.join('\n');
}

export interface NodeTextOptions {
  /** Header, criterion and the last journal entries only: for agents that skim. */
  brief?: boolean;
  /** How many journal entries to show; `Infinity` for all. Default 12 (3 when brief). */
  journal?: number;
  /** An «in progress» node nobody works on: the mark in the status line and the card note. */
  stale?: Stale;
  /** Status words in the lines of the children, as in `treeText`. */
  words?: boolean;
}

export function nodeText(tree: Tree, node: TreeNode, p: Paint, options: NodeTextOptions = {}): string {
  const brief = options.brief === true;
  const keep = options.journal ?? (brief ? 3 : 12);
  const stale = options.stale;
  const lines: string[] = [];
  const path = pathTo(tree, node.id);
  lines.push(`${GLYPH[node.status]} ${p.bold(node.title)}  ${p.dim(node.id)}`);
  lines.push(
    p.dim(
      [
        STATUS_LABEL[node.status],
        stale ? staleLabel(stale) : undefined,
        node.who
          ? t('делает: {p1}', {
              p1: WHO_LABEL[node.who],
            })
          : undefined,
        node.updated
          ? t('обновлён {p1}', {
              p1: ago(node.updated),
            })
          : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
    ),
  );
  if (!brief && path.length > 1)
    lines.push(
      p.dim(
        t('путь: {p1}', {
          p1: [tree.project.title, ...path.map((step) => step.title)].join(' › '),
        }),
      ),
    );
  if (stale) lines.push(p.dim(staleNote(stale)));
  lines.push('');
  lines.push(`${p.dim(t('готово, когда:'))} ${node.doneWhen ?? p.dim(t('не задано'))}`);
  if (node.check) lines.push(`${p.dim(t('проверка:'))} ${node.check}`);
  if (node.status === 'waiting') {
    lines.push(
      `${p.dim(t('ждёт:'))} ${node.waiting ?? '—'}${
        node.until
          ? p.dim(
              t(' · вернуться, когда: {until}', {
                until: node.until,
              }),
            )
          : ''
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
  if (!brief && node.commits?.length) {
    lines.push('', p.dim(t('коммиты:')));
    for (const sha of node.commits) lines.push(`  ${sha}`);
  }
  const kids = childrenOf(tree, node.id);
  if (kids.length > 0 && brief) {
    const { done, total } = progress(tree, node.id);
    lines.push(p.dim(t('внутри: {total}, готово {done}', { total, done })));
  } else if (kids.length > 0) {
    lines.push('', p.dim(t('внутри:')));
    lines.push(treeText(tree, p, { under: node.id, ...(options.words ? { words: true } : {}) }));
  }
  if (!brief && node.sessions.length > 0) {
    lines.push('', p.dim(t('сессии:')));
    for (const ref of node.sessions) {
      lines.push(
        `  ${ref.brain.padEnd(11)} ${ref.id}  ${p.dim(ref.name ?? '')} ${p.dim(ago(ref.opened ?? ref.started))}`,
      );
    }
  }
  const about = brief ? undefined : description(node.body);
  if (about) lines.push('', about);
  const journal = journalEntries(node.body);
  if (journal.length > 0) {
    lines.push('', p.dim(t('журнал:')));
    const hidden = Math.max(0, journal.length - keep);
    if (hidden > 0 && (brief || options.journal !== undefined))
      lines.push(p.dim(t('  … ещё {n} (--journal all)', { n: hidden })));
    for (const entry of journal.slice(journal.length - Math.min(keep, journal.length))) lines.push(`  - ${entry}`);
  }
  return lines.join('\n');
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
