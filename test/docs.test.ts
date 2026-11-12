import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Key } from 'ink';
import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';

import { docPath, docTitle, projectDocs, readDoc, sortDocs, TREE_DOC, writeDoc } from '../src/docs.js';
import { setLang } from '../src/i18n/i18n.js';
import { editKey, editorRows, insert } from '../src/tui/doc-editor.js';
import { inline, layoutMarkdown, type MdRow } from '../src/tui/markdown.js';
import { emptyTree, tempDir, treeyardIn } from './helpers.js';

const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
const write = (dir: string, path: string, text: string) => {
  mkdirSync(join(dir, path, '..'), { recursive: true });
  writeFileSync(join(dir, path), text);
};
const text = (row: MdRow) => row.spans.map((span) => span.text).join('');

describe('project documents', () => {
  it('lists tracked and new .md files from Git, without ignored ones and the nodes, tree.md first', async () => {
    const dir = emptyTree().project.dir;
    git(dir, 'init', '-q');
    write(dir, 'docs/vision.md', '# Видение\n');
    write(dir, 'README.md', '# Проект\n\nтекст\n');
    write(dir, 'AGENTS.md', 'правила\n');
    write(dir, 'notes/секрет.md', 'не для дерева\n');
    write(dir, '.gitignore', 'notes/\n');
    write(dir, 'src/code.ts', 'export {};\n');
    git(dir, 'add', 'README.md', 'docs');
    // Not added yet: a new file still belongs to the project.
    write(dir, 'draft.md', 'черновик\n');
    const docs = await projectDocs(dir);
    expect(docs.map((doc) => doc.path)).toEqual([TREE_DOC, 'README.md', 'AGENTS.md', 'draft.md', 'docs/vision.md']);
    expect(docs.find((doc) => doc.path === 'README.md')?.lines).toBe(3);
  });

  it('walks the folder without Git, skipping hidden folders and dependencies', async () => {
    const dir = emptyTree().project.dir;
    write(dir, 'README.md', 'x\n');
    write(dir, 'guide/how.md', 'x\n');
    write(dir, 'node_modules/pkg/README.md', 'x\n');
    write(dir, '.cache/old.md', 'x\n');
    const docs = await projectDocs(dir);
    expect(docs.map((doc) => doc.path)).toEqual([TREE_DOC, 'README.md', 'guide/how.md']);
  });

  it('names each document by its front matter, its first top-level heading or its file', () => {
    expect(docTitle('a.md', '# Видение\n\n## Раздел\n')).toBe('Видение');
    expect(docTitle('a.md', '---\ntitle: Из шапки\n---\n# Заголовок\n')).toBe('Из шапки');
    expect(docTitle('a.md', '---\nname: skill\n---\n\n# Скилл  #\n')).toBe('Скилл');
    expect(docTitle('a.md', 'Подчёркнутый\n===\n')).toBe('Подчёркнутый');
    expect(docTitle('a.md', '<div>\n<h1 align="center">Проект</h1>\n</div>\n')).toBe('Проект');
    expect(docTitle('a.md', '# [Ссылка](x.md) и **жирный** `код`\n')).toBe('Ссылка и жирный код');
    // A heading inside a code block is code; ## is a section, not the title.
    expect(docTitle('docs/guide.md', '```sh\n# комментарий\n```\n## Раздел\n')).toBe('guide');
    expect(docTitle('notes/Список дел.markdown', 'текст\n')).toBe('Список дел');
    expect(docTitle('a.md', '---\ntitle: [не закрыто\n---\n# Всё равно\n')).toBe('Всё равно');
    expect(docTitle('a.md', '#\n#тег\n')).toBe('a');
    expect(docTitle(TREE_DOC, '---\ntitle: Тест\n---\n')).toBe('Цель, правила и решения');
    setLang('en');
    expect(docTitle(TREE_DOC, '---\ntitle: Тест\n---\n')).toBe('Goal, rules and decisions');
    setLang('ru');
  });

  it('sorts README, AGENTS and CLAUDE first among the top files, folders after', () => {
    const sorted = sortDocs(
      ['docs/a.md', 'z.md', 'CLAUDE.md', 'a.md', 'README.md', TREE_DOC].map((path) => ({ path })),
    );
    expect(sorted.map((doc) => doc.path)).toEqual([TREE_DOC, 'README.md', 'CLAUDE.md', 'a.md', 'z.md', 'docs/a.md']);
  });

  it('keeps Windows line ends, refuses a broken tree.md and paths outside the project', () => {
    const dir = emptyTree().project.dir;
    writeFileSync(join(dir, 'win.md'), 'one\r\ntwo\r\n');
    const doc = readDoc(dir, 'win.md');
    expect(doc).toMatchObject({ text: 'one\ntwo\n', crlf: true });
    writeDoc(dir, 'win.md', 'one\ntwo\nthree\n', doc.crlf);
    expect(readFileSync(join(dir, 'win.md'), 'utf8')).toBe('one\r\ntwo\r\nthree\r\n');

    const before = readFileSync(join(dir, TREE_DOC), 'utf8');
    expect(() => writeDoc(dir, TREE_DOC, '---\ntitle: [не закрыто\n---\n')).toThrow(/tree\.md/);
    expect(readFileSync(join(dir, TREE_DOC), 'utf8')).toBe(before);

    expect(() => docPath(dir, '../outside.md')).toThrow();
    expect(() => writeDoc(dir, '../outside.md', 'x')).toThrow();
  });
});

