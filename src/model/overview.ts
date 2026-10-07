/**
 * `.tree/README.md` — the whole tree as one page, rebuilt on every change.
 * GitHub shows it when you open the folder, and an agent gets the shape of
 * the project from it in one read. It is generated: edits go to the nodes.
 * Siblings go by `order` (execution order), not by status: the file is
 * committed, so it may not depend on anyone's `status_order` setting.
 */

import { t } from '../i18n/i18n.js';
import { atomicWrite, TREE_DIR } from './store.js';
import { childrenByOrder, childrenOf, progress, summarize } from './tree.js';
import { ROOT, type Status, type Tree, type TreeNode } from './types.js';

export const GLYPH: Record<Status, string> = {
  idea: '◇',
  todo: '○',
  active: '◐',
  waiting: '‖',
  review: '◎',
  done: '✓',
  dropped: '✗',
};

export function overviewText(tree: Tree): string {
  const { project } = tree;
  const total = summarize(tree);
  const lines: string[] = [`# ${project.title}`, ''];
  if (project.goal)
    lines.push(
      t('**Цель:** {goal}', {
        goal: project.goal,
      }),
      '',
    );
  lines.push(
    t('Готово {done} из {total} · в работе {active} · на проверке {review} · ждут {waiting} · идей {ideas}', {
      done: total.done,
      total: total.total,
      active: total.active,
      review: total.review,
      waiting: total.waiting,
      ideas: total.ideas,
    }),
    '',
    t('> Этот файл собирает treeyard из `nodes/` — правьте узлы, а не его.'),
    t('> `○` к работе · `◐` в работе · `◎` на проверке · `‖` ждёт · `✓` готово · `◇` идея · `✗` отказ'),
    '',
  );
  const walk = (parent: string, depth: number) => {
    for (const node of childrenByOrder(tree, parent)) {
      lines.push(`${'  '.repeat(depth)}- ${line(tree, node)}`);
      walk(node.id, depth + 1);
    }
  };
  walk(ROOT, 0);
  return `${lines.join('\n')}\n`;
}

function line(tree: Tree, node: TreeNode): string {
  let text = `${GLYPH[node.status]} [${escapeMd(node.title)}](nodes/${node.id}.md)`;
  const kids = childrenOf(tree, node.id);
  if (kids.length > 0) {
    const { done, total } = progress(tree, node.id);
    if (total > 0) text += ` — ${done}/${total}`;
  }
  if (node.who === 'human') text += t(' · *ты*');
  if (node.status === 'waiting' && node.waiting)
    text += t(' · ждёт: {p1}', {
      p1: escapeMd(node.waiting),
    });
  return text;
}

function escapeMd(text: string): string {
  return text.replace(/([[\]])/g, '\\$1');
}

export function writeOverview(tree: Tree): void {
  atomicWrite(`${tree.project.dir}/${TREE_DIR}/README.md`, overviewText(tree));
}
