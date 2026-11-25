import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  deliverOpencodeMidTurn,
  installOpencodeMailPlugin,
  OPENCODE_PLUGIN_FILE,
  OPENCODE_PLUGIN_SOURCE,
  opencodeMailHookPlaces,
  opencodeMailPluginInstalled,
  opencodePluginFile,
  parseOpencodeHookInput,
  removeOpencodeMailPlugin,
} from '../src/agents/opencode-plugin.js';
import { addLetter, INBOX, letterByNumber, mailDir, queuedFor } from '../src/model/mailbox.js';
import { NODE_VAR, PROJECT_VAR } from '../src/model/notes.js';
import { addNode } from '../src/model/ops.js';
import { emptyTree, tempDir, treeyardIn, tsx } from './helpers.js';

const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const flag = (dir: string, node: string) => join(mailDir(dir), INBOX, node);

function project() {
  const tree = emptyTree();
  const worker = addNode(tree, { title: 'Воркер OpenCode', status: 'active' });
  const boss = addNode(tree, { title: 'Координатор', status: 'active' });
  const env = { [NODE_VAR]: worker.id, [PROJECT_VAR]: tree.project.dir };
  return { tree, dir: tree.project.dir, worker, boss, env };
}

function capture() {
  const printed: string[] = [];
  return { printed, emit: (text: string) => printed.push(text) };
}

function shims() {
  const bin = tempDir('treeyard-opencode-bin-');
  const mark = join(bin, 'started');
  const stub = join(bin, 'stub');
  mkdirSync(stub);
  writeFileSync(join(stub, 'treeyard'), `#!/bin/sh\necho started >> "${mark}"\ncat >/dev/null\n`);
  chmodSync(join(stub, 'treeyard'), 0o755);
  const real = join(bin, 'real');
  mkdirSync(real);
  writeFileSync(join(real, 'treeyard'), `#!/bin/sh\nexec "${process.execPath}" --import "${tsx}" "${cli}" "$@"\n`);
  chmodSync(join(real, 'treeyard'), 0o755);
  return { mark, stub, real };
}

