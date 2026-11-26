import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CODEX_HOOK_COMMAND,
  codexHooksFile,
  codexMailHookInstalled,
  codexMailHookPlaces,
  deliverCodexMidTurn,
  installCodexMailHook,
  removeCodexMailHook,
} from '../src/agents/codex-hook.js';
import { deliverHookMail } from '../src/agents/turn-hook.js';
import { addLetter, INBOX, letterByNumber, mailDir, queuedFor } from '../src/model/mailbox.js';
import { NODE_VAR, PROJECT_VAR } from '../src/model/notes.js';
import { addNode } from '../src/model/ops.js';
import { emptyTree, tempDir, treeyardIn, tsx } from './helpers.js';

const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const flag = (dir: string, node: string) => join(mailDir(dir), INBOX, node);

function project() {
  const tree = emptyTree();
  const worker = addNode(tree, { title: 'Воркер Codex', status: 'active' });
  const boss = addNode(tree, { title: 'Координатор', status: 'active' });
  const env = { [NODE_VAR]: worker.id, [PROJECT_VAR]: tree.project.dir };
  return { tree, dir: tree.project.dir, worker, boss, env };
}

function capture() {
  const printed: string[] = [];
  return { printed, emit: (text: string) => printed.push(text) };
}

function shims() {
  const bin = tempDir('treeyard-codex-bin-');
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

function runCodexHook(env: NodeJS.ProcessEnv, path: string, stdin: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    const child = execFile(
      '/bin/sh',
      ['-c', CODEX_HOOK_COMMAND],
      { env: { ...env, PATH: `${path}:${process.env.PATH}` }, timeout: 30_000 },
      (error, stdout, stderr) =>
        done({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, stdout, stderr }),
    );
    // A hook that decides from its environment alone exits before reading stdin.
    child.stdin?.on('error', () => {});
    child.stdin?.end(stdin);
  });
}

describe('the hook in Codex hooks.json', () => {
  const env = () => ({ CODEX_HOME: tempDir('treeyard-codex-'), CLAUDE_CONFIG_DIR: tempDir('treeyard-claude-') });

  it('installs into .codex/hooks.json and leaves existing hooks untouched', () => {
    const dir = tempDir();
    const file = join(dir, '.codex', 'hooks.json');
    mkdirSync(join(dir, '.codex'));
    const mine = {
      hooks: {
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo audit' }] }],
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo prompt' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'echo stop' }] }],
      },
    };
    writeFileSync(file, JSON.stringify(mine));
    expect(installCodexMailHook('project', dir, env())).toEqual({ kind: 'installed', file });
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    expect(parsed.hooks.Stop).toEqual(mine.hooks.Stop);
    expect(parsed.hooks.PostToolUse).toEqual([
      mine.hooks.PostToolUse[0],
      { matcher: '*', hooks: [{ type: 'command', command: CODEX_HOOK_COMMAND, timeout: 10 }] },
    ]);
    expect(parsed.hooks.UserPromptSubmit).toEqual([
      mine.hooks.UserPromptSubmit[0],
      { hooks: [{ type: 'command', command: CODEX_HOOK_COMMAND, timeout: 10 }] },
    ]);
    expect(codexMailHookInstalled(file)).toBe(true);
    expect(installCodexMailHook('project', dir, env()).kind).toBe('already');
  });

  it('updates an outdated entry and removes only Treeyard’s entries', () => {
    const dir = tempDir();
    const file = codexHooksFile('project', dir);
    installCodexMailHook('project', dir);
    const data = JSON.parse(readFileSync(file, 'utf8'));
    data.hooks.PostToolUse[0].hooks[0].command = 'treeyard hook codex mail';
    writeFileSync(file, JSON.stringify(data));
    expect(codexMailHookPlaces(dir)[0]).toMatchObject({ scope: 'project', installed: true, needsUpdate: true });
    expect(installCodexMailHook('project', dir).kind).toBe('updated');
    expect(codexMailHookPlaces(dir)[0]).toEqual({ brain: 'codex', scope: 'project', file, installed: true });

    expect(removeCodexMailHook('project', dir)).toEqual({ kind: 'removed', file });
    expect(existsSync(file)).toBe(false);
    expect(removeCodexMailHook('project', dir).kind).toBe('absent');
  });

  it('refuses invalid JSON or a malformed hooks section without touching the file', () => {
    const dir = tempDir();
    const file = codexHooksFile('project', dir);
    mkdirSync(join(dir, '.codex'));
    for (const bad of ['{', '[]', '{"hooks": []}', '{"hooks": {"PostToolUse": 1}}']) {
      writeFileSync(file, bad);
      expect(() => installCodexMailHook('project', dir)).toThrow(/Codex|JSON/);
      expect(readFileSync(file, 'utf8')).toBe(bad);
    }
    expect(codexMailHookInstalled(file)).toBe(false);
  });

  it('keeps an untracked .codex/hooks.json out of git status and leaves a tracked one alone', () => {
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
    installCodexMailHook('project', dir, gitEnv);
    expect(execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: dir, env: gitEnv, encoding: 'utf8' })).toBe(
      '',
    );
    const exclude = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split('\n').filter((line) => line === '/.codex/hooks.json')).toHaveLength(1);

    // A repository that already tracks .codex/hooks.json does not get an exclude line.
    const trackedDir = tempDir();
    execFileSync('git', ['init', '-q'], { cwd: trackedDir, env: gitEnv });
    mkdirSync(join(trackedDir, '.codex'));
    writeFileSync(join(trackedDir, '.codex', 'hooks.json'), '{}\n');
    execFileSync('git', ['add', '.codex/hooks.json'], { cwd: trackedDir, env: gitEnv });
    installCodexMailHook('project', trackedDir, gitEnv);
    const trackedExclude = join(trackedDir, '.git', 'info', 'exclude');
    if (existsSync(trackedExclude)) expect(readFileSync(trackedExclude, 'utf8')).not.toContain('/.codex/hooks.json');
  });

  it('uses $CODEX_HOME/hooks.json (or ~/.codex/hooks.json) for --user', () => {
    const dir = tempDir();
    const own = env();
    installCodexMailHook('user', dir, own);
    expect(existsSync(join(dir, '.codex'))).toBe(false);
    expect(codexHooksFile('user', dir, own)).toBe(join(own.CODEX_HOME, 'hooks.json'));
    expect(codexMailHookPlaces(dir, own)).toEqual([
      { brain: 'codex', scope: 'project', file: join(dir, '.codex', 'hooks.json'), installed: false },
      { brain: 'codex', scope: 'user', file: join(own.CODEX_HOME, 'hooks.json'), installed: true },
    ]);
    const homeFallback = tempDir('treeyard-codex-home-fallback-');
    expect(codexHooksFile('user', dir, { HOME: homeFallback })).toBe(join(homeFallback, '.codex', 'hooks.json'));
  });
});

