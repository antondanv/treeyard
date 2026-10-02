/**
 * Small building blocks: a frame for dialogs, a one-line text field, an
 * inline choice and a menu. Each takes the keyboard only while `active`.
 */
import { Box, type DOMElement, type Key, Text, useInput } from 'ink';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import stringWidth from 'string-width';
import { t } from '../../i18n/i18n.js';
import { shortcutKey } from '../keys.js';
import { Clickable, useClick, usePress } from '../mouse.js';
import { C } from '../theme.js';

/**
 * State that key handlers can read at once. A burst of keys — a paste, key
 * repeat, a slow link — reaches the handlers before React renders again, so
 * a handler reading plain state would act on a stale value: two arrows move
 * once, an Enter picks the item before the arrow.
 */
export function useLatest<T>(initial: T | (() => T)): [T, (next: T | ((before: T) => T)) => void, { current: T }] {
  const [value, setValue] = useState(initial);
  const ref = useRef(value);
  const set = useCallback((next: T | ((before: T) => T)) => {
    ref.current = typeof next === 'function' ? (next as (before: T) => T)(ref.current) : next;
    setValue(ref.current);
  }, []);
  return [value, set, ref];
}

export function Frame(props: {
  title: string;
  width: number;
  children: ReactNode;
  footer?: KeyHint[];
  color?: string;
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={props.color ?? C.brandDim}
      width={props.width}
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color={props.color ?? C.brand} wrap="truncate-end">
          {props.title}
        </Text>
      </Box>
      {props.children}
      {props.footer ? (
        <Box marginTop={1}>
          <KeyHints hints={props.footer} wrap />
        </Box>
      ) : null}
    </Box>
  );
}

/** A key and what it does: `⏎ открыть`. Without a key it is a plain note. A click on it presses the key. */
export interface KeyHint {
  key?: string;
  label?: string;
  /** What a click types, when it is not the key itself; a list goes part by part: `< >`. */
  press?: string | string[];
  /** Instead of typing a key. */
  onPress?: () => void;
  color?: string;
}

const KEY_BYTES: Record<string, string> = { '⏎': '\r', esc: '\u001b', tab: '\t', space: ' ', '⌃Q': '\u0011' };
const SEPARATOR = ' · ';

function hintWidth(hint: KeyHint): number {
  const label = hint.label ? stringWidth(hint.label) : 0;
  return hint.key ? stringWidth(hint.key) + (label ? 1 + label : 0) : label;
}

/** What a click at column `x` of a hint does: a key to type or its own action. Keys like `← →` do nothing. */
export function hintPress(hint: KeyHint, x: number): string | (() => void) | undefined {
  if (!hint.key) return undefined;
  if (hint.onPress) return hint.onPress;
  if (!Array.isArray(hint.press))
    return hint.press ?? KEY_BYTES[hint.key] ?? ([...hint.key].length === 1 ? hint.key : undefined);
  let column = 0;
  for (const [index, part] of hint.key.split(' ').entries()) {
    const size = stringWidth(part);
    if (x >= column && x < column + size) return hint.press[index];
    column += size + 1;
  }
  return undefined;
}

/** The hint at column `x` of a line of hints, and the column inside it. */
export function hintAt(hints: KeyHint[], x: number): { hint: KeyHint; x: number } | undefined {
  let column = 0;
  for (const [index, hint] of hints.entries()) {
    if (index > 0) column += SEPARATOR.length;
    const size = hintWidth(hint);
    if (x >= column && x < column + size) return { hint, x: x - column };
    column += size;
  }
  return undefined;
}

/**
 * A line of key hints that are buttons too. One line cut at the edge, or
 * (`wrap`) as many lines as it takes, breaking between hints.
 */
