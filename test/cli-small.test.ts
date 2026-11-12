import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listImages } from '../src/model/images.js';
import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { emptyTree, tempDir, treeyardIn, tsx } from './helpers.js';

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

function png(dir: string, name: string): string {
  const image = new PNG({ width: 2, height: 2 });
  image.data.fill(200);
  const path = join(dir, name);
  writeFileSync(path, PNG.sync.write(image));
  return path;
}

describe('small CLI forms', () => {
  it('image takes a caption per file, or one for all; a mismatch or a missing file adds none', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Узел' });
    const dir = tempDir();
    const [wide, narrow] = [png(dir, 'wide.png'), png(dir, 'narrow.png')];
    const sh = treeyardIn(tree.project.dir);
    const images = () => listImages(tree.project.dir, node.id).map((image) => image.note ?? '');
    expect((await sh('image', node.id, wide, narrow, '--note', '1440', '--note', '390')).code).toBe(0);
    expect(images()).toEqual(['1440', '390']);
    expect((await sh('image', node.id, wide, narrow, '--note', 'обе')).code).toBe(0);
    expect(images()).toEqual(['1440', '390', 'обе', 'обе']);
    const mismatch = await sh('image', node.id, wide, narrow, '--note', 'a', '--note', 'b', '--note', 'c');
    expect(mismatch.code).toBe(2);
    expect(mismatch.stderr).toContain('подписей 3, картинок 2');
    const missing = await sh('image', node.id, wide, join(dir, 'nope.png'), '--note', 'a', '--note', 'b');
    expect(missing.code).toBe(2);
    expect(images()).toHaveLength(4);
  }, 40_000);

  it('diff --add takes several refs after the flag', async () => {
    const tree = emptyTree();
    const dir = tree.project.dir;
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], {
        cwd: dir,
        encoding: 'utf8',
      }).trim();
    git('init', '-q', '-b', 'main');
    const shas: string[] = [];
    for (const name of ['a', 'b']) {
      writeFileSync(join(dir, name), name);
      git('add', name);
      git('commit', '-q', '-m', name);
      shas.push(git('rev-parse', 'HEAD'));
    }
    const node = addNode(loadTree(dir), { title: 'Узел' });
    const res = await treeyardIn(dir)('diff', node.id, '--add', 'HEAD~1', 'HEAD');
    expect(res.stdout).toBe(`${node.id} · привязано коммитов: 2\n`);
    expect(loadTree(dir).nodes.get(node.id)!.commits).toEqual(shas);
  }, 40_000);

  it('set says on stdout when done became review, naming an --as that is not a person', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Узел', status: 'review' });
    const sh = treeyardIn(tree.project.dir);
    const typo = await sh('set', node.id, 'status=done', '--as', 'ty');
    expect(typo.stdout).toBe(`${node.id} · на проверке · Узел · не готово: «ty» — не человек, готово ставит человек\n`);
    const person = await sh('set', node.id, 'status=done', '--as', 'ты');
    expect(person.stdout).toBe(`${node.id} · готово · Узел\n`);
  }, 40_000);
});

describe('the commands module', () => {
  it('runs nothing when imported: only src/cli/main.ts starts the CLI', () => {
    const commands = pathToFileURL(join(import.meta.dirname, '../src/cli/commands.ts')).href;
    const out = execFileSync(
      process.execPath,
      ['--import', tsx, '--input-type=module', '-e', `await import(${JSON.stringify(commands)});`],
      {
        cwd: emptyTree().project.dir,
        env: { ...process.env, TREEYARD_HOME: tempDir('treeyard-home-'), NO_COLOR: '1' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    // Before the fix the import ran `treeyard` with no arguments and printed the tree here.
    expect(out).toBe('');
  }, 30_000);
});
