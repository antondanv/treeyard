/**
 * The loop around the app: show the tree; when a session needs the
 * terminal, step aside, let the CLI have it, and come back with what
 * happened. The tree is re-read every time — the agent may have changed it.
 */
import { spawnSync } from 'node:child_process';
import { attachPane } from '@antondanv/brainyard';

import { render } from 'ink';

import { BRAIN_LABEL, launch, resume, resumeLoose } from '../agents/launch.js';
import type { Pane } from '../agents/panes.js';
import { followStatuses, settlePushes } from '../github.js';
import { t } from '../i18n/i18n.js';
import { loadTree, nodePath } from '../model/store.js';
import { type Action, App, type Toast } from './App.js';
import { captureMouse, TerminalInput, withoutAutowrap } from './input.js';
import { inlineMark } from './logo.js';
import { PlantingApp } from './planting.js';
import { C } from './theme.js';
import { loadUi, saveUi } from './ui-state.js';

export async function runTui(dir: string, plantingPane?: Pane): Promise<void> {
  // A status changed here moves its card on the GitHub board; quitting waits for the moves.
  const unfollow = followStatuses();
  try {
    await loop(dir, plantingPane);
  } finally {
    unfollow();
    await settlePushes();
  }
}

async function loop(dir: string, plantingPane?: Pane): Promise<void> {
  let toast: Toast | undefined;
  for (;;) {
    const ui = loadUi(dir);
    let next = { type: 'quit' } as Action;
    const input = new TerminalInput(process.stdin);
    const releaseMouse = captureMouse(process.stdout);
    const screen = withoutAutowrap(process.stdout);
    try {
      const props = {
        dir,
        ui,
        toast,
        onAction: (action: Action) => {
          next = action;
        },
      };
      const instance = render(
        plantingPane ? <PlantingApp {...props} plantingPane={plantingPane} /> : <App {...props} />,
        {
          stdin: input as unknown as NodeJS.ReadStream,
          stdout: screen.stdout,
          alternateScreen: true,
          exitOnCtrlC: false,
          patchConsole: false,
          maxFps: 30,
          incrementalRendering: true,
        },
      );
      await instance.waitUntilExit();
    } finally {
      // Unmounted Ink has left the alternate screen: the CLI or the shell gets wrapping back.
      screen.restore();
      releaseMouse();
      input.destroy();
    }
    // Give the keyboard back: the CLI that comes next reads it.
    if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
    process.stdin.pause();
    const action: Action = next;
    if (action.type === 'quit') return;
    toast = await perform(dir, action);
    if (action.type !== 'editor' && !plantingPane) saveUi(dir, loadUi(dir));
  }
}

async function perform(dir: string, action: Exclude<Action, { type: 'quit' }>): Promise<Toast | undefined> {
  try {
    if (action.type === 'attach-pane') {
      await attachPane(action.pane, { hint: t('⌃Q — обратно к дереву') });
      return { text: t('вернулся из панели'), color: C.brand };
    }
    if (action.type === 'editor') {
      const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
      spawnSync(editor, [nodePath(dir, action.node)], { stdio: 'inherit', shell: true });
      return { text: t('узел сохранён в редакторе') };
    }
    const tree = loadTree(dir);
    if (action.type === 'launch') {
      const node = tree.nodes.get(action.node);
      banner(`${BRAIN_LABEL[action.options.brain]} · ${node?.title ?? ''}`);
      const { result, ref } = await launch(tree, action.node, action.options);
      if (result.error) return { text: result.error.message, color: C.bad };
      if (!ref)
        return { text: result.warnings.join(' · ') || t('сессия закрыта, но найти её не удалось'), color: C.warn };
      return {
        text: t('сессия сохранена в «{title}» · ⏎ на узле — продолжить', {
          title: node?.title,
        }),
        color: C.brand,
      };
    }
    if (action.type === 'resume') {
      const node = tree.nodes.get(action.node);
      banner(`${BRAIN_LABEL[action.ref.brain]} · ${action.ref.name ?? node?.title ?? ''}`);
      const result = await resume(tree, action.node, action.ref);
      if (result.error) return { text: result.error.message, color: C.bad };
      return {
        text: t('вернулся из {p1}', {
          p1: BRAIN_LABEL[action.ref.brain],
        }),
        color: C.brand,
      };
    }
    banner(`${BRAIN_LABEL[action.session.brain]} · ${action.session.title ?? action.session.id}`);
    const result = await resumeLoose(tree, action.session);
    if (result.error) return { text: result.error.message, color: C.bad };
    return { text: t('вернулся из сессии · l — привязать её к узлу'), color: C.brand };
  } catch (error) {
    return { text: (error as Error).message, color: C.bad };
  }
}

/** One line before the CLI takes over, so it is clear where the exit leads. */
function banner(what: string): void {
  const tty = process.stdout.isTTY;
  const color = (hex: string, text: string) => {
    if (!tty) return text;
    const n = Number.parseInt(hex.slice(1), 16);
    return `\u001b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m${text}\u001b[39m`;
  };
  const dim = (text: string) => (tty ? `\u001b[2m${text}\u001b[22m` : text);
  process.stdout.write(`\n${inlineMark(color)} → ${what}\n${dim(t('    выйдешь из сессии — вернёшься в дерево'))}\n\n`);
}
