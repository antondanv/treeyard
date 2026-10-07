import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { closePane, listPanes, panesAvailable } from '@antondanv/brainyard';
import { afterAll, describe, expect, it } from 'vitest';

import { loadTree } from '../src/model/store.js';
import { tempDir } from './helpers.js';

const run = promisify(execFile);
const panes = `treeyard-plant-test-${process.pid}-panes`;
const terminal = `treeyard-plant-test-${process.pid}-term`;
const fixture = fileURLToPath(new URL('./fixtures/planting-cli.mjs', import.meta.url));
const tsx = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
const tsconfig = fileURLToPath(new URL('../tsconfig.json', import.meta.url));
const main = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const hasTmux = panesAvailable();
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const term = async (...args: string[]) =>
  (await run('tmux', ['-L', terminal, '-f', '/dev/null', ...args], { timeout: 10_000 })).stdout;
const screen = async (name: string, colors = false) =>
  term('capture-pane', '-p', ...(colors ? ['-e'] : []), '-t', `=${name}:`);

async function until(check: () => Promise<boolean>) {
  const end = Date.now() + 15_000;
  while (!(await check()) && Date.now() < end) await pause(100);
  expect(await check()).toBe(true);
}

async function evidence(name: string, step: string) {
  const dir = process.env.TREEYARD_EVIDENCE_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}-${step}.ans`), await screen(name, true));
}

async function start(name: string, columns: number, fallback = false) {
  const dir = tempDir('treeyard-plant-project-');
  const bin = tempDir('treeyard-plant-bin-');
  // The wizard sees Claude as installed; Brainyard uses the isolated fixture below.
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const env = {
    TREEYARD_HOME: tempDir('treeyard-plant-home-'),
    TREEYARD_LANG: 'ru',
    BRAINYARD_TMUX_SOCKET: panes,
    BRAINYARD_CLAUDE_BIN: JSON.stringify([process.execPath, fixture]),
    BRAINYARD_CODEX_BIN: 'treeyard-test-no-codex',
    BRAINYARD_AGY_BIN: 'treeyard-test-no-agy',
    BRAINYARD_OPENCODE_BIN: 'treeyard-test-no-opencode',
    ...(fallback ? { BRAINYARD_TMUX_BIN: 'treeyard-test-no-tmux' } : {}),
    CLAUDE_CONFIG_DIR: tempDir('treeyard-plant-claude-'),
    TREEYARD_TEST_TSX: tsx,
    TREEYARD_TEST_TSCONFIG: tsconfig,
    TREEYARD_TEST_MAIN: main,
    TREEYARD_NODE: 'parent-session',
    TERM: 'xterm-256color',
  };
  await term(
    'new-session',
    '-d',
    '-s',
    name,
    '-x',
    String(columns),
    '-y',
    '30',
    '-c',
    dir,
    ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
    '--',
    'sh',
    '-c',
    // PATH in the command, not in -e: tmux 3.4 gives the command the PATH of the client that ran new-session.
    `PATH=${quote(bin)}:"$PATH" ${quote(tsx)} --tsconfig ${quote(tsconfig)} ${quote(main)}; printf 'treeyard returned\\n'; sleep 60`,
  );
  await until(async () => (await screen(name)).includes('Как посадим дерево?'));
  await term('send-keys', '-t', `=${name}:`, 'Enter');
  await until(async () => (await screen(name)).includes('Посадить дерево с Claude Code?'));
  expect(await screen(name)).toContain(fallback ? 'выйдешь из сессии' : 'в панели рядом');
  await pause(400);
  await term('send-keys', '-t', `=${name}:`, 'Enter');
  await until(async () => (await screen(name)).includes('planting CLI ready'));
  return dir;
}

async function type(name: string, text: string) {
  await term('send-keys', '-l', '-t', `=${name}:`, text);
  await term('send-keys', '-t', `=${name}:`, 'Enter');
}

async function cleanup(name: string) {
  await term('kill-session', '-t', `=${name}`).catch(() => undefined);
  for (const pane of await listPanes({ socket: panes })) await closePane(pane.pane, { socket: panes });
}

describe.skipIf(!hasTmux)('planting in a real terminal from an empty folder', () => {
  afterAll(async () => {
    await cleanup('unused');
    await term('kill-server').catch(() => undefined);
  });

  it.each([120, 100])(
    'keeps one interview beside the growing tree at %s×30',
    async (columns) => {
      const name = `plant-${columns}`;
      try {
        const dir = await start(name, columns);
        expect(existsSync(join(dir, '.tree'))).toBe(false);
        const started = await listPanes({ socket: panes });
        expect(started).toHaveLength(1);
        const interview = JSON.parse(readFileSync(join(dir, 'interview.json'), 'utf8'));
        expect(interview.node).toBe('');
        const system = interview.args[interview.args.indexOf('--append-system-prompt') + 1];
        expect(system.split('## Session entry')[1]).toContain('Ctrl+Q');
        await evidence(name, 'before');
        if (columns === 120) {
          await term('send-keys', '-t', `=${name}:`, 'C-q');
          await until(async () => (await screen(name)).includes('f печатать'));
          await pause(100);
          await term('send-keys', '-t', `=${name}:`, 'F');
          await until(async () => (await screen(name)).includes('⌃Q — обратно к дереву'));
          expect(existsSync(join(dir, '.tree'))).toBe(false);
          await term('send-keys', '-t', `=${name}:`, 'C-q');
          await until(async () => (await screen(name)).includes('Разговор справа'));
          await pause(100);
        }
        await type(name, 'plant');
        await until(
          async () =>
            (await screen(name)).includes('Шаг 1') && (await screen(name)).includes('tree planted; conversation'),
        );
        expect(loadTree(dir).nodes.size).toBe(2);
        // The screen transition keeps the keyboard in the same interview.
        await type(name, 'more');
        await until(
          async () => (await screen(name)).includes('Шаг 2') && (await screen(name)).includes('another node planted'),
        );
        expect((await listPanes({ socket: panes })).map((pane) => pane.pane)).toEqual(started.map((pane) => pane.pane));
        const lines = (await screen(name)).trimEnd().split('\n');
        expect(lines).toHaveLength(30);
        expect(lines.some((line) => line.includes('Шаг 1') && line.indexOf('Шаг 1') < Math.floor(columns * 0.42))).toBe(
          true,
        );
        await evidence(name, 'after');
        await term('send-keys', '-t', `=${name}:`, 'C-q');
        await until(async () => (await screen(name)).includes('f печатать'));
        await pause(100);
        await term('send-keys', '-t', `=${name}:`, 'q');
        await until(async () => (await screen(name)).includes('treeyard returned'));
      } catch (error) {
        await evidence(name, 'failure');
        throw error;
      } finally {
        await cleanup(name);
      }
    },
    60_000,
  );

  it('without tmux, exiting the interview opens the planted tree in the same process', async () => {
    const name = 'plant-fallback';
    try {
      const dir = await start(name, 100, true);
      expect(existsSync(join(dir, '.tree'))).toBe(false);
      const interview = JSON.parse(readFileSync(join(dir, 'interview.json'), 'utf8'));
      const system = interview.args[interview.args.indexOf('--append-system-prompt') + 1];
      expect(system.split('## Session entry')[1]).toContain('exit this session — the tree will open automatically');
      await type(name, 'plant');
      await until(async () => (await screen(name)).includes('tree planted; conversation continues'));
      expect(loadTree(dir).nodes.size).toBe(2);
      await evidence(name, 'interview');
      await type(name, 'exit');
      await until(async () => (await screen(name)).includes('Шаг 1') && (await screen(name)).includes('Сейчас'));
      expect(await listPanes({ socket: panes })).toEqual([]);
      await evidence(name, 'tree');
      await term('send-keys', '-t', `=${name}:`, 'q');
      await until(async () => (await screen(name)).includes('treeyard returned'));
    } finally {
      await cleanup(name);
    }
  }, 60_000);
});
