import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  AGY_HOOK_COMMAND,
  AGY_HOOK_NAME,
  agyHooksFile,
  agyMailHookInstalled,
  agyMailHookPlaces,
  deliverAgyMidTurn,
  installAgyMailHook,
  parseAgyHookInput,
  removeAgyMailHook,
} from '../src/agents/agy-hook.js';
import { addLetter, INBOX, letterByNumber, mailDir, queuedFor } from '../src/model/mailbox.js';
import { NODE_VAR, PROJECT_VAR } from '../src/model/notes.js';
import { addNode } from '../src/model/ops.js';
import { emptyTree, tempDir, treeyardIn, tsx } from './helpers.js';

const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const flag = (dir: string, node: string) => join(mailDir(dir), INBOX, node);

function project() {
  const tree = emptyTree();
  const worker = addNode(tree, { title: 'Воркер Antigravity', status: 'active' });
  const boss = addNode(tree, { title: 'Координатор', status: 'active' });
  const env = { [NODE_VAR]: worker.id, [PROJECT_VAR]: tree.project.dir };
  return { tree, dir: tree.project.dir, worker, boss, env };
}

function capture() {
  const printed: string[] = [];
  return { printed, emit: (text: string) => printed.push(text) };
}

function shims() {
  const bin = tempDir('treeyard-agy-bin-');
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

function runAgyHook(env: NodeJS.ProcessEnv, path: string, stdin: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    const child = execFile(
      '/bin/sh',
      ['-c', AGY_HOOK_COMMAND],
      { env: { ...env, PATH: `${path}:${process.env.PATH}` }, timeout: 30_000 },
      (error, stdout, stderr) =>
        done({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, stdout, stderr }),
    );
    child.stdin?.end(stdin);
  });
}

describe('the hook in Antigravity hooks.json', () => {
  const env = () => ({ HOME: tempDir('treeyard-agy-home-') });

  it('installs treeyard-mail PreInvocation into .agents/hooks.json and leaves existing named hooks untouched', () => {
    const dir = tempDir();
    const file = join(dir, '.agents', 'hooks.json');
    mkdirSync(join(dir, '.agents'));
    const mine = {
      'lint-checker': {
        PostToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: './lint.sh', timeout: 10 }] }],
      },
      [AGY_HOOK_NAME]: {
        PreInvocation: [{ type: 'command', command: 'echo custom' }],
      },
    };
    writeFileSync(file, JSON.stringify(mine));
    expect(installAgyMailHook('project', dir, env())).toEqual({ kind: 'installed', file });
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    expect(parsed['lint-checker']).toEqual(mine['lint-checker']);
    expect(parsed[AGY_HOOK_NAME]).toEqual({
      PreInvocation: [
        { type: 'command', command: 'echo custom' },
        { type: 'command', command: AGY_HOOK_COMMAND, timeout: 10 },
      ],
    });
    expect(agyMailHookInstalled(file)).toBe(true);
    expect(installAgyMailHook('project', dir, env()).kind).toBe('already');

    // Removing leaves other named hooks and custom handlers in place.
    expect(removeAgyMailHook('project', dir, env())).toEqual({ kind: 'removed', file });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(mine);
  });

  it('updates an outdated or disabled entry and deletes the file when nothing else remains', () => {
    const dir = tempDir();
    const file = agyHooksFile('project', dir);
    installAgyMailHook('project', dir);

    const data = JSON.parse(readFileSync(file, 'utf8'));
    data[AGY_HOOK_NAME].PreInvocation[0].command = 'treeyard hook antigravity mail';
    writeFileSync(file, JSON.stringify(data));
    expect(agyMailHookPlaces(dir)[0]).toMatchObject({ scope: 'project', installed: true, needsUpdate: true });
    expect(installAgyMailHook('project', dir).kind).toBe('updated');
    expect(agyMailHookPlaces(dir)[0]).toEqual({ brain: 'antigravity', scope: 'project', file, installed: true });

    // A disabled `treeyard-mail` entry is treated as needing update and re-enabled on install.
    const disabled = JSON.parse(readFileSync(file, 'utf8'));
    disabled[AGY_HOOK_NAME].enabled = false;
    writeFileSync(file, JSON.stringify(disabled));
    expect(agyMailHookPlaces(dir)[0]).toMatchObject({ scope: 'project', installed: true, needsUpdate: true });
    expect(installAgyMailHook('project', dir).kind).toBe('updated');
    expect(JSON.parse(readFileSync(file, 'utf8'))[AGY_HOOK_NAME].enabled).toBeUndefined();

    expect(removeAgyMailHook('project', dir)).toEqual({ kind: 'removed', file });
    expect(existsSync(file)).toBe(false);
    expect(removeAgyMailHook('project', dir).kind).toBe('absent');
  });

  it('refuses invalid JSON or a malformed treeyard-mail section without touching the file', () => {
    const dir = tempDir();
    const file = agyHooksFile('project', dir);
    mkdirSync(join(dir, '.agents'));
    for (const bad of [
      '{',
      '[]',
      '{"treeyard-mail": []}',
      '{"treeyard-mail": {"PreInvocation": 1}}',
      '{"treeyard-mail": {"enabled": "no"}}',
    ]) {
      writeFileSync(file, bad);
      expect(() => installAgyMailHook('project', dir)).toThrow(/Antigravity|JSON/);
      expect(readFileSync(file, 'utf8')).toBe(bad);
    }
    expect(agyMailHookInstalled(file)).toBe(false);
  });

  it('keeps an untracked .agents/hooks.json out of git status and leaves a tracked one alone', () => {
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
    installAgyMailHook('project', dir, gitEnv);
    expect(execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: dir, env: gitEnv, encoding: 'utf8' })).toBe(
      '',
    );
    const exclude = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split('\n').filter((line) => line === '/.agents/hooks.json')).toHaveLength(1);

    const trackedDir = tempDir();
    execFileSync('git', ['init', '-q'], { cwd: trackedDir, env: gitEnv });
    mkdirSync(join(trackedDir, '.agents'));
    writeFileSync(join(trackedDir, '.agents', 'hooks.json'), '{}\n');
    execFileSync('git', ['add', '.agents/hooks.json'], { cwd: trackedDir, env: gitEnv });
    installAgyMailHook('project', trackedDir, gitEnv);
    const trackedExclude = join(trackedDir, '.git', 'info', 'exclude');
    if (existsSync(trackedExclude)) expect(readFileSync(trackedExclude, 'utf8')).not.toContain('/.agents/hooks.json');
  });

  it('uses ~/.gemini/config/hooks.json for --user', () => {
    const dir = tempDir();
    const own = env();
    installAgyMailHook('user', dir, own);
    expect(existsSync(join(dir, '.agents'))).toBe(false);
    const userFile = join(own.HOME, '.gemini', 'config', 'hooks.json');
    expect(agyHooksFile('user', dir, own)).toBe(userFile);
    expect(agyMailHookPlaces(dir, own)).toEqual([
      { brain: 'antigravity', scope: 'project', file: join(dir, '.agents', 'hooks.json'), installed: false },
      { brain: 'antigravity', scope: 'user', file: userFile, installed: true },
    ]);
  });
});

