/**
 * The tree as a graph: the goal on the left, branches growing right, each
 * parent in the middle of its children, joined by lines. Two looks:
 *
 * - `line` — a node is one line of text; a screen holds the whole working
 *   part of a project. The default.
 * - `card` — a node is a framed card with its status underneath; roomier,
 *   for looking at a few branches up close.
 *
 * Layout works in its own coordinates; only the cells inside the viewport are
 * drawn, so a large tree costs no more than the screen.
 */
import type { SessionInfo } from '@antondanv/brainyard';
import { Box, Text } from 'ink';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';

import { BRAIN_SHORT } from '../agents/launch.js';
import { t } from '../i18n/i18n.js';
import { STATUS_LABEL } from '../model/ops.js';
import { GLYPH } from '../model/overview.js';
import { childrenOf, pathTo, progress, type Row } from '../model/tree.js';
import { ROOT, type Tree } from '../model/types.js';
import { marquee, overflows } from './marquee.js';
import { C, SPINNER, STATUS_COLOR } from './theme.js';

export type GraphStyle = 'line' | 'card';

export interface GraphCard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Width of the column the card stands in: lines leave from its right edge. */
  column: number;
  depth: number;
  row?: Row;
}

export interface GraphLayout {
  style: GraphStyle;
  cards: GraphCard[];
  byId: Map<string, GraphCard>;
  width: number;
  height: number;
}

export interface LayoutOptions {
  style: GraphStyle;
  /** Card width in `card` style; the widest label in `line` style. */
  width: number;
  tree: Tree;
}

const LINE_GAP_X = 6;
const CARD_GAP_X = 6;

export interface Label {
  glyph: string;
  title: string;
  /** What is folded inside a closed branch: `› 4`. */
  tail: string;
}

/** The text of a node in `line` style: status mark, title, and how much is folded inside. */
export function lineLabel(tree: Tree, row: Row | undefined): Label {
  if (!row) return { glyph: '◆', title: tree.project.title, tail: '' };
  const folded = row.hasChildren && !row.expanded ? childrenOf(tree, row.node.id).length : 0;
  return { glyph: GLYPH[row.node.status], title: row.node.title, tail: folded ? ` ›${folded}` : '' };
}

function labelText(label: Label): string {
  return `${label.glyph} ${label.title}${label.tail}`;
}

/** Subtrees occupy separate vertical bands; parents sit between their children. */
export function layoutGraph(rows: Row[], options: LayoutOptions): GraphLayout {
  const { style, tree } = options;
  const card = style === 'card';
  const cardHeight = card ? (options.width <= 20 ? 4 : 5) : 1;
  const children = new Map<string, Row[]>();
  for (const row of rows) {
    const list = children.get(row.node.parent) ?? [];
    list.push(row);
    children.set(row.node.parent, list);
  }

  // Column widths: cards are all alike; lines take what the longest title in
  // the column needs, up to the limit.
  const columns: number[] = [];
  const labelWidth = new Map<string, number>();
  const measureLabel = (id: string, depth: number, row?: Row) => {
    const width = card ? options.width : Math.min(options.width, stringWidth(labelText(lineLabel(tree, row))));
    labelWidth.set(id, width);
    columns[depth] = Math.max(columns[depth] ?? 0, width);
    for (const kid of children.get(id) ?? []) measureLabel(kid.node.id, depth + 1, kid);
  };
  measureLabel(ROOT, 0);
  const gapX = card ? CARD_GAP_X : LINE_GAP_X;
  const columnX: number[] = [];
  let x = 1;
  for (let depth = 0; depth < columns.length; depth++) {
    columnX[depth] = x;
    x += (columns[depth] ?? 0) + gapX;
  }

  // Leaves sit tight; a sibling with its own branch gets air around it.
  const gapBetween = (a: Row, b: Row) =>
    card ? 1 : (children.get(a.node.id)?.length ?? 0) > 0 || (children.get(b.node.id)?.length ?? 0) > 0 ? 1 : 0;
  const heights = new Map<string, number>();
  const measure = (id: string): number => {
    const kids = children.get(id) ?? [];
    let total = 0;
    kids.forEach((kid, index) => {
      total += measure(kid.node.id);
      if (index > 0) total += gapBetween(kids[index - 1]!, kid);
    });
    const height = Math.max(cardHeight, total);
    heights.set(id, height);
    return height;
  };
  const height = measure(ROOT) + 2;
  const cards: GraphCard[] = [];
  const middle = card ? 2 : 0;
  const place = (id: string, depth: number, top: number, row?: Row): number => {
    const kids = children.get(id) ?? [];
    let next = top;
    const centers = kids.map((kid, index) => {
      if (index > 0) next += gapBetween(kids[index - 1]!, kid);
      const center = place(kid.node.id, depth + 1, next, kid);
      next += heights.get(kid.node.id)!;
      return center;
    });
    const center = centers.length ? Math.floor((centers[0]! + centers.at(-1)!) / 2) : top + middle;
    cards.push({
      id,
      x: columnX[depth]!,
      y: center - middle,
      width: labelWidth.get(id) ?? options.width,
      height: cardHeight,
      column: columns[depth] ?? options.width,
      depth,
      ...(row ? { row } : {}),
    });
    return center;
  };
  place(ROOT, 0, 1);
  const width = Math.max(...cards.map((item) => item.x + item.column)) + 2;
  return { style, cards, byId: new Map(cards.map((item) => [item.id, item])), width, height };
}

