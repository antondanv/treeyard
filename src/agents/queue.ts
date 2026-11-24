/**
 * `treeyard queue`: the coordinator's queue, kept by treeyard instead of the coordinator's chat.
 * Nodes start one after another, at most `parallel` at a time; the next one starts when a running
 * node leaves «в работе» or its session ends. A node that needs another node of the tree waits for
 * it to reach review or done. When the CLI's subscription window is nearly used up, nothing new
 * starts until the window resets. Running it again picks up the nodes already at work, so «stop
 * starting» is Ctrl+C and «go on» is the same command.
 */
import { type LimitWindow, usage } from '@antondanv/brainyard';

import { isSameTree, parseRef } from '../model/links.js';
import { loadTree } from '../model/store.js';
import { childrenByOrder } from '../model/tree.js';
import type { BrainId, Status, Tree, TreeNode } from '../model/types.js';
import { watchTree } from '../watch.js';
import { worktreeFor } from '../worktree.js';
import type { LaunchOptions } from './launch.js';
import { paneInProject } from './panes.js';
import {
  GRACE_MS,
  INTERVAL_MS,
  look,
  lookOverlaps,
  type OverlapLook,
  type SessionSight,
  SOURCES,
  type WaitSources,
} from './wait.js';

/** What happened, a line each. */
export type QueueEvent =
  | { type: 'start'; node: string; title: string; session: string | null; pane: string | null }
  | { type: 'fail'; node: string; title: string; error: string }
  /** The node left «в работе», or its session ended without leaving it: its slot is free. */
  | { type: 'done'; node: string; title: string; status: Status; ended: boolean }
  /** Its session ended its turn or waits for the person while the node is still at work. */
  | { type: 'asks'; node: string; title: string; state: 'idle' | 'waiting'; waitingFor?: string }
  /** Nothing starts until the window resets. */
  | { type: 'limit'; brain: BrainId; window: string; utilization: number; resetsAt: number | null }
  | { type: 'resume'; brain: BrainId }
  /** It could not start and nothing it waits for is moving. */
  | { type: 'blocked'; node: string; title: string; reason: string }
  /** Two nodes' worktrees change the same files (new ones since the last event for this pair). */
  | { type: 'overlap'; a: string; aTitle: string; b: string; bTitle: string; files: string[] }
  /** `stopped` — interrupted (Ctrl+C): the same command again picks up the nodes at work. */
  | { type: 'end'; started: number; finished: number; blocked: number; stopped: boolean };

export interface QueueSources extends WaitSources {
  /** Starts a session in the node; the node is «в работе» after it. */
  start(tree: Tree, id: string, options: LaunchOptions): Promise<{ session?: string; pane?: string }>;
  /** The CLI's subscription windows; null when it has none to tell. */
  limits(brain: BrainId): Promise<LimitWindow[] | null>;
}

export interface QueueOptions {
  launch: LaunchOptions;
  /** Sessions at a time. */
  parallel: number;
  /** Live panes of the project at most (`max_panes`); 0 — no limit. Panes only. */
  maxPanes?: number;
  /** A window this full stops new starts: 0.9 is 90%. */
  limit?: number;
  intervalMs?: number;
  graceMs?: number;
  sources: QueueSources;
  onEvent(event: QueueEvent): void;
  signal?: AbortSignal;
}

export const LIMIT = 0.9;

/** `queue <parent>` — its open children in their order; several ids — as given. */
export function queueNodes(tree: Tree, ids: readonly string[]): string[] {
  if (ids.length === 1) {
    const kids = childrenByOrder(tree, ids[0]!).filter(
      (kid) => (kid.status === 'todo' || kid.status === 'active') && kid.who !== 'human',
    );
    if (kids.length) return kids.map((kid) => kid.id);
  }
  return [...ids];
}

/** The nodes of this tree that `node` waits for and that have not reached review or done. */
function unmetNeeds(tree: Tree, node: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  for (const ref of node.needs ?? []) {
    if (!isSameTree(tree.project.dir, ref)) continue;
    const id = parseRef(ref)?.id;
    const need = id ? tree.nodes.get(id) : undefined;
    if (need && need.status !== 'review' && need.status !== 'done' && need.status !== 'dropped') out.push(need);
  }
  return out;
}

