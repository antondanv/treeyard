import { readFileSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';
import { cleanup, render } from 'ink-testing-library';
import stringWidth from 'string-width';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { description, journalEntries, replaceDescription } from '../src/model/journal.js';
import { addNode, logToNode, updateNode } from '../src/model/ops.js';
import { loadTree, nodePath } from '../src/model/store.js';
import { App } from '../src/tui/App.js';
import { cursorRow, multilineRows, verticalCursor } from '../src/tui/components/multiline.js';
import { NodeForm } from '../src/tui/dialogs.js';
import { snapshot } from '../src/tui/snapshot.js';
import { defaultUi } from '../src/tui/ui-state.js';
import { emptyTree } from './helpers.js';

afterEach(cleanup);
const plain = stripVTControlCharacters;
const pause = () => new Promise((done) => setTimeout(done, 30));
async function press(app: ReturnType<typeof render>, ...keys: string[]) {
  await pause();
  for (const key of keys) {
    app.stdin.write(key);
    await pause();
  }
}
const tabs = ['\t', '\t', '\t', '\t'];
const initial = { title: 'Узел', doneWhen: '', check: '', who: '' as const, status: 'todo' as const };
const paste = (text: string) => `\u001b[200~${text}\u001b[201~`;

describe('description and journal', () => {
  it.each(['Журнал', 'Journal'])('keeps %s and the later sections verbatim, even when cleared', (heading) => {
    const journal = `## ${heading}\n\n- запись\n\n## Потом\n\nхвост\n`;
    const body = `Старое\n\n${journal}`;
    expect(replaceDescription(body, 'Новое\n\n- пункт')).toBe(`Новое\n\n- пункт\n\n${journal}`);
    expect(replaceDescription(body, '')).toBe(journal);
    expect(replaceDescription('', 'Первое\nописание')).toBe('Первое\nописание');
  });

  it('rejects a pasted journal heading instead of creating a second journal', () => {
    expect(() => replaceDescription('Описание', '## Journal\n\n- запись')).toThrow('Журнал');
  });

  it('leaves unchanged description formatting intact and does not partially apply an invalid edit', () => {
    const body = '\nОписание\n\n\n## Журнал\n\n- запись\n';
    expect(replaceDescription(body, 'Описание')).toBe(body);
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Узел', body });
    expect(() => updateNode(tree, node.id, { title: 'Новое', description: '## Журнал' })).toThrow();
    expect(node.title).toBe('Узел');
    expect(loadTree(tree.project.dir).nodes.get(node.id)!.title).toBe('Узел');
  });
});

describe('multiline cursor', () => {
  it('wraps at the width and preserves paragraph breaks, empty lines and wide graphemes', () => {
    const value = '漢字🙂 длинная строка для переноса\n\nКонец\n';
    const rows = multilineRows(value, 12);
    expect(
      rows
        .map((row) => (row.last ? `${row.text.slice(0, -1)}\n` : row.text))
        .join('')
        .slice(0, -1),
    ).toBe(value);
    for (const row of rows) expect(stringWidth(row.text)).toBeLessThanOrEqual(12);
    expect(cursorRow(rows, value.length)).toBe(rows.length - 1);
  });

  it('keeps the display column through a short line and moves across wrapped rows', () => {
    const rows = multilineRows('abcdef\nx\nabcdef', 20);
    const up = verticalCursor(rows, 13, -1);
    expect(up).toEqual({ cursor: 8, column: 4 });
    expect(verticalCursor(rows, up.cursor, -1, up.column).cursor).toBe(4);
    const wrapped = multilineRows('abcdefghi', 4);
    expect(verticalCursor(wrapped, 5, -1).cursor).toBe(1);
    expect(verticalCursor(wrapped, 1, 1).cursor).toBe(5);
  });
});

describe('editing a description in the node form', () => {
  it('inserts lines, moves with arrows, pastes paragraphs and saves with Ctrl+S', async () => {
    const onSubmit = vi.fn();
    const app = render(
      <NodeForm
        mode="edit"
        initial={{ ...initial, description: 'абв\nгде' }}
        width={60}
        height={22}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await press(app, ...tabs, '\u001b[A', '!', '\u001b[B', '\r', paste('пункт\r\n\r\n- список'), '\u0013');
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ ...initial, description: 'абв!\nгде\nпункт\n\n- список' });
  });

  it('keeps Enter for saving other fields and allows Tab/Shift+Tab to leave the description', async () => {
    const onSubmit = vi.fn();
    const app = render(<NodeForm mode="edit" initial={initial} width={60} onSubmit={onSubmit} onCancel={vi.fn()} />);
    await press(app, ...tabs, 'Текст', '\u001b[Z', '\r');
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ ...initial, description: 'Текст' });
  });

  it('edits emoji as whole graphemes and joins lines with Backspace', async () => {
    const onSubmit = vi.fn();
    const app = render(
      <NodeForm
        mode="edit"
        initial={{ ...initial, description: 'а🙂\nб' }}
        width={60}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await press(app, ...tabs, '\u001b[D', '\u007f', '\u001b[D', '\u001b[3~', '\u0013');
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ ...initial, description: 'аб' });
  });

  it.each([
    [130, 36],
    [100, 30],
  ])('saves paragraphs, keeps the journal and undoes the save at %d×%d', async (columns, rows) => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Описание задачи', body: 'Старое описание' });
    logToNode(tree, node.id, 'Исходная запись');
    const keys = ['e', ...tabs, '\u0001', '\u000b', paste('Первый абзац\n\n- пункт списка\nВторая строка'), '\u0013'];
    await snapshot(tree.project.dir, { columns, rows, ui: { selected: node.id }, keys });
    const saved = loadTree(tree.project.dir).nodes.get(node.id)!;
    expect(description(saved.body)).toBe('Первый абзац\n\n- пункт списка\nВторая строка');
    expect(journalEntries(saved.body)).toEqual(journalEntries(node.body));
    // Undo belongs to the running TUI, so exercise it in a single mount.
    await snapshot(tree.project.dir, {
      columns,
      rows,
      ui: { selected: node.id },
      keys: ['e', ...tabs, 'Правка', '\u0013', 'u'],
    });
    expect(loadTree(tree.project.dir).nodes.get(node.id)!.body).toBe(saved.body);
    await snapshot(tree.project.dir, {
      columns,
      rows,
      ui: { selected: node.id },
      keys: ['e', ...tabs, '\u0001', '\u000b', '\u0013'],
    });
    expect(description(loadTree(tree.project.dir).nodes.get(node.id)!.body)).toBe('');
    expect(journalEntries(loadTree(tree.project.dir).nodes.get(node.id)!.body)).toEqual(journalEntries(node.body));
  });

  it('Esc discards changes and E still hands the full node to the editor', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Узел', body: 'Описание' });
    const before = readFileSync(nodePath(tree.project.dir, node.id), 'utf8');
    const onAction = vi.fn();
    const app = render(
      <App
        dir={tree.project.dir}
        ui={{ ...defaultUi(), selected: node.id }}
        offline
        persist={false}
        onAction={onAction}
      />,
    );
    await press(app, 'e', ...tabs, 'Правка', '\u001b');
    expect(readFileSync(nodePath(tree.project.dir, node.id), 'utf8')).toBe(before);
    await press(app, 'E');
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'editor', node: node.id });
  });

  it('keeps a journal entry added just before saving, without waiting for the tree poll', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Узел', body: 'Описание' });
    const app = render(
      <App
        dir={tree.project.dir}
        ui={{ ...defaultUi(), selected: node.id }}
        offline
        persist={false}
        onAction={vi.fn()}
      />,
    );
    await press(app, 'e', ...tabs, ' новое');
    logToNode(loadTree(tree.project.dir), node.id, 'Запись агента при открытой форме');
    app.stdin.write('\u0013');
    await pause();
    const saved = loadTree(tree.project.dir).nodes.get(node.id)!;
    expect(description(saved.body)).toBe('Описание новое');
    expect(journalEntries(saved.body)).toHaveLength(1);
    expect(saved.body).toContain('Запись агента при открытой форме');
  });

  it('keeps the form open with the unsaved text when its journal heading is rejected', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Узел', body: 'Описание' });
    const before = readFileSync(nodePath(tree.project.dir, node.id), 'utf8');
    const frame = plain(
      await snapshot(tree.project.dir, {
        columns: 100,
        rows: 30,
        ui: { selected: node.id },
        keys: ['e', ...tabs, '\r', paste('## Журнал'), '\u0013'],
      }),
    );
    expect(frame).toContain('Изменить узел');
    expect(frame).toContain('## Журнал');
    expect(frame).toContain('Раздел «Журнал»');
    expect(readFileSync(nodePath(tree.project.dir, node.id), 'utf8')).toBe(before);
  });

  it('keeps long input and the footer visible in the narrow TUI in both languages', async () => {
    const tree = emptyTree();
    const node = addNode(tree, {
      title: 'Длинное название '.repeat(10),
      doneWhen: 'Длинный критерий '.repeat(10),
      check: 'npm test '.repeat(10),
      body: 'Описание\n'.repeat(20),
    });
    for (const lang of ['ru', 'en'] as const) {
      const opened = plain(
        await snapshot(tree.project.dir, {
          columns: 100,
          rows: 30,
          ui: { selected: node.id },
          keys: ['e', ...tabs],
          settings: { lang },
        }),
      );
      expect(opened).toContain(lang === 'ru' ? 'Описание' : 'Description');
      expect(opened).toContain(lang === 'ru' ? '⌃S сохранить' : '⌃S save');
      const frame = plain(
        await snapshot(tree.project.dir, {
          columns: 100,
          rows: 30,
          ui: { selected: node.id },
          keys: ['e', ...tabs, 'КОНЕЦ'],
          settings: { lang },
        }),
      );
      expect(frame).toContain('КОНЕЦ');
      expect(frame).toContain(lang === 'ru' ? '⌃S сохранить' : '⌃S save');
      expect(frame.trimEnd().split('\n').length).toBeLessThanOrEqual(30);
      for (const line of frame.split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(100);
    }
  });
});
