/**
 * `treeyard wait`: a coordinator handed nodes out to sessions and waits until one of them needs
 * it — the node left «в работе», or its session ended its turn, waits for the person or is gone.
 * Without it the coordinator polls `show` and `git log`, or keeps a subagent it can hear back from.
 *
 * The tree is watched (a change wakes the wait at once); the sessions are asked every few seconds,
 * through Brainyard, the way the tree's panes are.
 */
import {
  capturePane,
  findPaneSession,
  listPanes,
  liveSessions,
  type PaneInfo,
  type PaneScreen,
  type SessionInfo,
} from '@antondanv/brainyard';

import { type Entry, isOwnLine, parseEntry } from '../model/history.js';
import { journalEntries } from '../model/journal.js';
import { type MailItem, markDelivered, queuedFor, withMailLock } from '../model/mailbox.js';
import { loadTree } from '../model/store.js';
import type { SessionRef, Status, Tree, TreeNode } from '../model/types.js';
import { watchTree } from '../watch.js';
import { lastMessage } from './last-message.js';
import { findOverlaps, notifyOverlaps, type Overlap } from './overlap.js';
import { paneDialog, type StartupDialog, startupWaitingFor } from './pane-dialog.js';
import { withPaneIdle } from './pane-idle.js';
import { isPending, paneFor, paneInProject } from './panes.js';

/** What a session is doing, as its CLI tells it; `gone` — its process ended (a pane asleep, a finished background run). */
export type SessionState = 'busy' | 'waiting' | 'idle' | 'gone' | 'unknown';

/** Why a node needs the coordinator now; `letter` — its session wrote to the coordinator's node. */
export type Reason = 'status' | 'waiting' | 'idle' | 'gone' | 'letter';

export interface SessionSight {
  brain: SessionRef['brain'];
  /** The CLI's session id; null while a Codex, Antigravity or OpenCode pane has not named it. */
  id: string | null;
  mode?: SessionRef['mode'];
  state: SessionState;
  /** `waiting`: what for, as the CLI says. */
  waitingFor?: string;
  /** The live pane it runs in. */
  pane?: string;
  /** The last message the session wrote, whole, from its CLI's transcript: the question or the summary. */
  message?: string;
  /** The end of the pane's screen, plain text; only when there is no transcript to take the message from. */
  screen?: string[];
}

export interface Sight {
  id: string;
  title: string;
  status: Status;
  /** The status when the wait began. */
  from: Status;
  /** The last entry a person or an agent wrote: the session's summary, as a rule. */
  entry?: Entry;
  /** The node's newest session. */
  session?: SessionSight;
  reason?: Reason;
}

/** A letter to the coordinator's node, with the title of the node whose session wrote it. */
export type InboxLetter = MailItem & { fromTitle?: string };

export interface WaitResult {
  settled: Sight[];
  pending: Sight[];
  /** Letters to the coordinator's own node that waited for it: whole, handed over by this wait. */
  letters: InboxLetter[];
  /** Pairs of nodes whose worktrees change one file, among the nodes of the wait and the ones at work beside them. */
  conflicts?: Overlap[];
  timedOut: boolean;
}

/** What the wait reads; tests put their own. */
export interface WaitSources {
  load(dir: string): Tree;
  live(): Promise<SessionInfo[]>;
  panes(): Promise<PaneInfo[]>;
  /** The session a Codex, Antigravity or OpenCode pane started. */
  paneSession(pane: PaneInfo): Promise<string | undefined>;
  capture(pane: string): Promise<PaneScreen | undefined>;
  /** The last message of a session, whole, from the CLI's transcript; none — the screen stands in. */
  message?(brain: SessionRef['brain'], id: string): Promise<string | undefined>;
  /** Adds the idle state of panes whose CLI lists only busy sessions (Codex, Antigravity). */
  idle(panes: readonly PaneInfo[], live: ReadonlyMap<string, SessionInfo>): Promise<ReadonlyMap<string, SessionInfo>>;
  watch(dir: string, wake: () => void): { stop(): void };
  /** Writes to a node's session about a file another node changes too; none — nobody is told. */
  notify?(tree: Tree, id: string, text: string): Promise<void>;
  now(): number;
}

export const SOURCES: WaitSources = {
  load: loadTree,
  // Finished background runs too: «done» is the answer the coordinator waits for.
  live: () => liveSessions({ all: true, panes: {} }),
  panes: () => listPanes(),
  paneSession: async (pane) => (await findPaneSession(pane))?.id,
  capture: (pane) => capturePane(pane),
  message: lastMessage,
  idle: (panes, live) => withPaneIdle(panes, live),
  watch: (dir, wake) => watchTree(dir, wake),
  notify: async (tree, id, text) => {
    // Loaded here: send.ts reads this module.
    const { sendToNode } = await import('./send.js');
    await sendToNode(tree, id, text, { source: 'treeyard' });
  },
  now: () => Date.now(),
};

