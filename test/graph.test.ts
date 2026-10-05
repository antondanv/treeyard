import type { SessionInfo } from '@antondanv/brainyard';
import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';

import { addNode } from '../src/model/ops.js';
import { flatten } from '../src/model/tree.js';
import { ROOT, type Tree } from '../src/model/types.js';
import { follow, graphCells, layoutGraph, neighbour } from '../src/tui/graph.js';
import { emptyTree } from './helpers.js';

const text = (cells: { char: string }[][]) => cells.map((row) => row.map((cell) => cell.char).join('')).join('\n');

function sample(): { tree: Tree; expanded: Set<string> } {
  const tree = emptyTree();
  const expanded = new Set<string>();
  for (let i = 0; i < 6; i++) {
    const branch = addNode(tree, { title: `Ветка ${i}` });
    expanded.add(branch.id);
    for (let j = 0; j <= i % 3; j++) addNode(tree, { title: `Задача ${i}.${j}`, parent: branch.id });
  }
  return { tree, expanded };
}

describe('graph layout', () => {
  for (const style of ['line', 'card'] as const) {
    it(`${style}: children to the right of parents, no overlaps in a column`, () => {
      const { tree, expanded } = sample();
      const layout = layoutGraph(flatten(tree, { expanded, showClosed: true }), { style, width: 28, tree });
      for (const card of layout.cards) {
        if (card.row) {
          const parent = layout.byId.get(card.row.node.parent)!;
          expect(card.x).toBeGreaterThan(parent.x + parent.width);
          expect(card.depth).toBe(parent.depth + 1);
        }
        for (const other of layout.cards) {
          if (card.id === other.id || card.x !== other.x) continue;
          expect(card.y + card.height <= other.y || other.y + other.height <= card.y).toBe(true);
        }
      }
      expect(layout.cards).toHaveLength(tree.nodes.size + 1);
    });
  }

  it('line: one row per leaf, so a whole branch fits on a screen', () => {
    const { tree, expanded } = sample();
    const rows = flatten(tree, { expanded, showClosed: true });
    const lines = layoutGraph(rows, { style: 'line', width: 30, tree });
    const cards = layoutGraph(rows, { style: 'card', width: 28, tree });
    expect(lines.height).toBeLessThan(cards.height / 3);
  });

  it('a parent sits between its first and last child', () => {
    const { tree, expanded } = sample();
    const layout = layoutGraph(flatten(tree, { expanded, showClosed: true }), { style: 'line', width: 30, tree });
    for (const card of layout.cards) {
      const kids = layout.cards.filter((item) => item.row?.node.parent === card.id);
      if (kids.length < 2) continue;
      expect(card.y).toBeGreaterThanOrEqual(Math.min(...kids.map((kid) => kid.y)));
      expect(card.y).toBeLessThanOrEqual(Math.max(...kids.map((kid) => kid.y)));
    }
  });
});

