import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Paint, treeText } from '../src/cli/print.js';
import { addImage } from '../src/model/images.js';
import { NODE_VAR } from '../src/model/notes.js';
import { addNode, logToNode, setStatus } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { createTree, getTemplate } from '../src/templates/templates.js';
import { tempDir } from './helpers.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

let dir = '';
let ids: { a: string; b: string; story: string };

function sh(...args: string[]) {
  return showIn(dir, ...args);
}

function showIn(cwd: string, ...args: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TREEYARD_HOME: tempDir('treeyard-home-'),
    TREEYARD_LANG: 'ru',
    NO_COLOR: '1',
  };
  delete env[NODE_VAR];
  delete env.FORCE_COLOR;
  return run(process.execPath, ['--import', tsx, cli, 'show', ...args], { cwd, env, timeout: 30_000 }).then(
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
  addImage(dir, a.id, PNG.sync.write(new PNG({ width: 1, height: 1 })), 'экран');
  const story = addNode(tree, { title: 'История' });
  setStatus(tree, story.id, 'active', { source: 'тест' });
  logToNode(tree, story.id, 'сделал половину', 'тест');
  setStatus(tree, story.id, 'review', { source: 'тест' });
  ids = { a: a.id, b: b.id, story: story.id };
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

  it('--json --all: the version, and everything about every node — nothing left to parse in markdown', async () => {
    type Node = Record<string, unknown> & { id: string; title: string; children: Node[] };
    const json = JSON.parse((await sh('--json', '--all')).stdout) as { version: number; title: string; nodes: Node[] };
    expect(json.version).toBe(1);
    expect(json.title).toBe('Проект');
    const all: Node[] = [];
    // The place among siblings of the same status: that is how the tree orders them.
    const walk = (nodes: Node[], parent: string) =>
      nodes.forEach((node, index) => {
        all.push(node);
        const before = nodes.slice(0, index).filter((kid) => kid.status === node.status);
        expect(node).toMatchObject({ parent, position: before.length });
        walk(node.children, node.id);
      });
    walk(json.nodes, 'root');
    const DAY = /^\d{4}-\d\d-\d\d$/;
    for (const node of all)
      expect(node).toMatchObject({
        note: expect.any(String),
        journal: expect.any(Array),
        history: expect.any(Array),
        images: expect.any(Array),
        created: expect.stringMatching(DAY),
        updated: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/),
      });
    // By status in the default order, then the siblings' own order.
    expect(json.nodes.map((node) => [node.title, node.position])).toEqual([
      ['Первый', 0],
      ['История', 0],
      ['Второй', 0],
      ['Сделанное раз', 0],
      ['Сделанное два', 1],
    ]);
    const byId = (id: string) => all.find((node) => node.id === id)!;
    const first = byId(ids.a);
    expect(first.note).toBe('Описание первого');
    expect(first.journal).toHaveLength(6);
    expect((first.journal as unknown[])[0]).toEqual({
      at: expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:\d\d$/),
      who: 'тест',
      text: 'запись 1',
    });
    const [image] = first.images as { file: string; path: string; note: string; added: string }[];
    expect(image).toMatchObject({ file: '001.png', note: 'экран', added: expect.any(String) });
    expect(image!.path.endsWith(join('.tree', '.local', 'images', ids.a, '001.png'))).toBe(true);
    expect(existsSync(image!.path)).toBe(true);
    expect(byId(ids.story).history).toEqual([
      { at: expect.any(String), who: 'тест', from: 'todo', to: 'active' },
      { at: expect.any(String), who: 'тест', from: 'active', to: 'review' },
    ]);
    expect(json.nodes.find((node) => node.title === 'Сделанное раз')!.closed).toMatch(DAY);
    expect(first.closed).toBeUndefined();
  }, 40_000);

  it('--json --all --under: the branch with the version on top; the short --json stays as it was', async () => {
    const branch = JSON.parse((await sh('--under', ids.a, '--json', '--all')).stdout);
    expect(branch).toMatchObject({ version: 1, id: ids.a, parent: 'root', position: 0, note: 'Описание первого' });
    expect(branch.children).toEqual([expect.objectContaining({ title: 'Вложенный', parent: ids.a, position: 0 })]);
    const short = JSON.parse((await sh('--json')).stdout);
    expect(short.version).toBeUndefined();
    expect(short.nodes[0].journal).toBeUndefined();
    expect(short.nodes[0].note).toBeUndefined();
  }, 40_000);

  it('--status lists the nodes of those statuses, a line each with the status as a word and the path', async () => {
    const res = await sh('--status', 'active,waiting');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('в работе, ждёт · 2 узла');
    expect(res.stdout).toMatch(new RegExp(`◐ Первый {2}${ids.a} {2}в работе`));
    expect(res.stdout).toMatch(new RegExp(`Второй {2}${ids.b} {2}ждёт`));
    expect(res.stdout).not.toContain('Вложенный');
    // Words and aliases, never glyphs; done work is found too.
    const done = await sh('--status', 'готово');
    expect(done.stdout).toContain('Сделанное раз');
    const nested = await sh('--status', 'to do');
    expect(nested.stdout).toMatch(/○ Вложенный {2}\w+ {2}к работе {2}\(Первый\)/);
  }, 40_000);

  it('--under narrows to a branch: a list with --status, the branch as a tree without it', async () => {
    const list = await sh('--status', 'todo', '--under', ids.a);
    expect(list.stdout).toContain('к работе · 1 узел · в ветке «Первый»');
    expect(list.stdout).toMatch(/○ Вложенный {2}\w+ {2}к работе\n/);
    expect((await sh('--status', 'review', '--under', ids.a)).stdout).toContain('на проверке: таких узлов нет');
    const branch = await sh('--under', ids.a);
    expect(branch.stdout.split('\n')[0]).toMatch(new RegExp(`◐ Первый {2}${ids.a} {2}в работе`));
    expect(branch.stdout).toMatch(/└─ ○ Вложенный/);
    expect(branch.stdout).not.toContain('Второй');
    const json = JSON.parse((await sh('--status', 'todo', '--under', ids.a, '--json')).stdout);
    expect(json).toEqual([expect.objectContaining({ title: 'Вложенный', status: 'todo', parent: ids.a, path: [] })]);
    expect(JSON.parse((await sh('--under', ids.a, '--json')).stdout).children[0].title).toBe('Вложенный');
  }, 40_000);

  it('--only prints the title line and just the asked parts, in the order of the card', async () => {
    const journal = await sh(ids.a, '--only', 'journal', '--journal', '2');
    expect(journal.stdout.split('\n')[0]).toContain('Первый');
    expect(journal.stdout).toContain('запись 6');
    expect(journal.stdout).not.toContain('запись 4');
    expect(journal.stdout).toContain('--journal all');
    expect(journal.stdout).not.toContain('готово, когда');
    // Empty parts say so; several nodes keep their title lines apart.
    const two = await sh(ids.a, ids.b, '--only', 'сессии,commits');
    expect(two.stdout).toContain('Второй');
    expect(two.stdout.match(/сессии: —/g)).toHaveLength(2);
    expect(two.stdout.indexOf('коммиты: —')).toBeLessThan(two.stdout.indexOf('сессии: —'));
    const history = await sh(ids.story, '--only', 'history,header');
    expect(history.stdout).toContain('на проверке');
    expect(history.stdout).toContain('к работе → в работе');
    expect(history.stdout).toContain('в работе → на проверке');
    expect(history.stdout).not.toContain('сделал половину');
    const json = JSON.parse((await sh(ids.story, '--only', 'history,note', '--json')).stdout);
    expect(Object.keys(json)).toEqual(['id', 'title', 'note', 'history']);
    expect(json.history).toHaveLength(2);
  }, 40_000);

  it('--only names the parts when a word is not one, and wants an id', async () => {
    const bad = await sh(ids.a, '--only', 'foo');
    expect(bad.code).toBe(2);
    expect(bad.stdout).toContain('header, criterion, commits, children, sessions, note, journal, history');
    expect((await sh('--only', 'journal')).code).toBe(2);
  }, 40_000);

  it('a word that is not a status and ids next to --status fail with the right form', async () => {
    const bad = await sh('--status', 'soon');
    expect(bad.code).toBe(2);
    expect(bad.stdout).toContain('«soon» — не статус');
    const mixed = await sh(ids.a, '--status', 'todo');
    expect(mixed.code).toBe(2);
    expect(mixed.stdout).toContain('treeyard show --status review --under <id>');
  }, 40_000);
});

