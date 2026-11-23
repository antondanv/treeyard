import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  claudeSettingsFile,
  deliverMidTurn,
  HOOK_COMMAND,
  installMailHook,
  mailHookInstalled,
  mailHookPlaces,
  parseHookInput,
  removeMailHook,
} from '../src/agents/turn-hook.js';
import { setLang } from '../src/i18n/i18n.js';
import { letterState } from '../src/model/mail.js';
import {
  addLetter,
  dropFile,
  INBOX,
  LOCK,
  letterByNumber,
  mailDir,
  markDelivered,
  queuedFor,
  takeFile,
} from '../src/model/mailbox.js';
import { NODE_VAR, PROJECT_VAR } from '../src/model/notes.js';
import { addNode } from '../src/model/ops.js';
import { emptyTree, tempDir, treeyardIn, tsx } from './helpers.js';

const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));

const flag = (dir: string, node: string) => join(mailDir(dir), INBOX, node);

/** A project with a node `Сайт` and a node `Координатор`. */
function project() {
  const tree = emptyTree();
  const site = addNode(tree, { title: 'Сайт', status: 'active' });
  const boss = addNode(tree, { title: 'Координатор', status: 'active' });
  const env = { [NODE_VAR]: site.id, [PROJECT_VAR]: tree.project.dir };
  return { tree, dir: tree.project.dir, site, boss, env };
}

/** What the hook printed, as Claude Code would read it. */
function capture() {
  const printed: string[] = [];
  return { printed, emit: (text: string) => printed.push(text) };
}

describe('the inbox flag', () => {
  it('stands while letters wait for a node, and goes with the last of them', () => {
    const { dir, site, boss } = project();
    expect(existsSync(flag(dir, site.id))).toBe(false);
    const first = addLetter(dir, { to: site.id, from: boss.id, text: 'раз' });
    const second = addLetter(dir, { to: site.id, from: boss.id, text: 'два' });
    expect(existsSync(flag(dir, site.id))).toBe(true);
    // Another node's letters are not this node's business.
    addLetter(dir, { to: boss.id, text: 'тебе' });
    expect(existsSync(flag(dir, boss.id))).toBe(true);

    markDelivered(dir, [first.n], 'typed');
    expect(existsSync(flag(dir, site.id))).toBe(true);
    markDelivered(dir, [second.n], 'typed');
    expect(existsSync(flag(dir, site.id))).toBe(false);
    expect(existsSync(flag(dir, boss.id))).toBe(true);
  });

  it('does not change what the mailbox reads', () => {
    const { dir, site } = project();
    addLetter(dir, { to: site.id, text: 'раз' });
    expect(queuedFor(dir, site.id).map((letter) => letter.n)).toEqual([1]);
    expect(addLetter(dir, { to: site.id, text: 'два' }).n).toBe(2);
  });
});