describe('letters delivered by Antigravity PreInvocation', () => {
  it('delivers as injectSteps systemMessage with prompt (invocationNum 0) and turn (invocationNum > 0)', async () => {
    const { dir, worker, boss, env } = project();
    addLetter(dir, { to: worker.id, from: boss.id, who: 'claude', text: 'проверь сборку', held: 'terminal' });
    const first = capture();
    const firstInput = parseAgyHookInput(
      JSON.stringify({
        conversationId: '9335cc3c-cd1c-469a-a84b-686a0bc0ef79',
        hookEventName: 'PreInvocation',
        invocationNum: 0,
      }),
    );
    expect(await deliverAgyMidTurn(env, firstInput, { emit: first.emit })).toEqual([1]);
    expect(JSON.parse(first.printed[0]!)).toEqual({
      injectSteps: [
        {
          systemMessage: {
            systemMessage: `Вместе с запросом пришло письмо для этой сессии.\nПисьмо от сессии узла «Координатор» (${boss.id}), не от человека; ответ — treeyard send ${boss.id} "…":\nпроверь сборку`,
          },
        },
      ],
    });
    expect(letterByNumber(dir, 1)?.delivered).toMatchObject({ how: 'prompt', session: 'antigravity 9335cc3c' });

    addLetter(dir, { to: worker.id, from: boss.id, who: 'claude', text: 'обнови тест' });
    const second = capture();
    expect(
      await deliverAgyMidTurn(
        env,
        { conversationId: '9335cc3c-cd1c-469a-a84b-686a0bc0ef79', hookEventName: 'PreInvocation', invocationNum: 1 },
        { emit: second.emit },
      ),
    ).toEqual([2]);
    expect(JSON.parse(second.printed[0]!)).toEqual({
      injectSteps: [
        {
          systemMessage: {
            systemMessage: `Пока ты работал, пришло письмо — учти его в этой работе:\nПисьмо от сессии узла «Координатор» (${boss.id}), не от человека; ответ — treeyard send ${boss.id} "…":\nобнови тест`,
          },
        },
      ],
    });
    expect(letterByNumber(dir, 2)?.delivered).toMatchObject({ how: 'turn', session: 'antigravity 9335cc3c' });
    expect(existsSync(flag(dir, worker.id))).toBe(false);

    // Other events and subagents never consume the node session's letters.
    addLetter(dir, { to: worker.id, text: 'только главной сессии' });
    expect(await deliverAgyMidTurn(env, { hookEventName: 'PostToolUse' }, { emit: second.emit })).toEqual([]);
    expect(await deliverAgyMidTurn(env, { agentId: 'sub-agy' }, { emit: second.emit })).toEqual([]);
    expect(queuedFor(dir, worker.id)).toHaveLength(1);
  });

  it('runs through the real AGY_HOOK_COMMAND shell line only when a letter waits', async () => {
    const { env, dir, worker, boss } = project();
    const { mark, stub, real } = shims();
    const runEnv: NodeJS.ProcessEnv = {
      ...env,
      TREEYARD_HOME: tempDir('treeyard-home-'),
      TREEYARD_LANG: 'ru',
      NO_COLOR: '1',
    };
    expect(await runAgyHook(runEnv, stub, '{}')).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(existsSync(mark)).toBe(false);

    addLetter(dir, { to: worker.id, from: boss.id, who: 'claude', text: 'письмо через PreInvocation' });
    const input = JSON.stringify({
      conversationId: 'cd506736-4351-4c20-9c78-cc32621654be',
      hookEventName: 'PreInvocation',
      invocationNum: 1,
    });
    const delivered = await runAgyHook(runEnv, real, input);
    expect(delivered.code).toBe(0);
    expect(delivered.stderr).toBe('');
    expect(JSON.parse(delivered.stdout).injectSteps[0].systemMessage.systemMessage).toContain(
      'письмо через PreInvocation',
    );
    expect(letterByNumber(dir, 1)?.delivered).toMatchObject({ how: 'turn', session: 'antigravity cd506736' });
    expect(await runAgyHook(runEnv, real, input)).toEqual({ code: 0, stdout: '', stderr: '' });
  });
});