export function KeyHints(props: { hints: KeyHint[]; active?: boolean; keyColor?: string; wrap?: boolean }) {
  const press = usePress();
  const ref = useRef<DOMElement>(null);
  const run = (hint: KeyHint, x: number) => {
    const action = hintPress(hint, x);
    if (typeof action === 'function') action();
    else if (action) press(action);
  };
  useClick(
    ref,
    (click) => {
      // A habitual double click must not press «d готово» twice.
      if (click.double || click.y !== 0) return;
      const at = hintAt(props.hints, click.x);
      if (at) run(at.hint, at.x);
    },
    props.active !== false && !props.wrap,
  );
  const keyColor = props.keyColor ?? C.accent;
  const body = (hint: KeyHint) => (
    <>
      {hint.key ? <Text color={hint.color ?? keyColor}>{hint.key}</Text> : null}
      {hint.label ? (
        <Text color={C.faint}>
          {hint.key ? ' ' : ''}
          {hint.label}
        </Text>
      ) : null}
    </>
  );
  if (props.wrap) {
    return (
      <Box flexWrap="wrap">
        {props.hints.map((hint, index) => (
          <Clickable
            // biome-ignore lint/suspicious/noArrayIndexKey: hints are positions in a fixed line.
            key={index}
            flexShrink={0}
            active={props.active !== false}
            onClick={(click) => {
              if (!click.double) run(hint, click.x - (index > 0 ? SEPARATOR.length : 0));
            }}
          >
            <Text>
              {index > 0 ? <Text color={C.rule}>{SEPARATOR}</Text> : null}
              {body(hint)}
            </Text>
          </Clickable>
        ))}
      </Box>
    );
  }
  return (
    <Box ref={ref} flexShrink={1} minWidth={0}>
      <Text wrap="truncate-end">
        {props.hints.map((hint, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: hints are positions in a fixed line.
          <Text key={index}>
            {index > 0 ? <Text color={C.rule}>{SEPARATOR}</Text> : null}
            {body(hint)}
          </Text>
        ))}
      </Text>
    </Box>
  );
}

/** Applies one keystroke to a text and its cursor. Null when the key is not for text editing. */
export function editText(
  value: string,
  cursor: number,
  input: string,
  key: Key,
): { value: string; cursor: number } | null {
  const shortcut = shortcutKey(input);
  if (key.return || key.escape || key.tab || key.upArrow || key.downArrow) return null;
  if (key.leftArrow)
    return { value, cursor: Math.max(0, cursor - (key.ctrl || key.meta ? wordLeft(value, cursor) : 1)) };
  if (key.rightArrow) return { value, cursor: Math.min(value.length, cursor + 1) };
  if (key.home || (key.ctrl && shortcut === 'a')) return { value, cursor: 0 };
  if (key.end || (key.ctrl && shortcut === 'e')) return { value, cursor: value.length };
  if (key.ctrl && shortcut === 'u') return { value: value.slice(cursor), cursor: 0 };
  if (key.ctrl && shortcut === 'k') return { value: value.slice(0, cursor), cursor };
  if ((key.ctrl && shortcut === 'w') || (key.meta && key.backspace)) {
    const from = cursor - wordLeft(value, cursor);
    return { value: value.slice(0, from) + value.slice(cursor), cursor: from };
  }
  if (key.backspace || key.delete) {
    if (cursor === 0) return { value, cursor };
    return { value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1 };
  }
  if (key.ctrl || key.meta) return null;
  // Typed or pasted text; line breaks in a paste become spaces.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: dropping control characters from typed text is the point.
  const clean = input.replace(/\r?\n/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '');
  if (!clean) return null;
  return { value: value.slice(0, cursor) + clean + value.slice(cursor), cursor: cursor + clean.length };
}

function wordLeft(value: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && value[i - 1] === ' ') i -= 1;
  while (i > 0 && value[i - 1] !== ' ') i -= 1;
  return cursor - i;
}

