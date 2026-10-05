/**
 * Sessions in panes: the CLI runs in tmux (through Brainyard), the tree shows
 * its screen next to the nodes, and the session outlives the tree.
 *
 * Memory is kept in check two ways. Watching costs nothing extra: only the
 * pane on screen is read. And a quiet pane can sleep: its CLI process ends,
 * the conversation stays in the CLI's history, and waking it is `--resume`
 * in a new pane. Panes that work or wait for you never sleep on their own.
 */

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  closePane,
  findPaneSession,
  listPanes,
  type PaneInfo,
  paneMemory,
  panesAvailable,
  type SessionInfo,
  sessions,
  setPaneSession,
  startPane,
} from '@antondanv/brainyard';

import { t } from '../i18n/i18n.js';
import { nodeEnv } from '../model/notes.js';
import { attachSession, detachSession, setStatus } from '../model/ops.js';
import { nowIso } from '../model/time.js';
import { holderOf, sessionHolders } from '../model/tree.js';
import type { BrainId, SessionRef, Tree, TreeNode } from '../model/types.js';
import { fullAccess, sessionPlan } from './context.js';
import type { LaunchOptions } from './launch.js';

export { panesAvailable };

/** tmux and the CLI may spell the same folder differently through a symlink. */
export function paneInProject(pane: PaneInfo, dir: string): boolean {
  if (!pane.cwd) return false;
  if (pane.cwd === dir) return true;
  try {
    return realpathSync(pane.cwd) === realpathSync(dir);
  } catch {
    return resolve(pane.cwd) === resolve(dir);
  }
}

/** A pane as the tree sees it: what tmux says, plus memory. */
export interface Pane extends PaneInfo {
  /** Bytes of resident memory of the CLI and what it started. */
  memory?: number;
}

/** Codex and Antigravity name a session only after it starts; until then the ref holds the pane. */
const PENDING = 'pane:';

export function isPending(ref: SessionRef): boolean {
  return ref.id.startsWith(PENDING);
}

export interface PaneSize {
  width: number;
  height: number;
}

/** Starts a session of a node, or of the whole project (`root`), in a new pane. */
export async function launchInPane(
  tree: Tree,
  id: string,
  options: LaunchOptions,
  size: PaneSize,
): Promise<{ pane: string; ref: SessionRef; warnings: string[] }> {
  const node = holderOf(tree, id);
  if (!node)
    throw new Error(
      t('нет узла {id}', {
        id,
      }),
    );
  const plan = sessionPlan(tree, id, options.start, options.brain);
  const started = await startPane({
    brain: options.brain,
    cwd: tree.project.dir,
    // Only Claude Code takes a name; the others title a session after its first message.
    ...(options.brain === 'claude' ? { name: plan.name } : {}),
    label: node.title,
    system: plan.system,
    ...(plan.prompt ? { prompt: plan.prompt } : {}),
    ...(plan.permissionMode ? { permissionMode: plan.permissionMode } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.effort ? { effort: options.effort } : {}),
    ...(options.worktree ? { worktree: true } : {}),
    env: nodeEnv(id),
    width: size.width,
    height: size.height,
  });
  const ref: SessionRef = {
    brain: options.brain,
    id: started.sessionId ?? `${PENDING}${started.pane}`,
    name: plan.name,
    started: nowIso(new Date(started.startedAt)),
    mode: 'pane',
    pane: started.pane,
  };
  attachSession(
    tree,
    id,
    ref,
    t('новая сессия в панели ({p2})', {
      p2: plan.start === 'goal' ? '/goal' : plan.start,
    }),
  );
  const current = tree.nodes.get(id);
  if (current && (current.status === 'todo' || current.status === 'idea')) {
    setStatus(tree, id, 'active', { source: options.brain });
  }
  return { pane: started.pane, ref, warnings: started.warnings };
}

/**
 * Whether the CLI wrote the conversation down. A session nobody said a word
 * in is not saved (Claude Code keeps no transcript for it), so it cannot be
 * resumed: there is nothing to put to sleep, and nothing to wake.
 */
export async function hasConversation(dir: string, brain: BrainId, id: string): Promise<boolean> {
  const list = await sessions({ cwd: dir, brains: [brain], live: false, headless: true, limit: 1000 });
  return list.some((session) => session.id === id);
}