async function withProcessEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const keys = Object.keys(overrides);
  const saved = new Map<string, string | undefined>();
  for (const key of keys) {
    saved.set(key, process.env[key]);
    const next = overrides[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    return await fn();
  } finally {
    for (const [key, prev] of saved) {
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
  }
}

describe('the OpenCode mail plugin file', () => {
  const env = () => ({ HOME: tempDir('treeyard-oc-home-') });

  it('installs treeyard-mail.js into .opencode/plugins/ and preserves sibling plugins and configs', () => {
    const dir = tempDir();
    const pluginsDir = join(dir, '.opencode', 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(dir, '.opencode', 'opencode.jsonc'), '{"model": "opencode/big-pickle"}\n');
    writeFileSync(join(pluginsDir, 'custom.js'), 'export default async () => ({});\n');

    const file = join(pluginsDir, OPENCODE_PLUGIN_FILE);
    expect(installOpencodeMailPlugin('project', dir, env())).toEqual({ kind: 'installed', file });
    expect(readFileSync(file, 'utf8')).toBe(OPENCODE_PLUGIN_SOURCE);
    expect(opencodeMailPluginInstalled(file)).toBe(true);
    expect(installOpencodeMailPlugin('project', dir, env()).kind).toBe('already');

    expect(removeOpencodeMailPlugin('project', dir, env())).toEqual({ kind: 'removed', file });
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(join(pluginsDir, 'custom.js'), 'utf8')).toBe('export default async () => ({});\n');
    expect(readFileSync(join(dir, '.opencode', 'opencode.jsonc'), 'utf8')).toContain('big-pickle');
  });

  it('updates an outdated plugin and prunes empty .opencode/plugins and .opencode directories on remove', () => {
    const dir = tempDir();
    const file = opencodePluginFile('project', dir);
    installOpencodeMailPlugin('project', dir);

    writeFileSync(file, '// treeyard-mail-plugin\n// old version calling treeyard hook opencode mail\n');
    expect(opencodeMailHookPlaces(dir)[0]).toMatchObject({ scope: 'project', installed: true, needsUpdate: true });
    expect(installOpencodeMailPlugin('project', dir).kind).toBe('updated');
    expect(opencodeMailHookPlaces(dir)[0]).toEqual({ brain: 'opencode', scope: 'project', file, installed: true });

    expect(removeOpencodeMailPlugin('project', dir)).toEqual({ kind: 'removed', file });
    expect(existsSync(join(dir, '.opencode'))).toBe(false);
    expect(removeOpencodeMailPlugin('project', dir).kind).toBe('absent');
  });

  it('refuses to overwrite or delete a foreign file named treeyard-mail.js', () => {
    const dir = tempDir();
    const file = opencodePluginFile('project', dir);
    mkdirSync(join(dir, '.opencode', 'plugins'), { recursive: true });
    const foreign = 'export default async () => ({ /* user custom plugin */ });\n';
    writeFileSync(file, foreign);

    expect(opencodeMailPluginInstalled(file)).toBe(false);
    expect(() => installOpencodeMailPlugin('project', dir)).toThrow(/treeyard/);
    expect(readFileSync(file, 'utf8')).toBe(foreign);
    expect(removeOpencodeMailPlugin('project', dir)).toEqual({ kind: 'absent', file });
    expect(readFileSync(file, 'utf8')).toBe(foreign);
  });

  it('keeps an untracked .opencode/plugins/treeyard-mail.js out of git status and leaves a tracked one alone', () => {
    const dir = tempDir();
    const bare = tempDir('treeyard-bare-home-');
    const gitEnv = {
      ...process.env,
      HOME: bare,
      XDG_CONFIG_HOME: bare,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    };
    execFileSync('git', ['init', '-q'], { cwd: dir, env: gitEnv });
    installOpencodeMailPlugin('project', dir, gitEnv);
    expect(execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: dir, env: gitEnv, encoding: 'utf8' })).toBe(
      '',
    );
    const exclude = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split('\n').filter((line) => line === '/.opencode/plugins/treeyard-mail.js')).toHaveLength(1);

    const trackedDir = tempDir();
    execFileSync('git', ['init', '-q'], { cwd: trackedDir, env: gitEnv });
    mkdirSync(join(trackedDir, '.opencode', 'plugins'), { recursive: true });
    writeFileSync(join(trackedDir, '.opencode', 'plugins', OPENCODE_PLUGIN_FILE), OPENCODE_PLUGIN_SOURCE);
    execFileSync('git', ['add', `.opencode/plugins/${OPENCODE_PLUGIN_FILE}`], { cwd: trackedDir, env: gitEnv });
    installOpencodeMailPlugin('project', trackedDir, gitEnv);
    const trackedExclude = join(trackedDir, '.git', 'info', 'exclude');
    if (existsSync(trackedExclude))
      expect(readFileSync(trackedExclude, 'utf8')).not.toContain('/.opencode/plugins/treeyard-mail.js');
  });

  it('uses ~/.config/opencode/plugins/ (or $XDG_CONFIG_HOME / $OPENCODE_CONFIG_DIR) for --user', () => {
    const dir = tempDir();
    const own = env();
    installOpencodeMailPlugin('user', dir, own);
    expect(existsSync(join(dir, '.opencode'))).toBe(false);
    const userFile = join(own.HOME, '.config', 'opencode', 'plugins', OPENCODE_PLUGIN_FILE);
    expect(opencodePluginFile('user', dir, own)).toBe(userFile);
    expect(opencodeMailHookPlaces(dir, own)).toEqual([
      {
        brain: 'opencode',
        scope: 'project',
        file: join(dir, '.opencode', 'plugins', OPENCODE_PLUGIN_FILE),
        installed: false,
      },
      { brain: 'opencode', scope: 'user', file: userFile, installed: true },
    ]);

    const xdg = tempDir('treeyard-oc-xdg-');
    expect(opencodePluginFile('user', dir, { HOME: own.HOME, XDG_CONFIG_HOME: xdg })).toBe(
      join(xdg, 'opencode', 'plugins', OPENCODE_PLUGIN_FILE),
    );
    const customDir = tempDir('treeyard-oc-custom-');
    expect(opencodePluginFile('user', dir, { HOME: own.HOME, OPENCODE_CONFIG_DIR: customDir })).toBe(
      join(customDir, 'plugins', OPENCODE_PLUGIN_FILE),
    );
  });
});