/** The row of a card where lines meet it. */
function port(card: GraphCard): number {
  return card.height > 1 ? card.y + 2 : card.y;
}

export interface Viewport {
  x: number;
  y: number;
}

/**
 * Moves the viewport only as much as it takes to keep the selection in view
 * with a margin — the picture does not jump on every step.
 */
export function follow(
  layout: GraphLayout,
  selected: string | undefined,
  size: Viewport,
  previous: Viewport,
): Viewport {
  const card = (selected && layout.byId.get(selected)) || layout.byId.get(ROOT)!;
  const marginY = Math.min(4, Math.floor(size.y / 4));
  let y = previous.y;
  if (card.y - marginY < y) y = card.y - marginY;
  if (card.y + card.height + marginY > y + size.y) y = card.y + card.height + marginY - size.y;
  let x = previous.x;
  // The whole label and a little of what grows out of it.
  const right = card.x + card.column + 4;
  if (right > x + size.x) x = right - size.x;
  // Keep the parent's column in view when there is room for it.
  const parent = card.row ? layout.byId.get(card.row.node.parent) : undefined;
  const left = parent && right - parent.x <= size.x ? parent.x - 1 : card.x - 1;
  if (left < x) x = left;
  return {
    x: clamp(x, 0, Math.max(0, layout.width - size.x)),
    y: clamp(y, 0, Math.max(0, layout.height - size.y)),
  };
}

/** The node an arrow key leads to, by position on screen. */
export function neighbour(
  layout: GraphLayout,
  from: string | undefined,
  direction: 'up' | 'down' | 'left' | 'right',
): string | undefined {
  const card = from ? layout.byId.get(from) : undefined;
  if (!card) return layout.cards.find((item) => item.id !== ROOT)?.id;
  if (direction === 'left') return card.row && card.row.node.parent !== ROOT ? card.row.node.parent : undefined;
  if (direction === 'right') {
    const kids = layout.cards.filter((item) => item.row?.node.parent === card.id);
    return nearest(kids, port(card))?.id;
  }
  // Up and down stay in the column, crossing from one parent's children to the next.
  const same = layout.cards.filter((item) => item.depth === card.depth && item.id !== card.id && item.id !== ROOT);
  const candidates = same.filter((item) => (direction === 'up' ? item.y < card.y : item.y > card.y));
  return nearest(candidates, card.y)?.id;
}

function nearest(cards: GraphCard[], y: number): GraphCard | undefined {
  let best: GraphCard | undefined;
  for (const item of cards) {
    if (!best || Math.abs(port(item) - y) < Math.abs(port(best) - y)) best = item;
  }
  return best;
}

export interface Cell {
  char: string;
  color?: string;
  bold?: boolean;
  /** Part of the selected node's pill: drawn on the brand colour. */
  pill?: boolean;
  /** Continuation of a wide grapheme; emitting it would add an extra column. */
  continuation?: boolean;
  mask?: number;
}

const N = 1;
const E = 2;
const S = 4;
const W = 8;
const LINES: Record<number, string> = {
  1: '│',
  2: '─',
  3: '╰',
  4: '│',
  5: '│',
  6: '╭',
  7: '├',
  8: '─',
  9: '╯',
  10: '─',
  11: '┴',
  12: '╮',
  13: '┤',
  14: '┬',
  15: '┼',
};
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * How much of the selected node's title does not fit: the text that would
 * run and the columns it has. Undefined when it fits — no ticker needed.
 */
