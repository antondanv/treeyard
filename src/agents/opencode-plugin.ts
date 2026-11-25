/**
 * Letters for an OpenCode (1.19+) session, handed over alongside a prompt (`chat.message`) or
 * between tool calls (`tool.execute.after`).
 *
 * OpenCode has no shell command hooks; instead it loads JS/TS plugins from `.opencode/plugins/`
 * in the project and `~/.config/opencode/plugins/` (`$XDG_CONFIG_HOME/opencode/plugins/` or
 * `$OPENCODE_CONFIG_DIR/plugins/`) globally, without manual approval, and runs them in-process
 * with the session's `process.env` (`TREEYARD_NODE`, `TREEYARD_PROJECT`).
 *
 * The installed `treeyard-mail.js` plugin uses only Node/Bun built-ins, checks the node's inbox
 * flag via `existsSync` first (so turns without waiting mail never spawn `treeyard`), skips
 * subagent sessions (`session.parentID`), and calls `treeyard hook opencode mail` to pick up and
 * mark waiting letters through `deliverHookMail`. Prompt mail is appended as a `synthetic: true`
 * user text part (persisted in SQLite); mid-turn mail is appended as `<system-reminder>` on the
 * completed tool output (persisted in SQLite).
 */
import { existsSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { t } from '../i18n/i18n.js';
import { atomicWrite } from '../model/store.js';
import { deliverHookMail, type HookScope, keepOutOfGit, type MailHookPlace, type MailHookResult } from './turn-hook.js';

export const OPENCODE_PLUGIN_FILE = 'treeyard-mail.js';
export const OPENCODE_PROMPT_EVENT = 'chat.message';
export const OPENCODE_TOOL_EVENT = 'tool.execute.after';

const OPENCODE_MARKER = 'treeyard hook opencode mail';
const PLUGIN_HEADER = '// treeyard-mail-plugin';

export type OpencodeScope = HookScope;

/** Self-contained ESM plugin OpenCode loads from `.opencode/plugins/` or `~/.config/opencode/plugins/`. */
export const OPENCODE_PLUGIN_SOURCE = `${PLUGIN_HEADER}: hands waiting Treeyard letters to an OpenCode node session.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const TIMEOUT_MS = 10_000;
let lastMs = 0;
let seq = 0;

function nextPartId(afterId) {
  let now = Date.now();
  if (typeof afterId === 'string' && /^prt_[0-9a-f]{12}/.test(afterId)) {
    const prevMs = Number(BigInt(\`0x\${afterId.slice(4, 16)}\`) >> 12n);
    if (prevMs >= now) now = prevMs + 1;
  }
  if (now !== lastMs) {
    lastMs = now;
    seq = 0;
  }
  seq += 1;
  const n = BigInt(now) * 4096n + BigInt(seq);
  const hex = n.toString(16).padStart(12, '0').slice(-12);
  const bytes = randomBytes(14);
  let tail = '';
  for (let i = 0; i < 14; i += 1) tail += BASE62[bytes[i] % 62];
  return \`prt_\${hex}\${tail}\`;
}

function hasWaitingFlag(env = process.env) {
  const node = env.TREEYARD_NODE?.trim();
  const project = env.TREEYARD_PROJECT?.trim();
  if (!node || !project || !/^[\\w-]+$/.test(node)) return false;
  return existsSync(join(project, '.tree', '.local', 'mail', 'inbox', node));
}

function fetchMail(payload) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(text);
    };
    let child;
    try {
      // ${OPENCODE_MARKER}
      child = spawn('treeyard', ['hook', 'opencode', 'mail'], {
        env: process.env,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      done('');
      return;
    }
    const chunks = [];
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      done('');
    }, TIMEOUT_MS);
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.on('error', () => done(''));
    child.on('close', (code) => {
      if (code !== 0) {
        done('');
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        done(typeof parsed?.context === 'string' ? parsed.context : '');
      } catch {
        done('');
      }
    });
    try {
      child.stdin.end(JSON.stringify(payload));
    } catch {
      done('');
    }
  });
}

export const TreeyardMailPlugin = async (ctx) => {
  const subagents = new Map();

  async function isSubagent(sessionID) {
    if (!sessionID || !ctx?.client?.session?.get) return false;
    if (subagents.has(sessionID)) return subagents.get(sessionID);
    try {
      const res = await ctx.client.session.get({ path: { id: sessionID } });
      const info = res?.data ?? res;
      const sub = Boolean(info && typeof info === 'object' && info.parentID);
      subagents.set(sessionID, sub);
      return sub;
    } catch {
      return false;
    }
  }

  return {
    'chat.message': async (input, output) => {
      if (!hasWaitingFlag() || !Array.isArray(output?.parts) || !output?.message?.id) return;
      const sessionID = typeof input?.sessionID === 'string' ? input.sessionID : '';
      if (await isSubagent(sessionID)) return;
      const context = await fetchMail({ sessionID, hookEventName: 'chat.message' });
      if (!context) return;
      output.parts.push({
        id: nextPartId(output.parts.at(-1)?.id),
        sessionID,
        messageID: output.message.id,
        type: 'text',
        synthetic: true,
        text: context,
      });
    },
    'tool.execute.after': async (input, output) => {
      if (!hasWaitingFlag()) return;
      const hasStringOut = typeof output?.output === 'string';
      const hasContentArr = !hasStringOut && Array.isArray(output?.content);
      if (!hasStringOut && !hasContentArr) return;
      const sessionID = typeof input?.sessionID === 'string' ? input.sessionID : '';
      if (await isSubagent(sessionID)) return;
      const context = await fetchMail({ sessionID, hookEventName: 'tool.execute.after' });
      if (!context) return;
      const block = \`<system-reminder>\\n\${context}\\n</system-reminder>\`;
      if (hasStringOut) {
        output.output = output.output ? \`\${output.output}\\n\\n\${block}\` : block;
      } else {
        output.content.push({ type: 'text', text: block });
      }
    },
  };
};

export default TreeyardMailPlugin;
`;

/**
 * OpenCode's plugin file: `.opencode/plugins/treeyard-mail.js` in the project, or
 * `$OPENCODE_CONFIG_DIR/plugins/treeyard-mail.js` / `~/.config/opencode/plugins/treeyard-mail.js` globally.
 */
export function opencodePluginFile(
  scope: OpencodeScope,
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (scope === 'project') return join(project, '.opencode', 'plugins', OPENCODE_PLUGIN_FILE);
  const custom = env.OPENCODE_CONFIG_DIR?.trim();
  if (custom) return join(custom, 'plugins', OPENCODE_PLUGIN_FILE);
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const useXdg = Boolean(
    xdg && (!env.HOME || env === process.env || env.XDG_CONFIG_HOME !== process.env.XDG_CONFIG_HOME),
  );
  const configRoot = useXdg ? xdg! : join(env.HOME?.trim() || homedir(), '.config');
  return join(configRoot, 'opencode', 'plugins', OPENCODE_PLUGIN_FILE);
}

function isOwnPluginText(text: string): boolean {
  return text.includes(OPENCODE_MARKER) || text.includes(PLUGIN_HEADER);
}

function opencodePluginState(file: string): 'absent' | 'outdated' | 'installed' {
  if (!existsSync(file)) return 'absent';
  try {
    const text = readFileSync(file, 'utf8');
    if (text === OPENCODE_PLUGIN_SOURCE) return 'installed';
    return isOwnPluginText(text) ? 'outdated' : 'absent';
  } catch {
    return 'absent';
  }
}

/** Whether there is any treeyard OpenCode mail plugin to remove, including an older version. */
export function opencodeMailPluginInstalled(file: string): boolean {
  return opencodePluginState(file) !== 'absent';
}

/** Installs or updates `treeyard-mail.js` in OpenCode's `plugins/` folder. */
export function installOpencodeMailPlugin(
  scope: OpencodeScope,
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): MailHookResult {
  const file = opencodePluginFile(scope, project, env);
  let present = false;
  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf8');
    if (existing === OPENCODE_PLUGIN_SOURCE) return { kind: 'already', file };
    if (!isOwnPluginText(existing))
      throw new Error(t('{file}: чужой файл, не плагин treeyard — убери или переименуй его сам', { file }));
    present = true;
  }
  atomicWrite(file, OPENCODE_PLUGIN_SOURCE);
  if (scope === 'project') keepOutOfGit(project, file, `/.opencode/plugins/${OPENCODE_PLUGIN_FILE}`, env);
  return { kind: present ? 'updated' : 'installed', file };
}

