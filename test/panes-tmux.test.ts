import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capturePane, closePane, listPanes, panesAvailable, sendToPane } from '@antondanv/brainyard';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { launchInPane, readPanes, sleepPane, wakeInPane } from '../src/agents/panes.js';
import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { emptyTree, tempDir } from './helpers.js';

const socket = `treeyard-test-${process.pid}`;
const fixture = fileURLToPath(new URL('./fixtures/pane-cli.mjs', import.meta.url));
const hasTmux = panesAvailable();

async function until(check: () => Promise<boolean>) {
  const end = Date.now() + 5000;
  while (!(await check()) && Date.now() < end) await new Promise((done) => setTimeout(done, 50));
  expect(await check()).toBe(true);
}

describe.skipIf(!hasTmux)('pane lifecycle with real tmux', () => {
  beforeAll(() => {
    vi.stubEnv('BRAINYARD_TMUX_SOCKET', socket);
    vi.stubEnv('BRAINYARD_CLAUDE_BIN', JSON.stringify([process.execPath, fixture]));
    // Where the stand-in writes its conversations, and where the tree looks for them.
    vi.stubEnv('CLAUDE_CONFIG_DIR', tempDir('treeyard-claude-home-'));
  });
  afterAll(async () => {
    for (const pane of await listPanes({ socket })) await closePane(pane.pane, { socket });
    vi.unstubAllEnvs();
  });

  it('survives reloading the tree, echoes UTF-8 and resumes the same conversation after sleep', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Isolated CLI work' });
    const launched = await launchInPane(
      tree,
      node.id,
      { brain: 'claude', start: 'chat', pane: true },
      { width: 70, height: 12 },
    );
    try {
      await until(async () => (await capturePane(launched.pane))?.lines.join('\n').includes('pane CLI ready') ?? false);
      const saved = loadTree(tree.project.dir);
      const ref = saved.nodes.get(node.id)!.sessions[0]!;
      expect(ref).toMatchObject({ id: launched.ref.id, mode: 'pane', pane: launched.pane });
      const metadata = (await readPanes()).find((p) => p.pane === launched.pane)!;
      expect(metadata.cwd).toBe(tree.project.dir);
      expect(metadata.memory).toBeGreaterThan(0);
      await sendToPane(launched.pane, 'привет\r\u001b[A');
      await until(async () => (await capturePane(launched.pane))?.lines.join('\n').includes('привет') ?? false);
      expect(await sleepPane(saved, metadata)).toBe('slept');
      expect((await listPanes()).some((p) => p.pane === launched.pane)).toBe(false);
      const woken = await wakeInPane(saved, node.id, ref, { width: 70, height: 12 });
      try {
        await until(async () => (await capturePane(woken))?.lines.join('\n').includes('pane CLI ready') ?? false);
        const recorded = JSON.parse(readFileSync(join(tree.project.dir, `pane-${ref.id}.json`), 'utf8'));
        expect(recorded.args).toEqual(['--resume', ref.id]);
        expect(loadTree(tree.project.dir).nodes.get(node.id)!.sessions).toHaveLength(1);
        expect(loadTree(tree.project.dir).nodes.get(node.id)!.sessions[0]!.pane).toBe(woken);
      } finally {
        await closePane(woken);
      }
    } finally {
      await closePane(launched.pane);
    }
  });

  it('a session nobody spoke in is closed, not put to sleep: there is nothing to wake', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Silent' });
    const launched = await launchInPane(
      tree,
      node.id,
      { brain: 'claude', start: 'chat', pane: true },
      { width: 70, height: 12 },
    );
    await until(async () => (await capturePane(launched.pane))?.lines.join('\n').includes('pane CLI ready') ?? false);
    const pane = (await readPanes()).find((p) => p.pane === launched.pane)!;
    expect(await sleepPane(tree, pane)).toBe('closed');
    expect((await listPanes()).some((p) => p.pane === launched.pane)).toBe(false);
    expect(loadTree(tree.project.dir).nodes.get(node.id)!.sessions).toEqual([]);
    await expect(wakeInPane(tree, node.id, launched.ref, { width: 70, height: 12 })).rejects.toThrow(
      /не было ни одного/,
    );
  });

  it('captures a bounded scrollback viewport and detects native CLI mouse input', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Scroll test' });
    const launched = await launchInPane(
      tree,
      node.id,
      { brain: 'claude', start: 'chat', pane: true },
      { width: 70, height: 12 },
    );
    try {
      await until(async () => (await capturePane(launched.pane))?.lines.join('\n').includes('pane CLI ready') ?? false);
      await sendToPane(launched.pane, '\u0014');
      await until(
        async () => (await capturePane(launched.pane))?.lines.join('\n').includes('history line 099') ?? false,
      );
      const live = (await capturePane(launched.pane))!;
      expect(live.historySize).toBeGreaterThan(80);
      expect(live.scrollOffset).toBe(0);
      const earlier = (await capturePane(launched.pane, { scroll: 30 }))!;
      expect(earlier.lines).toHaveLength(12);
      expect(earlier.scrollOffset).toBe(30);
      expect(earlier.lines.join('\n')).toContain('history line 060');
      expect(earlier.lines.join('\n')).not.toContain('history line 099');
      const oldest = (await capturePane(launched.pane, { scroll: 100_000 }))!;
      expect(oldest.scrollOffset).toBe(oldest.historySize);
      expect(oldest.lines).toHaveLength(12);
      expect(oldest.lines.join('\n')).toContain('pane CLI ready');
      expect((await capturePane(launched.pane, { scroll: -20 }))!.lines).toEqual(live.lines);
      await sendToPane(launched.pane, '\u0013');
      await until(async () => (await capturePane(launched.pane))?.mouseTracking ?? false);
      expect(await capturePane(launched.pane)).toMatchObject({ mouseTracking: true, mouseSgr: true, alternate: true });
    } finally {
      await closePane(launched.pane);
    }
  });
});
