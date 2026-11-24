/**
 * Letters for a Claude Code session, handed over with a prompt or between tool calls.
 *
 * The deliverer (deliver.ts) waits for the end of a busy session's turn: a letter sent in the
 * middle of a long turn is read after it. It also cannot type into the person's own terminal.
 * Claude Code can read `additionalContext` from PostToolUse within a turn, or from UserPromptSubmit
 * alongside the submitted prompt. Both hooks take the node's letters from the mailbox and mark
 * them delivered after printing them for the model.
 *
 * - The hook is a shell line that tests the node's inbox flag (mailbox.ts) first and starts treeyard
 *   only when a letter waits: without letters, it costs a `[ -e … ]` on each event.
 * - It touches only sessions started from a node (`TREEYARD_NODE`), never others.
 * - Both live in the project's `.claude/settings.local.json` (git does not see it) unless the person
 *   asks for `--user`; `treeyard hook claude remove` takes them out and leaves the rest of the file.
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

/** What `treeyard hook claude mail` is called by: the settings entry is ours when its command has this. */
const MARKER = 'treeyard hook claude mail';

/**
 * The hook's command. Everything before `treeyard` is shell builtins: no process starts unless a
 * letter waits for this very node. Silent and always successful — a failing hook must never
 * stop a prompt or tool call (exit 2 would) or fill the session's screen.
 */
export const HOOK_COMMAND =
  `[ -n "$${NODE_VAR}" ] && [ -e "$${PROJECT_VAR}/.tree/.local/mail/${INBOX}/$${NODE_VAR}" ]` +
  ` && command -v treeyard >/dev/null 2>&1 && ${MARKER} 2>/dev/null; exit 0`;

const TOOL_EVENT = 'PostToolUse';
const PROMPT_EVENT = 'UserPromptSubmit';
const EVENTS = [TOOL_EVENT, PROMPT_EVENT] as const;
type HookEvent = (typeof EVENTS)[number];

/** Seconds Claude Code lets the hook run. */
const TIMEOUT = 10;

export type ClaudeScope = 'project' | 'user';

/** Claude Code's settings file: the project's local one (not in git), or the person's own. */
export function claudeSettingsFile(scope: ClaudeScope, project: string, env: NodeJS.ProcessEnv = process.env): string {
  if (scope === 'project') return join(project, '.claude', 'settings.local.json');
  const home = env.CLAUDE_CONFIG_DIR?.trim() || join(env.HOME?.trim() || homedir(), '.claude');
  return join(home, 'settings.json');
}

type Json = Record<string, unknown>;

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

const isOurs = (hook: Json) => typeof hook?.command === 'string' && hook.command.includes(MARKER);

function ownHooks(list: Entry[]): Json[] {
  return list.flatMap((entry) => (Array.isArray(entry?.hooks) ? entry.hooks.filter(isOurs) : []));
}

function currentHook(hooks: Json[]): boolean {
  return (
    hooks.length === 1 &&
    hooks[0]?.type === 'command' &&
    hooks[0].command === HOOK_COMMAND &&
    hooks[0].timeout === TIMEOUT
  );
}

function withoutOwnHooks(list: Entry[]): Entry[] {
  return list.flatMap((entry) => {
    if (!Array.isArray(entry?.hooks) || !entry.hooks.some(isOurs)) return [entry];
    const rest = entry.hooks.filter((hook) => !isOurs(hook));
    return rest.length ? [{ ...entry, hooks: rest }] : [];
  });
}

function hookState(file: string): 'absent' | 'outdated' | 'installed' {
  try {
    const hooks = readSettings(file).hooks as Json | undefined;
    const ours = EVENTS.map((event) => {
      const list = hooks?.[event];
      return Array.isArray(list) ? ownHooks(list) : [];
    });
    if (ours.every(currentHook)) return 'installed';
    return ours.some((items) => items.length > 0) ? 'outdated' : 'absent';
  } catch {
    return 'absent';
  }
}

/** Whether there is any treeyard hook to remove, including an old or partial installation. */
export function mailHookInstalled(file: string): boolean {
  return hookState(file) !== 'absent';
}

export type MailHookResult = { kind: 'installed' | 'updated' | 'already' | 'removed' | 'absent'; file: string };

/** Keeps `.claude/settings.local.json` out of `git status`: Claude Code's own habit, in case the machine lacks it. */
function keepOutOfGit(project: string, file: string, env: NodeJS.ProcessEnv): void {
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
      `${existsSync(exclude) && !readFileSync(exclude, 'utf8').endsWith('\n') ? '\n' : ''}/.claude/settings.local.json\n`,
    );
  } catch {
    // Only a convenience.
  }
}

