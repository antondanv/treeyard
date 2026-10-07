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

/** `treeyard <args>` from source, run in `cwd` with a throwaway home; never throws, returns the exit code. */
export function treeyardIn(cwd: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TREEYARD_HOME: tempDir('treeyard-home-'),
    TREEYARD_LANG: 'ru',
    NO_COLOR: '1',
  };
  delete env[NODE_VAR];
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.FORCE_COLOR;
  return (...args: string[]) =>
    run(process.execPath, ['--import', tsx, cli, ...args], { cwd, env, timeout: 30_000 }).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error: { code: number; stdout: string; stderr: string }) => error,
    );
}
