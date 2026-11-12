import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach } from 'vitest';

import { NODE_VAR } from '../src/model/notes.js';
import { loadTree } from '../src/model/store.js';
import type { Tree } from '../src/model/types.js';
import { createTree, getTemplate } from '../src/templates/templates.js';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix = 'treeyard-test-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** A fresh tree with no nodes, from the `directions` template without its skeleton. */
export function emptyTree(): Tree {
  const dir = tempDir();
  createTree(dir, getTemplate('directions')!, { title: 'Тест', answers: { goal: 'всё работает' }, skeleton: false });
  return loadTree(dir);
}

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

/** The environment of a CLI run from source: a throwaway home, Russian, no colors, no outer session. */
function cliEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TREEYARD_HOME: tempDir('treeyard-home-'),
    TREEYARD_LANG: 'ru',
    NO_COLOR: '1',
  };
  delete env[NODE_VAR];
  Object.assign(env, extra);
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.FORCE_COLOR;
  return env;
}

/** `treeyard <args>` from source, run in `cwd` with a throwaway home; never throws, returns the exit code. */
export function treeyardIn(cwd: string, extra: NodeJS.ProcessEnv = {}) {
  const env = cliEnv(extra);
  return (...args: string[]) =>
    run(process.execPath, ['--import', tsx, cli, ...args], { cwd, env, timeout: 30_000 }).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error: { code: number; stdout: string; stderr: string }) => error,
    );
}

/**
 * `treeyard <args>` with `input` on stdin — the way a program hands over a long text; `late` — the
 * text comes only after the command has started reading, as from a slow pipe.
 */
export function withStdin(
  cwd: string,
  input: string | { late: string },
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = execFile(
      process.execPath,
      ['--import', tsx, cli, ...args],
      { cwd, env: cliEnv(), timeout: 30_000 },
      (error, stdout, stderr) =>
        done({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, stdout, stderr }),
    );
    if (typeof input === 'string') child.stdin?.end(input);
    else setTimeout(() => child.stdin?.end(input.late), 1500);
  });
}
