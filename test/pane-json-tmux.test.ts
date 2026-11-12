import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capturePane, listPanes, panesAvailable } from '@antondanv/brainyard';
import { afterEach, describe, expect, it } from 'vitest';

import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import type { BrainId } from '../src/model/types.js';
import { emptyTree, tempDir, treeyardIn } from './helpers.js';

const node = process.execPath;
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const sockets: string[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) spawnSync('tmux', ['-L', socket, 'kill-server']);
});

async function until(check: () => Promise<boolean>, what: string) {
  const end = Date.now() + 10_000;
  while (!(await check()) && Date.now() < end) await new Promise((done) => setTimeout(done, 60));
  expect(await check(), what).toBe(true);
}

const CASES: { brain: BrainId; bin: string; file: string }[] = [
  { brain: 'codex', bin: 'BRAINYARD_CODEX_BIN', file: 'codex-cli.mjs' },
  { brain: 'antigravity', bin: 'BRAINYARD_AGY_BIN', file: 'agy-cli.mjs' },
];

describe.skipIf(!panesAvailable())('a pane for a program: Codex and Antigravity', () => {
  it.each(CASES)(
    '$brain: open --pane --json gives the pane, sessions --json finds its session',
    async (c) => {
      const tree = emptyTree();
      const task = addNode(tree, { title: 'Терминал в браузере' });
      // Each case starts its own tmux server from the CLI, so its panes get this home: the
      // stand-ins write their stores into it, and Brainyard reads them from there.
      const socket = `treeyard-test-${process.pid}-json-${c.brain}`;
      sockets.push(socket);
      const home = tempDir(`treeyard-home-${c.brain}-`);
      const sh = treeyardIn(tree.project.dir, {
        HOME: home,
        CODEX_HOME: join(home, '.codex'),
        XDG_DATA_HOME: join(home, '.local', 'share'),
        CLAUDE_CONFIG_DIR: join(home, '.claude'),
        BRAINYARD_TMUX_SOCKET: socket,
        BRAINYARD_CLAUDE_BIN: 'treeyard-test-no-claude',
        BRAINYARD_CODEX_BIN: 'treeyard-test-no-codex',
        BRAINYARD_AGY_BIN: 'treeyard-test-no-agy',
        BRAINYARD_OPENCODE_BIN: 'treeyard-test-no-opencode',
        [c.bin]: JSON.stringify([node, fixture(c.file)]),
      });

      const got = await sh('open', task.id, '--brain', c.brain, '--start', 'do', '--pane', '--json', '--yes');
      expect(got.code, got.stderr).toBe(0);
      const started = JSON.parse(got.stdout) as { id: string | null; pane: string };
      // The CLI names its session only once it has started.
      expect(started).toMatchObject({ node: task.id, brain: c.brain, id: null, warnings: [] });
      expect((await listPanes({ socket })).find((p) => p.pane === started.pane)?.brain).toBe(c.brain);

      let id = '';
      await until(async () => {
        const screen = (await capturePane(started.pane, { socket }))?.lines.join('\n') ?? '';
        id = /stand-in ready (\S+)/.exec(screen)?.[1] ?? '';
        return Boolean(id);
      }, `the pane shows the ${c.brain} stand-in`);
      // Nobody has settled the pane: the node holds `pane:…`, the pane knows no session.
      const pending = `pane:${started.pane}`;
      expect(loadTree(tree.project.dir).nodes.get(task.id)!.sessions[0]!.id).toBe(pending);

      const list = JSON.parse((await sh('sessions', '--json')).stdout) as { id: string; pane: string | null }[];
      expect(list).toEqual([
        expect.objectContaining({ id, brain: c.brain, node: task.id, offTree: false, pane: started.pane }),
      ]);
      expect((await sh('sessions')).stdout).toContain(`▣ ${started.pane}`);
      // Reading never writes: the tree learns the id when the TUI settles the pane.
      expect(loadTree(tree.project.dir).nodes.get(task.id)!.sessions[0]!.id).toBe(pending);

      spawnSync('tmux', ['-L', socket, 'kill-server']);
      const closed = JSON.parse((await sh('sessions', '--json')).stdout) as { id: string; pane: string | null }[];
      expect(closed).toEqual([expect.objectContaining({ id, pane: null })]);
    },
    40_000,
  );
});
