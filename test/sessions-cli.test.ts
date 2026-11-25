import { describe, expect, it } from 'vitest';

import { journalEntries } from '../src/model/journal.js';
import { addNode, attachSession } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import type { SessionRef } from '../src/model/types.js';
import { emptyTree, tempDir, treeyardIn } from './helpers.js';

describe('treeyard sessions --replace', () => {
  it('replaces an exact id in place, preserves session metadata and records the repair once', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Terminal', status: 'active' });
    const previous: SessionRef = {
      id: 'old-conversation',
      brain: 'antigravity',
      mode: 'pane',
      name: 'Terminal',
      started: '2026-11-25T17:16:30.000Z',
      opened: '2026-11-25T17:20:30.000Z',
      pane: 'agy-1234',
      dir: tempDir(),
    };
    const other: SessionRef = { ...previous, id: 'older-conversation', pane: 'agy-5678' };
    attachSession(tree, node.id, previous);
    attachSession(tree, node.id, other);
    const owner = addNode(tree, { title: 'Other node' });
    attachSession(tree, owner.id, { ...previous, id: 'taken-conversation' });
    const socket = `treeyard-test-${process.pid}-replace`;
    const sh = treeyardIn(tempDir(), { BRAINYARD_TMUX_SOCKET: socket, TREEYARD_LANG: 'en' });
    const replace = (oldId: string, id: string) =>
      sh('sessions', node.id, oldId, '--replace', id, '--project', tree.project.dir);

    const missing = await replace('old', 'right-conversation');
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('use the exact id');
    const duplicate = await replace(previous.id, 'taken-conversation');
    expect(duplicate.code).toBe(2);
    expect(duplicate.stderr).toContain('already belongs to node');
    expect((await replace(previous.id, 'pane:agy-1234')).code).toBe(2);
    const saved = () => loadTree(tree.project.dir).nodes.get(node.id)!;
    expect(saved().sessions).toEqual([previous, other]);

    const repaired = await replace(previous.id, 'right-conversation');
    expect(repaired.code, repaired.stderr).toBe(0);
    expect(repaired.stdout).toContain('updated session binding: old-conversation → right-conversation');
    expect(saved().sessions).toEqual([{ ...previous, id: 'right-conversation' }, other]);
    expect(saved().status).toBe('active');
    expect((await replace('right-conversation', 'right-conversation')).code).toBe(0);
    expect(journalEntries(saved().body).filter((line) => line.includes('updated session binding'))).toHaveLength(1);
  }, 40_000);
});
