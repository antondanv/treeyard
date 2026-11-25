/**
 * Delivery of the mailbox (model/mailbox.ts): a letter reaches its node's newest session as soon
 * as that session can take it, without its sender doing anything more.
 *
 * - A live pane whose turn is over gets it typed in, as a person would (pasted, then Enter).
 * - A pane asleep wakes with it: the same conversation, resumed in a new pane.
 * - A Claude Code background session whose turn is over is resumed in the background with it.
 * - A busy session, one waiting for the person (keys typed into a dialog would answer it), one open
 *   in the person's own terminal, or no session at all — the letter waits. The node's next new
 *   session gets the waiting letters in its first message (context.ts).
 *
 * `treeyard send` delivers at once when it can; what it could not, the deliverer — a quiet
 * `treeyard deliver` of its own, one per project — keeps trying until nothing is left that a
 * session could take.
 */
import { spawn } from 'node:child_process';

import {
  capturePane,
  findPaneSession,
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
import { letterBody } from '../model/mail.js';
import {
  DELIVERER,
  type Delivery,
  delivererRunning,
  dropFile,
  type Hold,
  type MailItem,
  markDelivered,
  markHeld,
  queuedFor,
  queuedLetters,
  takeFile,
  withMailLock,
} from '../model/mailbox.js';
import { AS_VAR, NODE_VAR, nodeEnv, PROJECT_VAR, SESSION_VAR } from '../model/notes.js';
import { attachSession } from '../model/ops.js';
import { loadTree } from '../model/store.js';
import { nowIso } from '../model/time.js';
import { holderOf } from '../model/tree.js';
import type { SessionRef, Tree } from '../model/types.js';
import { sessionFolder } from '../worktree.js';
import { fullAccess } from './access.js';
import { withPaneIdle } from './pane-idle.js';
import { isPending, type PaneSize } from './panes.js';
import { newestSession, observe, type SessionSight, sessionSight, sessionSince, type World } from './wait.js';

/** What delivery uses of Brainyard; tests put their own. */
export interface DeliverSources {
  live(): Promise<SessionInfo[]>;
  panes(): Promise<PaneInfo[]>;
  /** The session a Codex, Antigravity or OpenCode pane started. */
  paneSession?(pane: PaneInfo): Promise<string | undefined>;
  /** Adds the idle state of panes whose CLI lists only busy sessions (Codex, Antigravity). */
  idle?(
    panes: readonly PaneInfo[],
    live: ReadonlyMap<string, SessionInfo>,
    since?: ReadonlyMap<string, number>,
  ): Promise<ReadonlyMap<string, SessionInfo>>;
  /** Reads a pane's screen to spot startup dialogs before the CLI reports its session. */
  capture?(pane: string): Promise<{ lines: string[] } | undefined>;
  type(pane: string, data: string): Promise<void>;
  startPane: typeof startPane;
  open: typeof open;
  stop: typeof stopSession;
  pause(ms: number): Promise<void>;
  now?(): number;
}

export const DELIVER_SOURCES: DeliverSources = {
  // Finished background runs too: a run that is over can be resumed without stopping it.
  live: () => liveSessions({ all: true, panes: {} }),
  panes: () => listPanes(),
  paneSession: async (pane) => (await findPaneSession(pane))?.id,
  idle: (panes, live, since) => withPaneIdle(panes, live, since ? { since } : {}),
  capture: (pane) => capturePane(pane),
  type: (pane, data) => sendToPane(pane, data),
  startPane,
  open,
  stop: stopSession,
  pause: (ms) => new Promise((done) => setTimeout(done, ms)),
  now: () => Date.now(),
};

/**
 * Bracketed paste: the CLI takes the whole text as one paste, newlines included, instead of
 * sending the message at its first line. The Enter comes after a pause, apart from the paste:
 * Codex counts keys that come too fast as part of a paste and would put a newline instead.
 */
const PASTE_START = '\u001b[200~';
const PASTE_END = '\u001b[201~';
const ENTER_AFTER_MS = 400;

/** A CLI that has just started (or just been written to) says «idle» before its turn begins. */
export const SETTLE_MS = 15_000;
/** A pane whose CLI never says what it does is typed into once it has had this long to start. */
export const START_MS = 30_000;

/** One look at a node's waiting letters: delivered now, or why not. */
export interface Attempt {
  node: string;
  /** The letters it was about, oldest first. */
  letters: number[];
  how?: Delivery;
  ref?: SessionRef;
  /** The pane it went to, when it went to one. */
  pane?: string;
  held?: Hold;
  heldFor?: string;
  /** Brainyard could not do it: the letters stay queued and are tried again. */
  error?: string;
  warnings: string[];
}

type Route =
  | { kind: 'hold'; held: Hold; heldFor?: string }
  | { kind: 'type'; pane: string }
  | { kind: 'resume'; stop: boolean }
  | { kind: 'wake' };

function since(ref: SessionRef): number {
  return Math.max(Date.parse(ref.opened ?? '') || 0, Date.parse(ref.started ?? '') || 0);
}

/** Where the letters can go now, if anywhere. */
export function routeOf(
  ref: SessionRef | undefined,
  sight: SessionSight | undefined,
  info: SessionInfo | undefined,
  now: number,
): Route {
  if (!ref || !sight) return { kind: 'hold', held: 'none' };
  if (sight.state === 'waiting')
    return { kind: 'hold', held: 'waiting', ...(sight.waitingFor ? { heldFor: sight.waitingFor } : {}) };
  const fresh = now - since(ref);
  if (sight.pane) {
    if (sight.state === 'busy') return { kind: 'hold', held: 'busy' };
    // Just written to: its «idle» may be from before the message.
    if (sight.state === 'idle' && fresh < SETTLE_MS) return { kind: 'hold', held: 'busy' };
    if (sight.state === 'unknown' && fresh < START_MS) return { kind: 'hold', held: 'starting' };
    return { kind: 'type', pane: sight.pane };
  }
  if (ref.mode === 'background') {
    if (sight.state === 'busy') return { kind: 'hold', held: 'busy' };
    if (sight.state === 'idle' && fresh < SETTLE_MS && info?.live?.state !== 'done')
      return { kind: 'hold', held: 'busy' };
    // A run whose turn is over still holds the conversation: it lets go first.
    return { kind: 'resume', stop: sight.state === 'idle' && info?.live?.state !== 'done' };
  }
  // Open in a terminal (the person's own, or a pane they resumed outside the tree).
  if (sight.state === 'busy' || sight.state === 'idle') return { kind: 'hold', held: 'terminal' };
  // A pane that never named its session cannot be resumed: its next new session gets the letters.
  if (isPending(ref)) return { kind: 'hold', held: 'none' };
  return { kind: 'wake' };
}

/**
 * Whether the CLI takes a letter as the first message of a resumed session. OpenCode's TUI loses
 * one given at its start (probe 24.11): it wakes without it, and the letter is typed once it is ready.
 */
export function carriesWakePrompt(brain: string): boolean {
  return brain !== 'opencode';
}

/**
 * Brainyard sends a text to tmux in pieces of 2000 bytes, a key each, and tmux 3.7 refuses a
 * command that long («command too long», probe 24.11): a long letter goes in smaller pieces, cut
 * between characters, inside the one bracketed paste.
 */
const TYPE_PIECE = 400;

export async function typeText(sources: Pick<DeliverSources, 'type'>, pane: string, text: string): Promise<void> {
  const chars = Array.from(text);
  for (let at = 0; at < chars.length; at += TYPE_PIECE)
    await sources.type(pane, chars.slice(at, at + TYPE_PIECE).join(''));
}

export function shortId(ref: SessionRef): string {
  return isPending(ref) ? (ref.pane ?? ref.id) : ref.id.slice(0, 8);
}

export interface DeliverOptions {
  size?: PaneSize;
  sources?: DeliverSources;
}

/**
 * Hands node `id`'s waiting letters to its newest session if it can take them now, all in one
 * message; otherwise remembers why they wait. Undefined — nothing waits for the node. Call it
 * under the mailbox lock (`withMailLock`): two deliverers must not type the same letter twice.
 */
export async function deliverNode(
  tree: Tree,
  id: string,
  world: World,
  options: DeliverOptions = {},
): Promise<Attempt | undefined> {
  const sources = options.sources ?? DELIVER_SOURCES;
  const dir = tree.project.dir;
  const letters = queuedFor(dir, id);
  if (!letters.length) return undefined;
  const numbers = letters.map((letter) => letter.n);
  const node = holderOf(tree, id);
  const ref = node ? newestSession(node) : undefined;
  const sight = ref ? sessionSight(ref, world) : undefined;
  const info = sight?.id ? world.live.get(sight.id) : undefined;
  const route = routeOf(ref, sight, info, (sources.now ?? Date.now)());
  if (route.kind === 'hold' || !node || !ref) {
    const held = route.kind === 'hold' ? route : { held: 'none' as const };
    markHeld(dir, numbers, held.held, 'heldFor' in held ? held.heldFor : undefined);
    return {
      node: id,
      letters: numbers,
      held: held.held,
      ...('heldFor' in held && held.heldFor ? { heldFor: held.heldFor } : {}),
      warnings: [],
    };
  }
  const body = letterBody(tree, letters);
  // A session in the node's own git worktree goes on there, not in the project folder.
  const folder = sessionFolder(dir, ref);
  const attempt: Attempt = { node: id, letters: numbers, ref, warnings: [] };
  try {
    if (route.kind === 'type') {
      await typeText(sources, route.pane, `${PASTE_START}${body}${PASTE_END}`);
      await sources.pause(ENTER_AFTER_MS);
      await sources.type(route.pane, '\r');
      Object.assign(attempt, { how: 'typed', pane: route.pane });
    } else if (route.kind === 'resume') {
      if (route.stop) await sources.stop({ brain: ref.brain, sessionId: ref.id, cwd: folder });
      const result = await sources.open({
        brain: ref.brain,
        cwd: folder,
        resume: ref.id,
        prompt: body,
        background: true,
        ...fullAccess(ref.brain, dir),
        env: nodeEnv(id, dir, ref.brain),
      });
      if (result.error || !result.ok) throw new Error(result.error?.message ?? t('фоновая сессия не продолжилась'));
      Object.assign(attempt, { how: 'resumed', warnings: result.warnings });
    } else {
      const carries = carriesWakePrompt(ref.brain);
      const started = await sources.startPane({
        brain: ref.brain,
        cwd: folder,
        resume: ref.id,
        ...(carries ? { prompt: body } : {}),
        ...fullAccess(ref.brain, dir),
        label: node.title,
        env: nodeEnv(id, dir, ref.brain),
        ...(options.size ? { width: options.size.width, height: options.size.height } : {}),
      });
      Object.assign(attempt, {
        pane: started.pane,
        ref: { ...ref, mode: 'pane', pane: started.pane },
        warnings: started.warnings,
      });
      if (carries) attempt.how = 'woke';
      else {
        // Awake without the letters: they wait until the CLI is ready, then go in typed.
        const found = node.sessions.find((s) => s.brain === ref.brain && s.id === ref.id);
        if (found) {
          Object.assign(found, { mode: 'pane', pane: started.pane });
          attachSession(tree, id, { ...found, opened: nowIso() });
        }
        markHeld(dir, numbers, 'starting');
        return { ...attempt, held: 'starting' };
      }
    }
  } catch (error) {
    attempt.error = error instanceof Error ? error.message : String(error);
    return attempt;
  }
  markDelivered(dir, numbers, attempt.how!, {
    session: `${ref.brain} ${shortId(ref)}`,
    ...(attempt.pane ? { pane: attempt.pane } : {}),
  });
  // `opened` is when the session last heard from the tree: `wait` and the next delivery give it time.
  const found = node.sessions.find((s) => s.brain === ref.brain && s.id === ref.id);
  if (found) {
    if (attempt.how === 'woke') Object.assign(found, { mode: 'pane', pane: attempt.pane });
    attachSession(tree, id, { ...found, opened: nowIso() });
  }
  return attempt;
}

/** One pass over every waiting letter of the project, under the mailbox lock. */
export async function deliverAll(
  dir: string,
  options: DeliverOptions = {},
  only?: ReadonlySet<string>,
): Promise<Attempt[]> {
  const sources = options.sources ?? DELIVER_SOURCES;
  const nodes = [...new Set(queuedLetters(dir).map((letter) => letter.to))].filter((id) => !only || only.has(id));
  if (!nodes.length) return [];
  let since: Map<string, number> | undefined;
  try {
    since = sessionSince(loadTree(dir));
  } catch {
    // Tree unreadable right now: `observe` falls back to `pane.startedAt`.
  }
  const world = await observe(dir, sources, since ? { since } : undefined);
  return withMailLock(dir, async () => {
    const tree = loadTree(dir);
    const attempts: Attempt[] = [];
    for (const id of nodes) {
      const attempt = await deliverNode(tree, id, world, options);
      if (attempt) attempts.push(attempt);
    }
    return attempts;
  });
}

/**
 * Letters a session could take some day: the node has one that can be typed into or resumed. The
 * rest wait for the node's next new session, which gets them in its first message.
 */
function deliverable(tree: Tree, letters: readonly MailItem[]): MailItem[] {
  return letters.filter((letter) => {
    const node = holderOf(tree, letter.to);
    const ref = node ? newestSession(node) : undefined;
    return Boolean(ref) && !(isPending(ref!) && letter.held === 'none');
  });
}

export interface DelivererOptions extends DeliverOptions {
  intervalMs?: number;
  /** After this long it stops; the next `send`, `wait` or the tree starts another. */
  lifetimeMs?: number;
  signal?: AbortSignal;
  onAttempt?(attempt: Attempt): void;
}

const INTERVAL_MS = 3000;
/** Past this, a letter that still waits is looked at less often: a person's terminal may stay open for hours. */
const QUICK_MS = 10 * 60_000;
const SLOW_INTERVAL_MS = 15_000;
const LIFETIME_MS = 12 * 3_600_000;
/** A node whose delivery failed is tried again after this long. */
const RETRY_MS = 60_000;
/** Passes in a row where every delivery failed: tmux or the CLI is out of this process's reach. */
const FAILED_PASSES = 3;

/**
 * The deliverer: passes over the mailbox until no letter is left that a session could take, the
 * tree is gone, or its lifetime is over. One per project: a second one returns at once.
 */
export async function runDeliverer(dir: string, options: DelivererOptions = {}): Promise<number> {
  if (!takeFile(dir, DELIVERER)) return 0;
  const sources = options.sources ?? DELIVER_SOURCES;
  const now = sources.now ?? Date.now;
  const start = now();
  const lifetime = options.lifetimeMs ?? LIFETIME_MS;
  const failedAt = new Map<string, number>();
  let delivered = 0;
  let failing = 0;
  try {
    for (;;) {
      if (options.signal?.aborted || now() - start > lifetime) break;
      let tree: Tree;
      try {
        tree = loadTree(dir);
      } catch {
        break;
      }
      const left = deliverable(tree, queuedLetters(dir));
      if (!left.length) break;
      const waiting = left.filter((letter) => now() - (failedAt.get(letter.to) ?? 0) >= RETRY_MS);
      if (waiting.length) {
        let attempts: Attempt[];
        try {
          attempts = await deliverAll(dir, options, new Set(waiting.map((letter) => letter.to)));
        } catch {
          // The lock is stuck: another deliverer will do better.
          break;
        }
        for (const attempt of attempts) {
          options.onAttempt?.(attempt);
          if (attempt.error) failedAt.set(attempt.node, now());
          else if (attempt.how) delivered += attempt.letters.length;
        }
        const tried = attempts.filter((attempt) => attempt.how || attempt.error);
        failing = tried.length && tried.every((attempt) => attempt.error) ? failing + 1 : 0;
        if (failing >= FAILED_PASSES) break;
      }
      const interval = options.intervalMs ?? (now() - start < QUICK_MS ? INTERVAL_MS : SLOW_INTERVAL_MS);
      await new Promise<void>((done) => {
        const timer = setTimeout(done, interval);
        options.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          done();
        });
      });
    }
  } finally {
    dropFile(dir, DELIVERER);
  }
  return delivered;
}

