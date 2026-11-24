/**
 * Letters for a Codex session, handed over alongside a prompt (`UserPromptSubmit`) or between tool
 * calls (`PostToolUse`).
 *
 * Codex (0.172+, `features.hooks` on by default) reads `.codex/hooks.json` in a trusted project
 * folder and `$CODEX_HOME/hooks.json` (`~/.codex/hooks.json`) for all projects, passes the
 * session's `TREEYARD_NODE` and `TREEYARD_PROJECT` to the hook process, and injects
 * `hookSpecificOutput.additionalContext` into the current turn.
 *
 * Unlike Claude Code, Codex requires the person to trust any new or edited hook once (in the
 * «Hooks need review» prompt at session start or via `/hooks`; trusted hooks then run outside the
 * sandbox, recorded by hash in `config.toml`). `treeyard hook codex install` puts the entries in
 * place, keeps project `.codex/hooks.json` out of `git status`, and tells the person about the
 * one-time trust step.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import { t } from '../i18n/i18n.js';
import {
  deliverMidTurn,
  type HookInput,
  type HookScope,
  hookShellCommand,
  installJsonMailHook,
  type JsonHookSpec,
  jsonHookState,
  jsonMailHookPlaces,
  type MailHookPlace,
  type MailHookResult,
  type MidTurnOptions,
  mailHookPlaces,
  removeJsonMailHook,
} from './turn-hook.js';

const CODEX_MARKER = 'treeyard hook codex mail';

export const CODEX_HOOK_COMMAND = hookShellCommand(CODEX_MARKER);

export type CodexScope = HookScope;

/** Codex's hooks file: `.codex/hooks.json` in the project, or `$CODEX_HOME/hooks.json` (`~/.codex/hooks.json`). */
export function codexHooksFile(scope: CodexScope, project: string, env: NodeJS.ProcessEnv = process.env): string {
  if (scope === 'project') return join(project, '.codex', 'hooks.json');
  const home = env.CODEX_HOME?.trim() || join(env.HOME?.trim() || homedir(), '.codex');
  return join(home, 'hooks.json');
}

const CODEX_SPEC: JsonHookSpec = {
  brain: 'codex',
  marker: CODEX_MARKER,
  command: CODEX_HOOK_COMMAND,
  excludePattern: '/.codex/hooks.json',
  fileOf: codexHooksFile,
  badHooksError: (file) =>
    new Error(t('{file}: раздел hooks не в том виде, что читает Codex — поправь файл сам', { file })),
};

/** Whether there is any treeyard Codex hook to remove, including an old or partial installation. */
export function codexMailHookInstalled(file: string): boolean {
  return jsonHookState(CODEX_SPEC, file) !== 'absent';
}

/** Installs or updates `PostToolUse` and `UserPromptSubmit` in Codex's `hooks.json`. */
export function installCodexMailHook(
  scope: CodexScope,
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): MailHookResult {
  return installJsonMailHook(CODEX_SPEC, scope, project, env);
}

/** Removes our hooks from both events in Codex's `hooks.json` and deletes the file if empty. */
export function removeCodexMailHook(
  scope: CodexScope,
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): MailHookResult {
  return removeJsonMailHook(CODEX_SPEC, scope, project, env);
}

/** Where the Codex mail hook stands, in the project and in the person's own Codex folder. */
export function codexMailHookPlaces(project: string, env: NodeJS.ProcessEnv = process.env): MailHookPlace[] {
  return jsonMailHookPlaces(CODEX_SPEC, project, env);
}

/** Every CLI's mail hook places (`claude`, `codex`), in display order, for `status` and `uninstall`. */
export function allMailHookPlaces(project: string, env: NodeJS.ProcessEnv = process.env): MailHookPlace[] {
  return [...mailHookPlaces(project, env), ...codexMailHookPlaces(project, env)];
}

/** Hands waiting letters of `TREEYARD_NODE` to Codex and records `codex <short>` as the session. */
export function deliverCodexMidTurn(
  env: NodeJS.ProcessEnv,
  input: HookInput,
  options: Omit<MidTurnOptions, 'brain'> = {},
): Promise<number[]> {
  return deliverMidTurn(env, input, { ...options, brain: 'codex' });
}
