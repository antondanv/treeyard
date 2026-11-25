/**
 * Sessions from the tree, through Brainyard. A session opened here is the
 * CLI's own — `claude --resume`, `codex resume`, `agy --conversation`,
 * `opencode --session` and Claude Code's picker show it — and the node
 * remembers it, so the next time you come to the node, the conversation is
 * one key away.
 */
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { delimiter, extname, isAbsolute, join, resolve } from 'node:path';
import {
  BRAINS,
  liveSessions,
  type OpenResult,
  open,
  type SessionInfo,
  sessions,
  stopSession,
} from '@antondanv/brainyard';
import { t } from '../i18n/i18n.js';
import { senderNode } from '../model/mail.js';
import { markDelivered } from '../model/mailbox.js';
import { AS_VAR, nodeEnv } from '../model/notes.js';
import { attachSession, setStatus } from '../model/ops.js';
import { nowIso } from '../model/time.js';
import { holderOf } from '../model/tree.js';
import { BRAIN_IDS, type BrainId, ROOT, type SessionRef, type StartMode, type Tree } from '../model/types.js';
import {
  saveMainBaseline,
  sessionFolder,
  sessionPlace,
  type WorktreeWish,
  worktreeDirs,
  worktreeNote,
} from '../worktree.js';
import { fullAccess } from './access.js';
import { sessionPlan } from './context.js';

export const BRAIN_LABEL: Record<BrainId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity',
  opencode: 'OpenCode',
};

export const BRAIN_SHORT: Record<BrainId, string> = {
  claude: 'claude',
  codex: 'codex',
  antigravity: 'agy',
  opencode: 'opencode',
};

const WINDOWS = process.platform === 'win32';

function isExecutable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (WINDOWS) return true;
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function binaryExists(cmd: string, env: NodeJS.ProcessEnv): boolean {
  if (!cmd) return false;
  const exts = WINDOWS ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const candidates = (base: string) => (WINDOWS && extname(base) ? [base] : exts.map((ext) => base + ext));
  if (isAbsolute(cmd) || cmd.includes('/') || (WINDOWS && cmd.includes('\\'))) {
    return candidates(resolve(cmd)).some(isExecutable);
  }
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  return dirs.some((dir) => candidates(join(dir, cmd)).some(isExecutable));
}

function parseEnvCommand(value: string): string[] {
  if (value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed) && parsed.every((part): part is string => typeof part === 'string')) return parsed;
    } catch {
      // Not JSON after all: treat it as a path, the same way Brainyard does.
    }
  }
  return [value];
}

/** Whether a CLI's binary is available (respecting `BRAINYARD_<ID>_BIN`, then PATH). */
export function isBrainInstalled(brain: BrainId, env: NodeJS.ProcessEnv = process.env): boolean {
  const { binary, envVar } = BRAINS[brain];
  const override = env[envVar]?.trim();
  const [head] = override ? parseEnvCommand(override) : [binary];
  return head ? binaryExists(head, env) : false;
}

/** First installed CLI found on PATH (or via BRAINYARD_*_BIN), in BRAIN_IDS order. */
export function installedBrain(env: NodeJS.ProcessEnv = process.env): BrainId | undefined {
  return BRAIN_IDS.find((brain) => isBrainInstalled(brain, env));
}

/** Valid BrainId from the current session's `TREEYARD_AS`, if any. */
export function envBrain(env: NodeJS.ProcessEnv = process.env): BrainId | undefined {
  const raw = env[AS_VAR]?.trim().toLowerCase();
  if (!raw) return undefined;
  return (BRAIN_IDS as readonly string[]).includes(raw) ? (raw as BrainId) : undefined;
}

/**
 * Neutral default CLI when `--brain` is not passed:
 * the project's `brain:`, otherwise the current session's CLI (`TREEYARD_AS`),
 * otherwise the first installed CLI, otherwise `BRAIN_IDS[0]` as a deterministic fallback.
 */
export function defaultBrain(projectBrain?: BrainId, env: NodeJS.ProcessEnv = process.env): BrainId {
  return projectBrain ?? envBrain(env) ?? installedBrain(env) ?? BRAIN_IDS[0]!;
}

/** How to open a session by hand, in the project's folder. */
export function resumeCommand(brain: BrainId, id: string): string {
  if (brain === 'claude') return `claude --resume ${id}`;
  if (brain === 'codex') return `codex resume ${id}`;
  if (brain === 'opencode') return `opencode --session ${id}`;
  return `agy --conversation ${id}`;
}

/** OpenCode picks its reasoning variant inside a session (ctrl+t): its command line takes no effort. */
export function sessionEffort(brain: BrainId): boolean {
  return brain !== 'opencode';
}

export interface LaunchOptions {
  brain: BrainId;
  start: StartMode;
  /** Claude Code only: start in the background and come back at once. */
  background?: boolean;
  model?: string;
  effort?: string;
  /**
   * In the node's own git worktree (made if need be): true; in the project's folder: false; `auto` —
   * in a worktree if one can be made; not said — in the worktree the node already has, else in the folder.
   */
  worktree?: WorktreeWish;
  /** In a pane next to the tree (tmux), not in this terminal. */
  pane?: boolean;
  /** A coordinator's assignment, added to the session's first message. */
  task?: string;
}

