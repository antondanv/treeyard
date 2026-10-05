import { readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TREE_DOC, writeDoc } from '../src/docs.js';
import { setLang } from '../src/i18n/i18n.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { DocsDialog } from '../src/tui/docs-dialog.js';
import { emptyTree } from './helpers.js';

const SAVE = '\u0013';
const UNDO = '\u001a';
const ESC = '\u001b';
const PAGE_DOWN = '\u001b[6~';
const pause = (ms = 40) => new Promise((done) => setTimeout(done, ms));

beforeEach(() => {
  resetSettings({ ...DEFAULTS });
  setLang('ru');
});
afterEach(() => {
  cleanup();
  setLang('ru');
});

function project() {
  const dir = emptyTree().project.dir;
  const lines = Array.from({ length: 60 }, (_, index) => `строка ${index + 1}`);
  writeFileSync(join(dir, 'README.md'), `# Проект\n\n${lines.join('\n')}\n`);
  writeFileSync(join(dir, 'AGENTS.md'), '# Правила\n\n- держись узла\n');
  return dir;
}

function open(dir: string, extra: Partial<Parameters<typeof DocsDialog>[0]> = {}) {
  const saved: string[] = [];
  const app = render(
    <DocsDialog
      dir={dir}
      project="Тест"
      width={100}
      height={26}
      onSave={(path, text, crlf) => {
        writeDoc(dir, path, text, crlf);
        saved.push(path);
      }}
      onClose={() => {}}
      {...extra}
    />,
  );
  const waitFor = (text: string | RegExp) =>
    vi.waitFor(
      () => {
        if (typeof text === 'string') expect(app.lastFrame()).toContain(text);
        else expect(app.lastFrame()).toMatch(text);
      },
      { timeout: 5000, interval: 20 },
    );
  const type = async (keys: string) => {
    for (const key of [...keys]) {
      app.stdin.write(key);
      await pause(15);
    }
  };
  return { app, saved, waitFor, type };
}

describe('the documents window', () => {
  it('lists the documents, reads one with Markdown drawn, scrolls, edits where the reader is and saves', async () => {
    const dir = project();
    const { app, saved, waitFor, type } = open(dir);
    await waitFor('3 .md проекта');
    expect(app.lastFrame()).toContain('.tree/tree.md');
    expect(app.lastFrame()).toContain('корень дерева: цель, правила, решения');
    app.stdin.write('\u001b[B');
    await pause();
    app.stdin.write('\r');
    await waitFor('строка 1');
    // The heading is drawn, not its mark.
    expect(app.lastFrame()).toContain('Проект');
    expect(app.lastFrame()).not.toContain('# Проект');
    app.stdin.write(PAGE_DOWN);
    await vi.waitFor(() => expect(app.lastFrame()).not.toContain('строка 1\n'));
    app.stdin.write('e');
    await waitFor('✎ README.md');
    // The editor opens at the first line the reader saw, not at the top.
    expect(app.lastFrame()).not.toContain('# Проект');
    await type('Новое ');
    await waitFor('● README.md · не сохранён');
    app.stdin.write(SAVE);
    await waitFor('сохранено · README.md');
    expect(saved).toEqual(['README.md']);
    const text = readFileSync(join(dir, 'README.md'), 'utf8');
    expect(text).toMatch(/\nНовое строка \d+\n/);
    expect(text.startsWith('# Проект\n')).toBe(true);
    app.stdin.write(ESC);
    await waitFor('изменён');
    app.stdin.write(ESC);
    await waitFor('3 .md проекта');
  });

  it('asks before leaving unsaved edits, and leaves the file alone when they are thrown away', async () => {
    const dir = project();
    const { app, waitFor, type } = open(dir, { open: { path: 'AGENTS.md', edit: true } });
    await waitFor('✎ AGENTS.md');
    await type('Черновик');
    app.stdin.write(ESC);
    await waitFor('Есть несохранённые правки.');
    app.stdin.write(ESC);
    await vi.waitFor(() => expect(app.lastFrame()).not.toContain('Есть несохранённые правки.'));
    app.stdin.write(ESC);
    await waitFor('Есть несохранённые правки.');
    // The Russian layout answers too: в is d.
    app.stdin.write('в');
    await waitFor('изменён');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe('# Правила\n\n- держись узла\n');
  });

  it('never overwrites a file changed on disk silently: overwrite or reload', async () => {
    const dir = project();
    const path = join(dir, 'AGENTS.md');
    const { app, waitFor, type } = open(dir, { open: { path: 'AGENTS.md', edit: true } });
    await waitFor('✎ AGENTS.md');
    await type('Мой ');
    writeFileSync(path, 'агент переписал\n');
    utimesSync(path, new Date(), new Date(Date.now() + 5000));
    app.stdin.write(SAVE);
    await waitFor('Файл изменился на диске');
    expect(readFileSync(path, 'utf8')).toBe('агент переписал\n');
    app.stdin.write('r');
    await waitFor('перечитал с диска');
    expect(app.lastFrame()).toContain('агент переписал');
    // ⌃Home: to the start of the text.
    app.stdin.write('\u001b[1;5H');
    await pause();
    await type('Мой ');
    writeFileSync(path, 'и ещё раз\n');
    utimesSync(path, new Date(), new Date(Date.now() + 10_000));
    app.stdin.write(SAVE);
    await waitFor('Файл изменился на диске');
    app.stdin.write('o');
    await waitFor('сохранено');
    expect(readFileSync(path, 'utf8')).toBe('Мой агент переписал\n');
  });

  it('does not save tree.md with broken front matter, and takes edits back word by word', async () => {
    const dir = project();
    const before = readFileSync(join(dir, TREE_DOC), 'utf8');
    const { app, waitFor, type } = open(dir, { open: { path: TREE_DOC, edit: true } });
    await waitFor(`✎ ${TREE_DOC}`);
    app.stdin.write('\u001b[B');
    await pause();
    await type(': [');
    app.stdin.write(SAVE);
    await waitFor('tree.md не сохранён');
    expect(readFileSync(join(dir, TREE_DOC), 'utf8')).toBe(before);
    for (let i = 0; i < 3; i++) {
      app.stdin.write(UNDO);
      await pause();
    }
    await waitFor(`✎ ${TREE_DOC}`);
    app.stdin.write(UNDO);
    await waitFor('отменять нечего');
    app.stdin.write(SAVE);
    await waitFor('сохранено');
    expect(readFileSync(join(dir, TREE_DOC), 'utf8')).toBe(before);
  });

  it.each(['ru', 'en'] as const)('fits 100×30 in %s', async (lang) => {
    resetSettings({ ...DEFAULTS, lang });
    setLang(lang);
    const dir = project();
    const { app, waitFor } = open(dir, { width: 97, height: 23 });
    await waitFor(lang === 'ru' ? '3 .md проекта' : '3 .md files');
    const rows = () => (app.lastFrame() ?? '').split('\n');
    expect(rows().length).toBeLessThanOrEqual(23);
    app.stdin.write('\u001b[B');
    await pause();
    app.stdin.write('\r');
    await waitFor('PgUp PgDn');
    expect(rows().length).toBeLessThanOrEqual(23);
    app.stdin.write('e');
    await waitFor('✎ README.md');
    expect(rows().length).toBeLessThanOrEqual(23);
  });
});
