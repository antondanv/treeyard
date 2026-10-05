/**
 * The built-in editor of a project document: the whole file in the window,
 * the view following the cursor. ⌃S saves, ⌃Z takes back the last edit, esc
 * asks about what is not saved. A file that changed on disk while it was open
 * — an agent or another editor wrote it — is never overwritten silently.
 */
import { Box, type Key, Text, useInput, usePaste } from 'ink';
import { useRef, useState } from 'react';
import stringWidth from 'string-width';

import { docStamp, lineCount, readDoc } from '../docs.js';
import { t } from '../i18n/i18n.js';
import { Frame, type KeyHint, useLatest } from './components/controls.js';
import { cursorRow, multilineRows, type TextRow, verticalCursor } from './components/multiline.js';
import { shortcutKey } from './keys.js';
import { C } from './theme.js';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const UNDO_LIMIT = 300;

export interface EditState {
  value: string;
  cursor: number;
}

/** Rows of the whole text. A line is wrapped once and reused while it stays the same: typing re-wraps one line. */
export function editorRows(value: string, width: number, cache: Map<string, TextRow[]> = new Map()): TextRow[] {
  const rows: TextRow[] = [];
  let offset = 0;
  for (const line of value.split('\n')) {
    let wrapped = cache.get(line);
    if (!wrapped) {
      wrapped = multilineRows(line, width);
      cache.set(line, wrapped);
    }
    for (const row of wrapped) rows.push({ ...row, start: row.start + offset });
    offset += line.length + 1;
  }
  return rows;
}

const isSpace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);

function wordLeft(value: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && isSpace(value[i - 1])) i -= 1;
  while (i > 0 && !isSpace(value[i - 1])) i -= 1;
  return i;
}

function wordRight(value: string, cursor: number): number {
  let i = cursor;
  while (i < value.length && isSpace(value[i])) i += 1;
  while (i < value.length && !isSpace(value[i])) i += 1;
  return i;
}

const lineStart = (value: string, cursor: number) => value.lastIndexOf('\n', cursor - 1) + 1;
const lineEnd = (value: string, cursor: number) => {
  const end = value.indexOf('\n', cursor);
  return end < 0 ? value.length : end;
};

type EditKind = 'type' | 'space' | 'delete' | 'paste' | 'line' | 'cut';

/**
 * One keystroke on the text, when it is an edit or a move inside the text.
 * `rows` are the rows of the current text; `page` is how far PgUp/PgDn go.
 */
export function editKey(
  state: EditState,
  input: string,
  key: Key,
  rows: TextRow[],
  page: number,
  column: number | undefined,
): { next: EditState; kind?: EditKind; column?: number } | undefined {
  const { value, cursor } = state;
  const positions = () => [...graphemes.segment(value)].map((part) => part.index);
  const before = () => positions().findLast((index) => index < cursor) ?? 0;
  const after = () => positions().find((index) => index > cursor) ?? value.length;
  const move = (to: number) => ({ next: { value, cursor: to } });
  const cut = (from: number, to: number, kind: EditKind = 'cut') =>
    from === to ? move(cursor) : { next: { value: value.slice(0, from) + value.slice(to), cursor: from }, kind };

  if (key.upArrow || key.downArrow || key.pageUp || key.pageDown) {
    if (key.meta && (key.upArrow || key.downArrow)) return move(key.upArrow ? 0 : value.length);
    const step = (key.upArrow ? -1 : key.downArrow ? 1 : key.pageUp ? -page : page) || 0;
    const moved = verticalCursor(rows, cursor, step, column);
    return { next: { value, cursor: moved.cursor }, column: moved.column };
  }
  if (key.home || key.end) {
    if (key.ctrl) return move(key.home ? 0 : value.length);
    const row = rows[cursorRow(rows, cursor)]!;
    const last = [...graphemes.segment(row.text)].at(-1)?.index ?? 0;
    return move(key.home ? row.start : row.start + last);
  }
  if (key.leftArrow || key.rightArrow) {
    if (key.ctrl || key.meta) return move(key.leftArrow ? wordLeft(value, cursor) : wordRight(value, cursor));
    return move(key.leftArrow ? before() : after());
  }
  if (key.meta && (input === 'b' || input === 'f'))
    return move(input === 'b' ? wordLeft(value, cursor) : wordRight(value, cursor));
  if ((key.ctrl && input === 'w') || (key.meta && key.backspace)) return cut(wordLeft(value, cursor), cursor);
  if (key.backspace) return cut(before(), cursor, 'delete');
  if (key.delete) return cut(cursor, after(), 'delete');
  if (key.ctrl && input === 'a') return move(lineStart(value, cursor));
  if (key.ctrl && input === 'e') return move(lineEnd(value, cursor));
  if (key.ctrl && input === 'k') {
    const end = lineEnd(value, cursor);
    return cut(cursor, end === cursor ? Math.min(value.length, end + 1) : end);
  }
  if (key.ctrl && input === 'u') return cut(lineStart(value, cursor), cursor);
  if (key.return)
    return { next: { value: `${value.slice(0, cursor)}\n${value.slice(cursor)}`, cursor: cursor + 1 }, kind: 'line' };
  if (key.tab && key.shift) return undefined;
  if (key.tab)
    return { next: { value: `${value.slice(0, cursor)}  ${value.slice(cursor)}`, cursor: cursor + 2 }, kind: 'space' };
  if (key.ctrl || key.meta || key.escape || !input) return undefined;
  return insert(state, input);
}