function pruneEmptyDir(dir: string): void {
  try {
    if (readdirSync(dir).length === 0) rmdirSync(dir);
  } catch {
    // Non-empty or absent.
  }
}

/** Removes our `treeyard-mail.js` plugin and cleans up empty `plugins/` / `.opencode` directories. */
export function removeOpencodeMailPlugin(
  scope: OpencodeScope,
  project: string,
  env: NodeJS.ProcessEnv = process.env,
): MailHookResult {
  const file = opencodePluginFile(scope, project, env);
  if (!opencodeMailPluginInstalled(file)) return { kind: 'absent', file };
  unlinkSync(file);
  const pluginsDir = dirname(file);
  pruneEmptyDir(pluginsDir);
  pruneEmptyDir(dirname(pluginsDir));
  return { kind: 'removed', file };
}

/** Where the OpenCode mail plugin stands, in the project and in `~/.config/opencode/plugins/`. */
export function opencodeMailHookPlaces(project: string, env: NodeJS.ProcessEnv = process.env): MailHookPlace[] {
  return (['project', 'user'] as const).map((scope) => {
    const file = opencodePluginFile(scope, project, env);
    const state = opencodePluginState(file);
    return {
      brain: 'opencode',
      scope,
      file,
      installed: state !== 'absent',
      ...(state === 'outdated' ? { needsUpdate: true } : {}),
    };
  });
}

