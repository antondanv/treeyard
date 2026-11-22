/**
 * `treeyard send`: the coordinator writes the next message to a node's own session instead of
 * starting a new one — a new session reads the whole conversation again, the same one goes on.
 *
 * A live pane gets it typed in, as a person would (pasted, then Enter): a CLI at work queues it.
 * A pane asleep wakes with it as the first message of the resumed conversation. A Claude Code
 * background session that ended its turn is stopped and resumed in the background with it.
 * A session that waits for the person (a permission, a question in a dialog) gets nothing: keys
 * typed into a dialog answer it, and only the person answers those.
 */
import {
  listPanes,
  liveSessions,
  open,
  type PaneInfo,
  type SessionInfo,
  sendToPane,
  startPane,
  stopSession,
} from '@antondanv/brainyard';

import { t } from '../i18n/i18n.js';
import { nodeEnv } from '../model/notes.js';
import { attachSession, logToNode } from '../model/ops.js';
import { nowIso } from '../model/time.js';
import { holderOf } from '../model/tree.js';
import type { SessionRef, Tree } from '../model/types.js';
import { fullAccess } from './access.js';
import { isPending, type PaneSize } from './panes.js';
import { newestSession, type SessionSight, sessionSight, type World } from './wait.js';

/** How the message got there. */
export type Delivery = 'typed' | 'woke' | 'resumed';

export interface Sent {
  how: Delivery;
  ref: SessionRef;
  /** The pane it went to, when it went to one. */
  pane?: string;
  warnings: string[];
}

/** Why a message was not sent; the CLI prints it and exits 1. */
export class NotSent extends Error {}

/** What send uses of Brainyard; tests put their own. */
export interface SendSources {
  live(): Promise<SessionInfo[]>;
  panes(): Promise<PaneInfo[]>;
  type(pane: string, data: string): Promise<void>;
  startPane: typeof startPane;
  open: typeof open;
  stop: typeof stopSession;
  pause(ms: number): Promise<void>;
}

export const SEND_SOURCES: SendSources = {
  live: () => liveSessions({ panes: {} }),
  panes: () => listPanes(),
  type: (pane, data) => sendToPane(pane, data),
  startPane,
  open,
  stop: stopSession,
  pause: (ms) => new Promise((done) => setTimeout(done, ms)),
};

/**
 * Bracketed paste: the CLI takes the whole text as one paste, newlines included, instead of
 * sending the message at its first line. The Enter comes after a pause, apart from the paste:
 * Codex counts keys that come too fast as part of a paste and would put a newline instead.
 */
const PASTE_START = '\u001b[200~';
const PASTE_END = '\u001b[201~';
const ENTER_AFTER_MS = 400;

/** The journal shows what was written; the whole text is in the session. */
const JOURNAL_TEXT = 300;

export interface SendOptions {
  size?: PaneSize;
  /** Who writes, for the journal: the agent's name or «ты». */
  source?: string;
  sources?: SendSources;
}

/** Writes `text` to the newest session of node `id`. Throws `NotSent` when it cannot. */
export async function sendToNode(tree: Tree, id: string, text: string, options: SendOptions = {}): Promise<Sent> {
  const sources = options.sources ?? SEND_SOURCES;
  const node = holderOf(tree, id);
  if (!node) throw new NotSent(t('нет узла {id}', { id }));
  const ref = newestSession(node);
  if (!ref)
    throw new NotSent(t('у узла {id} нет сессии — начни её: treeyard open {id} --bg|--pane --task "…"', { id }));
  const [live, panes] = await Promise.all([sources.live().catch(() => []), sources.panes().catch(() => [])]);
  const world: World = { live: new Map(live.map((s) => [s.id, s])), panes, paneSessions: new Map() };
  const sight = sessionSight(ref, world);
  const dir = tree.project.dir;
  let sent: Sent;
  if (sight.state === 'waiting') throw new NotSent(waitingText(sight));
  if (sight.pane) {
    await sources.type(sight.pane, `${PASTE_START}${text}${PASTE_END}`);
    await sources.pause(ENTER_AFTER_MS);
    await sources.type(sight.pane, '\r');
    sent = { how: 'typed', ref, pane: sight.pane, warnings: [] };
  } else if (ref.mode === 'background') {
    if (sight.state === 'busy')
      throw new NotSent(t('сессия {short} ещё работает — дождись её: treeyard wait {id}', { short: short(ref), id }));
    // A background session whose turn is over still holds the conversation: it lets go first.
    if (sight.state === 'idle' && live.find((s) => s.id === ref.id)?.live?.state !== 'done')
      await sources.stop({ brain: ref.brain, sessionId: ref.id, cwd: dir });
    const result = await sources.open({
      brain: ref.brain,
      cwd: dir,
      resume: ref.id,
      prompt: text,
      background: true,
      ...fullAccess(ref.brain),
      env: nodeEnv(id, dir),
    });
    if (result.error || !result.ok) throw new NotSent(result.error?.message ?? t('фоновая сессия не продолжилась'));
    sent = { how: 'resumed', ref, warnings: result.warnings };
  } else {
    if (sight.state === 'busy' || sight.state === 'idle')
      throw new NotSent(
        t('сессия {short} открыта в терминале — напиши ей там или дождись, пока её закроют', { short: short(ref) }),
      );
    if (isPending(ref))
      throw new NotSent(t('сессия так и не получила id — её не продолжить; начни новую: treeyard open {id}', { id }));
    const started = await sources.startPane({
      brain: ref.brain,
      cwd: dir,
      resume: ref.id,
      prompt: text,
      ...fullAccess(ref.brain),
      label: node.title,
      env: nodeEnv(id, dir),
      ...(options.size ? { width: options.size.width, height: options.size.height } : {}),
    });
    sent = {
      how: 'woke',
      ref: { ...ref, mode: 'pane', pane: started.pane },
      pane: started.pane,
      warnings: started.warnings,
    };
  }
  // `opened` is when the session last heard from the tree: `wait` gives it time to take the message.
  const found = node.sessions.find((s) => s.brain === ref.brain && s.id === ref.id);
  if (found) {
    Object.assign(found, sent.how === 'woke' ? { mode: 'pane', pane: sent.pane } : {});
    attachSession(tree, id, { ...found, opened: nowIso() });
  }
  logToNode(
    tree,
    id,
    t('письмо сессии {brain} {short}: «{text}»', { brain: ref.brain, short: short(ref), text: clip(text) }),
    options.source,
  );
  return sent;
}

function short(ref: SessionRef): string {
  return isPending(ref) ? (ref.pane ?? ref.id) : ref.id.slice(0, 8);
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > JOURNAL_TEXT ? `${line.slice(0, JOURNAL_TEXT - 1)}…` : line;
}

function waitingText(sight: SessionSight): string {
  const why = sight.waitingFor ? ` (${sight.waitingFor})` : '';
  const where = sight.pane
    ? t('ответь в панели: tmux -L brainyard attach -t {pane}', { pane: sight.pane })
    : t('ответь в ней: claude attach {id}', { id: sight.id?.slice(0, 8) ?? '' });
  return t('сессия ждёт человека{why} — письмо ушло бы в её диалог; {where}', { why, where });
}
