import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { journalEntries } from '../src/model/journal.js';
import { NODE_VAR } from '../src/model/notes.js';
import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { createTree, getTemplate } from '../src/templates/templates.js';
import { tempDir } from './helpers.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

function shell(cwd: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, TREEYARD_HOME: tempDir('treeyard-home-'), NO_COLOR: '1' };
  delete env[NODE_VAR];
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.FORCE_COLOR;
  return (...args: string[]) =>
    run(process.execPath, ['--import', tsx, cli, ...args], { cwd, env, timeout: 30_000 }).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error: { code: number; stdout: string; stderr: string }) => error,
    );
}

/** A tree with one node, and a folder next to it that has no tree: where a git worktree would stand. */
function plant() {
  const root = tempDir('treeyard-project-');
  const main = join(root, 'main');
  const elsewhere = join(root, 'elsewhere');
  mkdirSync(main);
  mkdirSync(elsewhere);
  createTree(main, getTemplate('directions')!, { title: 'Главное', answers: { goal: 'работает' }, skeleton: false });
  const node = addNode(loadTree(main), { title: 'Узел из основного дерева' });
  return { main, elsewhere, id: node.id };
}

describe('--project of log and show', () => {
  it('log writes to the tree of another folder', async () => {
    const { main, elsewhere, id } = plant();
    const sh = shell(elsewhere);
    const without = await sh('log', id, 'не должно записаться', '--as', 'тест');
    expect(without.code).toBe(2);
    expect(without.stderr).toContain('здесь нет дерева');

    const done = await sh('log', id, 'что сделано; что осталось', '--as', 'тест', '--project', main);
    expect(done.code).toBe(0);
    expect(done.stdout).toContain(`${id} · записано`);
    const entries = journalEntries(loadTree(main).nodes.get(id)!.body);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain('тест · что сделано; что осталось');
  }, 40_000);

  it('show reads it, as text and as JSON, and a folder inside the project is enough', async () => {
    const { main, elsewhere, id } = plant();
    const sh = shell(elsewhere);
    expect((await sh('show')).code).toBe(2);

    const tree = await sh('show', '--project', main);
    expect(tree.code).toBe(0);
    expect(tree.stdout).toContain('Узел из основного дерева');

    const node = await sh('show', id, '--project', main);
    expect(node.code).toBe(0);
    expect(node.stdout).toContain('Узел из основного дерева');

    const inside = join(main, 'src', 'deep');
    mkdirSync(inside, { recursive: true });
    const json = await sh('show', id, '--json', '--project', inside);
    expect(JSON.parse(json.stdout)).toMatchObject({ id, title: 'Узел из основного дерева' });
  }, 40_000);

  it('a relative --project is taken from the current folder; a folder without a tree is an error', async () => {
    const { main, elsewhere, id } = plant();
    const sh = shell(elsewhere);
    expect((await sh('log', id, 'из соседней папки', '--as', 'тест', '--project', '../main')).code).toBe(0);
    expect(journalEntries(loadTree(main).nodes.get(id)!.body)[0]).toContain('из соседней папки');

    const empty = await sh('show', '--project', tempDir('treeyard-empty-'));
    expect(empty.code).toBe(2);
    expect(empty.stderr).toContain('здесь нет дерева');
  }, 40_000);
});