/** Payload the OpenCode mail plugin passes to `treeyard hook opencode mail` on stdin. */
export interface OpencodeHookInput {
  sessionId?: string;
  hookEventName?: string;
  /** True inside a subagent session (`parentID` / `agentId`). */
  subagent?: boolean;
}

export function parseOpencodeHookInput(text: string): OpencodeHookInput {
  try {
    const data = JSON.parse(text) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const raw = data as Record<string, unknown>;
    const sessionId = [raw.sessionID, raw.sessionId, raw.session_id].find(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    const hookEventName = [raw.hookEventName, raw.hook_event_name].find(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    const subagent =
      raw.subagent === true ||
      [raw.parentID, raw.parentSessionId, raw.agentId, raw.agent_id].some((v) => typeof v === 'string' && v.length > 0);
    return {
      ...(sessionId ? { sessionId } : {}),
      ...(hookEventName ? { hookEventName } : {}),
      ...(subagent ? { subagent: true } : {}),
    };
  } catch {
    return {};
  }
}

export interface OpencodeMidTurnOptions {
  /** Hands the plugin what `treeyard hook opencode mail` prints. Letters are marked only after this went out. */
  emit?(text: string): void;
  /** How long to wait for the mailbox lock before leaving delivery for later. */
  lockWaitMs?: number;
}

function printOut(text: string): void {
  writeSync(1, text);
}

/**
 * Hands waiting letters of `TREEYARD_NODE` to the OpenCode plugin as `{ context }`, recording
 * `prompt` on `chat.message` and `turn` on `tool.execute.after`.
 */
export async function deliverOpencodeMidTurn(
  env: NodeJS.ProcessEnv,
  input: OpencodeHookInput,
  options: OpencodeMidTurnOptions = {},
): Promise<number[]> {
  const event = input.hookEventName || OPENCODE_TOOL_EVENT;
  if (event !== OPENCODE_PROMPT_EVENT && event !== OPENCODE_TOOL_EVENT) return [];
  const emit = options.emit ?? printOut;
  return deliverHookMail(env, {
    brain: 'opencode',
    how: event === OPENCODE_PROMPT_EVENT ? 'prompt' : 'turn',
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    subagent: Boolean(input.subagent),
    ...(options.lockWaitMs !== undefined ? { lockWaitMs: options.lockWaitMs } : {}),
    deliver: (context) => emit(JSON.stringify({ context })),
  });
}