export function selectedOverflow(
  layout: GraphLayout,
  tree: Tree,
  id: string | undefined,
): { text: string; width: number } | undefined {
  const item = id ? layout.byId.get(id) : undefined;
  if (!item?.row) return undefined;
  if (layout.style === 'line') {
    const label = lineLabel(tree, item.row);
    const width = Math.max(4, item.width - 2 - stringWidth(label.tail));
    return overflows(label.title, width) ? { text: label.title, width } : undefined;
  }
  const inner = item.width - 4;
  const title = `${GLYPH[item.row.node.status]} ${item.row.node.title}`;
  if (item.height < 5) return overflows(title, inner) ? { text: title, width: inner } : undefined;
  const lines = wrapAnsi(title, inner, { hard: true, trim: true }).split('\n');
  if (lines.length <= 2) return undefined;
  // The second line runs through everything the first one did not show.
  const rest = title.slice(lines[0]!.length).trim();
  return { text: rest, width: inner };
}

export interface GraphProps {
  tree: Tree;
  layout: GraphLayout;
  selected?: string | undefined;
  width: number;
  height: number;
  offset: Viewport;
  live?: Map<string, SessionInfo>;
  /** Nodes whose session runs in a pane now. */
  panes?: ReadonlySet<string>;
  frame?: number;
  /** Milliseconds since the selected node got selected: the clock of its running title. */
  tick?: number;
}

