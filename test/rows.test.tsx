import type { SessionInfo } from '@antondanv/brainyard';
import { renderToString } from 'ink';
import stringWidth from 'string-width';
import { afterEach, describe, expect, it } from 'vitest';

import { addNode } from '../src/model/ops.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { TreeRow } from '../src/tui/rows.js';
import { emptyTree } from './helpers.js';

afterEach(() => resetSettings({ ...DEFAULTS }));

describe('deep tree rows', () => {
  it.each([
    { brain: 'claude', label: 'claude' },
    { brain: 'codex', label: 'codex' },
    { brain: 'antigravity', label: 'agy' },
    { brain: 'opencode', label: 'opencode' },
  ] as const)('$brain: keeps the node status, title and agent on a narrow line', ({ brain, label }) => {
    resetSettings({ ...DEFAULTS });
    const node = addNode(emptyTree(), {
      title: 'Оплата заказа после доставки и длинное продолжение',
      status: 'review',
      who: 'human',
    });
    for (const depth of [2, 8]) {
      for (const width of [29, 41]) {
        for (const status of ['busy', 'waiting'] as const) {
          const live: SessionInfo[] = [
            { brain, id: 'conversation', interactive: true, live: { kind: 'interactive', status } },
          ];
          for (const selected of [false, true]) {
            const frame = renderToString(
              <TreeRow
                row={{
                  node,
                  depth,
                  guides: [],
                  last: true,
                  hasChildren: false,
                  expanded: false,
                  held: false,
                  match: true,
                }}
                width={width}
                selected={selected}
                badges={{ live, frame: 0 }}
              />,
              { columns: width },
            );
            expect(frame).toContain('◎ Оплата');
            expect(frame).toContain(`${status === 'waiting' ? '?' : '⠋'} ${label}`);
            expect(frame.split('\n')).toHaveLength(1);
            expect(stringWidth(frame)).toBeLessThanOrEqual(width);
          }
        }
      }
    }
  });
});