describe('the hook in Claude Code settings', () => {
  const env = () => ({ CLAUDE_CONFIG_DIR: tempDir('treeyard-claude-') });

  it('goes into the project’s local settings and leaves the rest of the file as it was', () => {
    const dir = tempDir();
    const file = join(dir, '.claude', 'settings.local.json');
    mkdirSync(join(dir, '.claude'));
    const mine = {
      permissions: { allow: ['Bash(npm test)'] },
      hooks: {
        PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier --write' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
      },
    };
    writeFileSync(file, JSON.stringify(mine));
    expect(installMailHook('project', dir, env())).toEqual({ kind: 'installed', file });
    const settings = JSON.parse(readFileSync(file, 'utf8'));
    expect(settings.permissions).toEqual(mine.permissions);
    expect(settings.hooks.Stop).toEqual(mine.hooks.Stop);
    expect(settings.hooks.PostToolUse).toEqual([
      mine.hooks.PostToolUse[0],
      { matcher: '*', hooks: [{ type: 'command', command: HOOK_COMMAND, timeout: 10 }] },
    ]);
    expect(mailHookInstalled(file)).toBe(true);
  });

  it('is put once, whoever asks again', () => {
    const dir = tempDir();
    const file = claudeSettingsFile('project', dir);
    expect(installMailHook('project', dir).kind).toBe('installed');
    const text = readFileSync(file, 'utf8');
    expect(installMailHook('project', dir).kind).toBe('already');
    expect(readFileSync(file, 'utf8')).toBe(text);
    // An older line of ours is replaced, not doubled.
    const old = JSON.parse(text);
    old.hooks.PostToolUse[0].hooks[0].command = 'treeyard hook claude mail';
    writeFileSync(file, JSON.stringify(old));
    expect(installMailHook('project', dir).kind).toBe('updated');
    expect(JSON.parse(readFileSync(file, 'utf8')).hooks.PostToolUse).toHaveLength(1);
    expect(JSON.parse(readFileSync(file, 'utf8')).hooks.PostToolUse[0].hooks[0].command).toBe(HOOK_COMMAND);
  });

  it('comes out alone: others’ hooks and settings stay, an empty file goes', () => {
    const dir = tempDir();
    const file = claudeSettingsFile('project', dir);
    installMailHook('project', dir);
    expect(removeMailHook('project', dir)).toEqual({ kind: 'removed', file });
    expect(existsSync(file)).toBe(false);
    expect(removeMailHook('project', dir).kind).toBe('absent');

    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({ model: 'opus', hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'echo 1' }] }] } }),
    );
    installMailHook('project', dir);
    removeMailHook('project', dir);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      model: 'opus',
      hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'echo 1' }] }] },
    });
  });

  it('refuses a file it cannot read as settings, and leaves it alone', () => {
    const dir = tempDir();
    const file = claudeSettingsFile('project', dir);
    mkdirSync(join(dir, '.claude'));
    for (const text of ['{ "hooks": ', '[]', '{"hooks": []}', '{"hooks": {"PostToolUse": {}}}']) {
      writeFileSync(file, text);
      expect(() => installMailHook('project', dir)).toThrow();
      expect(readFileSync(file, 'utf8')).toBe(text);
    }
    // Nothing to take out of a file that is not settings.
    writeFileSync(file, 'не json');
    expect(mailHookInstalled(file)).toBe(false);
  });

  it('goes into the person’s own settings only when asked with --user', () => {
    const dir = tempDir();
    const own = env();
    installMailHook('user', dir, own);
    expect(existsSync(join(dir, '.claude'))).toBe(false);
    expect(mailHookPlaces(dir, own).map(({ scope, installed }) => [scope, installed])).toEqual([
      ['project', false],
      ['user', true],
    ]);
    expect(claudeSettingsFile('user', dir, own)).toBe(join(own.CLAUDE_CONFIG_DIR, 'settings.json'));
    expect(removeMailHook('user', dir, own).kind).toBe('removed');
  });

  it('keeps itself out of git status', () => {
    const dir = tempDir();
    // A machine without the person's global ignore file, which may already list this file.
    const bare = tempDir('treeyard-bare-home-');
    const git = {
      ...process.env,
      HOME: bare,
      XDG_CONFIG_HOME: bare,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    };
    execFileSync('git', ['init', '-q'], { cwd: dir, env: git });
    installMailHook('project', dir, git);
    expect(execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: dir, env: git, encoding: 'utf8' })).toBe('');
    // Again: one line in the exclude file, not two.
    installMailHook('project', dir, git);
    const exclude = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split('\n').filter((line) => line === '/.claude/settings.local.json')).toHaveLength(1);
  });
});

