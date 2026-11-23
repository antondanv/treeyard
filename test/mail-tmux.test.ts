import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capturePane, closePane, listPanes, panesAvailable, type SessionInfo } from '@antondanv/brainyard';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DELIVER_SOURCES, type DeliverSources, deliverAll } from '../src/agents/deliver.js';
import { launchInPane, readPanes, sleepPane } from '../src/agents/panes.js';
import { sendToNode } from '../src/agents/send.js';
import { letterByNumber } from '../src/model/mailbox.js';
import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { emptyTree, tempDir } from './helpers.js';

const socket = `treeyard-test-${process.pid}-mail`;
const fixture = fileURLToPath(new URL('./fixtures/pane-cli.mjs', import.meta.url));
const hasTmux = panesAvailable();

async function until(check: () => Promise<boolean>, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await check()) && Date.now() < end) await new Promise((done) => setTimeout(done, 50));
  expect(await check()).toBe(true);
}

const screen = async (pane: string) => (await capturePane(pane))?.lines.join('\n') ?? '';

describe.skipIf(!hasTmux)('letters through real tmux panes', () => {
  beforeAll(() => {
    vi.stubEnv('BRAINYARD_TMUX_SOCKET', socket);
    vi.stubEnv('BRAINYARD_CLAUDE_BIN', JSON.stringify([process.execPath, fixture]));
    vi.stubEnv('CLAUDE_CONFIG_DIR', tempDir('treeyard-claude-home-'));
  });
  afterAll(async () => {
    for (const pane of await listPanes({ socket })) await closePane(pane.pane, { socket });
    vi.unstubAllEnvs();
  });

  it('a letter to a busy pane waits, is typed once its turn is over, and wakes the pane once it sleeps', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Панель с письмами' });
    const launched = await launchInPane(
      tree,
      node.id,
      { brain: 'claude', start: 'chat', pane: true },
      { width: 90, height: 16 },
    );
    const panes = [launched.pane];
    try {
      await until(async () => (await screen(launched.pane)).includes('pane CLI ready'));
      const id = launched.ref.id;
      // The stand-in does not say what it does: the test does, through Brainyard's live states.
      let state = 'busy';
      const sources: DeliverSources = {
        ...DELIVER_SOURCES,
        live: async () =>
          [{ brain: 'claude', id, interactive: true, live: { status: state, kind: 'interactive' } }] as SessionInfo[],
        // As if the pane had started a minute ago: past the time a CLI takes to start.
        now: () => Date.now() + 60_000,
      };
      const queued = await sendToNode(loadTree(tree.project.dir), node.id, 'письмо в очередь', {
        sources,
        spawn: () => undefined,
      });
      expect(queued).toMatchObject({ held: 'busy', letter: { n: 1, state: 'queued' } });
      await new Promise((done) => setTimeout(done, 300));
      expect(await screen(launched.pane)).not.toContain('письмо в очередь');

      state = 'idle';
      const [typed] = await deliverAll(tree.project.dir, { sources });
      expect(typed).toMatchObject({ how: 'typed', pane: launched.pane, letters: [1] });
      // The whole letter went in as one paste, then Enter.
      await until(async () => (await screen(launched.pane)).includes('письмо в очередь'));
      expect(letterByNumber(tree.project.dir, 1)).toMatchObject({ state: 'delivered', delivered: { how: 'typed' } });

      // Asleep: the same conversation wakes in a new pane with the next letter.
      const metadata = (await readPanes()).find((p) => p.pane === launched.pane)!;
      expect(await sleepPane(loadTree(tree.project.dir), metadata)).toBe('slept');
      const asleep = { ...sources, live: async () => [] as SessionInfo[] };
      const woke = await sendToNode(loadTree(tree.project.dir), node.id, 'после сна', {
        sources: asleep,
        size: { width: 90, height: 16 },
      });
      expect(woke).toMatchObject({ how: 'woke', letter: { n: 2, state: 'delivered' } });
      panes.push(woke.pane!);
      await until(async () => (await screen(woke.pane!)).includes('pane CLI ready'));
      const recorded = JSON.parse(readFileSync(join(tree.project.dir, `pane-${id}.json`), 'utf8'));
      expect(recorded.args).toEqual(expect.arrayContaining(['--resume', id, 'после сна']));
      expect(loadTree(tree.project.dir).nodes.get(node.id)!.sessions[0]).toMatchObject({ pane: woke.pane });
    } finally {
      for (const pane of panes) await closePane(pane).catch(() => undefined);
    }
  }, 30_000);

  it('a letter to a node without a session goes into the first message of its new pane', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Ещё без сессии', doneWhen: 'письмо дошло' });
    const sent = await sendToNode(tree, node.id, 'прочти docs/', { spawn: () => undefined });
    expect(sent).toMatchObject({ held: 'none', letter: { state: 'queued' } });
    const launched = await launchInPane(
      loadTree(tree.project.dir),
      node.id,
      { brain: 'claude', start: 'do', pane: true },
      { width: 90, height: 16 },
    );
    try {
      await until(async () => (await screen(launched.pane)).includes('pane CLI ready'));
      const recorded = JSON.parse(readFileSync(join(tree.project.dir, `pane-${launched.ref.id}.json`), 'utf8'));
      expect(recorded.args.at(-1)).toContain('Письма узлу, которые ждали его сессии');
      expect(recorded.args.at(-1)).toContain('прочти docs/');
      expect(letterByNumber(tree.project.dir, 1)).toMatchObject({
        state: 'delivered',
        delivered: { how: 'first', pane: launched.pane },
      });
    } finally {
      await closePane(launched.pane);
    }
  }, 30_000);
});
