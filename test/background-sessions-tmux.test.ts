import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { liveSessions, panesAvailable, stopSession } from '@antondanv/brainyard';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { launch } from '../src/agents/launch.js';
import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { DEFAULTS, saveSettings } from '../src/settings.js';
import { defaultUi, saveUi } from '../src/tui/ui-state.js';
import { emptyTree, tempDir } from './helpers.js';

const run = promisify(execFile);
const socket = `treeyard-test-${process.pid}-background-term`;
const fixture = fileURLToPath(new URL('./fixtures/background-cli.mjs', import.meta.url));
const tsx = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
const main = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const tsconfig = fileURLToPath(new URL('../tsconfig.json', import.meta.url));
const term = async (...args: string[]) => (await run('tmux', ['-L', socket, '-f', '/dev/null', ...args])).stdout;
const screen = () => term('capture-pane', '-p', '-t', '=tree:');
const running = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function until(check: () => Promise<boolean>) {
  const end = Date.now() + 15_000;
  while (!(await check()) && Date.now() < end) await new Promise((done) => setTimeout(done, 60));
  expect(await check(), await screen()).toBe(true);
}
async function evidence(name: string) {
  const dir = process.env.TREEYARD_EVIDENCE_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.ans`), await term('capture-pane', '-p', '-e', '-t', '=tree:'));
}

describe.skipIf(!panesAvailable())('background sessions in a real TUI', () => {
  beforeAll(() => {
    vi.stubEnv('BRAINYARD_CLAUDE_BIN', JSON.stringify([process.execPath, fixture]));
    vi.stubEnv('BRAINYARD_TMUX_SOCKET', `${socket}-panes`);
  });
  afterAll(async () => {
    await term('kill-server').catch(() => undefined);
    vi.unstubAllEnvs();
  });

  it.each([100, 130])('stops the process and resumes the same saved conversation at %i×30', async (columns) => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Фоновая проверка', status: 'active' });
    const claudeHome = tempDir('treeyard-background-home-');
    vi.stubEnv('CLAUDE_CONFIG_DIR', claudeHome);
    const launched = await launch(tree, node.id, { brain: 'claude', start: 'do', background: true });
    expect(launched.result.ok).toBe(true);
    const id = launched.ref!.id;
    const current = (await liveSessions({ cwd: tree.project.dir, brains: ['claude'] })).find(
      (entry) => entry.id === id,
    )!;
    const pid = current.live!.pid!;
    expect(running(pid)).toBe(true);
    const home = tempDir('treeyard-background-settings-');
    saveSettings({ ...DEFAULTS, confirm: false, sleepAfter: 0, maxPanes: 0 }, { TREEYARD_HOME: home });
    saveUi(tree.project.dir, { ...defaultUi(), view: 'sessions', selected: node.id });
    try {
      const env = {
        TREEYARD_HOME: home,
        TREEYARD_LANG: '',
        BRAINYARD_CLAUDE_BIN: process.env.BRAINYARD_CLAUDE_BIN!,
        BRAINYARD_TMUX_SOCKET: process.env.BRAINYARD_TMUX_SOCKET!,
        BRAINYARD_CODEX_BIN: 'treeyard-test-no-codex',
        BRAINYARD_AGY_BIN: 'treeyard-test-no-agy',
        BRAINYARD_OPENCODE_BIN: 'treeyard-test-no-opencode',
        CLAUDE_CONFIG_DIR: claudeHome,
        TERM: 'xterm-256color',
        FORCE_COLOR: '2',
      };
      await term(
        'new-session',
        '-d',
        '-s',
        'tree',
        '-x',
        String(columns),
        '-y',
        '30',
        '-c',
        tree.project.dir,
        ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
        '--',
        'sh',
        '-c',
        `"${tsx}" --tsconfig "${tsconfig}" "${main}"; printf 'tree returned\\n'; sleep 60`,
      );
      await until(async () => (await screen()).includes('x усыпить') && (await screen()).includes('1 работает'));
      await evidence(`background-${columns}-before`);
      await term('send-keys', '-t', '=tree:', 'x');
      await until(async () => !running(pid) && (await screen()).includes('сессия спит · ⏎ — продолжить'));
      const asleep = await screen();
      expect(asleep).toContain('☾');
      expect(asleep.split('\n').slice(5).join('\n')).not.toContain('работает');
      expect(asleep.trimEnd().split('\n').length).toBeLessThanOrEqual(30);
      expect(loadTree(tree.project.dir).nodes.get(node.id)!.sessions).toMatchObject([{ id, mode: 'background' }]);
      await evidence(`background-${columns}-asleep`);
      await term('send-keys', '-t', '=tree:', 'Enter');
      await until(async () => (await screen()).includes(`Background conversation resumed ${id}`));
      expect(JSON.parse(readFileSync(join(tree.project.dir, 'background-resume.json'), 'utf8'))).toMatchObject({
        id,
        args: ['--resume', id],
      });
      await evidence(`background-${columns}-resumed`);
      await term('send-keys', '-t', '=tree:', 'q');
      await until(async () => (await screen()).includes('5 Сессии') && (await screen()).includes('спит'));
      expect(readFileSync(join(tree.project.dir, 'background-input.txt'), 'utf8')).toBe('q');
      await evidence(`background-${columns}-returned`);
      // A finished background entry from `agents --all` must stay asleep after the next poll.
      await new Promise((done) => setTimeout(done, 3200));
      expect((await screen()).split('\n').slice(5).join('\n')).not.toContain('работает');
      expect(await screen()).toContain('спит');
      await term('send-keys', '-t', '=tree:', 'q');
      await until(async () => (await screen()).includes('tree returned'));
    } finally {
      if (running(pid)) await stopSession({ brain: 'claude', sessionId: id, cwd: tree.project.dir });
      await term('kill-session', '-t', '=tree').catch(() => undefined);
      expect(running(pid)).toBe(false);
      expect(existsSync(join(claudeHome, 'background.json'))).toBe(true);
    }
  });
});