describe('letters between two tool calls', () => {
  it('reach the model as context of the turn, and are marked «посреди хода»', async () => {
    const { dir, site, boss, env } = project();
    addLetter(dir, { to: site.id, from: boss.id, who: 'claude', text: 'поправь заголовок' });
    const { printed, emit } = capture();
    const done = await deliverMidTurn(env, { session_id: '1a2b3c4d-0000', hook_event_name: 'PostToolUse' }, { emit });
    expect(done).toEqual([1]);
    expect(printed).toHaveLength(1);
    const out = JSON.parse(printed[0]!);
    expect(out.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    // Whose letter it is and how to answer, as for a letter typed into a pane.
    expect(out.hookSpecificOutput.additionalContext).toBe(
      `Пока ты работал, пришло письмо — учти его в этой работе:\nПисьмо от сессии узла «Координатор» (${boss.id}), не от человека; ответ — treeyard send ${boss.id} "…":\nпоправь заголовок`,
    );
    const letter = letterByNumber(dir, 1)!;
    expect(letter.state).toBe('delivered');
    expect(letter.delivered).toMatchObject({ how: 'turn', session: 'claude 1a2b3c4d' });
    expect(letterState({ state: 'delivered', how: 'turn' })).toBe('доставлено: посреди хода');
    expect(existsSync(flag(dir, site.id))).toBe(false);
  });

  it('do not come a second time', async () => {
    const { dir, site, env } = project();
    addLetter(dir, { to: site.id, text: 'раз' });
    const first = capture();
    expect(await deliverMidTurn(env, {}, { emit: first.emit })).toEqual([1]);
    const second = capture();
    expect(await deliverMidTurn(env, {}, { emit: second.emit })).toEqual([]);
    expect(second.printed).toEqual([]);
    // A letter that came since is the only one the next call brings.
    addLetter(dir, { to: site.id, text: 'два' });
    const third = capture();
    expect(await deliverMidTurn(env, {}, { emit: third.emit })).toEqual([2]);
    expect(JSON.parse(third.printed[0]!).hookSpecificOutput.additionalContext).toContain('два');
    expect(JSON.parse(third.printed[0]!).hookSpecificOutput.additionalContext).not.toContain('раз');
  });

  it('come together, a person’s letter as it is written', async () => {
    const { dir, site, boss, env } = project();
    addLetter(dir, { to: site.id, text: 'от человека из shell', who: 'ты' });
    addLetter(dir, { to: site.id, from: boss.id, text: 'от координатора' });
    const { printed, emit } = capture();
    expect(await deliverMidTurn(env, {}, { emit })).toEqual([1, 2]);
    expect(printed).toHaveLength(1);
    const text = JSON.parse(printed[0]!).hookSpecificOutput.additionalContext as string;
    expect(
      text.startsWith(
        'Пока ты работал, пришли письма — учти их в этой работе:\nот человека из shell\n\nПисьмо от сессии',
      ),
    ).toBe(true);
    // The event of the hook is the one Claude Code ran it for.
    expect(JSON.parse(printed[0]!).hookSpecificOutput.hookEventName).toBe('PostToolUse');
  });

  it('say it in the language of the tree', async () => {
    const { dir, site, boss, env } = project();
    setLang('en');
    try {
      addLetter(dir, { to: site.id, from: boss.id, text: 'fix the title' });
      const { printed, emit } = capture();
      await deliverMidTurn(env, {}, { emit });
      expect(JSON.parse(printed[0]!).hookSpecificOutput.additionalContext).toMatch(
        /^A letter came while you were working — take it into account in this work:\nA message from the session of node/,
      );
    } finally {
      setLang('ru');
    }
  });

  it('go only to the node of the session, never to a subagent or a session of no node', async () => {
    const { dir, site, boss, env } = project();
    addLetter(dir, { to: site.id, text: 'тебе' });
    const { printed, emit } = capture();
    // A subagent of the session reads its own context: the letter is for the session.
    expect(await deliverMidTurn(env, { agent_id: 'sub-1' }, { emit })).toEqual([]);
    expect(await deliverMidTurn({}, {}, { emit })).toEqual([]);
    expect(await deliverMidTurn({ [NODE_VAR]: boss.id, [PROJECT_VAR]: dir }, {}, { emit })).toEqual([]);
    expect(await deliverMidTurn({ [NODE_VAR]: site.id }, {}, { emit })).toEqual([]);
    expect(printed).toEqual([]);
    expect(queuedFor(dir, site.id)).toHaveLength(1);
  });

  it('stay in the mailbox when nothing could be printed', async () => {
    const { dir, site, env } = project();
    addLetter(dir, { to: site.id, text: 'раз' });
    await expect(
      deliverMidTurn(
        env,
        {},
        {
          emit: () => {
            throw new Error('EPIPE');
          },
        },
      ),
    ).rejects.toThrow('EPIPE');
    expect(queuedFor(dir, site.id)).toHaveLength(1);
    expect(existsSync(flag(dir, site.id))).toBe(true);
  });

  it('are never cut: a letter too long for the hook waits for the pane, the short ones go', async () => {
    const { dir, site, env } = project();
    addLetter(dir, { to: site.id, text: 'коротко' });
    addLetter(dir, { to: site.id, text: 'д'.repeat(9500) });
    const { printed, emit } = capture();
    expect(await deliverMidTurn(env, {}, { emit })).toEqual([1]);
    expect(printed[0]).not.toContain('дддд');
    expect(queuedFor(dir, site.id).map((letter) => letter.n)).toEqual([2]);
    // Nothing fits any more: nothing is printed, the letter keeps waiting.
    const again = capture();
    expect(await deliverMidTurn(env, {}, { emit: again.emit })).toEqual([]);
    expect(again.printed).toEqual([]);
  });

  it('wait for the mailbox lock of a delivery in progress, and never hold the tool call long', async () => {
    const { dir, site, env } = project();
    addLetter(dir, { to: site.id, text: 'раз' });
    expect(takeFile(dir, LOCK)).toBe(true);
    try {
      const { printed, emit } = capture();
      await expect(deliverMidTurn(env, {}, { emit, lockWaitMs: 250 })).rejects.toThrow('mailbox lock');
      // Nothing went out, nothing was marked: the next tool call (or the deliverer) has the letter.
      expect(printed).toEqual([]);
      expect(queuedFor(dir, site.id)).toHaveLength(1);
    } finally {
      dropFile(dir, LOCK);
    }
    expect(await deliverMidTurn(env, {}, { emit: capture().emit })).toEqual([1]);
  });

  it('lower a flag that nothing stands behind', async () => {
    const { dir, site, env } = project();
    mkdirSync(join(mailDir(dir), INBOX), { recursive: true });
    writeFileSync(flag(dir, site.id), '');
    expect(await deliverMidTurn(env, {})).toEqual([]);
    expect(existsSync(flag(dir, site.id))).toBe(false);
  });

  it('read what Claude Code sends, whatever else it sends', () => {
    expect(
      parseHookInput('{"session_id":"abc","hook_event_name":"PostToolUse","tool_name":"Bash","agent_id":"x"}'),
    ).toEqual({ session_id: 'abc', hook_event_name: 'PostToolUse', agent_id: 'x' });
    expect(parseHookInput('')).toEqual({});
    expect(parseHookInput('not json')).toEqual({});
    expect(parseHookInput('[1]')).toEqual({});
  });
});

/** An empty `treeyard` on PATH that notes it was started, and one that is the real thing from source. */
function shims() {
  const bin = tempDir('treeyard-bin-');
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

/** The hook as Claude Code starts it: `sh -c <command>` with the session's environment and a JSON on stdin. */
function runHook(env: NodeJS.ProcessEnv, path: string, stdin: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    const child = execFile(
      '/bin/sh',
      ['-c', HOOK_COMMAND],
      { env: { ...env, PATH: `${path}:${process.env.PATH}` }, timeout: 30_000 },
      (error, stdout, stderr) =>
        done({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, stdout, stderr }),
    );
    child.stdin?.end(stdin);
  });
}