/** Typed or pasted text: line breaks stay, other terminal controls do not. */
export function insert(state: EditState, input: string): { next: EditState; kind: EditKind } | undefined {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: user text must not carry terminal controls.
  const clean = input.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  if (!clean) return undefined;
  const { value, cursor } = state;
  const kind: EditKind = [...clean].length > 1 ? 'paste' : /\s/.test(clean) ? 'space' : 'type';
  return { next: { value: value.slice(0, cursor) + clean + value.slice(cursor), cursor: cursor + clean.length }, kind };
}

type Ask = 'exit' | 'conflict';

export function DocEditor(props: {
  dir: string;
  path: string;
  width: number;
  height: number;
  /** The source line to open at, from 0: where the reader was. */
  line?: number;
  active?: boolean;
  /** Writes the file; throws with a message to show when it cannot. */
  onSave: (text: string, crlf: boolean) => void;
  onExit: () => void;
}) {
  const [doc, setDoc] = useState(() => readDoc(props.dir, props.path));
  const [state, setState, latest] = useLatest<EditState>(() => {
    const lines = doc.text.split('\n');
    const at = Math.min(Math.max(0, props.line ?? 0), Math.max(0, lines.length - 1));
    return { value: doc.text, cursor: lines.slice(0, at).reduce((sum, line) => sum + line.length + 1, 0) };
  });
  const [saved, setSaved] = useLatest(doc.text);
  const [ask, setAsk, askRef] = useLatest<Ask | undefined>(undefined);
  const [notice, setNotice] = useState<{ text: string; color: string } | undefined>();
  const base = useRef(doc.mtime);
  const column = useRef<number | undefined>(undefined);
  const history = useRef<{ stack: EditState[]; kind?: EditKind; at: number }>({ stack: [], at: 0 });
  const cache = useRef({ width: 0, lines: new Map<string, TextRow[]>() });
  const top = useRef<number | undefined>(undefined);

  const lines = state.value.split('\n');
  const gutter = String(lines.length).length + 1;
  const inner = Math.max(10, props.width - 4);
  const textWidth = Math.max(8, inner - gutter);
  if (cache.current.width !== textWidth) cache.current = { width: textWidth, lines: new Map() };
  const rowsOf = (value: string) => {
    // Only the lines of this text stay cached: the map never grows past the document.
    const rows = editorRows(value, textWidth, cache.current.lines);
    if (cache.current.lines.size > rows.length * 2 + 64) {
      const keep = new Set(value.split('\n'));
      for (const line of cache.current.lines.keys()) if (!keep.has(line)) cache.current.lines.delete(line);
    }
    return rows;
  };
  const rows = rowsOf(state.value);
  const dirty = state.value !== saved;

  const footer: KeyHint[] = ask
    ? ask === 'exit'
      ? [
          { key: 's', label: t('сохранить и выйти') },
          { key: 'd', label: t('выйти без сохранения') },
          { key: 'esc', label: t('остаться') },
        ]
      : [
          { key: 'o', label: t('перезаписать') },
          { key: 'r', label: t('перечитать с диска — твоя правка пропадёт') },
          { key: 'esc', label: t('остаться') },
        ]
    : [
        { key: '⌃S', label: t('сохранить'), press: '\u0013' },
        { key: '⌃Z', label: t('отменить'), press: '\u001a' },
        { key: 'esc', label: t('выйти') },
        {
          label: t('стр. {line}/{lines} · кол. {column}', {
            line: lineOf(state.value, state.cursor) + 1,
            // As the list counts: a final line break does not start another line.
            lines: Math.max(lineCount(state.value), lineOf(state.value, state.cursor) + 1),
            column: state.cursor - lineStart(state.value, state.cursor) + 1,
          }),
        },
      ];
  const footerRows = Math.ceil(
    Math.max(1, stringWidth(footer.map((hint) => [hint.key, hint.label].filter(Boolean).join(' ')).join(' · '))) /
      inner,
  );
  const message =
    ask === 'exit'
      ? t('Есть несохранённые правки.')
      : ask === 'conflict'
        ? t('Файл изменился на диске, пока ты его правил.')
        : notice?.text;
  // The message line is always there, so the text does not jump when a message comes and goes.
  const room = Math.max(3, props.height - 6 - footerRows);
  const page = Math.max(1, room - 1);

  const at = cursorRow(rows, state.cursor);
  if (top.current === undefined) top.current = Math.max(0, Math.min(at, rows.length - room));
  if (at < top.current) top.current = at;
  if (at >= top.current + room) top.current = at - room + 1;
  top.current = Math.max(0, Math.min(top.current, Math.max(0, rows.length - room)));
  const first = top.current;

  const apply = (next: EditState, kind?: EditKind) => {
    const before = latest.current;
    if (kind && next.value !== before.value) {
      const h = history.current;
      const now = Date.now();
      // Snapshots by words: a run of letters is one step, a space or a new line starts the next.
      if (kind !== h.kind || kind === 'paste' || kind === 'line' || kind === 'cut' || now - h.at > 2000) {
        h.stack.push(before);
        if (h.stack.length > UNDO_LIMIT) h.stack.shift();
      }
      h.kind = kind;
      h.at = now;
    }
    setState(next);
    if (notice) setNotice(undefined);
  };

  const save = (force = false): boolean => {
    const disk = docStamp(props.dir, props.path);
    if (!force && disk && disk !== base.current) {
      setAsk('conflict');
      return false;
    }
    try {
      const text = latest.current.value;
      props.onSave(text, doc.crlf);
      base.current = docStamp(props.dir, props.path);
      setSaved(text);
      setAsk(undefined);
      setNotice({ text: t('сохранено · {path}', { path: props.path }), color: C.ok });
      return true;
    } catch (error) {
      setAsk(undefined);
      setNotice({ text: (error as Error).message, color: C.bad });
      return false;
    }
  };

  const reread = () => {
    const fresh = readDoc(props.dir, props.path);
    setDoc(fresh);
    base.current = fresh.mtime;
    setSaved(fresh.text);
    history.current = { stack: [], at: 0 };
    setState({ value: fresh.text, cursor: Math.min(latest.current.cursor, fresh.text.length) });
    setAsk(undefined);
    setNotice({ text: t('перечитал с диска'), color: C.brand });
  };

  usePaste(
    (text) => {
      const done = insert(latest.current, text);
      if (done) apply(done.next, done.kind);
    },
    { isActive: props.active !== false && !ask },
  );
  useInput(
    (input, key) => {
      if (askRef.current) {
        const letter = shortcutKey(input);
        if (key.escape) return setAsk(undefined);
        if (askRef.current === 'exit') {
          if (letter === 's') {
            if (save()) props.onExit();
            return;
          }
          if (letter === 'd') return props.onExit();
          return;
        }
        if (letter === 'o') return void save(true);
        if (letter === 'r') return reread();
        return;
      }
      const letter = key.ctrl ? shortcutKey(input) : input;
      if (key.ctrl && letter === 's') return void save();
      if (key.ctrl && letter === 'z') {
        const previous = history.current.stack.pop();
        history.current.kind = undefined;
        if (previous) setState(previous);
        else setNotice({ text: t('отменять нечего'), color: C.faint });
        return;
      }
      if (key.escape) {
        if (latest.current.value !== saved) return setAsk('exit');
        return props.onExit();
      }
      const current = latest.current;
      const done = editKey(current, letter, key, rowsOf(current.value), page, column.current);
      if (!done) return;
      column.current = done.column;
      apply(done.next, done.kind);
    },
    { isActive: props.active !== false },
  );

  // Line numbers on the first row of each line; one scan finds where the window starts.
  let line = rows[first] ? lineOf(state.value, rows[first]!.start) : 0;
  const number = (row: TextRow, index: number) => {
    const startsLine = row.start === 0 || state.value[row.start - 1] === '\n';
    if (startsLine && index > 0) line += 1;
    return startsLine ? String(line + 1).padStart(gutter - 1) : ' '.repeat(gutter - 1);
  };
  return (
    <Frame
      title={`${dirty ? '● ' : '✎ '}${props.path}${dirty ? t(' · не сохранён') : ''}`}
      width={props.width}
      footer={footer}
      color={ask ? C.warn : undefined}
    >
      <Text color={ask ? C.warn : (notice?.color ?? C.faint)} wrap="truncate-end">
        {message ?? ' '}
      </Text>
      <Box height={room} flexDirection="column" overflow="hidden">
        {rows.slice(first, first + room).map((row, index) => {
          const cursor = state.cursor - row.start;
          const selected = first + index === at;
          const part = selected
            ? [...graphemes.segment(row.text)].find(({ segment, index }) => cursor < index + segment.length)
            : undefined;
          const shown = (text: string) => text.replace(/\t/g, ' ');
          return (
            <Text key={row.start} wrap="truncate-end">
              <Text color={selected ? C.brandDim : C.rule}>{number(row, index)} </Text>
              {part ? (
                <>
                  {shown(row.text.slice(0, part.index))}
                  <Text inverse>{shown(part.segment)}</Text>
                  {shown(row.text.slice(part.index + part.segment.length))}
                </>
              ) : (
                shown(row.text)
              )}
            </Text>
          );
        })}
      </Box>
    </Frame>
  );
}

function lineOf(value: string, offset: number): number {
  let count = 0;
  for (let i = value.indexOf('\n'); i >= 0 && i < offset; i = value.indexOf('\n', i + 1)) count += 1;
  return count;
}
