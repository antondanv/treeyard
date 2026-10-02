/** Only a screen-sized viewport of the visible terminal is captured. */
import { capturePane, type PaneScreen, resizePane, sendToPane } from '@antondanv/brainyard';
import { Box, type DOMElement, measureElement, Text, useStdin } from 'ink';
import { useEffect, useRef, useState } from 'react';
import stringWidth from 'string-width';

import { BRAIN_LABEL } from '../agents/launch.js';
import { formatMemory, type Pane } from '../agents/panes.js';
import { t } from '../i18n/i18n.js';
import type { MouseEvent, TerminalInputEvent } from './input.js';
import type { PaneState } from './rows.js';
import { C } from './theme.js';

/** Ctrl+Q belongs to the tree; all other bytes belong to the CLI. */
export function paneInput(data: string): { data: string; leave: boolean } {
  const at = data.indexOf('\u0011');
  return at < 0 ? { data, leave: false } : { data: data.slice(0, at), leave: true };
}

/** Keep text and colours; links and screen-control sequences belong to the remote terminal. */
export function screenLine(line: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: remove OSC sequences from captured terminal rows.
  const text = line.replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/gu, '');
  // biome-ignore lint/suspicious/noControlCharactersInRegex: allow ANSI SGR colours, discard other CSI commands.
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, (sequence) => (sequence.endsWith('m') ? sequence : ''));
}

/** Draw the remote cursor without letting terminal control sequences escape Ink. */
export function cursorLine(line: string, x: number): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: tmux screen colours are ANSI SGR sequences.
  const parts = line.split(/(\u001b\[[0-9;:]*m)/u);
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let column = 0;
  let placed = false;
  let out = '';
  for (const part of parts) {
    if (part.startsWith('\u001b[')) {
      out += part;
      continue;
    }
    for (const { segment } of graphemes.segment(part)) {
      const cells = stringWidth(segment);
      if (!placed && cells > 0 && column <= x && x < column + cells) {
        out += `\u001b[7m${segment}\u001b[27m`;
        placed = true;
      } else out += segment;
      column += cells;
    }
  }
  if (!placed) out += `${' '.repeat(Math.max(0, x - column))}\u001b[7m \u001b[27m`;
  return out;
}

