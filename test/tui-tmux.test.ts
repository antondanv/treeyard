import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { capturePane, closePane, listPanes, panesAvailable, sendToPane } from '@antondanv/brainyard';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { launchInPane } from '../src/agents/panes.js';
import { addNode } from '../src/model/ops.js';
import { defaultUi, saveUi } from '../src/tui/ui-state.js';
import { emptyTree, tempDir } from './helpers.js';

const run = promisify(execFile);
// Sessions live on one test server, the tree runs in a terminal on another: tmux is the terminal here.
const panes = `treeyard-test-${process.pid}-panes`;
const terminal = `treeyard-test-${process.pid}-term`;
const fixture = fileURLToPath(new URL('./fixtures/pane-cli.mjs', import.meta.url));
const tsx = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
const tsconfig = fileURLToPath(new URL('../tsconfig.json', import.meta.url));
const main = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const hasTmux = panesAvailable();
const ROWS = 30;

const term = async (...args: string[]) =>
  (await run('tmux', ['-L', terminal, '-f', '/dev/null', ...args], { timeout: 10_000 })).stdout;
const screen = async () => (await term('capture-pane', '-p', '-t', '=tree:')).split('\n').slice(0, ROWS);
const autowrap = async () => (await term('display-message', '-p', '-t', '=tree:', '#{wrap_flag}')).trim();
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function until(check: () => Promise<boolean>, ms = 20_000) {
  const end = Date.now() + ms;
  while (!(await check()) && Date.now() < end) await pause(100);
  expect(await check()).toBe(true);
}

describe.skipIf(!hasTmux)('the tree in a real terminal', () => {
  beforeAll(() => {
    vi.stubEnv('BRAINYARD_TMUX_SOCKET', panes);
    vi.stubEnv('BRAINYARD_CLAUDE_BIN', JSON.stringify([process.execPath, fixture]));
    vi.stubEnv('CLAUDE_CONFIG_DIR', tempDir('treeyard-claude-home-'));
  });
  afterAll(async () => {
    for (const pane of await listPanes({ socket: panes })) await closePane(pane.pane, { socket: panes });
    await term('kill-server').catch(() => undefined);
    vi.unstubAllEnvs();
  });

  it('a session row wider than Ink measured it does not shift the frame; autowrap is back after the tree', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Широкий символ' });
    const launched = await launchInPane(
      tree,
      node.id,
      { brain: 'claude', start: 'chat', pane: true },
      { width: 60, height: 20 },
    );
    await until(async () => (await capturePane(launched.pane))?.lines.join('\n').includes('pane CLI ready') ?? false);
    saveUi(tree.project.dir, { ...defaultUi(), selected: node.id });

    const env = {
      TREEYARD_HOME: process.env.TREEYARD_HOME!,
      TREEYARD_LANG: '',
      BRAINYARD_TMUX_SOCKET: panes,
      BRAINYARD_CLAUDE_BIN: process.env.BRAINYARD_CLAUDE_BIN!,
      BRAINYARD_CODEX_BIN: 'treeyard-test-no-codex',
      BRAINYARD_AGY_BIN: 'treeyard-test-no-agy',
      BRAINYARD_OPENCODE_BIN: 'treeyard-test-no-opencode',
      CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR!,
      TERM: 'xterm-256color',
    };
    await term(
      'new-session',
      '-d',
      '-s',
      'tree',
      '-x',
      '120',
      '-y',
      String(ROWS),
      '-c',
      tree.project.dir,
      ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
      '--',
      'sh',
      '-c',
      `"${tsx}" --tsconfig "${tsconfig}" "${main}"; echo 'tree closed'; sleep 60`,
    );
    await until(async () => (await screen()).join('\n').includes('pane CLI ready'));
    expect(await autowrap()).toBe('0');

    // U+115F before a space: tmux gives it a cell more than Ink does, so every echoed row runs
    // past the pane's right border — the right edge of the terminal.
    for (let n = 0; n < 6; n++) {
      await sendToPane(launched.pane, '\u115f x');
      await pause(250);
    }
    await until(async () => (await screen()).filter((row) => row.includes('got:')).length >= 6);
    await pause(1000);
    const rows = await screen();
    const top = rows.findIndex((row) => row.endsWith('╮'));
    const bottom = rows.findIndex((row) => row.endsWith('╯'));
    // The pane keeps its place above the strip and the footer; the echoed rows follow one another,
    // every other row keeps its right border, and no stray piece of a wrapped row is left.
    expect(bottom).toBe(ROWS - 3);
    const inside = rows.slice(top + 1, bottom);
    const echoed = inside.flatMap((row, at) => (row.includes('got:') ? [at] : []));
    expect(echoed).toEqual([3, 4, 5, 6, 7, 8]);
    expect(inside.filter((row) => !row.includes('got:')).every((row) => row.endsWith('│'))).toBe(true);
    expect(rows.some((row) => /^\s*│\s*$/.test(row))).toBe(false);

    await term('send-keys', '-t', '=tree:', 'q');
    await until(async () => (await screen()).join('\n').includes('tree closed'));
    expect(await autowrap()).toBe('1');
  }, 90_000);
});