/** Draw only viewport cells, so a deep or large tree does not allocate a giant canvas. */
export function graphCells(props: GraphProps): Cell[][] {
  const { tree, layout, width, height, selected, offset } = props;
  const cells: Cell[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ char: ' ' })));
  const path = new Set([ROOT, ...(selected ? pathTo(tree, selected).map((node) => node.id) : [])]);
  const card = layout.style === 'card';

  const put = (x: number, y: number, cell: Cell) => {
    if (x >= 0 && x < width && y >= 0 && y < height) cells[y]![x] = cell;
  };
  const lineCell = (x: number, y: number, mask: number, color: string) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const cell = cells[y]![x]!;
    const merged = (cell.mask ?? 0) | mask;
    // A line on the selected path keeps its colour where it crosses another.
    const keep = cell.color === C.brand && cell.mask !== undefined;
    cells[y]![x] = { char: LINES[merged] ?? '─', mask: merged, color: keep ? C.brand : color };
  };
  const horizontal = (x1: number, x2: number, y: number, color: string) => {
    for (let x = x1; x <= x2; x++) lineCell(x - offset.x, y - offset.y, (x > x1 ? W : 0) | (x < x2 ? E : 0), color);
  };
  const vertical = (x: number, y1: number, y2: number, color: string) => {
    for (let y = y1; y <= y2; y++) lineCell(x - offset.x, y - offset.y, (y > y1 ? N : 0) | (y < y2 ? S : 0), color);
  };

  // Lines first: from the end of a parent's label to a trunk in the gap, and on to each child.
  const gapX = card ? CARD_GAP_X : LINE_GAP_X;
  const drawn = layout.cards.filter((item) => item.row);
  // Lines off the selected path go first, so the path is drawn over them.
  drawn.sort((a, b) => Number(path.has(a.id)) - Number(path.has(b.id)));
  for (const item of drawn) {
    const parent = layout.byId.get(item.row!.node.parent);
    if (!parent) continue;
    const fromX = parent.x + (card ? parent.column : parent.width) + (card ? 0 : 1);
    const trunk = parent.x + parent.column + Math.ceil(gapX / 2);
    const color = path.has(item.id) ? C.brand : C.rule;
    if (fromX <= trunk) horizontal(fromX, trunk, port(parent), color);
    vertical(trunk, Math.min(port(parent), port(item)), Math.max(port(parent), port(item)), color);
    horizontal(trunk, item.x - (card ? 0 : 2), port(item), color);
  }

  const text = (x: number, y: number, value: string, max: number, style: Omit<Cell, 'char'>) => {
    let col = x;
    for (const { segment } of graphemes.segment(value)) {
      const size = stringWidth(segment);
      if (col + size > x + max) break;
      const sx = col - offset.x;
      const sy = y - offset.y;
      // A clipped wide grapheme must never occupy half a terminal character.
      if (sx >= 0 && sx + size <= width && sy >= 0 && sy < height) {
        put(sx, sy, { char: segment, ...style });
        for (let i = 1; i < size; i++) cells[sy]![sx + i] = { char: '', continuation: true, ...style };
      }
      col += size;
    }
  };

  for (const item of layout.cards) {
    if (
      item.y - offset.y >= height ||
      item.y + item.height - offset.y <= 0 ||
      item.x - offset.x >= width ||
      item.x + item.column - offset.x <= 0
    )
      continue;
    if (card) drawCard(item);
    else drawLine(item);
  }

  function drawLine(item: GraphCard) {
    const node = item.row?.node;
    const isSelected = item.id === selected;
    const onPath = path.has(item.id);
    const closed = node && (node.status === 'done' || node.status === 'dropped');
    const held = item.row && (item.row.held || !item.row.match);
    const label = lineLabel(tree, item.row);
    // The tail stays; a long title gives way with an ellipsis.
    const tailWidth = stringWidth(label.tail);
    const room = Math.max(4, item.width - 2 - tailWidth);
    // The selected title runs when it does not fit; the others give way with an ellipsis.
    const title = isSelected ? marquee(label.title, room, props.tick ?? 0) : clip(label.title, room);
    const glyphColor = node ? (held ? C.faint : (STATUS_COLOR[node.status] ?? C.dim)) : C.brand;
    if (isSelected) {
      // The selection is a solid pill: seen at a glance on any background.
      text(item.x - 1, item.y, ` ${label.glyph} ${title}${label.tail} `, item.width + 2, {
        color: C.pillText,
        bold: true,
        pill: true,
      });
      return;
    }
    const titleColor = !node ? C.brand : held ? C.faint : closed ? C.dim : onPath ? C.brand : undefined;
    text(item.x, item.y, label.glyph, 2, { color: glyphColor });
    text(item.x + 2, item.y, title, item.width - 2, {
      ...(titleColor ? { color: titleColor } : {}),
      bold: onPath || !node,
    });
    if (label.tail) text(item.x + 2 + stringWidth(title), item.y, label.tail, tailWidth, { color: C.faint });
    // Live agents and waiting reasons right after the label.
    const extra = liveNote(item);
    if (extra)
      text(item.x + item.width + 1, item.y, extra.text, Math.max(0, item.column - item.width + 2), {
        color: extra.color,
      });
  }

  function liveNote(item: GraphCard): { text: string; color: string } | undefined {
    const node = item.row?.node;
    if (!node) return undefined;
    const sessions = node.sessions.map((ref) => props.live?.get(ref.id)).filter(Boolean);
    if (sessions.some((session) => session?.live?.status === 'waiting')) return { text: '?', color: C.you };
    if (sessions.some((session) => session?.live?.status === 'busy'))
      return { text: SPINNER[(props.frame ?? 0) % SPINNER.length]!, color: C.agent };
    if (props.panes?.has(node.id)) return { text: '▣', color: C.ok };
    return undefined;
  }

  function drawCard(item: GraphCard) {
    const node = item.row?.node;
    const isSelected = item.id === selected;
    const dim = item.row && (item.row.held || !item.row.match || node?.status === 'done' || node?.status === 'dropped');
    const color = isSelected
      ? C.brand
      : item.id === ROOT
        ? C.brandDim
        : dim
          ? C.faint
          : (STATUS_COLOR[node!.status] ?? C.dim);
    const edge = isSelected ? ['┏', '━', '┓', '┃', '┗', '┛'] : ['╭', '─', '╮', '│', '╰', '╯'];
    const left = item.x - offset.x;
    const top = item.y - offset.y;
    for (let y = top; y < top + item.height; y++)
      for (let x = left; x < left + item.width; x++) put(x, y, { char: ' ' });
    for (let x = left + 1; x < left + item.width - 1; x++) {
      put(x, top, { char: edge[1]!, color });
      put(x, top + item.height - 1, { char: edge[1]!, color });
    }
    for (let y = top + 1; y < top + item.height - 1; y++) {
      put(left, y, { char: edge[3]!, color });
      put(left + item.width - 1, y, { char: edge[3]!, color });
    }
    put(left, top, { char: edge[0]!, color });
    put(left + item.width - 1, top, { char: edge[2]!, color });
    put(left, top + item.height - 1, { char: edge[4]!, color });
    put(left + item.width - 1, top + item.height - 1, { char: edge[5]!, color });
    if (node) put(left, top + 2, { char: isSelected ? '┫' : '┤', color });
    if (layout.cards.some((child) => child.row?.node.parent === item.id))
      put(left + item.width - 1, top + 2, { char: isSelected ? '┣' : '├', color });

    const inner = item.width - 4;
    const title = node ? `${GLYPH[node.status]} ${node.title}` : `◆ ${tree.project.title}`;
    const running = isSelected ? selectedOverflow(layout, tree, item.id) : undefined;
    const lines =
      item.height < 5
        ? [running ? marquee(title, inner, props.tick ?? 0) : clip(title, inner)]
        : wrapAnsi(title, inner, { hard: true, trim: true }).split('\n');
    text(item.x + 2, item.y + 1, lines[0]!, inner, {
      color: isSelected ? C.brand : dim ? C.dim : node ? undefined : C.brand,
      bold: true,
    });
    let second =
      lines[1] ?? (node ? (node.status === 'waiting' ? (node.waiting ?? '') : '') : (tree.project.goal ?? ''));
    if (lines.length > 2) second = running ? marquee(running.text, inner, props.tick ?? 0) : clip(`${second} …`, inner);
    if (item.height === 5)
      text(item.x + 2, item.y + 2, running ? second : clip(second, inner), inner, {
        color: isSelected ? undefined : dim ? C.faint : C.dim,
      });
    let meta: string;
    if (!node) {
      const p = progress(tree, ROOT);
      meta = t('цель проекта · {done}/{total}', {
        done: p.done,
        total: p.total,
      });
    } else {
      const sessions = node.sessions.map((ref) => props.live?.get(ref.id)).filter(Boolean);
      const waiting = sessions.find((session) => session?.live?.status === 'waiting');
      const busy = sessions.find((session) => session?.live?.status === 'busy');
      if (waiting)
        meta = t('? {p1} ждёт тебя', {
          p1: BRAIN_SHORT[waiting.brain],
        });
      else if (busy)
        meta = t('{p1} {p2} работает', {
          p1: SPINNER[(props.frame ?? 0) % SPINNER.length],
          p2: BRAIN_SHORT[busy.brain],
        });
      else {
        meta = STATUS_LABEL[node.status];
        if (node.who === 'human' && node.status !== 'done' && node.status !== 'dropped') meta += t(' · ты');
        if (props.panes?.has(node.id)) meta += ' · ▣';
        if (item.row?.hasChildren) {
          const p = progress(tree, node.id);
          meta += ` · ${p.done}/${p.total}${item.row.expanded ? '' : ' ›'}`;
        }
      }
    }
    text(item.x + 2, item.y + item.height - 2, clip(meta, inner), inner, { color });
  }

  if (offset.y > 0) put(0, 0, { char: '↑', color: C.faint });
  if (offset.y + height < layout.height) put(0, height - 1, { char: '↓', color: C.faint });
  if (offset.x > 0) put(0, Math.floor(height / 2), { char: '‹', color: C.faint });
  if (offset.x + width < layout.width) put(width - 1, Math.floor(height / 2), { char: '›', color: C.faint });
  return cells;
}

