/**
 * Letters handed to a running session with a prompt or between tool calls, and the Claude Code
 * hooks that use this delivery path.
 *
 * The deliverer (deliver.ts) waits for the end of a busy session's turn: a letter sent in the
 * middle of a long turn is read after it. It also cannot type into the person's own terminal.
 * CLIs with lifecycle hooks or plugins can read letters earlier:
 * - `deliverHookMail` is the shared mailbox step for any CLI (Claude Code, Codex, and future
 *   Antigravity / OpenCode hooks or plugins): under the mailbox lock it takes the node's fitting
 *   letters, hands the formatted block to the CLI, and marks them delivered once emitted.
 * - Claude Code and Codex share the same JSON hook shape (`PostToolUse` and `UserPromptSubmit`
 *   with `hookSpecificOutput.additionalContext`), driven by `JsonHookSpec` and `deliverMidTurn`.
 *
 * - The shell line tests the node's inbox flag (mailbox.ts) first and starts treeyard only when a
 *   letter waits: without letters, it costs a `[ -e … ]` on each event.
 * - It touches only sessions started from a node (`TREEYARD_NODE`), never others.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { t } from '../i18n/i18n.js';
import { letterBody } from '../model/mail.js';
import { INBOX, lowerFlag, markDelivered, queuedFor, withMailLock } from '../model/mailbox.js';
import { NODE_VAR, PROJECT_VAR } from '../model/notes.js';
import { atomicWrite, loadTree } from '../model/store.js';
import type { BrainId } from '../model/types.js';

/** What `treeyard hook claude mail` is called by: the settings entry is ours when its command has this. */
const CLAUDE_MARKER = 'treeyard hook claude mail';

/**
 * Builds the shell command a CLI hook runs. Everything before `treeyard` is shell builtins: no
 * process starts unless a letter waits for this very node. Silent and always successful — a
 * failing hook must never stop a prompt or tool call (exit 2 would) or fill the session's screen.
 */
export function hookShellCommand(marker: string): string {
  return (
    `[ -n "$${NODE_VAR}" ] && [ -e "$${PROJECT_VAR}/.tree/.local/mail/${INBOX}/$${NODE_VAR}" ]` +
    ` && command -v treeyard >/dev/null 2>&1 && ${marker} 2>/dev/null; exit 0`
  );
}

export const HOOK_COMMAND = hookShellCommand(CLAUDE_MARKER);

export const TOOL_EVENT = 'PostToolUse';
export const PROMPT_EVENT = 'UserPromptSubmit';
const EVENTS = [TOOL_EVENT, PROMPT_EVENT] as const;

/** Seconds the CLI lets the hook run. */
export const HOOK_TIMEOUT = 10;

export type HookScope = 'project' | 'user';
export type ClaudeScope = HookScope;
export type MailHookBrain = 'claude' | 'codex';

/** Claude Code's settings file: the project's local one (not in git), or the person's own. */
export function claudeSettingsFile(scope: ClaudeScope, project: string, env: NodeJS.ProcessEnv = process.env): string {
  if (scope === 'project') return join(project, '.claude', 'settings.local.json');
  const home = env.CLAUDE_CONFIG_DIR?.trim() || join(env.HOME?.trim() || homedir(), '.claude');
  return join(home, 'settings.json');
}

type Json = Record<string, unknown>;

export interface JsonHookSpec {
  brain: MailHookBrain;
  marker: string;
  command: string;
  excludePattern: string;
  fileOf(scope: HookScope, project: string, env: NodeJS.ProcessEnv): string;
  badHooksError(file: string): Error;
}

function readSettings(file: string): Json {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  if (!text.trim()) return {};
  const fail = () => {
    throw new Error(t('{file} — не JSON-объект: хук поставь сам или поправь файл', { file }));
  };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail();
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail();
  return data as Json;
}

type Entry = Json & { hooks?: Json[] };

function ownHooks(list: Entry[], marker: string): Json[] {
  const isOurs = (hook: Json) => typeof hook?.command === 'string' && hook.command.includes(marker);
  return list.flatMap((entry) => (Array.isArray(entry?.hooks) ? entry.hooks.filter(isOurs) : []));
}