export function TextField(props: {
  value: string;
  onChange: (value: string) => void;
  active: boolean;
  placeholder?: string;
  width?: number;
}) {
  const [cursor, setCursor] = useState(props.value.length);
  useEffect(() => {
    if (cursor > props.value.length) setCursor(props.value.length);
  }, [props.value, cursor]);
  useInput(
    (input, key) => {
      const next = editText(props.value, cursor, input, key);
      if (!next) return;
      setCursor(next.cursor);
      if (next.value !== props.value) props.onChange(next.value);
    },
    { isActive: props.active },
  );
  const width = props.width ?? 40;
  if (!props.value && !props.active) {
    return (
      <Text color={C.faint} wrap="truncate-end">
        {props.placeholder ?? ''}
      </Text>
    );
  }
  if (!props.value && props.active) {
    return (
      <Text wrap="truncate-end">
        <Text inverse> </Text>
        <Text color={C.faint}>{props.placeholder ?? ''}</Text>
      </Text>
    );
  }
  // Keep the cursor in view: show a window of the text around it.
  const start = Math.max(0, Math.min(cursor - Math.floor(width * 0.7), props.value.length - width + 1));
  const shown = props.value.slice(start, start + width);
  const at = cursor - start;
  if (!props.active) return <Text>{shown}</Text>;
  return (
    <Text>
      {shown.slice(0, at)}
      <Text inverse>{shown[at] ?? ' '}</Text>
      {shown.slice(at + 1)}
    </Text>
  );
}

export interface ChoiceOption<T> {
  value: T;
  label: string;
  hint?: string;
}

export function Choice<T>(props: {
  options: ChoiceOption<T>[];
  value: T;
  active: boolean;
  onChange: (value: T) => void;
  /** Columns the choice may take; long lists show a window around the chosen option. */
  width?: number;
}) {
  const index = Math.max(
    0,
    props.options.findIndex((option) => option.value === props.value),
  );
  // The value a burst of arrows has reached, before the parent renders it.
  const latest = useRef(props.value);
  latest.current = props.value;
  useInput(
    (input, key) => {
      const step = key.leftArrow ? -1 : key.rightArrow || input === ' ' ? 1 : 0;
      if (!step) return;
      const at = Math.max(
        0,
        props.options.findIndex((option) => option.value === latest.current),
      );
      const next = props.options[(at + step + props.options.length) % props.options.length]!.value;
      latest.current = next;
      props.onChange(next);
    },
    { isActive: props.active },
  );
  return (
    <Options
      labels={props.options.map((option) => option.label)}
      index={index}
      active={props.active}
      {...(props.width ? { width: props.width } : {})}
    />
  );
}

/** A row of options with the chosen one marked; ‹ › say there are more beyond the edge. */
export function Options(props: { labels: string[]; index: number; active: boolean; width?: number }) {
  const { from, to } = optionWindow(props.labels, props.index, props.width ?? Number.POSITIVE_INFINITY);
  return (
    <Box>
      {from > 0 ? <Text color={C.faint}>{'‹ '}</Text> : null}
      {props.labels.slice(from, to).map((label, offset) => {
        const i = from + offset;
        return (
          <Box key={i} marginRight={i < to - 1 || to < props.labels.length ? 2 : 0} flexShrink={0}>
            <Text
              color={i === props.index ? (props.active ? C.brand : undefined) : C.faint}
              bold={i === props.index}
              underline={i === props.index && props.active}
            >
              {label}
            </Text>
          </Box>
        );
      })}
      {to < props.labels.length ? <Text color={C.faint}>{'›'}</Text> : null}
    </Box>
  );
}

const GAP = 2;
const EDGE = 2;

/**
 * Which options fit in `width` columns, always with the chosen one: the
 * window grows from it to the right first, then to the left, so the next
 * choice is in sight. Room is kept for the ‹ › of the hidden ones.
 */
export function optionWindow(labels: string[], index: number, width: number): { from: number; to: number } {
  if (labels.length === 0) return { from: 0, to: 0 };
  const at = Math.min(Math.max(0, index), labels.length - 1);
  const size = (from: number, to: number) => {
    let total = 0;
    for (let i = from; i < to; i++) total += stringWidth(labels[i]!) + (i < to - 1 ? GAP : 0);
    if (from > 0) total += EDGE;
    if (to < labels.length) total += GAP + EDGE;
    return total;
  };
  let from = at;
  let to = at + 1;
  for (;;) {
    const right = to < labels.length && size(from, to + 1) <= width;
    if (right) to += 1;
    const left = from > 0 && size(from - 1, to) <= width;
    if (left) from -= 1;
    if (!right && !left) return { from, to };
  }
}