export interface WaitOptions {
  /** Until every node needs the coordinator, not the first one. */
  all?: boolean;
  /** Give up after this long; 0 or none — never. */
  timeoutMs?: number;
  /**
   * The coordinator's own node: a letter to it that waits (its session is busy waiting) ends the
   * wait and is handed over here, whole.
   */
  inbox?: string;
  /** How often the sessions are asked. */
  intervalMs?: number;
  /**
   * A session this fresh is not done yet, whatever it says: a CLI that has just started (or has
   * just been written to) reports idle before its turn begins.
   */
  graceMs?: number;
  sources?: WaitSources;
}

export const INTERVAL_MS = 3000;
export const GRACE_MS = 30_000;
/** Rows of a pane's screen that make it into the answer. */
const SCREEN_ROWS = 12;

/** The node's newest session: the one the coordinator started or last wrote to. */
export function newestSession(node: TreeNode): SessionRef | undefined {
  const time = (ref: SessionRef) => Math.max(Date.parse(ref.opened ?? '') || 0, Date.parse(ref.started ?? '') || 0);
  return [...node.sessions].sort((a, b) => time(b) - time(a))[0];
}

/** The last entry a person or an agent wrote, not treeyard itself. */
export function lastEntry(node: TreeNode): Entry | undefined {
  const lines = journalEntries(node.body);
  for (let index = lines.length - 1; index >= 0; index--) {
    const entry = parseEntry(lines[index]!);
    if (!isOwnLine(entry.text)) return entry;
  }
  return undefined;
}

/** What the sessions of the machine are doing now, gathered once per look. */
export interface World {
  live: ReadonlyMap<string, SessionInfo>;
  panes: readonly PaneInfo[];
  /** Pane name → its session, for panes whose CLI names the session late. */
  paneSessions: ReadonlyMap<string, string>;
  /** Pane name → startup dialog on its screen before the CLI reports a live state. */
  paneDialogs?: ReadonlyMap<string, StartupDialog>;
  /** Pane name → screen lines already read while checking for startup dialogs. */
  paneScreens?: ReadonlyMap<string, readonly string[]>;
}

/** What `observe` asks; `paneSession`, `idle` and `capture` make the answer sharper. */
export type ObserveSources = Pick<WaitSources, 'live' | 'panes'> &
  Partial<Pick<WaitSources, 'paneSession' | 'idle'>> & {
    capture?(pane: string): Promise<{ lines: readonly string[] } | undefined>;
  };

/**
 * What the sessions of the machine are doing now: their live states, the panes, the sessions of
 * panes whose CLI named them late, the idle state of Codex and Antigravity panes, and startup
 * dialogs on panes the CLI has not reported yet.
 */
export async function observe(dir: string, sources: ObserveSources): Promise<World> {
  const [live, panes] = await Promise.all([sources.live().catch(() => []), sources.panes().catch(() => [])]);
  const names = new Map<string, string>();
  if (sources.paneSession)
    for (const pane of panes)
      if (pane.brain && !pane.sessionId && paneInProject(pane, dir)) {
        const id = await sources.paneSession(pane).catch(() => undefined);
        if (id) names.set(pane.pane, id);
      }
  const named = panes.map((pane) =>
    pane.sessionId || !names.has(pane.pane) ? pane : { ...pane, sessionId: names.get(pane.pane)! },
  );
  const asked = new Map(live.map((session) => [session.id, session]));
  const states = sources.idle ? await sources.idle(named, asked).catch(() => asked) : asked;
  const paneDialogs = new Map<string, StartupDialog>();
  const paneScreens = new Map<string, readonly string[]>();
  if (sources.capture) {
    const capture = sources.capture;
    const silent = named.filter(
      (pane) =>
        (!pane.brain || pane.brain === 'claude' || pane.brain === 'codex' || pane.brain === 'antigravity') &&
        (!pane.sessionId || !states.get(pane.sessionId)?.live?.status),
    );
    await Promise.all(
      silent.map(async (pane) => {
        const screen = await capture(pane.pane).catch(() => undefined);
        if (!screen) return;
        paneScreens.set(pane.pane, screen.lines);
        const dialog = paneDialog(screen.lines, pane.brain);
        if (dialog) paneDialogs.set(pane.pane, dialog);
      }),
    );
  }
  return { live: states, panes, paneSessions: names, paneDialogs, paneScreens };
}

