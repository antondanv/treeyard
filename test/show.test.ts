import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NODE_VAR } from '../src/model/notes.js';
import { addNode, logToNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { createTree, getTemplate } from '../src/templates/templates.js';
import { tempDir } from './helpers.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

let dir = '';
let ids: { a: string; b: string };

function sh(...args: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TREEYARD_HOME: tempDir('treeyard-home-'),
    TREEYARD_LANG: 'ru',
    NO_COLOR: '1',
  };
  delete env[NODE_VAR];
  delete env.FORCE_COLOR;
  return run(process.execPath, ['--import', tsx, cli, 'show', ...args], { cwd: dir, env, timeout: 30_000 }).then(
    ({ stdout }) => ({ code: 0, stdout }),
    (error: { code: number; stdout: string; stderr: string }) => ({
      code: error.code,
      stdout: error.stdout + error.stderr,
    }),
  );
}

beforeAll(() => {
  // Not tempDir: the shared helper wipes its folders after every test, and the tree is built once.
  dir = mkdtempSync(join(tmpdir(), 'treeyard-show-'));
  createTree(dir, getTemplate('directions')!, { title: 'Проект', answers: { goal: 'работает' }, skeleton: false });
  const tree = loadTree(dir);
  const a = addNode(tree, { title: 'Первый', status: 'active', doneWhen: 'первое видно', body: 'Описание первого' });
  const b = addNode(tree, { title: 'Второй', status: 'waiting', waiting: 'сервер' });
  addNode(tree, { title: 'Вложенный', parent: a.id });
  addNode(tree, { title: 'Сделанное раз', status: 'done' });
  addNode(tree, { title: 'Сделанное два', status: 'done' });
  for (let i = 1; i <= 6; i++) logToNode(tree, a.id, `запись ${i}`, 'тест');
  ids = { a: a.id, b: b.id };
}, 30_000);

describe('treeyard show for agents', () => {
  it('several nodes in one call, as text and as a JSON array', async () => {
    const text = await sh(ids.a, ids.b);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain('Первый');
    expect(text.stdout).toMatch(/\n\n.*Второй/);
    const json = JSON.parse((await sh(ids.a, ids.b, '--json')).stdout);
    expect(json.map((n: { id: string }) => n.id)).toEqual([ids.a, ids.b]);
    // One id keeps the old shape: an object.
    expect(JSON.parse((await sh(ids.a, '--json')).stdout).id).toBe(ids.a);
  }, 40_000);

  it('an unknown id fails with its name and prints no partial output', async () => {
    const res = await sh(ids.a, 'нетуз');
    expect(res.code).not.toBe(0);
    expect(res.stdout).toContain('нетуз');
    expect(res.stdout).not.toContain('Первый');
  }, 40_000);

  it('--brief: header, criterion, 3 last entries, no description, no children, a counter', async () => {
    const res = await sh(ids.a, '--brief');
    expect(res.stdout).toContain('первое видно');
    expect(res.stdout).toContain('запись 6');
    expect(res.stdout).toContain('запись 4');
    expect(res.stdout).not.toContain('запись 3');
    expect(res.stdout).not.toContain('Описание первого');
    expect(res.stdout).not.toContain('Вложенный');
    expect(res.stdout).toContain('внутри: 1, готово 0');
    expect((await sh(ids.b, '--brief')).stdout).toContain('ждёт: сервер');
  }, 40_000);

  it('--journal N keeps the last N and says how many are hidden; all shows everything', async () => {
    const two = await sh(ids.a, '--journal', '2');
    expect(two.stdout).toContain('запись 6');
    expect(two.stdout).not.toContain('запись 4');
    expect(two.stdout).toContain('--journal all');
    const all = await sh(ids.a, '--journal', 'all');
    expect(all.stdout).toContain('запись 1');
    expect(all.stdout).not.toContain('--journal all');
    expect((await sh(ids.a, '--journal', 'x')).code).not.toBe(0);
  }, 40_000);

  it('without an id off a terminal finished work folds into a counter; --all and --json show it', async () => {
    const folded = await sh();
    expect(folded.stdout).toContain('✓ готово: 2');
    expect(folded.stdout).not.toContain('Сделанное раз');
    expect(folded.stdout).toContain('Первый');
    const all = await sh('--all');
    expect(all.stdout).toContain('Сделанное раз');
    expect(all.stdout).not.toContain('✓ готово:');
    expect((await sh('--json')).stdout).toContain('Сделанное два');
  }, 40_000);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));