export interface Launched {
  result: OpenResult;
  ref?: SessionRef;
}

/** Opens a new session for a node, or for the whole project (`root`). In the terminal it returns when the person exits the CLI. */
export async function launch(tree: Tree, id: string, options: LaunchOptions): Promise<Launched> {
  const node = holderOf(tree, id);
  if (!node)
    throw new Error(
      t('нет узла {id}', {
        id,
      }),
    );
  const place = await sessionPlace(tree, id, options.worktree);
  if (!place.worktree && id !== ROOT) saveMainBaseline(tree.project.dir, id);
  const plan = sessionPlan(tree, id, options.start, options.brain, options.task, senderNode(tree));
  const result = await open({
    brain: options.brain,
    cwd: place.dir,
    // Only Claude Code takes a name; the others title a session after its first message.
    ...(options.brain === 'claude' ? { name: plan.name } : {}),
    system: place.worktree ? `${plan.system}\n\n${worktreeNote(place.worktree, tree.project.dir)}` : plan.system,
    ...(plan.prompt ? { prompt: plan.prompt } : {}),
    ...(plan.permissionMode ? { permissionMode: plan.permissionMode } : {}),
    ...(plan.extraArgs ? { extraArgs: plan.extraArgs } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.effort ? { effort: options.effort } : {}),
    ...(options.background ? { background: true } : {}),
    env: nodeEnv(id, tree.project.dir, options.brain),
  });
  if (place.warnings.length) result.warnings = [...(result.warnings ?? []), ...place.warnings];
  if (!result.sessionId) return { result };
  const ref: SessionRef = {
    brain: options.brain,
    id: result.sessionId,
    name: plan.name,
    started: nowIso(new Date(result.startedAt)),
    mode: options.background ? 'background' : 'terminal',
    ...(place.worktree ? { dir: place.dir } : {}),
  };
  const how = options.background ? t('в фоне') : t('в терминале');
  if (plan.letters?.length)
    markDelivered(tree.project.dir, plan.letters, 'first', { session: `${options.brain} ${ref.id.slice(0, 8)}` });
  attachSession(
    tree,
    id,
    ref,
    t('новая сессия {how} ({p2})', {
      how,
      p2: plan.start === 'goal' ? '/goal' : plan.start,
    }) + (place.worktree ? t(' в worktree {branch}', { branch: place.worktree.branch }) : ''),
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
    cwd: sessionFolder(tree.project.dir, ref),
    resume: ref.id,
    ...fullAccess(ref.brain, tree.project.dir),
    env: nodeEnv(id, tree.project.dir, ref.brain),
  });
  if (holderOf(tree, id)) attachSession(tree, id, { ...ref, opened: nowIso() });
  return result;
}

/** Opens any session of the project (one that no node holds yet). */
export async function resumeLoose(tree: Tree, session: SessionInfo): Promise<OpenResult> {
  // No node's session: not even the one this process may have inherited.
  return open({
    brain: session.brain,
    cwd: session.cwd && existsSync(session.cwd) ? session.cwd : tree.project.dir,
    resume: session.id,
    ...fullAccess(session.brain, tree.project.dir),
    env: nodeEnv(''),
  });
}

/** Live state of the sessions on this machine — Claude Code, Codex, Antigravity, OpenCode — by session id. */
export async function liveById(): Promise<Map<string, SessionInfo>> {
  const list = await liveSessions({ panes: {} });
  return new Map(list.map((session) => [session.id, session]));
}

/** Native background sessions stop through their CLI, without removing the node's conversation. */
export async function sleepBackground(tree: Tree, session: SessionRef | SessionInfo): Promise<void> {
  const cwd = ('dir' in session ? session.dir : undefined) ?? ('cwd' in session ? session.cwd : undefined);
  await stopSession({ brain: session.brain, sessionId: session.id, cwd: cwd ?? tree.project.dir });
}

/** Every session of the project folder and of its worktrees, across the CLIs, with live state. */
export async function projectSessions(tree: Tree): Promise<SessionInfo[]> {
  const dirs = [tree.project.dir, ...worktreeDirs(tree.project.dir)];
  if (dirs.length === 1) return sessions({ cwd: tree.project.dir, limit: 100 });
  const lists = await Promise.all(dirs.map((cwd) => sessions({ cwd, limit: 100 })));
  const unique = new Map<string, SessionInfo>();
  for (const session of lists.flat()) unique.set(`${session.brain}:${session.id}`, session);
  return [...unique.values()]
    .sort((a, b) => Date.parse(b.updatedAt ?? b.startedAt ?? '') - Date.parse(a.updatedAt ?? a.startedAt ?? ''))
    .slice(0, 100);
}

export { sessionOwners } from '../model/tree.js';