describe('open work under closed parents', () => {
  let nested = '';
  let id: Record<string, string> = {};

  beforeAll(() => {
    nested = mkdtempSync(join(tmpdir(), 'treeyard-show-nested-'));
    createTree(nested, getTemplate('directions')!, { title: 'Проект', answers: {}, skeleton: false });
    const tree = loadTree(nested);
    const live = addNode(tree, { title: 'Живое', status: 'active' });
    const given = addNode(tree, { title: 'Сданное', status: 'done' });
    const inner = addNode(tree, { title: 'Готовое внутри', status: 'done', parent: given.id });
    const idea = addNode(tree, { title: 'Забытая идея', status: 'idea', parent: given.id });
    const deeper = addNode(tree, { title: 'Глубже', status: 'done', parent: given.id });
    const tail = addNode(tree, { title: 'Хвост', parent: deeper.id });
    const plain = addNode(tree, { title: 'Готовое без хвостов', status: 'done' });
    addNode(tree, { title: 'Тоже готовое', status: 'done', parent: plain.id });
    const dropped = addNode(tree, { title: 'Отменённое', status: 'dropped' });
    const wait = addNode(tree, { title: 'Ждущее', status: 'waiting', waiting: 'сервер', parent: dropped.id });
    id = { live: live.id, given: given.id, inner: inner.id, idea: idea.id, deeper: deeper.id, tail: tail.id };
    Object.assign(id, { plain: plain.id, dropped: dropped.id, wait: wait.id });
  }, 30_000);

  const body = (stdout: string) => stdout.split('\n').slice(2).join('\n');

  it('off a terminal: the closed parent is one folded line, its open work under it, the rest in the counter', async () => {
    const res = await showIn(nested);
    expect(body(res.stdout)).toBe(
      [
        `├─ ◐ Живое  ${id.live}  в работе`,
        `├─ ✓ Сданное  ${id.given}  готово  · свёрнуто, скрыто 1`,
        `│  ├─ ◇ Забытая идея  ${id.idea}  идея`,
        `│  └─ ✓ Глубже  ${id.deeper}  готово`,
        `│     └─ ○ Хвост  ${id.tail}  к работе`,
        '├─ ✓ готово: 1',
        `└─ ✗ Отменённое  ${id.dropped}  отказ`,
        `   └─ ‖ Ждущее  ${id.wait}  ждёт: сервер`,
        '',
      ].join('\n'),
    );
  }, 40_000);

  it('--open: closed work is gone, except as folded lines above open work', async () => {
    const res = await showIn(nested, '--open');
    expect(body(res.stdout)).toBe(
      [
        `├─ ◐ Живое  ${id.live}  в работе`,
        `├─ ✓ Сданное  ${id.given}  готово  · свёрнуто, скрыто 1`,
        `│  ├─ ◇ Забытая идея  ${id.idea}  идея`,
        `│  └─ ✓ Глубже  ${id.deeper}  готово`,
        `│     └─ ○ Хвост  ${id.tail}  к работе`,
        `└─ ✗ Отменённое  ${id.dropped}  отказ`,
        `   └─ ‖ Ждущее  ${id.wait}  ждёт: сервер`,
        '',
      ].join('\n'),
    );
    // A branch narrowed to a closed node keeps its open work too.
    const branch = await showIn(nested, '--open', '--under', id.given!);
    expect(branch.stdout).toContain(`├─ ◇ Забытая идея  ${id.idea}  идея`);
    expect(branch.stdout).toContain(`   └─ ○ Хвост  ${id.tail}  к работе`);
    expect(branch.stdout).not.toContain('Готовое внутри');
  }, 40_000);

  it('in a terminal --open shows the same tree, without status words', () => {
    const plainPaint: Paint = { on: false, c: (_hex, text) => text, dim: (text) => text, bold: (text) => text };
    const text = treeText(loadTree(nested), plainPaint, { closed: false });
    expect(text.split('\n').slice(2)).toEqual([
      `├─ ◐ Живое  ${id.live}`,
      `├─ ✓ Сданное  ${id.given}  · свёрнуто, скрыто 1`,
      `│  ├─ ◇ Забытая идея  ${id.idea}`,
      `│  └─ ✓ Глубже  ${id.deeper}`,
      `│     └─ ○ Хвост  ${id.tail}`,
      `└─ ✗ Отменённое  ${id.dropped}`,
      `   └─ ‖ Ждущее  ${id.wait}  ждёт: сервер`,
    ]);
  });

  afterAll(() => rmSync(nested, { recursive: true, force: true }));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));