/** Wakes a sleeping session: the same conversation, in a new pane. */
export async function wakeInPane(tree: Tree, nodeId: string, ref: SessionRef, size: PaneSize): Promise<string> {
  const running = paneFor(ref, await listPanes());
  if (running) return running.pane;
  if (isPending(ref) || !(await hasConversation(tree.project.dir, ref.brain, ref.id))) {
    if (holderOf(tree, nodeId)) detachSession(tree, nodeId, ref.id);
    throw new Error(t('в этой сессии не было ни одного сообщения — CLI её не сохранил; убрал из узла · o — новая'));
  }
  const node = holderOf(tree, nodeId);
  const started = await startPane({
    brain: ref.brain,
    cwd: tree.project.dir,
    resume: ref.id,
    ...fullAccess(ref.brain),
    ...(node ? { label: node.title } : {}),
    env: nodeEnv(nodeId),
    width: size.width,
    height: size.height,
  });
  // The resumed session may not know its id was ours: tell the pane.
  if (!started.sessionId) await setPaneSession(started.pane, ref.id);
  if (node) updateRef(tree, nodeId, ref, { mode: 'pane', pane: started.pane, opened: nowIso() });
  return started.pane;
}

/**
 * Puts a pane to sleep: the CLI closes, the conversation stays in its
 * history for `wakeInPane`. A session without a conversation is simply
 * closed and leaves its node — there is nothing to come back to.
 */
export async function sleepPane(tree: Tree, pane: Pane): Promise<'slept' | 'closed' | 'failed'> {
  let owner: { nodeId: string; ref: SessionRef } | undefined;
  for (const node of sessionHolders(tree)) {
    const ref = node.sessions.find((s) => paneFor(s, [pane]));
    if (ref) owner = { nodeId: node.id, ref };
  }
  let id = pane.sessionId ?? (owner && !isPending(owner.ref) ? owner.ref.id : undefined);
  // Codex and Antigravity may have written it down a moment ago.
  if (!id) id = (await findPaneSession(pane))?.id;
  const saved = Boolean(id && pane.brain && (await hasConversation(tree.project.dir, pane.brain, id)));
  if (!(await closePane(pane.pane))) return 'failed';
  if (owner) {
    if (!saved) detachSession(tree, owner.nodeId, owner.ref.id);
    else if (isPending(owner.ref) && id) {
      owner.ref.id = id;
      attachSession(tree, owner.nodeId, owner.ref);
    }
  }
  return saved ? 'slept' : 'closed';
}

function updateRef(tree: Tree, nodeId: string, ref: SessionRef, patch: Partial<SessionRef>): void {
  const node = holderOf(tree, nodeId);
  if (!node) return;
  const found = node.sessions.find((s) => s.brain === ref.brain && s.id === ref.id);
  if (!found) return;
  Object.assign(found, patch);
  attachSession(tree, nodeId, found);
}

/** The live panes of this machine with their memory; empty when tmux is missing. */
export async function readPanes(): Promise<Pane[]> {
  const list = await listPanes();
  if (list.length === 0) return [];
  const memory = await paneMemory(list);
  return list.map((pane) => ({ ...pane, ...(memory.has(pane.pane) ? { memory: memory.get(pane.pane)! } : {}) }));
}

/** The live pane a session runs in: by pane name, or by session id when another program started it. */
export function paneFor(ref: SessionRef, panes: readonly Pane[]): Pane | undefined {
  return panes.find(
    (p) =>
      p.brain === ref.brain &&
      ((ref.pane && p.pane === ref.pane) ||
        ref.id === `${PENDING}${p.pane}` ||
        (!isPending(ref) && p.sessionId === ref.id)),
  );
}

/** The node's live pane, the newest first. */
export function nodePane(
  node: TreeNode | undefined,
  panes: readonly Pane[],
): { ref: SessionRef; pane: Pane } | undefined {
  if (!node) return undefined;
  const refs = [...node.sessions].sort((a, b) =>
    (b.opened ?? b.started ?? '').localeCompare(a.opened ?? a.started ?? ''),
  );
  for (const ref of refs) {
    const pane = paneFor(ref, panes);
    if (pane) return { ref, pane };
  }
  return undefined;
}

/** The node's newest session that ran in a pane and sleeps now. */
export function sleepingRef(node: TreeNode | undefined, panes: readonly Pane[]): SessionRef | undefined {
  if (!node) return undefined;
  return [...node.sessions]
    .filter((ref) => ref.mode === 'pane' && !isPending(ref) && !paneFor(ref, panes))
    .sort((a, b) => (b.opened ?? b.started ?? '').localeCompare(a.opened ?? a.started ?? ''))[0];
}

