/**
 * Markdown to read in a terminal: headings, lists, quotes, code and inline
 * marks are drawn with colour instead of their symbols, and every row is
 * wrapped to the width in advance — a long document scrolls by slicing rows.
 * Each row remembers its source line, so the editor opens where the reader is.
 */
import stringWidth from 'string-width';

import { C } from './theme.js';

export interface MdSpan {
  text: string;
  color?: string | undefined;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

export interface MdRow {
  spans: MdSpan[];
  /** The source line it comes from, from 0. */
  line: number;
}

type Style = Omit<MdSpan, 'text'>;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const WORD = /[\p{L}\p{N}]/u;

interface Cell {
  text: string;
  size: number;
  style: Style;
}

function cellsOf(spans: MdSpan[]): Cell[] {
  const out: Cell[] = [];
  for (const { text, ...style } of spans)
    for (const { segment } of graphemes.segment(text)) out.push({ text: segment, size: stringWidth(segment), style });
  return out;
}

function same(a: Style, b: Style): boolean {
  return (
    a.color === b.color &&
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.underline) === Boolean(b.underline) &&
    Boolean(a.strike) === Boolean(b.strike)
  );
}

function joinCells(cells: Cell[]): MdSpan[] {
  const out: MdSpan[] = [];
  for (const cell of cells) {
    const last = out.at(-1);
    if (last && same(last, cell.style)) last.text += cell.text;
    else out.push({ ...cell.style, text: cell.text });
  }
  return out;
}

export function spansWidth(spans: MdSpan[]): number {
  return spans.reduce((sum, span) => sum + stringWidth(span.text), 0);
}

/** Word wrap: the first row starts after `lead`, the others after `hang`. */
function wrap(spans: MdSpan[], width: number, lead: MdSpan[] = [], hang: MdSpan[] = lead): MdSpan[][] {
  const cells = cellsOf(spans);
  if (!cells.length) return [lead];
  const rows: MdSpan[][] = [];
  let prefix = lead;
  let at = 0;
  while (at < cells.length) {
    const room = Math.max(1, width - spansWidth(prefix));
    let used = 0;
    let next = at;
    let space = -1;
    while (next < cells.length && used + cells[next]!.size <= room) {
      if (cells[next]!.text === ' ') space = next;
      used += cells[next]!.size;
      next += 1;
    }
    let end = next;
    if (next < cells.length) {
      if (cells[next]!.text === ' ') end = next;
      else if (space > at) end = space + 1;
      // A grapheme wider than the room still takes a row of its own.
      else if (next === at) end = at + 1;
    }
    let last = end;
    while (last > at && cells[last - 1]!.text === ' ' && end < cells.length) last -= 1;
    rows.push([...prefix, ...joinCells(cells.slice(at, last))]);
    at = end;
    while (at < cells.length && cells[at]!.text === ' ') at += 1;
    prefix = hang;
  }
  return rows;
}

/** One row cut at the edge with an ellipsis: tables keep their columns. */
function clipRow(spans: MdSpan[], width: number): MdSpan[] {
  const cells = cellsOf(spans);
  if (cells.reduce((sum, cell) => sum + cell.size, 0) <= width) return spans;
  const kept: Cell[] = [];
  let used = 0;
  for (const cell of cells) {
    if (used + cell.size > width - 1) break;
    kept.push(cell);
    used += cell.size;
  }
  return [...joinCells(kept), { text: '…', color: C.faint }];
}