/** Installs or updates both events in Claude Code's settings. */
export function installMailHook(
  scope: ClaudeScope,
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): MailHookResult {
  const file = claudeSettingsFile(scope, project, env);
  const settings = readSettings(file);
  const bad = () =>
    new Error(t('{file}: раздел hooks не в том виде, что читает Claude Code — поправь файл сам', { file }));
  if (
    settings.hooks !== undefined &&
    (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks))
  )
    throw bad();
  const hooks = (settings.hooks ?? {}) as Json;
  settings.hooks = hooks;
  let changed = false;
  let present = false;
  for (const event of EVENTS) {
    const list = hooks[event];
    if (list !== undefined && !Array.isArray(list)) throw bad();
    const entries = (list ?? []) as Entry[];
    const ours = ownHooks(entries);
    present ||= ours.length > 0;
    if (currentHook(ours)) continue;
    changed = true;
    hooks[event] = [
      ...withoutOwnHooks(entries),
      {
        ...(event === TOOL_EVENT ? { matcher: '*' } : {}),
        hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: TIMEOUT }],
      },
    ];
  }
  if (!changed) return { kind: 'already', file };
  atomicWrite(file, `${JSON.stringify(settings, null, 2)}\n`);
  if (scope === 'project') keepOutOfGit(project, file, env);
  return { kind: present ? 'updated' : 'installed', file };
}

/** Removes our hooks from both events and deletes the file if no settings remain. */
export function removeMailHook(
  scope: ClaudeScope,
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): MailHookResult {
  const file = claudeSettingsFile(scope, project, env);
  const settings = readSettings(file);
  const hooks = settings.hooks as Json | undefined;
  if (!hooks) return { kind: 'absent', file };
  let changed = false;
  for (const event of EVENTS) {
    const list = hooks[event];
    if (!Array.isArray(list) || !ownHooks(list).length) continue;
    changed = true;
    const kept = withoutOwnHooks(list);
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
  scope: ClaudeScope;
  file: string;
  installed: boolean;
  needsUpdate?: true;
}

/** Where the hook stands, in the project and in the person's own settings. */
export function mailHookPlaces(project: string, env: NodeJS.ProcessEnv = process.env): MailHookPlace[] {
  return (['project', 'user'] as const).map((scope) => {
    const file = claudeSettingsFile(scope, project, env);
    const state = hookState(file);
    return { scope, file, installed: state !== 'absent', ...(state === 'outdated' ? { needsUpdate: true } : {}) };
  });
}

// ── What the hook does ─────────────────────────────────────────────────────

/** What Claude Code sends a hook on stdin; the rest of it does not matter here. */
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

/** Claude Code takes 10 000 characters of context from a hook and files the rest away; letters stay under that. */
const MAX_CHARS = 9000;

export interface MidTurnOptions {
  /** Hands the model what the hook prints. Letters are marked only after this went out. */
  emit?(text: string): void;
  /** How long to wait for the mailbox lock before leaving delivery for later. */
  lockWaitMs?: number;
}

function printOut(text: string): void {
  writeSync(1, text);
}

/**
 * The hook hands node `TREEYARD_NODE`'s waiting letters to the model as context for the event.
 * Returns the numbers of the letters handed over;
 * none — no letter, no node, or nothing that fits. Under the mailbox lock, like every delivery: the
 * deliverer must not type a letter the hook is handing over, nor the hook one just typed.
 */
export async function deliverMidTurn(
  env: NodeJS.ProcessEnv,
  input: HookInput,
  options: MidTurnOptions = {},
): Promise<number[]> {
  const id = env[NODE_VAR]?.trim();
  const dir = env[PROJECT_VAR]?.trim();
  if (!id || !dir || input.agent_id) return [];
  const event = input.hook_event_name || TOOL_EVENT;
  if (event !== TOOL_EVENT && event !== PROMPT_EVENT) return [];
  if (!queuedFor(dir, id).length) {
    // A flag left behind by a delivery that came another way.
    lowerFlag(dir, id);
    return [];
  }
  const tree = loadTree(dir);
  const emit = options.emit ?? printOut;
  return withMailLock(
    dir,
    async () => {
      const letters = queuedFor(dir, id);
      const fit: typeof letters = [];
      let size = 0;
      for (const letter of letters) {
        // A letter is never cut: one too long for the hook waits for the pane, or the next session.
        size += letter.text.length + 200;
        if (size > MAX_CHARS) break;
        fit.push(letter);
      }
      if (!fit.length) return [];
      const intro = letterIntro(event, fit.length);
      emit(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: event,
            additionalContext: `${intro}\n${letterBody(tree, fit)}`,
          },
        }),
      );
      const numbers = fit.map((letter) => letter.n);
      markDelivered(dir, numbers, event === PROMPT_EVENT ? 'prompt' : 'turn', {
        ...(input.session_id ? { session: `claude ${input.session_id.slice(0, 8)}` } : {}),
      });
      return numbers;
    },
    options.lockWaitMs ?? 2000,
  );
}

function letterIntro(event: HookEvent, count: number): string {
  if (event === PROMPT_EVENT)
    return count === 1
      ? t('Вместе с запросом пришло письмо для этой сессии.')
      : t('Вместе с запросом пришли письма для этой сессии.');
  return count === 1
    ? t('Пока ты работал, пришло письмо — учти его в этой работе:')
    : t('Пока ты работал, пришли письма — учти их в этой работе:');
}