function currentHook(hooks: Json[], command: string): boolean {
  return (
    hooks.length === 1 &&
    hooks[0]?.type === 'command' &&
    hooks[0].command === command &&
    hooks[0].timeout === HOOK_TIMEOUT
  );
}

function withoutOwnHooks(list: Entry[], marker: string): Entry[] {
  const isOurs = (hook: Json) => typeof hook?.command === 'string' && hook.command.includes(marker);
  return list.flatMap((entry) => {
    if (!Array.isArray(entry?.hooks) || !entry.hooks.some(isOurs)) return [entry];
    const rest = entry.hooks.filter((hook) => !isOurs(hook));
    return rest.length ? [{ ...entry, hooks: rest }] : [];
  });
}

export function jsonHookState(spec: JsonHookSpec, file: string): 'absent' | 'outdated' | 'installed' {
  try {
    const hooks = readSettings(file).hooks as Json | undefined;
    const ours = EVENTS.map((event) => {
      const list = hooks?.[event];
      return Array.isArray(list) ? ownHooks(list, spec.marker) : [];
    });
    if (ours.every((items) => currentHook(items, spec.command))) return 'installed';
    return ours.some((items) => items.length > 0) ? 'outdated' : 'absent';
  } catch {
    return 'absent';
  }
}

export type MailHookResult = { kind: 'installed' | 'updated' | 'already' | 'removed' | 'absent'; file: string };