export function Graph(props: GraphProps) {
  const cells = graphCells(props);
  return (
    <Box flexDirection="column" width={props.width} height={props.height} overflow="hidden">
      {cells.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: viewport coordinates are stable identities.
        <Text key={index}>
          {runs(line).map((run) =>
            run.pill ? (
              <Text key={run.x} color={C.pillText} backgroundColor={C.pill} bold>
                {run.value}
              </Text>
            ) : (
              <Text key={run.x} color={run.color} bold={run.bold}>
                {run.value}
              </Text>
            ),
          )}
        </Text>
      ))}
    </Box>
  );
}

interface Run {
  x: number;
  value: string;
  color?: string | undefined;
  bold?: boolean | undefined;
  pill?: boolean | undefined;
}

function runs(cells: Cell[]): Run[] {
  const result: Run[] = [];
  cells.forEach((cell, x) => {
    if (cell.continuation) return;
    const pill = cell.pill;
    const last = result.at(-1);
    if (last && last.color === cell.color && last.bold === cell.bold && last.pill === pill) last.value += cell.char;
    else result.push({ x, value: cell.char, color: cell.color, bold: cell.bold, pill });
  });
  return result;
}

function clip(value: string, width: number): string {
  if (stringWidth(value) <= width) return value;
  let result = '';
  for (const { segment } of graphemes.segment(value)) {
    if (stringWidth(result + segment) > width - 1) break;
    result += segment;
  }
  return `${result}…`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
