/**
 * `treeyard peek`: peek at the screen of a node's live pane from the CLI,
 * without attaching tmux or manual capture.
 */

import { capturePane, findPaneSession, listPanes, liveSessions } from '@antondanv/brainyard';

import { t } from '../i18n/i18n.js';
import { STATUS_LABEL } from '../model/ops.js';
import { GLYPH } from '../model/overview.js';
import { holderOf } from '../model/tree.js';
import { type BrainId, ROOT, type Tree } from '../model/types.js';
import { withPaneIdle } from './pane-idle.js';
import { isPending, nodePane, sleepingRef } from './panes.js';
import { type ObserveSources, observe, type SessionState, screenTail, sessionSight, type World } from './wait.js';

export interface PeekSources extends ObserveSources {
  capture: (pane: string) => Promise<{ lines: readonly string[] } | undefined>;
}

export const DEFAULT_PEEK_SOURCES: PeekSources = {
  live: () => liveSessions({ all: true, panes: {} }),
  panes: () => listPanes(),
  paneSession: async (pane) => (await findPaneSession(pane))?.id,
  idle: (panes, live) => withPaneIdle(panes, live),
  capture: (pane) => capturePane(pane),
};

export interface PeekOptions {
  lines?: number;
  sources?: Partial<PeekSources>;
  world?: World;
}

export interface PeekResult {
  node: string;
  title: string;
  status: string;
  live: boolean;
  pane: string | null;
  brain: BrainId | null;
  session: string | null;
  state: SessionState | null;
  waitingFor: string | null;
  lines: string[];
  screen: string[];
  message?: string;
  error?: string;
  ok: boolean;
}

export interface PeekPaint {
  bold(text: string): string;
  dim(text: string): string;
  c(hex: string, text: string): string;
}

const plainPaint: PeekPaint = {
  bold: (s) => s,
  dim: (s) => s,
  c: (_, s) => s,
};

function stateWord(state: SessionState, waitingFor?: string): string {
  switch (state) {
    case 'busy':
      return t('работает');
    case 'waiting':
      return waitingFor ? t('ждёт человека: {why}', { why: waitingFor }) : t('ждёт человека');
    case 'idle':
      return t('закончила ход');
    case 'gone':
      return t('закончилась');
    default:
      return t('ещё не сказала, что делает');
  }
}

function sessionLine(session: {
  brain?: BrainId | null;
  session?: string | null;
  id?: string | null;
  pane?: string | null;
  state?: SessionState | null;
  waitingFor?: string | null;
}): string {
  const rawId = session.session ?? session.id;
  const id = rawId ? rawId.slice(0, 8) : t('без id');
  const where = session.pane ? ` · ${t('панель {pane}', { pane: session.pane })}` : '';
  const brain = session.brain ? `${session.brain} ` : '';
  return `${t('сессия')} ${brain}${id}${where} · ${stateWord(session.state ?? 'unknown', session.waitingFor ?? undefined)}`;
}