/** What a session is doing, from its live state and its pane. */
export function sessionSight(ref: SessionRef, world: World): SessionSight {
  const pane = paneFor(ref, world.panes);
  const id = isPending(ref) ? (pane ? (pane.sessionId ?? world.paneSessions.get(pane.pane)) : undefined) : ref.id;
  const info = id ? world.live.get(id) : undefined;
  const sight: SessionSight = { brain: ref.brain, id: id ?? null, state: 'unknown' };
  if (ref.mode) sight.mode = ref.mode;
  if (pane) sight.pane = pane.pane;
  const status = info?.live?.status;
  const dialog = !status && pane ? world.paneDialogs?.get(pane.pane) : undefined;
  if (status === 'waiting') {
    sight.state = 'waiting';
    if (info?.live?.waitingFor) sight.waitingFor = info.live.waitingFor;
  } else if (dialog) {
    sight.state = 'waiting';
    sight.waitingFor = startupWaitingFor(dialog);
  } else if (status === 'idle') sight.state = 'idle';
  else if (status) sight.state = 'busy';
  // No word from the CLI: a live pane is still starting or does not say; without one the process is over.
  else if (!pane) sight.state = 'gone';
  return sight;
}

/**
 * Whether the node needs the coordinator now, and why. `worked` — the wait saw its session at
 * work: an idle one then has ended its turn for sure, no grace needed.
 */
export function reasonOf(
  node: TreeNode,
  session: SessionSight | undefined,
  ref: SessionRef | undefined,
  now: number,
  graceMs: number,
  worked = false,
  /** False — only the session counts: `send --wait` asks a node that may sit in review. */
  statusMatters = true,
): Reason | undefined {
  if (statusMatters && node.status !== 'active') return 'status';
  if (!session || !ref) return undefined;
  if (session.state === 'waiting') return 'waiting';
  if (session.state !== 'idle' && session.state !== 'gone') return undefined;
  if (worked) return session.state;
  const since = Math.max(Date.parse(ref.opened ?? '') || 0, Date.parse(ref.started ?? '') || 0);
  return now - since >= graceMs ? session.state : undefined;
}