export function TerminalPane(props: {
  pane: Pane;
  title: string;
  state: PaneState;
  width: number;
  height: number;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onGone: () => void;
  onError: (message: string) => void;
}) {
  const { pane, width, height, focused } = props;
  const [screen, setScreen] = useState<PaneScreen>();
  const screenRef = useRef<PaneScreen>(undefined);
  const viewport = useRef(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const box = useRef<DOMElement>(null);
  const { stdin, setRawMode } = useStdin();
  const callbacks = useRef(props);
  callbacks.current = props;
  const sending = useRef<Promise<void>>(Promise.resolve());

  const scrollTo = (offset: number) => {
    viewport.current = Math.max(0, Math.min(screenRef.current?.historySize ?? 0, offset));
    setScrollOffset(viewport.current);
  };
  const send = (data: string | Uint8Array) => {
    sending.current = sending.current
      .then(() => sendToPane(pane.pane, data))
      .catch((error: Error) => callbacks.current.onError(error.message));
  };
  const controls = useRef({ scrollTo, send });
  controls.current = { scrollTo, send };

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    setScreen(undefined);
    screenRef.current = undefined;
    const capture = async () => {
      const requested = viewport.current;
      try {
        let next = await capturePane(pane.pane, requested ? { scroll: requested } : {});
        if (stopped || requested !== viewport.current) return;
        if (!next) return callbacks.current.onGone();
        // Keep the same history rows in view while more output arrives.
        const added = Math.max(0, next.historySize - (screenRef.current?.historySize ?? next.historySize));
        const offset = Math.min(next.historySize, requested + (requested ? added : 0));
        if (offset !== requested) {
          next = await capturePane(pane.pane, { scroll: offset });
          if (stopped || requested !== viewport.current) return;
          if (!next) return callbacks.current.onGone();
        }
        viewport.current = next.scrollOffset || 0;
        setScrollOffset(viewport.current);
        screenRef.current = next;
        setScreen((before) => (JSON.stringify(before) === JSON.stringify(next) ? before : next));
      } catch (error) {
        if (!stopped) callbacks.current.onError((error as Error).message);
      } finally {
        if (!stopped) timer = setTimeout(capture, 125);
      }
    };
    const poll = async () => {
      try {
        // An attached client controls the size until it leaves full screen.
        if (!pane.attached) await resizePane(pane.pane, width - 2, height - 4);
      } catch (error) {
        if (!stopped) callbacks.current.onError((error as Error).message);
      }
      if (!stopped) await capture();
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pane.pane, pane.attached, width, height]);

  useEffect(() => {
    const mouse = (event: MouseEvent) => {
      if (event.release || !box.current) return;
      const bounds = measureElement(box.current);
      // A click inside starts typing there, a click outside goes back to the tree.
      if (!(event.button & 64) && (event.button & 3) === 0) {
        const inside =
          event.x >= bounds.x &&
          event.x < bounds.x + bounds.width &&
          event.y >= bounds.y &&
          event.y < bounds.y + bounds.height;
        if (inside && !callbacks.current.focused) callbacks.current.onFocus();
        else if (!inside && callbacks.current.focused) callbacks.current.onBlur();
        return;
      }
      if (!(event.button & 64) || (event.button & 3) > 1) return;
      if (
        event.x < bounds.x + 1 ||
        event.x >= bounds.x + bounds.width - 1 ||
        event.y < bounds.y + 2 ||
        event.y >= bounds.y + bounds.height - 2
      )
        return;
      if (screenRef.current?.mouseTracking && !viewport.current && !(event.button & 4)) {
        // Full-screen CLIs own their conversation scroll; translate into their grid.
        const x = event.x - bounds.x;
        const y = event.y - bounds.y - 1;
        if (screenRef.current.mouseSgr) controls.current.send(`\u001b[<${event.button};${x};${y}M`);
        else if (x <= 223 && y <= 223)
          controls.current.send(Uint8Array.of(27, 91, 77, event.button + 32, x + 32, y + 32));
      } else {
        controls.current.scrollTo(viewport.current + (event.button & 1 ? -3 : 3));
      }
    };
    stdin.on('mouse', mouse);
    return () => {
      stdin.off('mouse', mouse);
    };
  }, [stdin]);

  useEffect(() => {
    if (!focused) return;
    setRawMode(true);
    const input = (event: Extract<TerminalInputEvent, { kind: 'input' }>) => {
      const { data, paste } = event;
      if (!paste && (data === '\u001b[5~' || data === '\u001b[6~')) {
        if (screenRef.current?.alternate && screenRef.current.mouseTracking && !viewport.current) {
          controls.current.send(data);
        } else {
          controls.current.scrollTo(viewport.current + (data === '\u001b[5~' ? 1 : -1) * Math.max(1, height - 5));
        }
        return;
      }
      if (!paste && viewport.current && ['\u001b[F', '\u001b[4~', '\u001b[8~', '\u001bOF'].includes(data)) {
        controls.current.scrollTo(0);
        return;
      }
      if (!paste && viewport.current && ['\u001b[H', '\u001b[1~', '\u001b[7~', '\u001bOH'].includes(data)) {
        controls.current.scrollTo(screenRef.current?.historySize ?? 0);
        return;
      }
      const next = paste ? { data, leave: false } : paneInput(data);
      if (next.data) {
        controls.current.scrollTo(0);
        // Preserve order across rapid typing and multi-byte pastes.
        controls.current.send(next.data);
      }
      if (next.leave) callbacks.current.onBlur();
    };
    stdin.on('terminal-input', input);
    return () => {
      stdin.off('terminal-input', input);
      setRawMode(false);
    };
  }, [focused, stdin, setRawMode, height]);

  const brain = pane.brain ? BRAIN_LABEL[pane.brain] : '';
  const memory = formatMemory(pane.memory);
  const waiting = props.state.color === C.you;
  const border = focused ? C.brand : waiting ? C.you : C.rule;
  const keys: [string, string][] = scrollOffset
    ? [
        ['End', t('к живому экрану')],
        ['PgUp PgDn', t('листать')],
      ]
    : focused
      ? [
          ['⌃Q', t('к дереву')],
          [t('колесо, PgUp'), t('история')],
        ]
      : [
          ['f', t('печатать')],
          ['F', t('весь экран')],
          ['x', t('усыпить')],
          ['p', t('скрыть')],
          ['< >', t('ширина')],
        ];
  return (
    <Box
      ref={box}
      width={width}
      height={height}
      flexDirection="column"
      borderStyle="round"
      borderColor={border}
      paddingX={0}
    >
      <Box justifyContent="space-between" width={width - 2}>
        <Box flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end">
            <Text color={props.state.color}>{props.state.mark} </Text>
            <Text color={focused ? C.brand : undefined} bold>
              {brain}
            </Text>
            <Text color={C.faint}> · {props.title}</Text>
          </Text>
        </Box>
        <Box flexShrink={0} marginLeft={1}>
          <Text>
            <Text color={props.state.color}>{props.state.text}</Text>
            {memory ? <Text color={C.faint}> · {memory}</Text> : null}
            {focused ? <Text color={C.brand}>{t('  ✎ ввод')}</Text> : null}
          </Text>
        </Box>
      </Box>
      <Box height={Math.max(1, height - 4)} flexDirection="column" overflow="hidden">
        {screen ? (
          screen.lines.slice(0, height - 4).map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: terminal rows are screen positions.
            <Text key={index} wrap="truncate-end">
              {focused && !scrollOffset && screen.cursor.visible && screen.cursor.y === index
                ? cursorLine(screenLine(line), screen.cursor.x)
                : screenLine(line) || ' '}
            </Text>
          ))
        ) : (
          <Text color={C.faint}>{t('читаю экран…')}</Text>
        )}
      </Box>
      <Text wrap="truncate-end">
        {scrollOffset ? (
          <Text color={C.warn}>
            {t('история ↑{rows}', {
              rows: scrollOffset,
            })}
            {'  '}
          </Text>
        ) : null}
        {keys.map(([key, what], index) => (
          <Text key={key}>
            {index > 0 ? <Text color={C.rule}> · </Text> : null}
            <Text color={focused ? C.brand : C.accent}>{key}</Text>
            <Text color={C.faint}> {what}</Text>
          </Text>
        ))}
      </Text>
    </Box>
  );
}
