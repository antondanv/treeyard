/**
 * Letters for a session at work, handed over between two of its tool calls.
 *
 * The deliverer (deliver.ts) waits for the end of a busy session's turn: a letter sent in the
 * middle of a long turn is read after it. Claude Code can do better — its hooks run around every
 * tool call, and a PostToolUse hook may hand the model text as `additionalContext`, which it reads
 * on its next model request, in the same turn. So treeyard puts one hook into Claude Code's
 * settings: it takes the session node's waiting letters from the mailbox, prints them for the model
 * and marks them delivered «посреди хода»; the deliverer then finds nothing left to type.
 *
 * - The hook is a shell line that tests the node's inbox flag (mailbox.ts) first and starts treeyard
 *   only when a letter waits: the line runs before every tool call, and costs a `[ -e … ]` without letters.
 * - It touches only sessions started from a node (`TREEYARD_NODE`), never others.
 * - It lives in the project's `.claude/settings.local.json` (git does not see it) unless the person
 *   asks for `--user`; `treeyard hook claude remove` takes it out and leaves the rest of the file.
 * - Without it nothing changes: the letter comes after the turn, as before.
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
 * stop a tool call (exit 2 would) or fill the session's screen.
 */
export const HOOK_COMMAND =
  `[ -n "$${NODE_VAR}" ] && [ -e "$${PROJECT_VAR}/.tree/.local/mail/${INBOX}/$${NODE_VAR}" ]` +
  ` && command -v treeyard >/dev/null 2>&1 && ${MARKER} 2>/dev/null; exit 0`;

/** The tool-call event the hook is on: its output reaches the model's next request in the same turn. */
const EVENT = 'PostToolUse';
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

interface Entry {
  matcher?: string;
  hooks?: Array<Json & { command?: unknown }>;
  [key: string]: unknown;
}

const isOurs = (hook: { command?: unknown }) => typeof hook.command === 'string' && hook.command.includes(MARKER);

/** The entries of the PostToolUse list, or undefined when the file has none (or not in the shape Claude Code reads). */
function entriesOf(settings: Json): Entry[] | undefined {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return undefined;
  const list = (hooks as Json)[EVENT];
  return Array.isArray(list) ? (list as Entry[]) : undefined;
}

/** Whether the file has our hook, as it is now written. */
export function mailHookInstalled(file: string): boolean {
  try {
    return (
      entriesOf(readSettings(file))?.some(
        (entry) => Array.isArray(entry?.hooks) && entry.hooks.some((hook) => isOurs(hook)),
      ) ?? false
    );
  } catch {
    return false;
  }
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

/** Puts the hook into Claude Code's settings; the rest of the file stays as it is. */
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
  if (hooks[EVENT] !== undefined && !Array.isArray(hooks[EVENT])) throw bad();
  const list = (hooks[EVENT] ?? []) as Entry[];
  hooks[EVENT] = list;
  const ours = list.flatMap((entry) => (Array.isArray(entry?.hooks) ? entry.hooks.filter((hook) => isOurs(hook)) : []));
  let kind: MailHookResult['kind'] = 'installed';
  if (ours.length) {
    if (ours.length === 1 && ours[0]!.command === HOOK_COMMAND && ours[0]!.timeout === TIMEOUT)
      return { kind: 'already', file };
    for (const hook of ours) {
      hook.command = HOOK_COMMAND;
      hook.timeout = TIMEOUT;
    }
    kind = 'updated';
  } else list.push({ matcher: '*', hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: TIMEOUT }] });
  atomicWrite(file, `${JSON.stringify(settings, null, 2)}\n`);
  if (scope === 'project') keepOutOfGit(project, file, env);
  return { kind, file };
}

/** Takes the hook out; whatever else the file holds stays, and a file left empty goes away. */
export function removeMailHook(
  scope: ClaudeScope,
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): MailHookResult {
  const file = claudeSettingsFile(scope, project, env);
  const settings = readSettings(file);
  const list = entriesOf(settings);
  if (!list?.some((entry) => Array.isArray(entry?.hooks) && entry.hooks.some((hook) => isOurs(hook))))
    return { kind: 'absent', file };
  const kept = list.flatMap((entry) => {
    if (!Array.isArray(entry?.hooks)) return [entry];
    const rest = entry.hooks.filter((hook) => !isOurs(hook));
    return rest.length ? [{ ...entry, hooks: rest }] : [];
  });
  const hooks = settings.hooks as Json;
  if (kept.length) hooks[EVENT] = kept;
  else delete hooks[EVENT];
  if (!Object.keys(hooks).length) delete settings.hooks;
  if (Object.keys(settings).length) atomicWrite(file, `${JSON.stringify(settings, null, 2)}\n`);
  else unlinkSync(file);
  return { kind: 'removed', file };
}

export interface MailHookPlace {
  scope: ClaudeScope;
  file: string;
  installed: boolean;
}

/** Where the hook stands, in the project and in the person's own settings. */
export function mailHookPlaces(project: string, env: NodeJS.ProcessEnv = process.env): MailHookPlace[] {
  return (['project', 'user'] as const).map((scope) => {
    const file = claudeSettingsFile(scope, project, env);
    return { scope, file, installed: mailHookInstalled(file) };
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
  /** How long to wait for the mailbox lock: the hook must not hold the tool call back. */
  lockWaitMs?: number;
}

function printOut(text: string): void {
  writeSync(1, text);
}

/**
 * The hook's work: node `TREEYARD_NODE`'s waiting letters go to the model as context of this very
 * turn, and become «доставлено: посреди хода». Returns the numbers of the letters handed over;
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
      const intro =
        fit.length === 1
          ? t('Пока ты работал, пришло письмо — учти его в этой работе:')
          : t('Пока ты работал, пришли письма — учти их в этой работе:');
      emit(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: input.hook_event_name || EVENT,
            additionalContext: `${intro}\n${letterBody(tree, fit)}`,
          },
        }),
      );
      const numbers = fit.map((letter) => letter.n);
      markDelivered(dir, numbers, 'turn', {
        ...(input.session_id ? { session: `claude ${input.session_id.slice(0, 8)}` } : {}),
      });
      return numbers;
    },
    options.lockWaitMs ?? 2000,
  );
}
