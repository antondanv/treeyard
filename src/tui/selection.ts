/**
 * Text selected with the mouse on a session's screen. The tree owns the
 * mouse, so the terminal cannot select there itself: a drag goes from the
 * cell where the button went down to the cell under it now, row by row as a
 * terminal selects — the first row from the start, the last up to the end.
 */
import stringWidth from 'string-width';

export interface Cell {
  x: number;
  y: number;
}

export interface Selection {
  from: Cell;
  to: Cell;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: tmux screen colours are ANSI SGR sequences.
const SGR = /(\u001b\[[0-9;:]*m)/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Start and end in reading order: a drag may go up or left. */
export function ordered(selection: Selection): Selection {
  const { from, to } = selection;
  return from.y < to.y || (from.y === to.y && from.x <= to.x) ? selection : { from: to, to: from };
}

/** The columns of a row that are selected, `[start, end)`; undefined when the row is not. */
export function rowSpan(selection: Selection, row: number): [number, number] | undefined {
  const { from, to } = ordered(selection);
  if (row < from.y || row > to.y) return undefined;
  return [row === from.y ? from.x : 0, row === to.y ? to.x + 1 : Number.POSITIVE_INFINITY];
}

/** Each visible character of a row with the column it starts at; colours left out. */
function* characters(line: string): Generator<{ text: string; column: number; width: number }> {
  let column = 0;
  for (const part of line.split(SGR)) {
    if (part.startsWith('\u001b[')) continue;
    for (const { segment } of graphemes.segment(part)) {
      const width = stringWidth(segment);
      yield { text: segment, column, width };
      column += width;
    }
  }
}

/** A wide character half inside the selection is inside. */
const within = (column: number, width: number, [start, end]: [number, number]) =>
  width > 0 && column + width > start && column < end;

/** What was selected, as plain text: colours dropped, each row without its trailing blanks. */
export function selectedText(lines: readonly string[], selection: Selection): string {
  const { from, to } = ordered(selection);
  const rows: string[] = [];
  for (let row = from.y; row <= to.y; row++) {
    const span = rowSpan(selection, row)!;
    let text = '';
    for (const char of characters(lines[row] ?? '')) if (within(char.column, char.width, span)) text += char.text;
    rows.push(text.trimEnd());
  }
  return rows.join('\n');
}

/**
 * The row with its selected cells inverted, colours kept: a reset inside the
 * row must not end the inversion. Past the end of the text the selection
 * shows as inverted blanks, up to `width`.
 */
export function highlight(line: string, span: [number, number], width: number): string {
  let out = '';
  let inside = false;
  let column = 0;
  for (const part of line.split(SGR)) {
    if (part.startsWith('\u001b[')) {
      out += inside ? `${part}\u001b[7m` : part;
      continue;
    }
    for (const { segment } of graphemes.segment(part)) {
      const cells = stringWidth(segment);
      const selected = within(column, cells, span);
      if (cells > 0 && selected !== inside) {
        out += selected ? '\u001b[7m' : '\u001b[27m';
        inside = selected;
      }
      out += segment;
      column += cells;
    }
  }
  const blanks = Math.min(span[1], width) - Math.max(column, span[0]);
  if (blanks > 0) {
    if (column < span[0]) out += ' '.repeat(span[0] - column);
    if (!inside) out += '\u001b[7m';
    out += ' '.repeat(blanks);
    inside = true;
  }
  return inside ? `${out}\u001b[27m` : out;
}
