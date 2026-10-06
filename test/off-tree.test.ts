import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const now = Date.now();
const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString();

vi.mock('@antondanv/brainyard', async (original) => ({
  ...(await original<typeof import('@antondanv/brainyard')>()),
  panesAvailable: () => false,
  liveSessions: async () => [],
  sessions: async () => [
    { brain: 'claude', id: 'from-node', title: 'Node work', startedAt: daysAgo(1), interactive: true },
    { brain: 'claude', id: 'stray', title: 'Quick fix by hand', startedAt: daysAgo(2), interactive: true },
    { brain: 'codex', id: 'old-stray', title: 'Old experiment', startedAt: daysAgo(30), interactive: true },
  ],
}));

import { addNode, attachSession } from '../src/model/ops.js';
import { offTree, offTreeLine, offTreeTally, sessionOwners } from '../src/model/tree.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { snapshot } from '../src/tui/snapshot.js';
import { emptyTree, tempDir } from './helpers.js';

beforeEach(() => {
  process.env.TREEYARD_HOME = tempDir('treeyard-home-');
  resetSettings({ ...DEFAULTS });
});

afterEach(() => resetSettings({ ...DEFAULTS }));

describe('sessions opened past the tree', () => {
  it('a session no node holds is off the tree; pane placeholders and the planting session are not', () => {
    const owners = new Map([['mine', 'n1']]);
    expect(offTree({ id: 'mine' }, owners)).toBe(false);
    expect(offTree({ id: 'other' }, owners)).toBe(true);
    expect(offTree({ id: 'pane:claude-1' }, owners)).toBe(false);
    expect(offTree({ id: 'p', title: 'my-app · посадка дерева' }, owners)).toBe(false);
    expect(offTree({ id: 'p', title: 'my-app · planting the tree' }, owners)).toBe(false);
  });

  it('counts only the last 14 days', () => {
    const owners = new Map([['mine', 'n1']]);
    const tally = offTreeTally(
      [
        { id: 'mine', startedAt: daysAgo(1) },
        { id: 'a', startedAt: daysAgo(3) },
        { id: 'b', updatedAt: daysAgo(13) },
        { id: 'c', startedAt: daysAgo(20) },
        { id: 'd' },
      ],
      owners,
      now,
    );
    expect(tally).toEqual({ total: 3, off: 2 });
    expect(offTreeLine(tally)).toBe('за 14 дней: 3 сессии, мимо дерева — 2');
  });

  it('the «Сессии» tab marks them and shows the count', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Cart', status: 'active' });
    attachSession(tree, node.id, { brain: 'claude', id: 'from-node', name: 'Node work', started: daysAgo(1) });
    expect(sessionOwners(tree).get('from-node')).toBe(node.id);
    const frame = await snapshot(tree.project.dir, { columns: 110, rows: 30, keys: ['5'], live: true });
    expect(frame).toContain('за 14 дней: 2 сессии, мимо дерева — 1');
    expect(frame).toMatch(/Quick fix by hand\s+· без узла/);
    expect(frame).toMatch(/Old experiment\s+· без узла/);
    expect(frame).not.toMatch(/Node work.*без узла/);
  });
});