/**
 * Codex and Antigravity sessions get their ids once their CLI wrote them
 * down: the pending refs in the tree and the panes learn them. Returns
 * whether the tree changed.
 */
export async function settlePending(tree: Tree, panes: readonly Pane[]): Promise<boolean> {
  let changed = false;
  const pending = sessionHolders(tree)
    .flatMap((node) => node.sessions.filter(isPending).map((ref) => ({ node, ref })))
    .sort((a, b) => (a.ref.started ?? '').localeCompare(b.ref.started ?? ''));
  const used = new Set(
    sessionHolders(tree).flatMap((node) =>
      node.sessions.filter((ref) => !isPending(ref)).map((ref) => `${ref.brain}:${ref.id}`),
    ),
  );
  const history = new Map<string, SessionInfo[]>();
  for (const { node, ref } of pending) {
    const pane = panes.find((p) => p.pane === ref.pane && p.brain === ref.brain);
    let id = pane?.sessionId;
    if (!id && ref.started) {
      let candidates = history.get(ref.brain);
      if (!candidates) {
        candidates = await sessions({ cwd: tree.project.dir, brains: [ref.brain], headless: true, live: false });
        history.set(ref.brain, candidates);
      }
      // Match the earliest unclaimed conversation from this launch. In
      // particular, two launches in one folder must not both claim the newest.
      const from = Date.parse(ref.started) - 2000;
      id = candidates
        .filter(
          (s) =>
            s.interactive &&
            !used.has(`${ref.brain}:${s.id}`) &&
            Date.parse(s.startedAt ?? '') >= from &&
            Date.parse(s.startedAt ?? '') <= Date.parse(ref.started!) + 120_000,
        )
        .sort((a, b) => Date.parse(a.startedAt ?? '') - Date.parse(b.startedAt ?? ''))[0]?.id;
    }
    if (!id || used.has(`${ref.brain}:${id}`)) continue;
    if (pane) await setPaneSession(pane.pane, id);
    used.add(`${ref.brain}:${id}`);
    ref.id = id;
    attachSession(tree, node.id, ref);
    changed = true;
  }
  return changed;
}

export interface SleepRules {
  /** Minutes of quiet before a pane sleeps; 0 — never. */
  sleepAfter: number;
  /** Live panes of the project at most; 0 — no limit. */
  maxPanes: number;
}

/**
 * Which panes of the project go to sleep now, and why. Never one that works
 * or waits for you, never one on screen or open full screen.
 */
export function panesToSleep(
  panes: readonly Pane[],
  options: {
    dir: string;
    rules: SleepRules;
    /** Live state by session id, from the CLIs. */
    live: ReadonlyMap<string, SessionInfo>;
    /** The pane on screen. */
    watched?: string | undefined;
    now?: number;
  },
): { pane: Pane; reason: 'quiet' | 'limit' }[] {
  const now = options.now ?? Date.now();
  const own = panes.filter((p) => paneInProject(p, options.dir));
  const quietFor = (p: Pane) => now - Date.parse(p.activityAt ?? p.startedAt ?? new Date(now).toISOString());
  const restful = own.filter((p) => {
    if (p.attached || p.pane === options.watched) return false;
    // A pane without a conversation id cannot be resumed. Give a newly
    // started CLI at least a minute to initialise and publish its live state.
    if (!p.sessionId || quietFor(p) < 60_000) return false;
    const status = p.sessionId ? options.live.get(p.sessionId)?.live?.status : undefined;
    return status === 'idle';
  });
  restful.sort((a, b) => quietFor(b) - quietFor(a));
  const out: { pane: Pane; reason: 'quiet' | 'limit' }[] = [];
  if (options.rules.sleepAfter > 0) {
    for (const p of restful)
      if (quietFor(p) >= options.rules.sleepAfter * 60_000) out.push({ pane: p, reason: 'quiet' });
  }
  if (options.rules.maxPanes > 0) {
    let over = own.length - out.length - options.rules.maxPanes;
    for (const p of restful) {
      if (over <= 0) break;
      if (out.some((o) => o.pane === p)) continue;
      out.push({ pane: p, reason: 'limit' });
      over -= 1;
    }
  }
  return out;
}

/** «312 МБ», «1.4 ГБ». */
export function formatMemory(bytes: number | undefined): string {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  if (mb < 1000)
    return t('{n} МБ', {
      n: Math.round(mb),
    });
  return t('{n} ГБ', {
    n: (mb / 1024).toFixed(1),
  });
}