/** Formats the peek result for CLI text output. */
export function peekText(result: PeekResult, p: PeekPaint = plainPaint): string {
  if (!result.ok) {
    return `${result.error ?? ''}\n`;
  }
  const glyph =
    result.status && (GLYPH as Record<string, string | undefined>)[result.status]
      ? `${(GLYPH as Record<string, string | undefined>)[result.status]} `
      : '';
  const statusLabel =
    (result.status && (STATUS_LABEL as Record<string, string | undefined>)[result.status]) || result.status;
  const header = `${p.bold(`${glyph}${result.title}`.trim())}  ${p.dim(result.node)}  ${statusLabel}`;

  if (!result.live) {
    return `${header}\n  ${p.dim(result.message ?? '')}\n`;
  }

  const lines = [header, `  ${sessionLine(result)}`];
  if (result.state === 'waiting' && result.pane) {
    lines.push(`  ${p.dim(t('ответить в панели: tmux -L brainyard attach -t {pane}', { pane: result.pane }))}`);
  }
  if (result.lines.length === 0) {
    lines.push(`  ${p.dim(t('(экран пуст)'))}`);
  } else {
    for (const row of result.lines) {
      lines.push(row ? `  ${p.dim('│')} ${row}` : `  ${p.dim('│')}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Formats the peek result for CLI `--json` output. */
export function peekJson(result: PeekResult): Record<string, unknown> {
  return {
    node: result.node,
    title: result.title,
    status: result.status,
    live: result.live,
    pane: result.pane,
    brain: result.brain,
    session: result.session,
    state: result.state,
    waitingFor: result.waitingFor,
    lines: result.lines,
    screen: result.screen,
    ...(result.message !== undefined ? { message: result.message } : {}),
    ...(!result.ok && result.error !== undefined ? { ok: false, error: result.error } : {}),
  };
}

/**
 * Peeks at the screen of a node's live pane, returning session state, pane name,
 * and the screen tail stripped of ANSI codes.
 */
export async function peekNodePane(tree: Tree, id: string, options: PeekOptions = {}): Promise<PeekResult> {
  let node = holderOf(tree, id);
  if (!node && id && id !== ROOT) {
    const matches = [...tree.nodes.keys()].filter((key) => key.startsWith(id));
    if (matches.length === 1) {
      node = tree.nodes.get(matches[0]!);
    } else if (matches.length > 1) {
      return {
        node: id,
        title: '',
        status: '',
        live: false,
        pane: null,
        brain: null,
        session: null,
        state: null,
        waitingFor: null,
        lines: [],
        screen: [],
        ok: false,
        error: t('id «{id}» подходит к нескольким узлам', { id }),
      };
    }
  }

  if (!node) {
    return {
      node: id,
      title: '',
      status: '',
      live: false,
      pane: null,
      brain: null,
      session: null,
      state: null,
      waitingFor: null,
      lines: [],
      screen: [],
      ok: false,
      error: t('нет узла {id}', { id }),
    };
  }

  const sources: PeekSources = { ...DEFAULT_PEEK_SOURCES, ...options.sources };
  const world = options.world ?? (await observe(tree.project.dir, sources));
  const found = nodePane(node, world.panes);

  if (!found) {
    const sleeping = sleepingRef(node, world.panes);
    if (sleeping) {
      return {
        node: node.id,
        title: node.title,
        status: node.status,
        live: false,
        pane: null,
        brain: sleeping.brain,
        session: isPending(sleeping) ? null : sleeping.id,
        state: null,
        waitingFor: null,
        lines: [],
        screen: [],
        message: t('панель спит · продолжить: treeyard send {id} "…", журнал: treeyard show {id}', { id: node.id }),
        ok: true,
      };
    }

    const background = [...node.sessions].find((ref) => ref.mode === 'background');
    if (background) {
      return {
        node: node.id,
        title: node.title,
        status: node.status,
        live: false,
        pane: null,
        brain: background.brain,
        session: isPending(background) ? null : background.id,
        state: null,
        waitingFor: null,
        lines: [],
        screen: [],
        message: t('нет живой панели (сессия в фоне) · журнал: treeyard show {id}, ожидание: treeyard wait {id}', {
          id: node.id,
        }),
        ok: true,
      };
    }

    return {
      node: node.id,
      title: node.title,
      status: node.status,
      live: false,
      pane: null,
      brain: null,
      session: null,
      state: null,
      waitingFor: null,
      lines: [],
      screen: [],
      message: t('нет живой панели · журнал: treeyard show {id}, ожидание: treeyard wait {id}', { id: node.id }),
      ok: true,
    };
  }

  const { ref, pane } = found;
  const sight = sessionSight(ref, world);
  const linesCount =
    options.lines !== undefined && options.lines > 0 && Number.isInteger(options.lines) ? options.lines : 25;
  const rawLines =
    world.paneScreens?.get(pane.pane) ?? (await sources.capture(pane.pane).catch(() => undefined))?.lines ?? [];
  const screen = screenTail(rawLines, linesCount);

  return {
    node: node.id,
    title: node.title,
    status: node.status,
    live: true,
    pane: pane.pane,
    brain: ref.brain,
    session: sight.id ?? (isPending(ref) ? null : ref.id),
    state: sight.state,
    waitingFor: sight.waitingFor ?? null,
    lines: screen,
    screen,
    ok: true,
  };
}