describe('treeyard docs', () => {
  it("--json gives the window's list from Git: path, title, lines and time", async () => {
    const dir = emptyTree().project.dir;
    git(dir, 'init', '-q');
    write(dir, 'docs/vision.md', '# Видение\n\nкуда идём\n');
    write(dir, 'README.md', '<h1>Проект</h1>\n');
    write(dir, 'CLAUDE.md', '@AGENTS.md\n');
    write(dir, 'AGENTS.md', '# Правила для агентов\n');
    write(dir, 'notes/секрет.md', '# Не для дерева\n');
    write(dir, '.gitignore', 'notes/\n');
    git(dir, 'add', 'README.md', 'docs', '.gitignore');
    write(dir, 'draft.md', 'черновик\n');
    const result = await treeyardIn(dir)('docs', '--json');
    expect(result.code).toBe(0);
    const docs = JSON.parse(result.stdout) as { path: string; title: string; lines: number; modified: string }[];
    expect(docs.map(({ path, title }) => [path, title])).toEqual([
      [TREE_DOC, 'Цель, правила и решения'],
      ['README.md', 'Проект'],
      ['AGENTS.md', 'Правила для агентов'],
      ['CLAUDE.md', 'CLAUDE'],
      ['draft.md', 'draft'],
      ['docs/vision.md', 'Видение'],
    ]);
    // The same list as the window's, field for field.
    const window = await projectDocs(dir);
    expect(docs.map((doc) => doc.path)).toEqual(window.map((doc) => doc.path));
    expect(docs[5]!.lines).toBe(3);
    expect(docs[5]!.modified).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    expect(Date.parse(docs[5]!.modified)).toBe(Math.floor(window[5]!.mtime / 1000) * 1000);
    expect(Object.keys(docs[0]!)).toEqual(['path', 'title', 'lines', 'modified']);
  }, 40_000);

  it('without Git lists the folder; in text — a line per document; --project from elsewhere', async () => {
    const dir = emptyTree().project.dir;
    write(dir, 'README.md', '# Проект\n');
    write(dir, 'guide/how.md', 'как\n');
    write(dir, 'node_modules/pkg/README.md', 'x\n');
    const run = treeyardIn(dir);
    const json = JSON.parse((await run('docs', '--json')).stdout) as { path: string; title: string }[];
    expect(json.map(({ path, title }) => [path, title])).toEqual([
      [TREE_DOC, 'Цель, правила и решения'],
      ['README.md', 'Проект'],
      ['guide/how.md', 'how'],
    ]);
    const text = await run('docs');
    expect(text.code).toBe(0);
    const lines = text.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^\.tree\/tree\.md +Цель, правила и решения · \d+ стр\. · только что$/);
    expect(lines[1]).toMatch(/^README\.md +Проект · 1 стр\./);
    // The file name is not repeated as the title.
    expect(lines[2]).toMatch(/^guide\/how\.md +· 1 стр\./);

    const elsewhere = await treeyardIn(tempDir())('docs', '--json', '--project', dir);
    expect(JSON.parse(elsewhere.stdout)).toEqual(json);
    const stray = await run('docs', 'лишнее');
    expect(stray.code).toBe(2);
    expect(stray.stderr).toContain('treeyard docs [--json] [--project <папка>]');
  }, 40_000);
});

