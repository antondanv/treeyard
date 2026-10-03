/** Wait for the agent's import without writing anything into the unplanted folder. */
import { basename } from 'node:path';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { useEffect, useState } from 'react';

import type { Pane } from '../agents/panes.js';
import { t } from '../i18n/i18n.js';
import { findProject } from '../model/store.js';
import { type Action, App, type AppProps } from './App.js';
import { KeyHints } from './components/controls.js';
import { shortcutKey } from './keys.js';
import { Logo, logoSize, WORDMARK } from './logo.js';
import { MouseProvider } from './mouse.js';
import { paneState } from './rows.js';
import { TerminalPane } from './terminal.js';
import { C } from './theme.js';

export function PlantingApp(props: AppProps & { plantingPane: Pane }) {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [ready, setReady] = useState(() => findProject(props.dir) === props.dir);
  const [pane, setPane] = useState<Pane | undefined>(props.plantingPane);
  const [focused, setFocused] = useState(true);
  const [split, setSplit] = useState(props.ui.split ?? 0.58);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (ready) return;
    const timer = setInterval(() => {
      if (findProject(props.dir) === props.dir) setReady(true);
    }, 700);
    return () => clearInterval(timer);
  }, [ready, props.dir]);

  const handOver = (action: Action) => {
    props.onAction(action);
    exit();
  };
  useInput(
    (input, key) => {
      input = shortcutKey(input);
      if (input === 'q' || key.escape || (key.ctrl && input === 'c')) return handOver({ type: 'quit' });
      if (!pane) return;
      if (input === 'f') return setFocused(true);
      if (input === 'F') return handOver({ type: 'attach-pane', pane: pane.pane });
      if (input === '<' || (key.shift && key.leftArrow)) setSplit((value) => Math.min(0.74, value + 0.08));
      if (input === '>' || (key.shift && key.rightArrow)) setSplit((value) => Math.max(0.42, value - 0.08));
    },
    { isActive: !ready && !focused },
  );

  if (ready)
    return (
      <App {...props} ui={{ ...props.ui, split }} plantingPane={pane} plantingFocused={focused && Boolean(pane)} />
    );

  const width = Math.max(40, columns - 1);
  const height = Math.max(14, rows);
  const compact = height < 26;
  const mark = logoSize(compact);
  const bodyHeight = height - mark.rows - 3;
  const side = columns >= 80;
  const rightWidth = side ? Math.max(40, Math.min(width - 25, Math.floor(width * split))) : width;
  const leftWidth = side ? width - rightWidth - 1 : width;

  return (
    <MouseProvider>
      <Box width={width} height={height} flexDirection="column">
        <Box height={mark.rows + 1} paddingX={1}>
          <Logo compact={compact} />
          <Box marginLeft={2} flexDirection="column" justifyContent="center" flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={C.brand} bold>
                {WORDMARK}
              </Text>
              <Text color={C.faint}> · </Text>
              <Text bold>{basename(props.dir)}</Text>
            </Text>
            <Text color={C.dim} wrap="truncate-end">
              {t('Сажаем дерево с агентом')}
            </Text>
          </Box>
        </Box>
        <Box height={bodyHeight}>
          {side || !pane ? (
            <Box width={pane ? leftWidth : width} paddingX={2} paddingY={1} flexDirection="column" overflow="hidden">
              <Text color={C.brand} bold>
                {t('Сажаем дерево с агентом')}
              </Text>
              <Box marginTop={1}>
                <Text color={C.dim}>
                  {pane
                    ? t('Дерево появится здесь после твоего «да» и будет расти по мере посадки.')
                    : t('Сессия посадки закрыта')}
                </Text>
              </Box>
              {!pane ? (
                <Box marginTop={1}>
                  <Text color={C.dim}>{t('дерево пока не посажено — продолжить: treeyard init --agent')}</Text>
                </Box>
              ) : null}
            </Box>
          ) : null}
          {side && pane ? <Box width={1} /> : null}
          {pane ? (
            <TerminalPane
              pane={pane}
              title={t('Сажаем дерево с агентом')}
              state={paneState(pane, undefined, 0)}
              width={rightWidth}
              height={bodyHeight}
              focused={focused}
              planting
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onGone={() => {
                setPane(undefined);
                setFocused(false);
              }}
              onError={setError}
            />
          ) : null}
        </Box>
        <Box height={1} paddingX={1}>
          <Text color={error ? C.bad : C.faint} wrap="truncate-end">
            {error ?? t('Разговор справа · ⌃Q — к дереву · f — снова агенту')}
          </Text>
        </Box>
        <Box height={1} paddingX={1}>
          {!focused ? <KeyHints hints={[{ key: 'q', label: t('выйти') }]} /> : null}
        </Box>
      </Box>
    </MouseProvider>
  );
}