/** Inline marks: `code`, **bold**, *italic*, ~~struck~~, [links](url), ![pictures](src). */
export function inline(text: string, base: Style = {}): MdSpan[] {
  const out: MdSpan[] = [];
  let bold: string | undefined;
  let italic: string | undefined;
  let strike = false;
  let buffer = '';
  const style = (): Style => ({
    ...base,
    ...(bold ? { bold: true } : {}),
    ...(italic ? { italic: true } : {}),
    ...(strike ? { strike: true } : {}),
  });
  const flush = () => {
    if (buffer) out.push({ ...style(), text: buffer });
    buffer = '';
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const ch = text[i]!;
    if (ch === '\\' && /^\\[\\`*_{}[\]()#+\-.!~|<>]/.test(rest)) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const ticks = /^`+/.exec(rest)![0];
      const end = text.indexOf(ticks, i + ticks.length);
      if (end > -1) {
        flush();
        out.push({ ...style(), text: text.slice(i + ticks.length, end), color: C.accent });
        i = end + ticks.length;
      } else {
        buffer += ticks;
        i += ticks.length;
      }
      continue;
    }
    const picture = /^!\[([^\]]*)\]\(([^)\s]*)[^)]*\)/.exec(rest);
    if (picture) {
      flush();
      out.push({ ...style(), text: `▣ ${picture[1] || picture[2]}`, color: C.faint });
      i += picture[0].length;
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.exec(rest);
    if (link) {
      flush();
      out.push(...inline(link[1]!, { ...style(), color: C.accent, underline: true }));
      if (link[2] && link[2] !== link[1]) out.push({ text: ` (${link[2]})`, color: C.faint });
      i += link[0].length;
      continue;
    }
    const auto = /^<((?:https?|mailto):[^>\s]+)>/.exec(rest);
    if (auto) {
      flush();
      out.push({ ...style(), text: auto[1]!, color: C.accent, underline: true });
      i += auto[0].length;
      continue;
    }
    const pair = rest.slice(0, 2);
    if (pair === '**' || pair === '__') {
      const opens = !bold && !/\s/.test(text[i + 2] ?? ' ') && text.indexOf(pair, i + 3) > -1;
      if (bold === pair || opens) {
        flush();
        bold = bold ? undefined : pair;
        i += 2;
        continue;
      }
    }
    if (pair === '~~') {
      if (strike || (!/\s/.test(text[i + 2] ?? ' ') && text.indexOf('~~', i + 3) > -1)) {
        flush();
        strike = !strike;
        i += 2;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      const before = text[i - 1] ?? ' ';
      const after = text[i + 1] ?? ' ';
      // snake_case stays as it is: an underscore inside a word is not a mark.
      if (italic === ch && !/\s/.test(before) && (ch === '*' || !WORD.test(after))) {
        flush();
        italic = undefined;
        i += 1;
        continue;
      }
      if (!italic && !/\s/.test(after) && (ch === '*' || !WORD.test(before)) && text.indexOf(ch, i + 2) > -1) {
        flush();
        italic = ch;
        i += 1;
        continue;
      }
    }
    buffer += ch;
    i += 1;
  }
  flush();
  return out;
}

const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})\s*([^`\s]*)/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

export function layoutMarkdown(text: string, width: number): MdRow[] {
  const lines = text.replace(/\t/g, '    ').split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  const rows: MdRow[] = [];
  const add = (line: number, list: MdSpan[][]) => {
    for (const spans of list) rows.push({ spans, line });
  };
  const bar = (color: string): MdSpan[] => [{ text: '│ ', color }];
  let i = 0;
  // Front matter: the YAML of tree.md, quiet.
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end > 0) {
      for (; i <= end; i++) add(i, wrap([{ text: lines[i]!, color: C.faint }], width));
    }
  }
  let fence: string | undefined;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (fence) {
      if (line.trim().startsWith(fence) && /^(`{3,}|~{3,})\s*$/.test(line.trim())) {
        add(i, [[{ text: '╰─', color: C.rule }]]);
        fence = undefined;
      } else add(i, wrap([{ text: line, color: C.review }], width, bar(C.rule)));
      continue;
    }
    const open = FENCE.exec(line);
    if (open) {
      fence = open[1]![0]!.repeat(3);
      add(i, [[{ text: `╭─${open[2] ? ` ${open[2]}` : ''}`, color: C.rule }]]);
      continue;
    }
    if (!line.trim()) {
      add(i, [[]]);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const wrapped = wrap(inline(heading[2]!, { bold: true, color: level <= 3 ? C.brand : undefined }), width);
      add(i, wrapped);
      if (level <= 2) {
        const size = Math.min(width, Math.max(...wrapped.map(spansWidth)));
        add(i, [[{ text: (level === 1 ? '━' : '─').repeat(size), color: level === 1 ? C.brandDim : C.rule }]]);
      }
      continue;
    }
    if (RULE.test(line)) {
      add(i, [[{ text: '─'.repeat(width), color: C.rule }]]);
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const spans = line.split(/(\|)/).map((part) => (part === '|' ? { text: part, color: C.rule } : { text: part }));
      add(i, [clipRow(spans, width)]);
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      add(i, wrap(inline(quote[1]!.replace(/^(\s*>\s?)+/, ''), { color: C.dim }), width, bar(C.faint)));
      continue;
    }
    const list = LIST.exec(line);
    if (list) {
      const indent = list[1]!.length;
      const ordered = /\d/.test(list[2]!);
      let rest = list[3]!;
      let marker: MdSpan = { text: ordered ? list[2]! : Math.floor(indent / 2) % 2 ? '◦' : '•', color: C.brandDim };
      const box = /^\[([ xX])\]\s+(.*)$/.exec(rest);
      if (box) {
        const done = box[1] !== ' ';
        marker = { text: done ? '✓' : '○', color: done ? C.ok : C.faint };
        rest = box[2]!;
      }
      const lead: MdSpan[] = [{ text: ' '.repeat(indent) }, marker, { text: ' ' }];
      add(i, wrap(inline(rest), width, lead, [{ text: ' '.repeat(spansWidth(lead)) }]));
      continue;
    }
    const indent = /^\s*/.exec(line)![0];
    add(i, wrap(inline(line.slice(indent.length)), width, indent ? [{ text: indent }] : []));
  }
  return rows;
}