export interface MenuItem {
  key: string;
  label: ReactNode;
  /** One letter that picks the item at once. */
  hotkey?: string;
  hint?: string;
  disabled?: boolean;
  /** Draws a separator before the item. */
  section?: string;
}

export function Menu(props: {
  items: MenuItem[];
  active: boolean;
  onPick: (key: string) => void;
  onCancel: () => void;
  /** Called with the highlighted item's key, for extra keys a dialog handles itself. */
  onKey?: (input: string, key: Key, current: string | undefined) => boolean;
  maxRows?: number;
}) {
  const choosable = props.items.filter((item) => !item.disabled);
  const [index, setIndex, indexRef] = useLatest(0);
  const current = choosable[Math.min(index, choosable.length - 1)];
  // A menu answers once: a second Enter in the same burst must not start a second session.
  const done = useRef(false);
  useInput(
    (input, key) => {
      if (done.current) return;
      input = shortcutKey(input);
      const n = Math.max(1, choosable.length);
      const highlighted = choosable[Math.min(indexRef.current, choosable.length - 1)];
      if (props.onKey?.(input, key, highlighted?.key)) return;
      if (key.escape) {
        done.current = true;
        return props.onCancel();
      }
      if (key.upArrow || input === 'k') return setIndex((i) => (i - 1 + n) % n);
      if (key.downArrow || input === 'j') return setIndex((i) => (i + 1) % n);
      const hit = key.return ? highlighted : choosable.find((item) => item.hotkey && item.hotkey === input);
      if (!hit) return;
      done.current = true;
      props.onPick(hit.key);
    },
    { isActive: props.active },
  );
  const rows = props.maxRows ?? 18;
  const at = props.items.indexOf(current!);
  const first = Math.max(0, Math.min(at - Math.floor(rows / 2), props.items.length - rows));
  const visible = props.items.slice(first, first + rows);
  return (
    <Box flexDirection="column">
      {first > 0 ? (
        <Text color={C.faint}>
          {t(' ↑ ещё ')}
          {first}
        </Text>
      ) : null}
      {visible.map((item) => {
        const selected = item === current;
        return (
          <Box key={item.key} flexDirection="column">
            {item.section ? (
              <Box marginTop={1}>
                <Text color={C.faint}>{item.section}</Text>
              </Box>
            ) : null}
            <Clickable
              active={props.active && !item.disabled}
              onClick={(click) => {
                if (done.current) return;
                // A click highlights, a double click picks — like ↑↓ and then ⏎.
                if (!click.double) return setIndex(choosable.indexOf(item));
                done.current = true;
                props.onPick(item.key);
              }}
            >
              <Text color={selected ? C.brand : C.faint}>{selected ? '❯ ' : '  '}</Text>
              <Box flexGrow={1}>
                {typeof item.label === 'string' ? (
                  <Text bold={selected} color={item.disabled ? C.faint : undefined} wrap="truncate-end">
                    {item.label}
                  </Text>
                ) : (
                  item.label
                )}
              </Box>
              {item.hotkey ? <Text color={selected ? C.brand : C.faint}> {item.hotkey}</Text> : null}
            </Clickable>
            {selected && item.hint ? (
              <Box marginLeft={2}>
                <Text color={C.faint} wrap="truncate-end">
                  {item.hint}
                </Text>
              </Box>
            ) : null}
          </Box>
        );
      })}
      {first + rows < props.items.length ? (
        <Text color={C.faint}>
          {t(' ↓ ещё ')}
          {props.items.length - first - rows}
        </Text>
      ) : null}
    </Box>
  );
}

/** Two labelled columns: `label  value`. */
export function Field(props: { label: string; width?: number; children: ReactNode; active?: boolean }) {
  return (
    <Box>
      <Box width={props.width ?? 18} flexShrink={0}>
        <Text color={props.active ? C.brand : C.dim}>{props.label}</Text>
      </Box>
      <Box flexGrow={1}>{props.children}</Box>
    </Box>
  );
}
