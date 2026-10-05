/**
 * The tree as plain text: for pipes, for agents (`treeyard show` is how they
 * look around), and for a quick look without the TUI.
 */

import { t } from '../i18n/i18n.js';
import { description, journalEntries } from '../model/journal.js';
import { type Link, linkLabel, linksOf } from '../model/links.js';
import { STATUS_LABEL, WHO_LABEL } from '../model/ops.js';
import { GLYPH } from '../model/overview.js';
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

export function treeText(tree: Tree, p: Paint, options: { closed?: boolean; under?: string } = {}): string {
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
    const kids = childrenOf(tree, parent).filter(
      (kid) => options.closed !== false || (kid.status !== 'done' && kid.status !== 'dropped'),
    );
    kids.forEach((node, index) => {
      const last = index === kids.length - 1;
      let line = `${prefix}${p.dim(last ? '└─ ' : '├─ ')}${glyph(node)} ${node.status === 'done' ? p.dim(node.title) : node.title}`;
      line += p.dim(`  ${node.id}`);
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
      lines.push(line);
      walk(node.id, `${prefix}${last ? '   ' : p.dim('│  ')}`);
    });
  };
  walk(options.under ?? ROOT, '');
  return lines.join('\n');
}

export function nodeText(tree: Tree, node: TreeNode, p: Paint): string {
  const lines: string[] = [];
  const path = pathTo(tree, node.id);
  lines.push(`${GLYPH[node.status]} ${p.bold(node.title)}  ${p.dim(node.id)}`);
  lines.push(
    p.dim(
      [
        STATUS_LABEL[node.status],
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
  if (path.length > 1)
    lines.push(
      p.dim(
        t('путь: {p1}', {
          p1: [tree.project.title, ...path.map((step) => step.title)].join(' › '),
        }),
      ),
    );
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
  if (node.commits?.length) {
    lines.push('', p.dim(t('коммиты:')));
    for (const sha of node.commits) lines.push(`  ${sha}`);
  }
  const kids = childrenOf(tree, node.id);
  if (kids.length > 0) {
    lines.push('', p.dim(t('внутри:')));
    lines.push(treeText(tree, p, { under: node.id }));
  }
  if (node.sessions.length > 0) {
    lines.push('', p.dim(t('сессии:')));
    for (const ref of node.sessions) {
      lines.push(
        `  ${ref.brain.padEnd(11)} ${ref.id}  ${p.dim(ref.name ?? '')} ${p.dim(ago(ref.opened ?? ref.started))}`,
      );
    }
  }
  const about = description(node.body);
  if (about) lines.push('', about);
  const journal = journalEntries(node.body);
  if (journal.length > 0) {
    lines.push('', p.dim(t('журнал:')));
    for (const entry of journal.slice(-12)) lines.push(`  - ${entry}`);
  }
  return lines.join('\n');
}

/** For scripts and agents: the tree as nested JSON. */
export function treeJson(tree: Tree): unknown {
  const nodeJson = (node: TreeNode): Record<string, unknown> => ({
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
    ...(node.commits?.length ? { commits: node.commits } : {}),
    children: childrenOf(tree, node.id).map(nodeJson),
  });
  return {
    title: tree.project.title,
    ...(tree.project.goal ? { goal: tree.project.goal } : {}),
    summary: summarize(tree),
    nodes: childrenOf(tree, ROOT).map(nodeJson),
  };
}
