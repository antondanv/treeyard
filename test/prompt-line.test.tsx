import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';

import { addNode } from '../src/model/ops.js';
import { editRows, promptLayout } from '../src/tui/components/controls.js';
import { snapshot } from '../src/tui/snapshot.js';
import { emptyTree } from './helpers.js';

const LONG =
  'Очень длинное название нового узла, которое не помещается в одну строку подвала и раньше уходило за правый край экрана';

const rowText = (row: { before: string; at?: string; after: string }) => row.before + (row.at ?? '') + row.after;
// biome-ignore lint/suspicious/noControlCharactersInRegex: the frame is coloured.
const plain = (frame: string) => frame.replace(/\u001b\[[0-9;]*m/g, '');
/** Text read across wrapped rows: breaks and indents become one space. */
const flat = (text: string) => text.replace(/\s+/g, ' ');

describe('editRows', () => {
  it('breaks a long text between words and keeps all of it', () => {
    const rows = editRows(LONG, LONG.length, 30);
    expect(rows.length).toBeGreaterThan(3);
    for (const row of rows) expect(stringWidth(rowText(row))).toBeLessThanOrEqual(30);
    expect(rows.map(rowText).join('')).toBe(`${LONG} `);
    // No word is cut in half when it fits a row.
    for (const row of rows.slice(0, -1)) expect(rowText(row)).toMatch(/ $/);
    // The cursor past the end is a blank cell in the last row.
    expect(rows.at(-1)!.at).toBe(' ');
  });

  it('puts the cursor in the row where it is', () => {
    const at = LONG.indexOf('строку');
    const rows = editRows(LONG, at, 30);
    const row = rows.find((r) => r.at !== undefined)!;
    expect(row.at).toBe('с');
    expect(row.after.startsWith('троку')).toBe(true);
    expect(rows.filter((r) => r.at !== undefined)).toHaveLength(1);
    expect(rows.map(rowText).join('')).toBe(LONG);
  });

  it('breaks a word longer than the row, and counts wide characters as two columns', () => {
    const word = 'а'.repeat(25);
    expect(editRows(word, 0, 10).map(rowText)).toEqual(['а'.repeat(10), 'а'.repeat(10), 'а'.repeat(5)]);
    const wide = '漢字かな交じり文と絵文字🙂も入ります';
    for (const row of editRows(wide, wide.length, 9)) expect(stringWidth(rowText(row))).toBeLessThanOrEqual(9);
  });

  it('shows at most `max` rows, the ones up to the cursor', () => {
    const all = editRows(LONG, LONG.length, 20);
    const tail = editRows(LONG, LONG.length, 20, 2);
    expect(tail.map(rowText)).toEqual(all.slice(-2).map(rowText));
    const head = editRows(LONG, 0, 20, 2);
    // Without the blank past the end, which the cursor at the start does not need.
    expect(head.map(rowText)).toEqual(editRows(LONG, 0, 20).slice(0, 2).map(rowText));
    expect(head[0]!.at).toBe('О');
  });
});

describe('promptLayout', () => {
  const base = { lead: '＋ Внутрь «Ветка»:', hints: '⏎ добавить · esc отмена', width: 80, max: 5 };

  it('keeps the hints after a short text and drops them when the text needs the room', () => {
    expect(promptLayout({ ...base, value: 'Коротко', cursor: 7 }).hints).toContain('⏎ добавить');
    const long = promptLayout({ ...base, value: LONG, cursor: LONG.length });
    expect(long.hints).toBe('');
    expect(long.rows.length).toBeGreaterThan(1);
    expect(long.width).toBe(80 - stringWidth(base.lead) - 1);
  });

  it('cuts a lead wider than half the line', () => {
    const layout = promptLayout({ ...base, lead: `＋ Внутрь «${LONG}»:`, value: 'x', cursor: 1 });
    expect(stringWidth(layout.lead)).toBeLessThanOrEqual(39);
    expect(layout.lead.endsWith('…')).toBe(true);
    expect(layout.width).toBeGreaterThanOrEqual(40);
  });
});

describe('the line at the bottom', () => {
  it('shows everything typed into a quick add, on a narrow screen too', async () => {
    const tree = emptyTree();
    addNode(tree, { title: `Ветка с длинным названием: ${LONG}`, status: 'active' });
    for (const [columns, rows] of [
      [100, 30],
      [130, 36],
    ] as const) {
      const frame = plain(await snapshot(tree.project.dir, { columns, rows, keys: ['a', LONG] }));
      const lines = frame.split('\n');
      const lead = lines.findIndex((line) => line.includes('＋ Внутрь «'));
      expect(lead).toBeGreaterThan(0);
      // The branch name is cut, so what you type keeps the line.
      expect(lines[lead]).toMatch(/«Ветка с длинным[^»]*…»:/);
      expect(flat(lines.slice(lead).join('\n'))).toContain(LONG);
      for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(columns);
    }
  });

  it('shows the whole title while renaming, and the filter text', async () => {
    const tree = emptyTree();
    addNode(tree, { title: LONG, status: 'active' });
    const rename = plain(await snapshot(tree.project.dir, { columns: 100, rows: 30, keys: ['r'] }));
    expect(flat(rename.slice(rename.indexOf('✎ Название:')))).toContain(LONG);
    const filter = plain(await snapshot(tree.project.dir, { columns: 100, rows: 30, keys: ['/', LONG] }));
    expect(flat(filter.slice(filter.lastIndexOf('\n / ')))).toContain(LONG);
  });
});