/** The window that stops new starts now, if any: full enough and not reset yet. */
export function fullWindow(windows: LimitWindow[] | null, limit: number, now: number): LimitWindow | undefined {
  return (windows ?? [])
    .filter((w) => w.utilization >= limit && (w.resetsAt === undefined || w.resetsAt * 1000 > now))
    .sort((a, b) => (b.resetsAt ?? Number.POSITIVE_INFINITY) - (a.resetsAt ?? Number.POSITIVE_INFINITY))[0];
}

const LIMITS_EVERY_MS = 60_000;

/** Runs the queue until every node has had its turn or is blocked. Resolves with the last event. */
export async function runQueue(dir: string, ids: readonly string[], options: QueueOptions): Promise<QueueEvent> {
  const { sources, launch } = options;
  const interval = options.intervalMs ?? INTERVAL_MS;
  const grace = options.graceMs ?? GRACE_MS;
  const limit = options.limit ?? LIMIT;
  const emit = options.onEvent;
  const order = queueNodes(sources.load(dir), ids);
  const from = new Map<string, Status>();
  /** Nodes whose session ended while they stayed «в работе»: done for the queue. */
  const ended = new Set<string>();
  const asked = new Map<string, string>();
  const worked = new Set<string>();
  const overlapLook: OverlapLook = { found: [] };
  /** `a|b|file` of the overlaps already printed. */
  const shown = new Set<string>();
  let started = 0;
  let finished = 0;
  let paused: string | undefined;
  let limits: { at: number; windows: LimitWindow[] | null } | undefined;
  let wake: (() => void) | undefined;
  const watcher = sources.watch(dir, () => wake?.());
  const stop = () => wake?.();
  options.signal?.addEventListener('abort', stop);
  const finish = (blocked: number, stopped = false): QueueEvent => {
    const event: QueueEvent = { type: 'end', started, finished, blocked, stopped };
    emit(event);
    return event;
  };
  try {
    for (;;) {
      if (options.signal?.aborted) return finish(0, true);
      const tree = sources.load(dir);
      const nodes = order.map((id) => tree.nodes.get(id)).filter((node): node is TreeNode => Boolean(node));
      // At work now: started by this queue or before it (a run picked up again).
      const active = nodes.filter((node) => node.status === 'active' && !ended.has(node.id));
      for (const node of nodes) if (!from.has(node.id) && node.status === 'active') from.set(node.id, 'active');
      const sights = active.length
        ? await look(
            dir,
            active.map((node) => node.id),
            from,
            grace,
            sources,
            worked,
          )
        : [];
      // Two nodes in one file: said once per file, and the sessions of both get a letter (see overlap.ts).
      for (const overlap of await lookOverlaps(dir, order, sources, overlapLook)) {
        const [a, b] = overlap.nodes;
        const fresh = overlap.files.filter((file) => !shown.has(`${a.id}|${b.id}|${file}`));
        if (!fresh.length) continue;
        for (const file of fresh) shown.add(`${a.id}|${b.id}|${file}`);
        emit({ type: 'overlap', a: a.id, aTitle: a.title, b: b.id, bTitle: b.title, files: fresh });
      }
      let running = 0;
      for (const sight of sights) {
        const session: SessionSight | undefined = sight.session;
        if (sight.reason === 'status') continue;
        if (sight.reason === 'gone') {
          ended.add(sight.id);
          finished++;
          emit({ type: 'done', node: sight.id, title: sight.title, status: sight.status, ended: true });
          continue;
        }
        running++;
        if ((sight.reason === 'idle' || sight.reason === 'waiting') && session) {
          const key = `${sight.reason}:${session.waitingFor ?? ''}`;
          if (asked.get(sight.id) !== key) {
            asked.set(sight.id, key);
            emit({
              type: 'asks',
              node: sight.id,
              title: sight.title,
              state: sight.reason,
              ...(session.waitingFor ? { waitingFor: session.waitingFor } : {}),
            });
          }
        } else asked.delete(sight.id);
      }
      // Left «в работе» since the last look: its slot is free.
      for (const node of nodes)
        if (from.get(node.id) === 'active' && node.status !== 'active' && !ended.has(node.id)) {
          from.set(node.id, node.status);
          finished++;
          emit({ type: 'done', node: node.id, title: node.title, status: node.status, ended: false });
        }

      const waiting = nodes.filter((node) => node.status === 'todo' && !ended.has(node.id));
      const ready = waiting.filter((node) => unmetNeeds(tree, node).length === 0);
      let free = Math.max(0, options.parallel - running);
      if (launch.pane && options.maxPanes) {
        const panes = await sources.panes().catch(() => []);
        const own = panes.filter((pane) => paneInProject(pane, dir)).length;
        free = Math.min(free, Math.max(0, options.maxPanes - own));
      }
      if (free > 0 && ready.length) {
        const now = sources.now();
        if (!limits || now - limits.at >= LIMITS_EVERY_MS)
          limits = { at: now, windows: await sources.limits(launch.brain).catch(() => null) };
        const full = fullWindow(limits.windows, limit, now);
        if (full) {
          const key = `${full.window}:${full.resetsAt ?? ''}`;
          if (paused !== key) {
            paused = key;
            emit({
              type: 'limit',
              brain: launch.brain,
              window: full.window,
              utilization: full.utilization,
              resetsAt: full.resetsAt ?? null,
            });
          }
        } else {
          if (paused) emit({ type: 'resume', brain: launch.brain });
          paused = undefined;
          // The project's folder holds one session; with the slots in parallel, every other node
          // works in a worktree of its own — unless the person said where (--worktree, --no-worktree).
          let mainTaken = nodes.some(
            (other) => other.status === 'active' && !ended.has(other.id) && !worktreeFor(dir, other.id),
          );
          for (const node of ready.slice(0, free)) {
            try {
              const own = Boolean(worktreeFor(dir, node.id));
              const wanted = launch.worktree ?? (options.parallel > 1 && mainTaken && !own ? 'auto' : undefined);
              const { worktree: _asked, ...rest } = launch;
              const got = await sources.start(
                sources.load(dir),
                node.id,
                wanted === undefined ? rest : { ...rest, worktree: wanted },
              );
              if (wanted !== true && !own) mainTaken = true;
              started++;
              from.set(node.id, 'active');
              emit({
                type: 'start',
                node: node.id,
                title: node.title,
                session: got.session ?? null,
                pane: got.pane ?? null,
              });
            } catch (error) {
              // A node that will not start is not retried in a loop: it is blocked.
              ended.add(node.id);
              emit({
                type: 'fail',
                node: node.id,
                title: node.title,
                error: (error as Error).message ?? String(error),
              });
            }
          }
          continue;
        }
      }
      // Nothing at work and nothing that can start: what is left waits for nodes that do not move.
      if (running === 0 && !paused && ready.length === 0) {
        // A need somebody is working on outside the queue will come: then the queue waits for it.
        const moving = waiting.some((node) => unmetNeeds(tree, node).some((need) => need.status === 'active'));
        if (!moving) {
          for (const node of waiting)
            emit({
              type: 'blocked',
              node: node.id,
              title: node.title,
              reason: unmetNeeds(tree, node)
                .map((need) => `«${need.title}»`)
                .join(', '),
            });
          return finish(waiting.length);
        }
      }
      await new Promise<void>((done) => {
        const timer = setTimeout(done, interval);
        wake = () => {
          clearTimeout(timer);
          done();
        };
      });
      wake = undefined;
    }
  } finally {
    watcher.stop();
    options.signal?.removeEventListener('abort', stop);
  }
}

/** Brainyard as the queue uses it, on top of what `wait` reads. */
export function queueSources(start: QueueSources['start']): QueueSources {
  return {
    ...SOURCES,
    load: loadTree,
    watch: (dir, wake) => watchTree(dir, wake),
    start,
    // Saved stores only: no model call, no quota request.
    limits: async (brain) => (await usage({ brains: [brain], limit: 0, offline: true })).brains[0]?.limits ?? null,
  };
}
