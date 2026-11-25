/**
 * Letters for an Antigravity (`agy` 1.5+) session, handed over before each model call (`PreInvocation`).
 *
 * Antigravity reads `.agents/hooks.json` in the workspace (and `~/.gemini/config/hooks.json` globally)
 * without manual hook approval, passes the session's `TREEYARD_NODE` and `TREEYARD_PROJECT` to the hook
 * process, and injects `{ injectSteps: [{ systemMessage: { systemMessage } }] }` into the conversation.
 *
 * Unlike Claude Code and Codex (`{ hooks: { PostToolUse, UserPromptSubmit } }`), Antigravity's
 * `hooks.json` maps top-level hook names (`treeyard-mail`) to event handler lists, and `PreInvocation`
 * fires both alongside the user prompt (`invocationNum: 0`) and mid-turn after tool calls
 * (`invocationNum > 0`), while empty stdout (when no letter waits) is a zero-cost no-op.
 */
import { unlinkSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { t } from '../i18n/i18n.js';
import { atomicWrite } from '../model/store.js';
import {
  deliverHookMail,
  HOOK_TIMEOUT,
  type HookScope,
  hookShellCommand,
  keepOutOfGit,
  type MailHookPlace,
  type MailHookResult,
  readHookJson,
} from './turn-hook.js';

const AGY_MARKER = 'treeyard hook antigravity mail';

export const AGY_HOOK_NAME = 'treeyard-mail';
export const AGY_EVENT = 'PreInvocation';
export const AGY_HOOK_COMMAND = hookShellCommand(AGY_MARKER);

export type AgyScope = HookScope;

type Json = Record<string, unknown>;

function isPlainObject(value: unknown): value is Json {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isOurs(handler: unknown): boolean {
  return isPlainObject(handler) && typeof handler.command === 'string' && handler.command.includes(AGY_MARKER);
}

function currentHandler(handlers: unknown[]): boolean {
  return (
    handlers.length === 1 &&
    isPlainObject(handlers[0]) &&
    handlers[0].type === 'command' &&
    handlers[0].command === AGY_HOOK_COMMAND &&
    handlers[0].timeout === HOOK_TIMEOUT
  );
}

function badHooksError(file: string): Error {
  return new Error(t('{file}: хуки не в том виде, что читает Antigravity — поправь файл сам', { file }));
}

/** Antigravity's hooks file: `.agents/hooks.json` in the project, or `~/.gemini/config/hooks.json` globally. */
export function agyHooksFile(scope: AgyScope, project: string, env: NodeJS.ProcessEnv = process.env): string {
  if (scope === 'project') return join(project, '.agents', 'hooks.json');
  const home = env.HOME?.trim() || homedir();
  return join(home, '.gemini', 'config', 'hooks.json');
}

function agyHookState(file: string): 'absent' | 'outdated' | 'installed' {
  try {
    const data = readHookJson(file);
    const named = data[AGY_HOOK_NAME];
    if (named !== undefined && !isPlainObject(named)) return 'absent';
    const ownList = isPlainObject(named) && Array.isArray(named[AGY_EVENT]) ? named[AGY_EVENT].filter(isOurs) : [];
    const elsewhere = Object.entries(data)
      .filter(([key]) => key !== AGY_HOOK_NAME)
      .flatMap(([, entry]) =>
        isPlainObject(entry) && Array.isArray(entry[AGY_EVENT]) ? entry[AGY_EVENT].filter(isOurs) : [],
      );
    const disabled = isPlainObject(named) && named.enabled === false;
    if (!disabled && elsewhere.length === 0 && currentHandler(ownList)) return 'installed';
    return ownList.length > 0 || elsewhere.length > 0 ? 'outdated' : 'absent';
  } catch {
    return 'absent';
  }
}

/** Whether there is any treeyard Antigravity hook to remove, including an old or disabled installation. */
export function agyMailHookInstalled(file: string): boolean {
  return agyHookState(file) !== 'absent';
}

/** Installs or updates `treeyard-mail` (`PreInvocation`) in Antigravity's `hooks.json`. */
export function installAgyMailHook(
  scope: AgyScope,
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): MailHookResult {
  const file = agyHooksFile(scope, project, env);
  const data = readHookJson(file);
  const existing = data[AGY_HOOK_NAME];
  if (existing !== undefined && !isPlainObject(existing)) throw badHooksError(file);
  const named = isPlainObject(existing) ? { ...existing } : {};
  if (named.enabled !== undefined && typeof named.enabled !== 'boolean') throw badHooksError(file);
  const rawList = named[AGY_EVENT];
  if (rawList !== undefined && !Array.isArray(rawList)) throw badHooksError(file);

  const list = (rawList ?? []) as unknown[];
  const ownInNamed = list.filter(isOurs);
  let present = ownInNamed.length > 0;
  let cleanedElsewhere = false;

  for (const [key, entry] of Object.entries(data)) {
    if (key === AGY_HOOK_NAME || !isPlainObject(entry) || !Array.isArray(entry[AGY_EVENT])) continue;
    if (!entry[AGY_EVENT].some(isOurs)) continue;
    present = true;
    cleanedElsewhere = true;
    const kept = entry[AGY_EVENT].filter((item) => !isOurs(item));
    const nextEntry = { ...entry };
    if (kept.length) nextEntry[AGY_EVENT] = kept;
    else delete nextEntry[AGY_EVENT];
    const remainingKeys = Object.keys(nextEntry).filter((k) => k !== 'enabled');
    if (remainingKeys.length) data[key] = nextEntry;
    else delete data[key];
  }

  const disabled = named.enabled === false;
  if (!disabled && !cleanedElsewhere && currentHandler(ownInNamed)) return { kind: 'already', file };

  if (disabled) delete named.enabled;
  named[AGY_EVENT] = [
    ...list.filter((item) => !isOurs(item)),
    { type: 'command', command: AGY_HOOK_COMMAND, timeout: HOOK_TIMEOUT },
  ];
  data[AGY_HOOK_NAME] = named;

  atomicWrite(file, `${JSON.stringify(data, null, 2)}\n`);
  if (scope === 'project') keepOutOfGit(project, file, '/.agents/hooks.json', env);
  return { kind: present ? 'updated' : 'installed', file };
}

/** Removes our `PreInvocation` hook from Antigravity's `hooks.json` and deletes the file if empty. */
export function removeAgyMailHook(
  scope: AgyScope,
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): MailHookResult {
  const file = agyHooksFile(scope, project, env);
  const data = readHookJson(file);
  let changed = false;
  for (const [key, entry] of Object.entries(data)) {
    if (!isPlainObject(entry) || !Array.isArray(entry[AGY_EVENT]) || !entry[AGY_EVENT].some(isOurs)) continue;
    changed = true;
    const kept = entry[AGY_EVENT].filter((item) => !isOurs(item));
    const nextEntry = { ...entry };
    if (kept.length) nextEntry[AGY_EVENT] = kept;
    else delete nextEntry[AGY_EVENT];
    const remainingKeys = Object.keys(nextEntry).filter((k) => k !== 'enabled');
    if (remainingKeys.length) data[key] = nextEntry;
    else delete data[key];
  }
  if (!changed) return { kind: 'absent', file };
  if (Object.keys(data).length) atomicWrite(file, `${JSON.stringify(data, null, 2)}\n`);
  else unlinkSync(file);
  return { kind: 'removed', file };
}

/** Where the Antigravity mail hook stands, in the project and in `~/.gemini/config/hooks.json`. */
export function agyMailHookPlaces(project: string, env: NodeJS.ProcessEnv = process.env): MailHookPlace[] {
  return (['project', 'user'] as const).map((scope) => {
    const file = agyHooksFile(scope, project, env);
    const state = agyHookState(file);
    return {
      brain: 'antigravity',
      scope,
      file,
      installed: state !== 'absent',
      ...(state === 'outdated' ? { needsUpdate: true } : {}),
    };
  });
}

/** Payload Antigravity passes to a `PreInvocation` hook on stdin (camelCase protojson). */
export interface AgyHookInput {
  conversationId?: string;
  hookEventName?: string;
  /** `0` on the first model call of a turn (with the user prompt); `> 0` after tool calls in the same turn. */
  invocationNum?: number;
  /** Set if invoked inside a subagent: letters belong to the node's own session. */
  agentId?: string;
}

export function parseAgyHookInput(text: string): AgyHookInput {
  try {
    const data = JSON.parse(text) as unknown;
    if (!isPlainObject(data)) return {};
    const { conversationId, hookEventName, invocationNum, agentId, agent_id } = data;
    const sub =
      typeof agentId === 'string' && agentId
        ? agentId
        : typeof agent_id === 'string' && agent_id
          ? agent_id
          : undefined;
    return {
      ...(typeof conversationId === 'string' && conversationId ? { conversationId } : {}),
      ...(typeof hookEventName === 'string' && hookEventName ? { hookEventName } : {}),
      ...(typeof invocationNum === 'number' && Number.isFinite(invocationNum) ? { invocationNum } : {}),
      ...(sub ? { agentId: sub } : {}),
    };
  } catch {
    return {};
  }
}

export interface AgyMidTurnOptions {
  /** Hands the model what the hook prints. Letters are marked only after this went out. */
  emit?(text: string): void;
  /** How long to wait for the mailbox lock before leaving delivery for later. */
  lockWaitMs?: number;
}

function printOut(text: string): void {
  writeSync(1, text);
}

/**
 * Hands waiting letters of `TREEYARD_NODE` to Antigravity as `injectSteps` (`systemMessage`)
 * on `PreInvocation`, recording `prompt` on `invocationNum === 0` and `turn` mid-turn.
 */
export async function deliverAgyMidTurn(
  env: NodeJS.ProcessEnv,
  input: AgyHookInput,
  options: AgyMidTurnOptions = {},
): Promise<number[]> {
  const event = input.hookEventName || AGY_EVENT;
  if (event !== AGY_EVENT) return [];
  const emit = options.emit ?? printOut;
  return deliverHookMail(env, {
    brain: 'antigravity',
    how: input.invocationNum === 0 ? 'prompt' : 'turn',
    ...(input.conversationId ? { sessionId: input.conversationId } : {}),
    subagent: Boolean(input.agentId),
    ...(options.lockWaitMs !== undefined ? { lockWaitMs: options.lockWaitMs } : {}),
    deliver: (systemMessage) =>
      emit(
        JSON.stringify({
          injectSteps: [
            {
              systemMessage: {
                systemMessage,
              },
            },
          ],
        }),
      ),
  });
}