describe('moving around the graph', () => {
  it('up and down stay in the column and cross between parents; left is the parent; right the nearest child', () => {
    const { tree, expanded } = sample();
    const layout = layoutGraph(flatten(tree, { expanded, showClosed: true }), { style: 'line', width: 30, tree });
    const byTitle = (title: string) => [...tree.nodes.values()].find((node) => node.title === title)!.id;
    // The last task of branch 1 goes down into the first task of branch 2.
    expect(neighbour(layout, byTitle('Задача 1.1'), 'down')).toBe(byTitle('Задача 2.0'));
    expect(neighbour(layout, byTitle('Задача 2.0'), 'up')).toBe(byTitle('Задача 1.1'));
    expect(neighbour(layout, byTitle('Задача 2.1'), 'left')).toBe(byTitle('Ветка 2'));
    // Branch 2 has three tasks and sits by the middle one.
    expect(neighbour(layout, byTitle('Ветка 2'), 'right')).toBe(byTitle('Задача 2.1'));
    expect(neighbour(layout, byTitle('Ветка 0'), 'left')).toBeUndefined();
  });

  it('the viewport moves only when the selection leaves it', () => {
    const { tree, expanded } = sample();
    const layout = layoutGraph(flatten(tree, { expanded, showClosed: true }), { style: 'line', width: 30, tree });
    const first = [...tree.nodes.values()].find((node) => node.title === 'Задача 0.0')!.id;
    const last = [...tree.nodes.values()].find((node) => node.title === 'Задача 5.2')!.id;
    const start = follow(layout, first, { x: 120, y: 8 }, { x: 0, y: 0 });
    expect(follow(layout, first, { x: 120, y: 8 }, start)).toEqual(start);
    const far = follow(layout, last, { x: 120, y: 8 }, start);
    const card = layout.byId.get(last)!;
    expect(card.y - far.y).toBeGreaterThanOrEqual(0);
    expect(card.y + card.height - far.y).toBeLessThanOrEqual(8);
  });

  it('frames the working branch beside a session, keeping the root reachable', () => {
    const { tree, expanded } = sample();
    for (const style of ['line', 'card'] as const) {
      const layout = layoutGraph(flatten(tree, { expanded, showClosed: true }), { style, width: 28, tree });
      const branch = [...tree.nodes.values()][0]!;
      const child = [...tree.nodes.values()].find((node) => node.parent === branch.id)!;
      const size = { x: 100, y: 12 };
      const focused = follow(layout, child.id, size, { x: 0, y: 0 }, true);
      expect(focused.x).toBe(layout.byId.get(branch.id)!.x - 1);
      expect(layout.byId.get(ROOT)!.x + layout.byId.get(ROOT)!.width).toBeLessThan(focused.x);
      const returned = follow(layout, branch.id, size, focused, true);
      expect(returned.x).toBe(0);
      expect(layout.byId.has(ROOT)).toBe(true);
    }
    const empty = emptyTree();
    const layout = layoutGraph([], { style: 'line', width: 28, tree: empty });
    expect(follow(layout, undefined, { x: 80, y: 12 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('drawing', () => {
  it.each(['line', 'card'] as const)(
    '%s: selected and unselected nodes keep their live state, even in narrow cards',
    (style) => {
      const tree = emptyTree();
      const node = addNode(tree, { title: 'Оплата заказа после доставки с продолжением', status: 'review' });
      node.sessions.push({ brain: 'claude', id: 'conversation' });
      const layout = layoutGraph(flatten(tree, { expanded: new Set(), showClosed: true }), { style, width: 20, tree });
      for (const status of ['busy', 'waiting'] as const) {
        const live = new Map<string, SessionInfo>([
          [
            'conversation',
            { brain: 'claude', id: 'conversation', interactive: true, live: { kind: 'interactive', status } },
          ],
        ]);
        for (const selected of [undefined, node.id]) {
          for (const tick of [0, 12_000]) {
            const cells = graphCells({
              tree,
              layout,
              selected,
              width: 70,
              height: 10,
              offset: { x: 0, y: 0 },
              live,
              tick,
            });
            const picture = text(cells);
            expect(picture).toContain('◎');
            expect(picture).toContain(status === 'waiting' ? '? claude' : '⠋ claude');
            expect(picture).not.toMatch(/работа…|ждёт т…/);
          }
        }
      }
    },
  );

  it('fits Unicode exactly into the terminal cells, wide characters and emoji included', () => {
    const tree = emptyTree();
    const expanded = new Set<string>();
    let parent = ROOT;
    for (let i = 0; i < 6; i++) {
      expanded.add(parent);
      parent = addNode(tree, { title: '部署 👩‍💻 é / проверка очень длинного названия', parent }).id;
    }
    for (const style of ['line', 'card'] as const) {
      const layout = layoutGraph(flatten(tree, { expanded, showClosed: true }), { style, width: 28, tree });
      const offset = follow(layout, parent, { x: 44, y: 12 }, { x: 0, y: 0 });
      const cells = graphCells({ tree, layout, selected: parent, width: 44, height: 12, offset });
      expect(cells).toHaveLength(12);
      for (const row of cells) expect(stringWidth(row.map((cell) => cell.char).join(''))).toBe(44);
    }
  });

  it('line: titles end with an ellipsis, closed branches say how much is inside, the selection is a pill', () => {
    const tree = emptyTree();
    const branch = addNode(tree, { title: 'Очень длинное название ветки, которое не влезет в колонку' });
    addNode(tree, { title: 'a', parent: branch.id });
    addNode(tree, { title: 'b', parent: branch.id });
    const other = addNode(tree, { title: 'Вторая' });
    const layout = layoutGraph(flatten(tree, { expanded: new Set(), showClosed: true }), {
      style: 'line',
      width: 24,
      tree,
    });
    const cells = graphCells({ tree, layout, selected: other.id, width: 80, height: 8, offset: { x: 0, y: 0 } });
    const picture = text(cells);
    expect(picture).toContain('…');
    expect(picture).toContain('›2');
    expect(picture).toContain('◆ Тест');
    expect(cells.flat().some((cell) => cell.pill && cell.char === 'В')).toBe(true);
  });

  it('lines join the parent to every child with box-drawing corners', () => {
    const { tree, expanded } = sample();
    const layout = layoutGraph(flatten(tree, { expanded, showClosed: true }), { style: 'line', width: 20, tree });
    const picture = text(graphCells({ tree, layout, width: 100, height: layout.height, offset: { x: 0, y: 0 } }));
    expect(picture).toMatch(/[╭├]/);
    expect(picture).toMatch(/[╰├]/);
    expect(picture).toContain('Задача 5.2');
  });
});