describe('Markdown in the terminal', () => {
  it('draws headings, lists, quotes, code and rules without their marks', () => {
    const rows = layoutMarkdown(
      [
        '# Заголовок',
        '',
        '- пункт **важный**',
        '  - вложенный',
        '1. первый',
        '- [x] сделано',
        '> цитата',
        '```ts',
        'const a = 1;',
        '```',
        '---',
        'Ссылка на [видение](docs/vision.md) и `код`.',
      ].join('\n'),
      60,
    );
    const lines = rows.map(text);
    expect(lines[0]).toBe('Заголовок');
    expect(rows[0]!.spans[0]).toMatchObject({ bold: true });
    expect(lines[1]).toMatch(/^━+$/);
    expect(lines).toContain('• пункт важный');
    expect(rows.find((row) => text(row) === '• пункт важный')!.spans.at(-1)).toMatchObject({
      text: 'важный',
      bold: true,
    });
    expect(lines).toContain('  ◦ вложенный');
    expect(lines).toContain('1. первый');
    expect(lines).toContain('✓ сделано');
    expect(lines).toContain('│ цитата');
    expect(lines).toContain('╭─ ts');
    expect(lines).toContain('│ const a = 1;');
    expect(lines).toContain('╰─');
    expect(lines).toContain('Ссылка на видение (docs/vision.md) и код.');
    // Each row knows its source line: the editor opens where the reader is.
    expect(rows.find((row) => text(row) === '│ const a = 1;')!.line).toBe(8);
  });

  it('wraps by words to the width, with a hanging indent in lists, wide characters counted', () => {
    const rows = layoutMarkdown(`- ${'слово '.repeat(30)}\n${'界'.repeat(50)}`, 30);
    for (const row of rows) expect(stringWidth(text(row))).toBeLessThanOrEqual(30);
    const list = rows.filter((row) => row.line === 0).map(text);
    expect(list.length).toBeGreaterThan(3);
    expect(list.slice(1).every((line) => line.startsWith('  слово'))).toBe(true);
    expect(rows.filter((row) => row.line === 1).length).toBe(Math.ceil(100 / 30));
  });

  it('keeps snake_case, cuts tables at the edge and quiets the front matter', () => {
    expect(
      inline('a snake_case_name here')
        .map((span) => span.text)
        .join(''),
    ).toBe('a snake_case_name here');
    expect(
      inline('*курсив* и _тоже_')
        .filter((span) => span.italic)
        .map((span) => span.text),
    ).toEqual(['курсив', 'тоже']);
    const rows = layoutMarkdown(`---\ntitle: Тест\n---\n| ${'колонка | '.repeat(10)}`, 20);
    expect(text(rows[1]!)).toBe('title: Тест');
    expect(text(rows[3]!).endsWith('…')).toBe(true);
    expect(stringWidth(text(rows[3]!))).toBeLessThanOrEqual(20);
  });
});

describe('editing text', () => {
  const key = (over: Partial<Key>): Key =>
    ({
      upArrow: false,
      downArrow: false,
      leftArrow: false,
      rightArrow: false,
      pageDown: false,
      pageUp: false,
      home: false,
      end: false,
      return: false,
      escape: false,
      ctrl: false,
      shift: false,
      tab: false,
      backspace: false,
      delete: false,
      meta: false,
      ...over,
    }) as Key;
  const press = (value: string, cursor: number, input: string, over: Partial<Key> = {}) =>
    editKey({ value, cursor }, input, key(over), editorRows(value, 20), 3, undefined)?.next;

  it('wraps each line once and keeps offsets in the whole text', () => {
    const cache = new Map();
    const rows = editorRows('первая строка\nвторая', 8, cache);
    expect(rows.map((row) => row.start)).toEqual([0, 7, 14]);
    editorRows('первая строка\nвторая!', 8, cache);
    expect(cache.has('первая строка')).toBe(true);
  });

  it('moves by lines, pages and words, and edits by graphemes and lines', () => {
    const value = 'a\nb\nc\nd\ne\nf';
    expect(press(value, 0, '', { pageDown: true })?.cursor).toBe(6);
    expect(press(value, 0, '', { end: true, ctrl: true })?.cursor).toBe(value.length);
    expect(press('один два', 8, '', { leftArrow: true, meta: true })?.cursor).toBe(5);
    expect(press('a👍🏽b', 5, '', { backspace: true })?.value).toBe('ab');
    expect(press('раз\nдва', 5, 'e', { ctrl: true })?.cursor).toBe(7);
    expect(press('раз\nдва', 4, 'k', { ctrl: true })?.value).toBe('раз\n');
    expect(press('раз', 3, '', { return: true })?.value).toBe('раз\n');
    expect(press('раз', 3, '', { tab: true })?.value).toBe('раз  ');
    expect(press('раз', 3, 'z', { ctrl: true })).toBeUndefined();
  });

  it('keeps line breaks of a paste and drops terminal controls', () => {
    expect(insert({ value: '', cursor: 0 }, 'a\r\nb\u001b[31m')?.next.value).toBe('a\nb[31m');
    expect(insert({ value: 'x', cursor: 1 }, 'длинная вставка')?.kind).toBe('paste');
  });
});

describe('a file that changed on disk', () => {
  it('is told apart by its modification time', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.md'), 'one\n');
    const first = readDoc(dir, 'a.md').mtime;
    await new Promise((done) => setTimeout(done, 20));
    writeFileSync(join(dir, 'a.md'), 'two\n');
    expect(readDoc(dir, 'a.md').mtime).not.toBe(first);
  });
});
