/** A Markdown input: hard line breaks survive, and the viewport follows the cursor. */
import { Box, Text, useInput, usePaste } from 'ink';
import { useRef } from 'react';
import stringWidth from 'string-width';
import { C } from '../theme.js';
import { editText, useLatest } from './controls.js';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export interface TextRow {
  start: number;
  text: string;
  /** The final row of a logical line includes a virtual cursor cell. */
  last: boolean;
}

/** Offsets stay in the original text, even across word wraps and empty lines. */
export function multilineRows(value: string, width: number): TextRow[] {
  const rows: TextRow[] = [];
  let offset = 0;
  for (const line of value.split('\n')) {
    const parts = [...graphemes.segment(line)].map(({ segment, index }) => ({
      text: segment,
      index,
      size: stringWidth(segment),
    }));
    parts.push({ text: ' ', index: line.length, size: 1 });
    let from = 0;
    let used = 0;
    let space = -1;
    const push = (to: number, last: boolean) => {
      rows.push({
        start: offset + parts[from]!.index,
        text: parts
          .slice(from, to)
          .map((p) => p.text)
          .join(''),
        last,
      });
      from = to;
    };
    for (const [i, part] of parts.entries()) {
      while (used + part.size > width && i > from) {
        const end = space >= from ? space + 1 : i;
        push(end, false);
        used = parts.slice(from, i).reduce((sum, p) => sum + p.size, 0);
      }
      used += part.size;
      if (part.text === ' ' && part.index < line.length) space = i;
    }
    push(parts.length, true);
    offset += line.length + 1;
  }
  return rows;
}

export function cursorRow(rows: TextRow[], cursor: number): number {
  return Math.max(
    0,
    rows.findIndex((row) => cursor >= row.start && cursor < row.start + row.text.length),
  );
}

/** Keep a display column across ↑↓, without landing inside a wide grapheme. */
export function verticalCursor(rows: TextRow[], cursor: number, step: number, column?: number) {
  const at = cursorRow(rows, cursor);
  const source = rows[at]!;
  const desired = column ?? stringWidth(source.text.slice(0, cursor - source.start));
  const target = rows[Math.max(0, Math.min(rows.length - 1, at + step))]!;
  let next = target.start;
  let used = 0;
  for (const { segment, index } of graphemes.segment(target.text)) {
    if (used > desired) break;
    next = target.start + index;
    used += stringWidth(segment);
  }
  return { cursor: next, column: desired };
}

export function MultilineField(props: {
  value: string;
  active: boolean;
  width: number;
  lines: number;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [state, setState, latest] = useLatest({ value: props.value, cursor: props.value.length });
  const column = useRef<number | undefined>(undefined);
  const insert = (input: string) => {
    const { value, cursor } = latest.current;
    // biome-ignore lint/suspicious/noControlCharactersInRegex: user text must not contain terminal controls.
    const clean = input.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');
    const next = { value: value.slice(0, cursor) + clean + value.slice(cursor), cursor: cursor + clean.length };
    column.current = undefined;
    setState(next);
    if (next.value !== value) props.onChange(next.value);
  };
  usePaste(insert, { isActive: props.active });
  useInput(
    (input, key) => {
      const { value, cursor } = latest.current;
      if (key.escape || key.tab) return;
      if (key.upArrow || key.downArrow) {
        const moved = verticalCursor(multilineRows(value, props.width), cursor, key.upArrow ? -1 : 1, column.current);
        column.current = moved.column;
        setState({ value, cursor: moved.cursor });
        return;
      }
      column.current = undefined;
      let next: { value: string; cursor: number } | null;
      if (key.return) next = { value: `${value.slice(0, cursor)}\n${value.slice(cursor)}`, cursor: cursor + 1 };
      else if (key.home || key.end) {
        const rows = multilineRows(value, props.width);
        const row = rows[cursorRow(rows, cursor)]!;
        const end = [...graphemes.segment(row.text)].at(-1)!.index;
        next = { value, cursor: key.home ? row.start : row.start + end };
      } else if (!key.ctrl && !key.meta && (key.leftArrow || key.rightArrow || key.backspace || key.delete)) {
        const positions = [...graphemes.segment(value)].map((part) => part.index);
        const before = positions.findLast((index) => index < cursor) ?? 0;
        const after = positions.find((index) => index > cursor) ?? value.length;
        if (key.leftArrow) next = { value, cursor: before };
        else if (key.rightArrow) next = { value, cursor: after };
        else if (key.delete) next = { value: value.slice(0, cursor) + value.slice(after), cursor };
        else next = { value: value.slice(0, before) + value.slice(cursor), cursor: before };
      } else if (
        !key.ctrl &&
        !key.meta &&
        input &&
        !key.leftArrow &&
        !key.rightArrow &&
        !key.backspace &&
        !key.delete
      ) {
        // Pasted paragraphs keep their line breaks; other terminal controls stay out.
        return insert(input);
      } else next = editText(value, cursor, input, key);
      if (!next) return;
      setState(next);
      if (next.value !== value) props.onChange(next.value);
    },
    { isActive: props.active },
  );

  const rows = multilineRows(state.value, props.width);
  const at = props.active ? cursorRow(rows, state.cursor) : 0;
  const first = Math.min(Math.max(0, at - props.lines + 1), Math.max(0, rows.length - props.lines));
  return (
    <Box flexDirection="column" width={props.width}>
      {rows.slice(first, first + props.lines).map((row, index) => {
        const cursor = state.cursor - row.start;
        const selected = props.active && first + index === at;
        const part = [...graphemes.segment(row.text)].find(({ segment, index }) => cursor < index + segment.length);
        return (
          <Text key={row.start} wrap="truncate-end">
            {selected && part ? (
              <>
                {row.text.slice(0, part.index)}
                <Text inverse>{part.segment}</Text>
                {row.text.slice(part.index + part.segment.length)}
              </>
            ) : (
              row.text
            )}
            {!state.value ? <Text color={C.faint}>{props.placeholder}</Text> : null}
          </Text>
        );
      })}
    </Box>
  );
}