describe('treeyard hook antigravity CLI (and agy alias), status and uninstall', () => {
  it('installs, accepts the agy alias, shows in status, and cleans up via remove and uninstall', async () => {
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
    const file = join(realpathSync(dir), '.agents', 'hooks.json');

    const before = await sh('hook', 'antigravity', 'status');
    expect(before.code).toBe(0);
    expect(before.stdout).toContain('хука нет');
    expect(before.stdout).toContain('treeyard hook antigravity install');
    expect((await sh('status')).stdout).toMatch(/Antigravity\s+не стоит · treeyard hook antigravity install/);

    const installed = await sh('hook', 'agy', 'install');
    expect(installed.code).toBe(0);
    expect(installed.stdout).toContain('хук поставлен');
    expect(installed.stdout).toContain('сессии Antigravity из узлов получат письма вместе с запросом и посреди хода');
    expect(installed.stdout).toContain('treeyard hook antigravity remove');
    expect(agyMailHookInstalled(file)).toBe(true);

    expect((await sh('hook', 'antigravity', 'status')).stdout).toContain('в проекте: хук стоит');
    expect((await sh('status')).stdout).toMatch(/Antigravity\s+стоит\s+в проекте/);

    // English help and --user install notice.
    const enSh = treeyardIn(dir, { ...env, TREEYARD_LANG: 'en' });
    const enHelp = await enSh('hook', '--help');
    expect(enHelp.stdout).toContain('treeyard hook antigravity install|remove|status [--user]');
    expect(enHelp.stdout).toContain('PreInvocation delivers with the prompt and during the turn');
    const userInstall = await enSh('hook', 'antigravity', 'install', '--user');
    expect(userInstall.stdout).toContain(
      'Antigravity sessions started from nodes will receive letters alongside a prompt and during a turn',
    );
    expect(userInstall.stdout).toContain('treeyard hook antigravity remove --user');

    const bad = await sh('hook', 'antigravity', 'enable');
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('treeyard hook antigravity install | remove | status [--user]');

    // `uninstall` removes both project and user Antigravity mail hooks while leaving unrelated hooks.
    const otherHook = { 'lint-checker': { PostToolUse: [] } };
    const merged = { ...otherHook, ...JSON.parse(readFileSync(file, 'utf8')) };
    writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
    const dry = await sh('uninstall', '--dry-run');
    expect(dry.stdout).toContain('хук Antigravity для писем');
    const removed = await sh('uninstall');
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain('хук Antigravity для писем');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(otherHook);
    expect(existsSync(join(home, '.gemini', 'config', 'hooks.json'))).toBe(false);
  }, 60_000);
});