/** Keeps a project-local hook file out of `git status` when it is neither tracked nor already ignored. */
export function keepOutOfGit(project: string, file: string, pattern: string, env: NodeJS.ProcessEnv): void {
  try {
    const run = (args: string[]) =>
      execFileSync('git', args, {
        cwd: project,
        env: { ...process.env, ...env },
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    try {
      run(['ls-files', '--error-unmatch', '--', file]);
      return;
    } catch {
      // Not tracked in git: check whether it is already ignored.
    }
    try {
      run(['check-ignore', '-q', '--no-index', file]);
      return;
    } catch (error) {
      // 1 — checked, not ignored; anything else (no repository, no git) — nothing to do here.
      if ((error as { status?: number }).status !== 1) return;
    }
    const exclude = resolve(project, run(['rev-parse', '--git-path', 'info/exclude']).trim());
    mkdirSync(dirname(exclude), { recursive: true });
    appendFileSync(
      exclude,
      `${existsSync(exclude) && !readFileSync(exclude, 'utf8').endsWith('\n') ? '\n' : ''}${pattern}\n`,
    );
  } catch {
    // Only a convenience.
  }
}

/** Installs or updates `PostToolUse` and `UserPromptSubmit` in a CLI's JSON hook file. */
export function installJsonMailHook(
  spec: JsonHookSpec,
  scope: HookScope,
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): MailHookResult {
  const file = spec.fileOf(scope, project, env);
  const settings = readSettings(file);
  if (
    settings.hooks !== undefined &&
    (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks))
  )
    throw spec.badHooksError(file);
  const hooks = (settings.hooks ?? {}) as Json;
  settings.hooks = hooks;
  let changed = false;
  let present = false;
  for (const event of EVENTS) {
    const list = hooks[event];
    if (list !== undefined && !Array.isArray(list)) throw spec.badHooksError(file);
    const entries = (list ?? []) as Entry[];
    const ours = ownHooks(entries, spec.marker);
    present ||= ours.length > 0;
    if (currentHook(ours, spec.command)) continue;
    changed = true;
    hooks[event] = [
      ...withoutOwnHooks(entries, spec.marker),
      {
        ...(event === TOOL_EVENT ? { matcher: '*' } : {}),
        hooks: [{ type: 'command', command: spec.command, timeout: HOOK_TIMEOUT }],
      },
    ];
  }
  if (!changed) return { kind: 'already', file };
  atomicWrite(file, `${JSON.stringify(settings, null, 2)}\n`);
  if (scope === 'project') keepOutOfGit(project, file, spec.excludePattern, env);
  return { kind: present ? 'updated' : 'installed', file };
}

/** Removes our hooks from both events and deletes the file if no settings remain. */
export function removeJsonMailHook(
  spec: JsonHookSpec,
  scope: HookScope,
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): MailHookResult {
  const file = spec.fileOf(scope, project, env);
  const settings = readSettings(file);
  const hooks = settings.hooks as Json | undefined;
  if (!hooks) return { kind: 'absent', file };
  let changed = false;
  for (const event of EVENTS) {
    const list = hooks[event];
    if (!Array.isArray(list) || !ownHooks(list, spec.marker).length) continue;
    changed = true;
    const kept = withoutOwnHooks(list, spec.marker);
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (!changed) return { kind: 'absent', file };
  if (!Object.keys(hooks).length) delete settings.hooks;
  if (Object.keys(settings).length) atomicWrite(file, `${JSON.stringify(settings, null, 2)}\n`);
  else unlinkSync(file);
  return { kind: 'removed', file };
}

export interface MailHookPlace {
  brain: MailHookBrain;
  scope: HookScope;
  file: string;
  installed: boolean;
  needsUpdate?: true;
}

export function jsonMailHookPlaces(
  spec: JsonHookSpec,
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): MailHookPlace[] {
  return (['project', 'user'] as const).map((scope) => {
    const file = spec.fileOf(scope, project, env);
    const state = jsonHookState(spec, file);
    return {
      brain: spec.brain,
      scope,
      file,
      installed: state !== 'absent',
      ...(state === 'outdated' ? { needsUpdate: true } : {}),
    };
  });
}

const CLAUDE_SPEC: JsonHookSpec = {
  brain: 'claude',
  marker: CLAUDE_MARKER,
  command: HOOK_COMMAND,
  excludePattern: '/.claude/settings.local.json',
  fileOf: claudeSettingsFile,
  badHooksError: (file) =>
    new Error(t('{file}: раздел hooks не в том виде, что читает Claude Code — поправь файл сам', { file })),
};

/** Whether there is any treeyard Claude Code hook to remove, including an old or partial installation. */
export function mailHookInstalled(file: string): boolean {
  return jsonHookState(CLAUDE_SPEC, file) !== 'absent';
}

/** Installs or updates both events in Claude Code's settings. */
export function installMailHook(
  scope: ClaudeScope,
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): MailHookResult {
  return installJsonMailHook(CLAUDE_SPEC, scope, project, env);
}

/** Removes our hooks from both events in Claude Code's settings and deletes the file if empty. */
export function removeMailHook(
  scope: ClaudeScope,
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): MailHookResult {
  return removeJsonMailHook(CLAUDE_SPEC, scope, project, env);
}

/** Where the Claude Code hook stands, in the project and in the person's own settings. */
export function mailHookPlaces(project: string, env: NodeJS.ProcessEnv = process.env): MailHookPlace[] {
  return jsonMailHookPlaces(CLAUDE_SPEC, project, env);
}

// ── Shared mailbox pickup & hook delivery ───────────────────────────────────

/** What Claude Code and Codex send a hook on stdin; the rest of it does not matter here. */
export interface HookInput {
  session_id?: string;
  hook_event_name?: string;
  /** Set inside a subagent of the session: letters are for the session itself. */
  agent_id?: string;
}

export function parseHookInput(text: string): HookInput {
  try {
    const data = JSON.parse(text) as unknown;
    if (!data || typeof data !== 'object') return {};
    const { session_id, hook_event_name, agent_id } = data as Record<string, unknown>;
    return {
      ...(typeof session_id === 'string' ? { session_id } : {}),
      ...(typeof hook_event_name === 'string' ? { hook_event_name } : {}),
      ...(typeof agent_id === 'string' && agent_id ? { agent_id } : {}),
    };
  } catch {
    return {};
  }
}

/** Hook context stays under 10 000 characters so the CLI never truncates or files it away. */
export const MAX_HOOK_CHARS = 9000;

export interface HookDeliveryOptions {
  /** Which CLI's hook or plugin is handing the letters over. */
  brain: BrainId;
  /** `prompt` — alongside a user prompt; `turn` — mid-turn between tool calls or before a model step. */
  how: 'turn' | 'prompt';
  sessionId?: string;
  /** True inside a subagent: letters belong to the node's own session, never its subagents. */
  subagent?: boolean;
  maxChars?: number;
  /** How long to wait for the mailbox lock before leaving delivery for later. */
  lockWaitMs?: number;
  /** Hands the formatted letter text to the CLI. Letters are marked only after this succeeds. */
  deliver(context: string): void;
}

/**
 * Shared mailbox pickup for any CLI hook or plugin: under the mailbox lock it takes the waiting
 * letters of `TREEYARD_NODE` that fit, formats them with their intro and sender lines, hands them
 * to `deliver`, and marks them delivered (`prompt` or `turn`).
 */
export async function deliverHookMail(env: NodeJS.ProcessEnv, options: HookDeliveryOptions): Promise<number[]> {
  const id = env[NODE_VAR]?.trim();
  const dir = env[PROJECT_VAR]?.trim();
  if (!id || !dir || options.subagent) return [];
  if (!queuedFor(dir, id).length) {
    // A flag left behind by a delivery that came another way.
    lowerFlag(dir, id);
    return [];
  }
  const tree = loadTree(dir);
  const maxChars = options.maxChars ?? MAX_HOOK_CHARS;
  return withMailLock(
    dir,
    async () => {
      const letters = queuedFor(dir, id);
      const fit: typeof letters = [];
      let size = 0;
      for (const letter of letters) {
        // A letter is never cut: one too long for the hook waits for the pane, or the next session.
        size += letter.text.length + 200;
        if (size > maxChars) break;
        fit.push(letter);
      }
      if (!fit.length) return [];
      const intro = hookLetterIntro(options.how, fit.length);
      options.deliver(`${intro}\n${letterBody(tree, fit)}`);
      const numbers = fit.map((letter) => letter.n);
      markDelivered(dir, numbers, options.how, {
        ...(options.sessionId ? { session: `${options.brain} ${options.sessionId.slice(0, 8)}` } : {}),
      });
      return numbers;
    },
    options.lockWaitMs ?? 2000,
  );
}

export function hookLetterIntro(how: 'turn' | 'prompt', count: number): string {
  if (how === 'prompt')
    return count === 1
      ? t('Вместе с запросом пришло письмо для этой сессии.')
      : t('Вместе с запросом пришли письма для этой сессии.');
  return count === 1
    ? t('Пока ты работал, пришло письмо — учти его в этой работе:')
    : t('Пока ты работал, пришли письма — учти их в этой работе:');
}

export interface MidTurnOptions {
  /** Which CLI ran the hook (`claude` by default; `codex` uses the same wire format). */
  brain?: MailHookBrain;
  /** Hands the model what the hook prints. Letters are marked only after this went out. */
  emit?(text: string): void;
  /** How long to wait for the mailbox lock before leaving delivery for later. */
  lockWaitMs?: number;
}

function printOut(text: string): void {
  writeSync(1, text);
}

/**
 * Hands node `TREEYARD_NODE`'s waiting letters to Claude Code or Codex as
 * `hookSpecificOutput.additionalContext` for `PostToolUse` or `UserPromptSubmit`.
 */
export async function deliverMidTurn(
  env: NodeJS.ProcessEnv,
  input: HookInput,
  options: MidTurnOptions = {},
): Promise<number[]> {
  const event = input.hook_event_name || TOOL_EVENT;
  if (event !== TOOL_EVENT && event !== PROMPT_EVENT) return [];
  const emit = options.emit ?? printOut;
  return deliverHookMail(env, {
    brain: options.brain ?? 'claude',
    how: event === PROMPT_EVENT ? 'prompt' : 'turn',
    ...(input.session_id ? { sessionId: input.session_id } : {}),
    subagent: Boolean(input.agent_id),
    ...(options.lockWaitMs !== undefined ? { lockWaitMs: options.lockWaitMs } : {}),
    deliver: (additionalContext) =>
      emit(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: event,
            additionalContext,
          },
        }),
      ),
  });
}