describe('the shell line of the hook', () => {
  const sessionEnv = (env: Record<string, string>, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
    ...env,
    TREEYARD_HOME: tempDir('treeyard-home-'),
    TREEYARD_LANG: 'ru',
    NO_COLOR: '1',
    ...extra,
  });

  it('starts nothing without a letter for the node: no flag, no treeyard', async () => {
    const { env, dir, boss } = project();
    const { mark, stub } = shims();
    const noFlag = await runHook(sessionEnv(env), stub, '{}');
    expect(noFlag).toEqual({ code: 0, stdout: '', stderr: '' });
    // A letter for another node does not wake this one's hook.
    addLetter(dir, { to: boss.id, text: 'не тебе' });
    await runHook(sessionEnv(env), stub, '{}');
    // Not a session of a node at all.
    await runHook(sessionEnv({}), stub, '{}');
    await runHook(sessionEnv({ [NODE_VAR]: env[NODE_VAR] }), stub, '{}');
    expect(existsSync(mark)).toBe(false);
  });

  it('starts treeyard when a letter waits, and a missing treeyard is no failure', async () => {
    const { env, dir, site } = project();
    const { mark, stub } = shims();
    addLetter(dir, { to: site.id, text: 'тебе' });
    expect((await runHook(sessionEnv(env), stub, '{}')).code).toBe(0);
    expect(readFileSync(mark, 'utf8')).toBe('started\n');
    // No treeyard on this PATH: the tool call goes on, quietly.
    const lost = await new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
      execFile(
        '/bin/sh',
        ['-c', HOOK_COMMAND],
        { env: { ...sessionEnv(env), PATH: '/nonexistent' } },
        (error, stdout, stderr) => done({ code: error ? 1 : 0, stdout, stderr }),
      );
    });
    expect(lost).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('hands the letter over through the real command, once', async () => {
    const { env, dir, site, boss } = project();
    const { real } = shims();
    addLetter(dir, { to: site.id, from: boss.id, who: 'claude', text: 'сначала тесты' });
    const input = JSON.stringify({ session_id: 'feedface-1111', hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    const first = await runHook(sessionEnv(env), real, input);
    expect(first.code).toBe(0);
    expect(first.stderr).toBe('');
    const out = JSON.parse(first.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(out.hookSpecificOutput.additionalContext).toContain('сначала тесты');
    // The mailbox says how it came; the flag is gone, so the next tool call costs nothing.
    expect(letterByNumber(dir, 1)?.delivered).toMatchObject({ how: 'turn', session: 'claude feedface' });
    expect(existsSync(flag(dir, site.id))).toBe(false);
    const second = await runHook(sessionEnv(env), real, input);
    expect(second).toEqual({ code: 0, stdout: '', stderr: '' });
  });
});

describe('treeyard hook claude', () => {
  it('puts the hook in, shows it in status and takes it out', async () => {
    const dir = tempDir();
    const own = tempDir('treeyard-claude-');
    const sh = treeyardIn(dir, { CLAUDE_CONFIG_DIR: own });
    expect((await sh('init', '--template', 'directions', '--goal', 'всё работает')).code).toBe(0);
    // The tree's folder by its real path (/private/var on macOS).
    const file = join(realpathSync(dir), '.claude', 'settings.local.json');

    let status = await sh('hook', 'claude', 'status');
    expect(status.code).toBe(0);
    expect(status.stdout).toContain('хука нет');
    expect(status.stdout).toContain('treeyard hook claude install');
    expect((await sh('status')).stdout).toMatch(/хук писем\s+Claude Code не стоит · treeyard hook claude install/);

    const put = await sh('hook', 'claude', 'install');
    expect(put.code).toBe(0);
    expect(put.stdout).toContain('хук поставлен');
    expect(put.stdout).toContain('treeyard hook claude remove');
    expect(mailHookInstalled(file)).toBe(true);
    expect((await sh('hook', 'claude', 'install')).stdout).toContain('хук уже стоит');

    status = await sh('hook', 'claude', 'status');
    expect(status.stdout).toContain('в проекте: хук стоит');
    const text = (await sh('status')).stdout;
    expect(text).toMatch(/хук писем\s+Claude Code стоит\s+в проекте/);
    const json = JSON.parse((await sh('status', '--json')).stdout);
    expect(json.mailHook).toEqual([
      { scope: 'project', file, installed: true },
      { scope: 'user', file: join(own, 'settings.json'), installed: false },
    ]);

    expect((await sh('hook', 'claude', 'remove')).stdout).toContain('хук убран');
    expect(existsSync(file)).toBe(false);
    expect((await sh('hook', 'claude', 'remove')).stdout).toContain('хука нет');
  });

  it('touches the person’s own settings only with --user', async () => {
    const dir = tempDir();
    const own = tempDir('treeyard-claude-');
    const sh = treeyardIn(dir, { CLAUDE_CONFIG_DIR: own });
    expect((await sh('init', '--template', 'directions', '--goal', 'всё работает')).code).toBe(0);
    await sh('hook', 'claude', 'install');
    expect(existsSync(join(own, 'settings.json'))).toBe(false);
    const user = await sh('hook', 'claude', 'install', '--user');
    expect(user.stdout).toContain('treeyard hook claude remove --user');
    expect(mailHookInstalled(join(own, 'settings.json'))).toBe(true);
    expect((await sh('status')).stdout).toMatch(/хук писем\s+Claude Code стоит\s+в проекте/);
    expect((await sh('hook', 'claude', 'remove', '--user')).stdout).toContain('хук убран');
    expect(existsSync(join(own, 'settings.json'))).toBe(false);
    expect(mailHookInstalled(join(dir, '.claude', 'settings.local.json'))).toBe(true);
  });

  it('is told wrong in a line, and the English help has it too', async () => {
    const dir = tempDir();
    const sh = treeyardIn(dir);
    const bad = await sh('hook', 'claude', 'enable');
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toContain('treeyard hook claude install | remove | status [--user]');
    const help = await sh('hook', '--help');
    expect(help.stdout).toContain('treeyard hook claude install|remove|status [--user]');
    const en = await treeyardIn(dir, { TREEYARD_LANG: 'en' })('hook', '--help');
    expect(en.stdout).toContain('Claude Code hook: a letter for a busy node session arrives between');
  });

  it('comes out with `treeyard uninstall`', async () => {
    const dir = tempDir();
    const own = tempDir('treeyard-claude-');
    const home = tempDir('treeyard-home-');
    const env = { CLAUDE_CONFIG_DIR: own, HOME: home, TREEYARD_HOME: join(home, '.treeyard'), TREEYARD_SKILLS: '' };
    const sh = treeyardIn(dir, env);
    expect((await sh('init', '--template', 'directions', '--goal', 'всё работает')).code).toBe(0);
    await sh('hook', 'claude', 'install');
    const file = join(dir, '.claude', 'settings.local.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('{', '{"model":"opus",'));
    expect((await sh('uninstall', '--dry-run')).stdout).toContain('хук Claude Code для писем');
    const done = await sh('uninstall');
    expect(done.stdout).toContain('хук Claude Code для писем');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ model: 'opus' });
  });
});