/** Starts `treeyard deliver` for the project in the background, detached from this process. */
export function spawnDeliverer(dir: string): void {
  const script = process.argv[1];
  if (!script) return;
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Nobody's session: the deliverer hands each session its own node's environment.
  for (const key of [
    NODE_VAR,
    PROJECT_VAR,
    SESSION_VAR,
    AS_VAR,
    'CLAUDECODE',
    'CLAUDE_CODE_SESSION_ID',
    'CLAUDE_CODE_ENTRYPOINT',
  ])
    delete env[key];
  const child = spawn(process.execPath, [...process.execArgv, script, 'deliver', '--project', dir], {
    cwd: dir,
    detached: true,
    stdio: 'ignore',
    env,
  });
  child.on('error', () => undefined);
  child.unref();
}

/**
 * Makes sure someone delivers the letters still waiting: starts the deliverer when one of them has
 * a session to go to and no deliverer runs. `TREEYARD_DELIVER=off` — never (the tests).
 */
export function ensureDeliverer(tree: Tree, start: (dir: string) => void = spawnDeliverer): boolean {
  if (start === spawnDeliverer && process.env.TREEYARD_DELIVER === 'off') return false;
  const dir = tree.project.dir;
  // A letter held for a node without a session goes when one appears, however it appeared.
  if (!deliverable(tree, queuedLetters(dir)).length || delivererRunning(dir)) return false;
  start(dir);
  return true;
}
