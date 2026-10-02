import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';

import { addNode } from '../src/model/ops.js';
import { columns, marquee, marqueeOffset } from '../src/tui/marquee.js';
import { snapshot } from '../src/tui/snapshot.js';
import { emptyTree } from './helpers.js';

describe('running title', () => {
  const title = 'Автономный прогон Claude Code в контейнере';
  const width = 20;
  const overflow = title.length - width;

  it('stays put when it fits', () => {
    expect(marquee('Короткое', 20, 5000)).toBe('Короткое');
  });

  it('rests at the start with an ellipsis, travels, rests at the end, and comes back', () => {
    expect(marquee(title, width, 0)).toBe(`${title.slice(0, 19)}…`);
    expect(marquee(title, width, 1500)).toBe(`${title.slice(0, 19)}…`);
    const offsets: number[] = [];
    for (let ms = 0; ms < 40_000; ms += 60) offsets.push(marqueeOffset(overflow, ms));
    const peak = offsets.indexOf(overflow);
    // It gets to the end…
    expect(peak).toBeGreaterThan(0);
    expect(marquee(title, width, peak * 60)).toBe(`…${title.slice(overflow + 1)}`);
    // …and goes back the way it came, without a jump to the start.
    for (let i = 1; i < offsets.length; i++) expect(Math.abs(offsets[i]! - offsets[i - 1]!)).toBeLessThanOrEqual(1);
    expect(offsets.slice(peak).includes(0)).toBe(true);
  });

  it('is slow: about a third of a second per column, gentler at the ends', () => {
    const steps: number[] = [];
    let last = 0;
    let lastMs = 0;
    for (let ms = 0; ms < 20_000; ms += 10) {
      const offset = marqueeOffset(overflow, ms);
      if (offset !== last) {
        steps.push(ms - lastMs);
        last = offset;
        lastMs = ms;
      }
      if (offset === overflow) break;
    }
    const travel = steps.slice(1).reduce((sum, step) => sum + step, 0);
    expect(travel / (overflow - 1)).toBeGreaterThan(250);
    // The first and last steps are the slowest: an easing, not a jerk.
    expect(steps.at(-1)!).toBeGreaterThan(steps[Math.floor(steps.length / 2)]!);
  });

  it('always takes exactly the width, wide characters included', () => {
    const wide = '部署 👩‍💻 проверка очень длинного названия 部署';
    for (let ms = 0; ms < 30_000; ms += 137) expect(stringWidth(marquee(wide, 15, ms))).toBe(15);
    expect(columns('部署', 1, 3)).toBe(' 署');
    expect(columns('部署', 1, 2)).toBe('  ');
  });

  it('runs on the selected node in the TUI, and only there', async () => {
    const tree = emptyTree();
    const branch = addNode(tree, { title: 'Ветка' });
    addNode(tree, {
      title: 'Длинное название задачи, которое не помещается в колонку целиком',
      parent: branch.id,
      status: 'active',
    });
    // The graph's line with the node; the strip below may show the full title anyway.
    const graphLine = (frame: string) => frame.split('\n').find((line) => line.includes('◆ Тест')) ?? '';
    const start = graphLine(await snapshot(tree.project.dir, { columns: 100, rows: 20 }));
    expect(start).toContain('Длинное название');
    expect(start).not.toContain('колонку целиком');
    const later = graphLine(await snapshot(tree.project.dir, { columns: 100, rows: 20, settle: 12_500 }));
    expect(later).toContain('колонку целиком');
    expect(later).not.toContain('Длинное название');
  }, 30_000);
});