describe('letters delivered by the OpenCode mail plugin', () => {
  it('delivers as { context } with prompt (chat.message) and turn (tool.execute.after)', async () => {
    const { dir, worker, boss, env } = project();
    addLetter(dir, { to: worker.id, from: boss.id, who: 'claude', text: 'проверь сборку', held: 'terminal' });
    const first = capture();
    const firstInput = parseOpencodeHookInput(
      JSON.stringify({ sessionID: 'ses_dede0b073ffe', hookEventName: 'chat.message' }),
    );
    expect(await deliverOpencodeMidTurn(env, firstInput, { emit: first.emit })).toEqual([1]);
    expect(JSON.parse(first.printed[0]!)).toEqual({
      context: `Вместе с запросом пришло письмо для этой сессии.\nПисьмо от сессии узла «Координатор» (${boss.id}), не от человека; ответ — treeyard send ${boss.id} "…":\nпроверь сборку`,
    });
    expect(letterByNumber(dir, 1)?.delivered).toMatchObject({ how: 'prompt', session: 'opencode ses_dede' });

    addLetter(dir, { to: worker.id, from: boss.id, who: 'claude', text: 'обнови тест' });
    const second = capture();
    expect(
      await deliverOpencodeMidTurn(
        env,
        parseOpencodeHookInput(JSON.stringify({ sessionID: 'ses_dede0b073ffe', hookEventName: 'tool.execute.after' })),
        { emit: second.emit },
      ),
    ).toEqual([2]);
    expect(JSON.parse(second.printed[0]!)).toEqual({
      context: `Пока ты работал, пришло письмо — учти его в этой работе:\nПисьмо от сессии узла «Координатор» (${boss.id}), не от человека; ответ — treeyard send ${boss.id} "…":\nобнови тест`,
    });
    expect(letterByNumber(dir, 2)?.delivered).toMatchObject({ how: 'turn', session: 'opencode ses_dede' });
    expect(existsSync(flag(dir, worker.id))).toBe(false);

    // Other events and subagent sessions never consume the node session's letters.
    addLetter(dir, { to: worker.id, text: 'только главной сессии' });
    expect(await deliverOpencodeMidTurn(env, { hookEventName: 'chat.params' }, { emit: second.emit })).toEqual([]);
    expect(
      await deliverOpencodeMidTurn(
        env,
        parseOpencodeHookInput(JSON.stringify({ sessionID: 'ses_sub', parentID: 'ses_dede0b073ffe' })),
        { emit: second.emit },
      ),
    ).toEqual([]);
    expect(queuedFor(dir, worker.id)).toHaveLength(1);
  });

  it('executes the generated treeyard-mail.js plugin: skips treeyard when idle or in a subagent, injects on mail', async () => {
    const { env, dir, worker, boss } = project();
    const { mark, stub, real } = shims();
    const pluginDir = tempDir('treeyard-oc-plugin-');
    const { file } = installOpencodeMailPlugin('project', pluginDir);
    const mod = (await import(pathToFileURL(file).href)) as {
      default: (ctx: unknown) => Promise<{
        'chat.message': (input: unknown, output: unknown) => Promise<void>;
        'tool.execute.after': (input: unknown, output: unknown) => Promise<void>;
      }>;
    };
    const hooks = await mod.default({
      client: {
        session: {
          get: async ({ path }: { path: { id: string } }) => ({
            data: { id: path.id, parentID: path.id.startsWith('ses_sub') ? 'ses_root' : null },
          }),
        },
      },
    });

    const baseEnv = {
      ...env,
      TREEYARD_HOME: tempDir('treeyard-home-'),
      TREEYARD_LANG: 'ru',
      NO_COLOR: '1',
    };

    // 1. No waiting letter: `treeyard` is never spawned.
    await withProcessEnv({ ...baseEnv, PATH: `${stub}:${process.env.PATH}` }, async () => {
      const msgOut = {
        message: { id: 'msg_1' },
        parts: [{ id: 'prt_212212506001bVIXkpL87VOHUS', type: 'text', text: 'привет' }],
      };
      await hooks['chat.message']({ sessionID: 'ses_root1234' }, msgOut);
      expect(msgOut.parts).toHaveLength(1);
      const toolOut = { title: 'Read', output: 'file text', metadata: {} };
      await hooks['tool.execute.after']({ sessionID: 'ses_root1234', tool: 'read' }, toolOut);
      expect(toolOut.output).toBe('file text');
    });
    expect(existsSync(mark)).toBe(false);

    // 2. Waiting letter, but inside a subagent or on a failed tool (`output === undefined`): `treeyard` is not spawned.
    addLetter(dir, { to: worker.id, from: boss.id, who: 'claude', text: 'письмо через плагин' });
    await withProcessEnv({ ...baseEnv, PATH: `${stub}:${process.env.PATH}` }, async () => {
      const subOut = { message: { id: 'msg_sub' }, parts: [{ id: 'prt_212212506001bVIXkpL87VOHUS', type: 'text' }] };
      await hooks['chat.message']({ sessionID: 'ses_sub9999' }, subOut);
      expect(subOut.parts).toHaveLength(1);
      await hooks['tool.execute.after']({ sessionID: 'ses_root1234', tool: 'bash' }, undefined);
    });
    expect(existsSync(mark)).toBe(false);
    expect(queuedFor(dir, worker.id)).toHaveLength(1);

    // 3. Prompt delivery on the root session via `chat.message`.
    const promptPartId = 'prt_212212506001bVIXkpL87VOHUS';
    const promptOut: { message: { id: string }; parts: Array<Record<string, unknown>> } = {
      message: { id: 'msg_root1' },
      parts: [{ id: promptPartId, sessionID: 'ses_root1234', messageID: 'msg_root1', type: 'text', text: 'задача' }],
    };
    await withProcessEnv({ ...baseEnv, PATH: `${real}:${process.env.PATH}` }, async () => {
      await hooks['chat.message']({ sessionID: 'ses_root1234' }, promptOut);
    });
    expect(promptOut.parts).toHaveLength(2);
    const injectedPart = promptOut.parts[1]!;
    expect(injectedPart).toMatchObject({
      sessionID: 'ses_root1234',
      messageID: 'msg_root1',
      type: 'text',
      synthetic: true,
      text: expect.stringContaining('письмо через плагин'),
    });
    expect(String(injectedPart.id)).toMatch(/^prt_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(String(injectedPart.id) > promptPartId).toBe(true);
    expect(letterByNumber(dir, 1)?.delivered).toMatchObject({ how: 'prompt', session: 'opencode ses_root' });
    expect(existsSync(flag(dir, worker.id))).toBe(false);

    // 4. Mid-turn delivery via `tool.execute.after` (string output and MCP content array).
    addLetter(dir, { to: worker.id, from: boss.id, who: 'claude', text: 'письмо после тула' });
    const toolOut = { title: 'Read', output: 'initial content', metadata: {} };
    await withProcessEnv({ ...baseEnv, PATH: `${real}:${process.env.PATH}` }, async () => {
      await hooks['tool.execute.after']({ sessionID: 'ses_root1234', tool: 'read' }, toolOut);
    });
    expect(toolOut.output).toContain('initial content\n\n<system-reminder>\nПока ты работал, пришло письмо');
    expect(toolOut.output).toContain('письмо после тула\n</system-reminder>');
    expect(letterByNumber(dir, 2)?.delivered).toMatchObject({ how: 'turn', session: 'opencode ses_root' });

    addLetter(dir, { to: worker.id, from: boss.id, who: 'claude', text: 'письмо для MCP' });
    const mcpOut = { content: [{ type: 'text', text: 'mcp data' }] };
    await withProcessEnv({ ...baseEnv, PATH: `${real}:${process.env.PATH}` }, async () => {
      await hooks['tool.execute.after']({ sessionID: 'ses_root1234', tool: 'mcp_tool' }, mcpOut);
    });
    expect(mcpOut.content).toHaveLength(2);
    expect(mcpOut.content[1]?.text).toContain('письмо для MCP');
    expect(letterByNumber(dir, 3)?.delivered).toMatchObject({ how: 'turn', session: 'opencode ses_root' });
  });
});

describe('treeyard hook opencode CLI, status and uninstall', () => {
  it('installs, shows in status, supports --user and English help, and cleans up via remove and uninstall', async () => {
    const dir = tempDir();
    const claudeOwn = tempDir('treeyard-claude-');
    const codexOwn = tempDir('treeyard-codex-');
    const home = tempDir('treeyard-home-');
    const env = {
      HOME: home,
      CLAUDE_CONFIG_DIR: claudeOwn,
      CODEX_HOME: codexOwn,
      TREEYARD_HOME: join(home, '.treeyard'),
      TREEYARD_SKILLS: '',
      BRAINYARD_TMUX_BIN: 'treeyard-test-no-tmux',
      BRAINYARD_CLAUDE_BIN: 'treeyard-test-no-claude',
    };
    const sh = treeyardIn(dir, env);
    expect((await sh('init', '--template', 'directions', '--goal', 'всё работает')).code).toBe(0);
    const file = join(realpathSync(dir), '.opencode', 'plugins', OPENCODE_PLUGIN_FILE);

    const before = await sh('hook', 'opencode', 'status');
    expect(before.code).toBe(0);
    expect(before.stdout).toContain('плагина нет');
    expect(before.stdout).toContain('treeyard hook opencode install');
    expect((await sh('status')).stdout).toMatch(/OpenCode\s+не стоит · treeyard hook opencode install/);

    const installed = await sh('hook', 'opencode', 'install');
    expect(installed.code).toBe(0);
    expect(installed.stdout).toContain('плагин поставлен');
    expect(installed.stdout).toContain('сессии OpenCode из узлов получат письма вместе с запросом и посреди хода');
    expect(installed.stdout).toContain('treeyard hook opencode remove');
    expect(opencodeMailPluginInstalled(file)).toBe(true);

    expect((await sh('hook', 'opencode', 'status')).stdout).toContain('в проекте: плагин стоит');
    expect((await sh('status')).stdout).toMatch(/OpenCode\s+стоит\s+в проекте/);

    // English help and --user install notice.
    const enSh = treeyardIn(dir, { ...env, TREEYARD_LANG: 'en' });
    const enHelp = await enSh('hook', '--help');
    expect(enHelp.stdout).toContain('treeyard hook opencode install|remove|status [--user]');
    expect(enHelp.stdout).toContain('chat.message delivers with the prompt, tool.execute.after during the turn');
    const userInstall = await enSh('hook', 'opencode', 'install', '--user');
    expect(userInstall.stdout).toContain(
      'OpenCode sessions started from nodes will receive letters alongside a prompt and during a turn',
    );
    expect(userInstall.stdout).toContain('treeyard hook opencode remove --user');

    const bad = await sh('hook', 'opencode', 'enable');
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('treeyard hook opencode install | remove | status [--user]');

    // `uninstall` removes both project and user OpenCode mail plugins while leaving sibling plugins.
    const customPlugin = join(realpathSync(dir), '.opencode', 'plugins', 'other.js');
    writeFileSync(customPlugin, 'export default async () => ({});\n');
    const dry = await sh('uninstall', '--dry-run');
    expect(dry.stdout).toContain('плагин OpenCode для писем');
    const removed = await sh('uninstall');
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain('плагин OpenCode для писем');
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(customPlugin, 'utf8')).toBe('export default async () => ({});\n');
    expect(existsSync(join(home, '.config', 'opencode', 'plugins', OPENCODE_PLUGIN_FILE))).toBe(false);
  }, 60_000);
});