/** One look at the nodes: what each is doing and which need the coordinator. */
export async function look(
  dir: string,
  ids: readonly string[],
  from: ReadonlyMap<string, Status>,
  graceMs: number,
  sources: WaitSources,
  /** Sessions seen at work during this wait; grows as it looks. */
  worked: Set<string> = new Set(),
  statusMatters = true,
): Promise<Sight[]> {
  const tree = sources.load(dir);
  const nodes = ids.map((id) => tree.nodes.get(id)).filter((node): node is TreeNode => Boolean(node));
  const asking = nodes.some((node) => node.sessions.length);
  const world: World = asking ? await observe(dir, sources) : { live: new Map(), panes: [], paneSessions: new Map() };
  const now = sources.now();
  const sights: Sight[] = [];
  for (const node of nodes) {
    const ref = newestSession(node);
    const session = ref ? sessionSight(ref, world) : undefined;
    const sight: Sight = {
      id: node.id,
      title: node.title,
      status: node.status,
      from: from.get(node.id) ?? node.status,
    };
    const entry = lastEntry(node);
    if (entry) sight.entry = entry;
    if (session) sight.session = session;
    if (ref && session?.state === 'busy') worked.add(ref.id);
    const reason = reasonOf(node, session, ref, now, graceMs, Boolean(ref && worked.has(ref.id)), statusMatters);
    if (reason) sight.reason = reason;
    if (session && reason) {
      // The transcript says what the journal does not yet — the question, or the answer the session
      // ended with — and says it whole; the end of the screen only stands in for a missing one, and
      // a startup dialog lives only on the screen.
      const onDialog = Boolean(session.pane && world.paneDialogs?.has(session.pane));
      const message =
        !onDialog && session.id && sources.message
          ? await sources.message(session.brain, session.id).catch(() => undefined)
          : undefined;
      if (message) session.message = message;
      else if (session.pane && reason !== 'gone') {
        const lines =
          world.paneScreens?.get(session.pane) ?? (await sources.capture(session.pane).catch(() => undefined))?.lines;
        if (lines) session.screen = screenTail(lines);
      }
    }
    sights.push(sight);
  }
  return sights;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences are what is stripped.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/** The last rows of a screen with something on them, without colours. */
export function screenTail(lines: readonly string[], rows = SCREEN_ROWS): string[] {
  const plain = lines.map((line) => line.replace(ANSI, '').trimEnd());
  while (plain.length && !plain.at(-1)) plain.pop();
  return plain.filter((line) => line.trim()).slice(-rows);
}

/** How often the worktrees are read while nodes are waited for: git per node is not for every look. */
export const OVERLAP_EVERY_MS = 15_000;
/** The answer is about to be given: a look younger than this is fresh enough. */
const OVERLAP_FRESH_MS = 2000;

/** When the worktrees were last read by a wait or a queue, and what they showed. */
export interface OverlapLook {
  at?: number;
  found: Overlap[];
}

/**
 * The pairs of nodes that change one file now — the nodes of `ids` against every node at work —
 * and, for a pair seen for the first time, a letter to the sessions of both. Reads git again only
 * when the last look is older than `maxAge`.
 */
export async function lookOverlaps(
  dir: string,
  ids: readonly string[],
  sources: Pick<WaitSources, 'load' | 'notify' | 'now'>,
  last: OverlapLook,
  maxAge = OVERLAP_EVERY_MS,
): Promise<Overlap[]> {
  const now = sources.now();
  if (last.at !== undefined && now - last.at < maxAge) return last.found;
  last.at = now;
  try {
    const tree = sources.load(dir);
    last.found = findOverlaps(tree, ids);
    const notify = sources.notify;
    if (notify && last.found.length) await notifyOverlaps(tree, last.found, (id, text) => notify(tree, id, text));
  } catch {
    // No git, a tree being written this moment: the next look has it; a wait does not fail over a heads-up.
  }
  return last.found;
}

/**
 * Waits until one of the nodes (every one with `all`) needs the coordinator, or the time is up.
 * Nodes that are not «в работе» already need it: the answer comes at once.
 */
export async function waitFor(dir: string, ids: readonly string[], options: WaitOptions = {}): Promise<WaitResult> {
  const sources = options.sources ?? SOURCES;
  const interval = options.intervalMs ?? INTERVAL_MS;
  const grace = options.graceMs ?? GRACE_MS;
  const start = sources.now();
  const deadline = options.timeoutMs ? start + options.timeoutMs : Number.POSITIVE_INFINITY;
  const first = sources.load(dir);
  const from = new Map(ids.map((id) => [id, first.nodes.get(id)?.status ?? 'todo'] as const));
  const worked = new Set<string>();
  const overlapLook: OverlapLook = { found: [] };
  let wake: (() => void) | undefined;
  const watcher = sources.watch(dir, () => wake?.());
  try {
    for (;;) {
      const sights = await look(dir, ids, from, grace, sources, worked);
      // A letter to the coordinator is a question for it: it ends the wait, whatever the nodes do.
      const tree = options.inbox ? sources.load(dir) : undefined;
      const letters: InboxLetter[] = (options.inbox ? queuedFor(dir, options.inbox) : []).map((letter) => {
        const title = letter.from ? tree?.nodes.get(letter.from)?.title : undefined;
        return title ? { ...letter, fromTitle: title } : letter;
      });
      if (letters.length) {
        await withMailLock(
          dir,
          async () =>
            void markDelivered(
              dir,
              letters.map((letter) => letter.n),
              'wait',
            ),
        );
        for (const sight of sights)
          if (!sight.reason && letters.some((letter) => letter.from === sight.id)) sight.reason = 'letter';
      }
      const settled = sights.filter((sight) => sight.reason);
      const pending = sights.filter((sight) => !sight.reason);
      const done = letters.length > 0 || (settled.length > 0 && (!options.all || pending.length === 0));
      const left = deadline - sources.now();
      // The sessions are told as soon as two nodes meet in a file; the answer carries what is true now.
      const conflicts = await lookOverlaps(
        dir,
        ids,
        sources,
        overlapLook,
        done || left <= 0 ? OVERLAP_FRESH_MS : OVERLAP_EVERY_MS,
      );
      if (done) return { settled, pending, letters, conflicts, timedOut: false };
      if (left <= 0) return { settled, pending, letters: [], conflicts, timedOut: true };
      await new Promise<void>((done) => {
        const timer = setTimeout(done, Math.min(interval, left));
        wake = () => {
          clearTimeout(timer);
          done();
        };
      });
      wake = undefined;
    }
  } finally {
    watcher.stop();
  }
}

/** `90`, `90s`, `10m`, `1h` → milliseconds; undefined for anything else. */
export function parseDuration(text: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(s|m|h|с|м|ч)?\s*$/i.exec(text);
  if (!match) return undefined;
  const unit = (match[2] ?? 's').toLowerCase();
  const scale = unit === 'h' || unit === 'ч' ? 3_600_000 : unit === 'm' || unit === 'м' ? 60_000 : 1000;
  return Math.round(Number(match[1]) * scale);
}
