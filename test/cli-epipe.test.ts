import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AS_VAR, NODE_VAR, PROJECT_VAR, SESSION_VAR } from '../src/model/notes.js';
import { addNode, attachCommit } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { emptyTree, tempDir, tsx } from './helpers.js';

const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));

const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_SYSTEM = '/dev/null';
});
afterAll(() => {
  for (const [key, value] of [
    ['GIT_CONFIG_GLOBAL', saved.global],
    ['GIT_CONFIG_SYSTEM', saved.system],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

interface PipeResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  firstLine: string;
  stderr: string;
}

/**
 * Runs `treeyard <args>` and closes its stdout pipe either immediately (`| true`) or right after
 * the first newline (`| head -1`). When the command outputs more than the OS pipe buffer (~64 KB),
 * the remaining writes fail with EPIPE.
 */
function runIntoClosedPipe(
  cwd: string,
  home: string,
  args: string[],
  options: { closeImmediately?: boolean } = {},
): Promise<PipeResult> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TREEYARD_HOME: home,
    TREEYARD_LANG: 'ru',
    NO_COLOR: '1',
  };
  for (const key of [NODE_VAR, PROJECT_VAR, SESSION_VAR, AS_VAR]) delete env[key];
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.FORCE_COLOR;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', tsx, cli, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let firstLine = '';
    let stderr = '';
    let closed = false;

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`treeyard ${args.join(' ')} timed out`));
    }, 25_000);

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    if (options.closeImmediately) {
      closed = true;
      child.stdout.destroy();
    } else {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (closed) return;
        firstLine += chunk;
        const newline = firstLine.indexOf('\n');
        if (newline !== -1) {
          firstLine = firstLine.slice(0, newline);
          closed = true;
          child.stdout.destroy();
        }
      });
    }

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, firstLine, stderr });
    });
  });
}

function crashLogs(home: string): string[] {
  const dir = join(home, 'crashes');
  return existsSync(dir) ? readdirSync(dir) : [];
}

/** A tree in a git repo with >400 KB of content in both a node and its attached commit diff. */
function largeFixture() {
  const tree = emptyTree();
  const dir = tree.project.dir;
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
  git('init', '-q', '-b', 'main');

  // ~450 KB: well above the 64 KB OS pipe buffer so closing after line 1 reliably triggers EPIPE.
  const payload = Array.from({ length: 5_000 }, (_, i) => `needle строка ${i} ${'x'.repeat(70)}`).join('\n');
  writeFileSync(join(dir, 'big.txt'), `${payload}\n`);
  git('add', 'big.txt');
  git('commit', '-q', '-m', 'add large file');
  const sha = git('rev-parse', 'HEAD');

  const loaded = loadTree(dir);
  const node = addNode(loaded, { title: 'Большой узел', body: payload });
  attachCommit(loaded, node.id, sha);
  return { dir, id: node.id };
}

describe('quiet exit on EPIPE', () => {
  it('diff, show and context exit cleanly with no stderr or crash log when stdout closes after line 1', async () => {
    const { dir, id } = largeFixture();
    const home = tempDir('treeyard-home-');
    const cases: { args: string[]; firstLine: RegExp }[] = [
      { args: ['diff', id], firstLine: /^Дифы · Большой узел$/ },
      { args: ['diff', id, '--json'], firstLine: /^\{$/ },
      { args: ['show', id], firstLine: new RegExp(`Большой узел\\s+${id}`) },
      { args: ['context', id], firstLine: /^# / },
    ];

    const results = await Promise.all(cases.map(({ args }) => runIntoClosedPipe(dir, home, args)));
    results.forEach((result, index) => {
      const label = cases[index]!.args.join(' ');
      expect(result.code, label).toBe(0);
      expect(result.signal, label).toBeNull();
      expect(result.stderr, label).toBe('');
      expect(result.firstLine, label).toMatch(cases[index]!.firstLine);
    });
    expect(crashLogs(home)).toEqual([]);
  }, 40_000);

  it('diff and show exit quietly when the reader closes the pipe before any output is read', async () => {
    const { dir, id } = largeFixture();
    const home = tempDir('treeyard-home-');
    const results = await Promise.all([
      runIntoClosedPipe(dir, home, ['diff', id], { closeImmediately: true }),
      runIntoClosedPipe(dir, home, ['show', id], { closeImmediately: true }),
    ]);

    for (const result of results) {
      expect(result.code).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.stderr).toBe('');
    }
    expect(crashLogs(home)).toEqual([]);
  }, 40_000);
});
