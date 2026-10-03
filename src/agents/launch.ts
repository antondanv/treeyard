/**
 * Sessions from the tree, through Brainyard. A session opened here is the
 * CLI's own — `claude --resume`, `codex resume`, `agy --conversation` and
 * Claude Code's picker show it — and the node remembers it, so the next time
 * you come to the node, the conversation is one key away.
 */
import { liveSessions, type OpenResult, open, type SessionInfo, sessions, stopSession } from '@antondanv/brainyard';
import { t } from '../i18n/i18n.js';
import { nodeEnv } from '../model/notes.js';
import { attachSession, setStatus } from '../model/ops.js';
import { nowIso } from '../model/time.js';
import type { BrainId, SessionRef, StartMode, Tree } from '../model/types.js';
import { fullAccess, sessionPlan } from './context.js';

export const BRAIN_LABEL: Record<BrainId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
};

export const BRAIN_SHORT: Record<BrainId, string> = {
  claude: 'claude',
  codex: 'codex',
  antigravity: 'agy',
};

export interface LaunchOptions {
  brain: BrainId;
  start: StartMode;
  /** Claude Code only: start in the background and come back at once. */
  background?: boolean;
  model?: string;
  effort?: string;
  /** Claude Code only: work in a new git worktree. */
  worktree?: boolean;
  /** In a pane next to the tree (tmux), not in this terminal. */
  pane?: boolean;
}

export interface Launched {
  result: OpenResult;
  ref?: SessionRef;
}

/** Opens a new session for a node. In the terminal it returns when the person exits the CLI. */
export async function launch(tree: Tree, id: string, options: LaunchOptions): Promise<Launched> {
  const node = tree.nodes.get(id);
  if (!node)
    throw new Error(
      t('нет узла {id}', {
        id,
      }),
    );
  const plan = sessionPlan(tree, id, options.start, options.brain);
  const result = await open({
    brain: options.brain,
    cwd: tree.project.dir,
    // Only Claude Code takes a name; the others title a session after its first message.
    ...(options.brain === 'claude' ? { name: plan.name } : {}),
    system: plan.system,
    ...(plan.prompt ? { prompt: plan.prompt } : {}),
    ...(plan.permissionMode ? { permissionMode: plan.permissionMode } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.effort ? { effort: options.effort } : {}),
    ...(options.background ? { background: true } : {}),
    ...(options.worktree ? { worktree: true } : {}),
    env: nodeEnv(id),
  });
  if (!result.sessionId) return { result };
  const ref: SessionRef = {
    brain: options.brain,
    id: result.sessionId,
    name: plan.name,
    started: nowIso(new Date(result.startedAt)),
    mode: options.background ? 'background' : 'terminal',
  };
  const how = options.background ? t('в фоне') : t('в терминале');
  attachSession(
    tree,
    id,
    ref,
    t('новая сессия {how} ({p2})', {
      how,
      p2: plan.start === 'goal' ? '/goal' : plan.start,
    }),
  );
  // Opening a session is starting the work.
  const current = tree.nodes.get(id);
  if (current && (current.status === 'todo' || current.status === 'idea')) {
    setStatus(tree, id, 'active', { source: options.brain });
  }
  return { result, ref };
}

/** Opens a node's session again; a running background session is attached to. */
export async function resume(tree: Tree, id: string, ref: SessionRef): Promise<OpenResult> {
  const result = await open({
    brain: ref.brain,
    cwd: tree.project.dir,
    resume: ref.id,
    ...fullAccess(ref.brain),
    env: nodeEnv(id),
  });
  if (tree.nodes.has(id)) attachSession(tree, id, { ...ref, opened: nowIso() });
  return result;
}

/** Opens any session of the project (one that no node holds yet). */
export async function resumeLoose(tree: Tree, session: SessionInfo): Promise<OpenResult> {
  // No node's session: not even the one this process may have inherited.
  return open({
    brain: session.brain,
    cwd: tree.project.dir,
    resume: session.id,
    ...fullAccess(session.brain),
    env: nodeEnv(''),
  });
}

/** Live state of the sessions on this machine — Claude Code, Codex, Antigravity — by session id. */
export async function liveById(): Promise<Map<string, SessionInfo>> {
  const list = await liveSessions({ panes: {} });
  return new Map(list.map((session) => [session.id, session]));
}

/** Native background sessions stop through their CLI, without removing the node's conversation. */
export async function sleepBackground(tree: Tree, session: SessionRef | SessionInfo): Promise<void> {
  await stopSession({ brain: session.brain, sessionId: session.id, cwd: tree.project.dir });
}

/** Every session of the project folder, across the CLIs, with live state. */
export async function projectSessions(tree: Tree): Promise<SessionInfo[]> {
  return sessions({ cwd: tree.project.dir, limit: 100 });
}

export { sessionOwners } from '../model/tree.js';