describe('letters delivered by the Codex hooks and shared hook delivery', () => {
  it('delivers on PostToolUse and UserPromptSubmit and records codex <short> in the mailbox', async () => {
    const { dir, worker, boss, env } = project();
    addLetter(dir, { to: worker.id, from: boss.id, who: 'claude', text: 'обнови тест' });
    const first = capture();
    expect(
      await deliverCodexMidTurn(
        env,
        { session_id: '01a20e14-a027-7442', hook_event_name: 'PostToolUse' },
        { emit: first.emit },
      ),
    ).toEqual([1]);
    expect(JSON.parse(first.printed[0]!).hookSpecificOutput).toEqual({
      hookEventName: 'PostToolUse',
      additionalContext: `Пока ты работал, пришло письмо — учти его в этой работе:\nПисьмо от сессии узла «Координатор» (${boss.id}), не от человека; ответ — treeyard send ${boss.id} "…":\nобнови тест`,
    });
    expect(letterByNumber(dir, 1)?.delivered).toMatchObject({ how: 'turn', session: 'codex 01a20e14' });

    addLetter(dir, { to: worker.id, from: boss.id, who: 'claude', text: 'проверь сборку', held: 'terminal' });
    const second = capture();
    expect(
      await deliverCodexMidTurn(
        env,
        { session_id: '01a20e14-a027-7442', hook_event_name: 'UserPromptSubmit' },
        { emit: second.emit },
      ),
    ).toEqual([2]);
    expect(letterByNumber(dir, 2)?.delivered).toMatchObject({ how: 'prompt', session: 'codex 01a20e14' });
    expect(existsSync(flag(dir, worker.id))).toBe(false);
    // Subagents of Codex never take the session's letters.
    addLetter(dir, { to: worker.id, text: 'только главной сессии' });
    expect(await deliverCodexMidTurn(env, { agent_id: 'sub-codex' }, { emit: second.emit })).toEqual([]);
    expect(queuedFor(dir, worker.id)).toHaveLength(1);
  });

  it('runs through the real CODEX_HOOK_COMMAND shell line only when a letter waits', async () => {
    const { env, dir, worker, boss } = project();
    const { mark, stub, real } = shims();
    const runEnv: NodeJS.ProcessEnv = {
      ...env,
      TREEYARD_HOME: tempDir('treeyard-home-'),
      TREEYARD_LANG: 'ru',
      NO_COLOR: '1',
    };
    expect(await runCodexHook(runEnv, stub, '{}')).toEqual({ code: 0, stdout: '', stderr: '' });
    expect(existsSync(mark)).toBe(false);

    addLetter(dir, { to: worker.id, from: boss.id, who: 'claude', text: 'письмо через shell' });
    const input = JSON.stringify({
      session_id: '01a20e15-c23d-77d2',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
    });
    const delivered = await runCodexHook(runEnv, real, input);
    expect(delivered.code).toBe(0);
    expect(delivered.stderr).toBe('');
    expect(JSON.parse(delivered.stdout).hookSpecificOutput.additionalContext).toContain('письмо через shell');
    expect(letterByNumber(dir, 1)?.delivered).toMatchObject({ how: 'turn', session: 'codex 01a20e15' });
    expect(await runCodexHook(runEnv, real, input)).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('exposes deliverHookMail as a reusable building block for other CLIs (Antigravity, OpenCode)', async () => {
    const { dir, worker, boss, env } = project();
    addLetter(dir, { to: worker.id, from: boss.id, text: 'для будущих хуков' });
    const payloads: unknown[] = [];
    const numbers = await deliverHookMail(env, {
      brain: 'antigravity',
      how: 'turn',
      sessionId: '3c48be1e-1b0c',
      deliver: (context) => payloads.push({ injectSteps: [{ systemMessage: { systemMessage: context } }] }),
    });
    expect(numbers).toEqual([1]);
    expect(payloads).toEqual([
      {
        injectSteps: [
          {
            systemMessage: {
              systemMessage: expect.stringContaining('для будущих хуков'),
            },
          },
        ],
      },
    ]);
    expect(letterByNumber(dir, 1)?.delivered).toMatchObject({ how: 'turn', session: 'antigravity 3c48be1e' });
  });
});

describe('treeyard hook codex CLI, status and uninstall', () => {
  it('installs, warns about one-time Codex trust, shows in status, and cleans up via remove and uninstall', async () => {
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
    const file = join(realpathSync(dir), '.codex', 'hooks.json');

    const before = await sh('hook', 'codex', 'status');
    expect(before.code).toBe(0);
    expect(before.stdout).toContain('хука нет');
    expect(before.stdout).toContain('treeyard hook codex install');
    expect((await sh('status')).stdout).toMatch(/Codex\s+не стоит · treeyard hook codex install/);

    const installed = await sh('hook', 'codex', 'install');
    expect(installed.code).toBe(0);
    expect(installed.stdout).toContain('хук поставлен');
    expect(installed.stdout).toContain('после одобрения хука в Codex (при старте сессии или /hooks)');
    expect(installed.stdout).toContain('treeyard hook codex remove');
    expect(codexMailHookInstalled(file)).toBe(true);

    expect((await sh('hook', 'codex', 'status')).stdout).toContain('в проекте: хук стоит');
    expect((await sh('status')).stdout).toMatch(/Codex\s+стоит\s+в проекте/);

    // English help and install notice.
    const enSh = treeyardIn(dir, { ...env, TREEYARD_LANG: 'en' });
    const enHelp = await enSh('hook', '--help');
    expect(enHelp.stdout).toContain('treeyard hook codex install|remove|status [--user]');
    expect(enHelp.stdout).toContain('trust once at start or /hooks');
    const userInstall = await enSh('hook', 'codex', 'install', '--user');
    expect(userInstall.stdout).toContain('once you trust the hook in Codex (at session start or via /hooks)');
    expect(userInstall.stdout).toContain('treeyard hook codex remove --user');

    const bad = await sh('hook', 'codex', 'enable');
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('treeyard hook codex install | remove | status [--user]');

    // `uninstall` removes both project and user Codex mail hooks while leaving unrelated settings.
    writeFileSync(file, readFileSync(file, 'utf8').replace('{', '{"other":1,'));
    const dry = await sh('uninstall', '--dry-run');
    expect(dry.stdout).toContain('хук Codex для писем');
    const removed = await sh('uninstall');
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain('хук Codex для писем');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ other: 1 });
    expect(existsSync(join(codexOwn, 'hooks.json'))).toBe(false);
  }, 60_000);
});
