import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPanes, panesAvailable } from '@antondanv/brainyard';
import { afterEach, describe, expect, it } from 'vitest';

import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import type { BrainId, TreeNode } from '../src/model/types.js';
import { emptyTree, tempDir, treeyardIn } from './helpers.js';

const node = process.execPath;
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const sockets: string[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) spawnSync('tmux', ['-L', socket, 'kill-server']);
});

const CASES: { brain: BrainId; bin: string; file: string; named: boolean }[] = [
  { brain: 'claude', bin: 'BRAINYARD_CLAUDE_BIN', file: 'pane-cli.mjs', named: true },
  { brain: 'codex', bin: 'BRAINYARD_CODEX_BIN', file: 'codex-cli.mjs', named: false },
  { brain: 'antigravity', bin: 'BRAINYARD_AGY_BIN', file: 'agy-cli.mjs', named: false },
  { brain: 'opencode', bin: 'BRAINYARD_OPENCODE_BIN', file: 'opencode-cli.mjs', named: false },
];

/** Three nodes in a fresh tree and a CLI run on its own tmux server, with `brain`'s stand-in unless `missing`. */
function setup(c: (typeof CASES)[number], missing = false) {
  const tree = emptyTree();
  const nodes = ['Бот', 'Сайт', 'Почта'].map((title) => addNode(tree, { title, doneWhen: `${title} работает` }));
  // Each case starts its own tmux server from the CLI, so its panes get this home: the
  // stand-ins write their stores into it, and Brainyard reads them from there.
  const socket = `treeyard-test-${process.pid}-many-${c.brain}`;
  sockets.push(socket);
  const home = tempDir(`treeyard-${c.brain}-home-`);
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
    ...(missing ? {} : { [c.bin]: JSON.stringify([node, fixture(c.file)]) }),
  });
  const saved = (n: TreeNode) => loadTree(tree.project.dir).nodes.get(n.id)!;
  return { tree, nodes, socket, sh, saved };
}

type Started = { node: string; brain: string; id: string | null; pane: string | null; startedAt: string | null };

describe.skipIf(!panesAvailable())('open <id> <id>… --pane with real tmux', () => {
  it.each(CASES)(
    '$brain: a pane in each node, a line per node, the panes are live and saved in the nodes',
    async (c) => {
      const { nodes, socket, sh, saved } = setup(c);
      const res = await sh('open', ...nodes.map((n) => n.id), '--brain', c.brain, '--start', 'do', '--pane', '--yes');
      expect(res.code, res.stderr).toBe(0);
      const lines = res.stdout.trimEnd().split('\n');
      expect(lines).toHaveLength(3);
      const live = await listPanes({ socket });
      expect(live).toHaveLength(3);
      nodes.forEach((n, i) => {
        const pane = new RegExp(`^✓ ${n.id}  ${n.title} · панель (\\S+)$`).exec(lines[i]!)?.[1];
        expect(pane, lines[i]).toBeDefined();
        expect(live.find((p) => p.pane === pane)).toMatchObject({ brain: c.brain });
        const now = saved(n);
        expect(now.sessions).toMatchObject([{ brain: c.brain, mode: 'pane', pane }]);
        expect(now.status).toBe('active');
      });
    },
    40_000,
  );

  it.each(CASES)(
    '$brain: --json is an array, one object per node',
    async (c) => {
      const { nodes, socket, sh } = setup(c);
      const res = await sh(
        'open',
        ...nodes.map((n) => n.id),
        '--brain',
        c.brain,
        '--start',
        'do',
        '--pane',
        '--json',
        '--yes',
      );
      expect(res.code, res.stderr).toBe(0);
      const rows = JSON.parse(res.stdout) as Started[];
      expect(rows.map((r) => r.node)).toEqual(nodes.map((n) => n.id));
      const live = await listPanes({ socket });
      for (const row of rows) {
        expect(row).toMatchObject({ brain: c.brain, warnings: [] });
        expect(live.some((p) => p.pane === row.pane)).toBe(true);
        expect(row.startedAt).toBeTruthy();
        // Codex, Antigravity and OpenCode name a session only after it starts.
        if (c.named) expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
        else expect(row.id).toBeNull();
      }
      expect(new Set(rows.map((r) => r.pane)).size).toBe(3);
    },
    40_000,
  );

  it('a repeated id gets one pane; the answer is a list because a list was asked', async () => {
    const c = CASES[0]!;
    const { nodes, socket, sh } = setup(c);
    const [a, b] = nodes as [TreeNode, TreeNode];
    const res = await sh('open', a.id, a.id, b.id, '--start', 'do', '--pane', '--json', '--yes');
    expect(res.code, res.stderr).toBe(0);
    expect((JSON.parse(res.stdout) as Started[]).map((r) => r.node)).toEqual([a.id, b.id]);
    expect(await listPanes({ socket })).toHaveLength(2);
    // Two ids that mean one node: still an array, not the object of a single id.
    const again = await sh('open', b.id, b.id, '--start', 'do', '--pane', '--json', '--yes');
    expect(again.code, again.stderr).toBe(0);
    expect(JSON.parse(again.stdout)).toEqual([expect.objectContaining({ node: b.id })]);
  }, 40_000);

  it('starts no pane when one id is wrong', async () => {
    const c = CASES[0]!;
    const { nodes, socket, sh, saved } = setup(c);
    const res = await sh('open', nodes[0]!.id, 'нет-такого', nodes[1]!.id, '--pane', '--json', '--yes');
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('нет узла «нет-такого»');
    expect(res.stdout).toBe('');
    expect(await listPanes({ socket })).toEqual([]);
    for (const n of nodes) expect(saved(n).sessions).toEqual([]);
  }, 40_000);

  it('every pane failing is a ✗ line each and exit 1, with the failures in the array', async () => {
    const c = CASES[0]!;
    // The CLI is not there: Brainyard cannot plan the launch, for each node in turn.
    const { nodes, sh, saved } = setup(c, true);
    const res = await sh('open', ...nodes.map((n) => n.id), '--pane', '--json', '--yes');
    expect(res.code, res.stderr).toBe(1);
    const rows = JSON.parse(res.stdout) as (Started & { error?: string })[];
    expect(rows).toHaveLength(3);
    for (const [i, row] of rows.entries()) {
      expect(row).toMatchObject({ node: nodes[i]!.id, id: null, pane: null, startedAt: null });
      expect(row.error).toBeTruthy();
      expect(res.stderr).toContain(`✗ ${nodes[i]!.id}  ${nodes[i]!.title} · ${row.error}`);
    }
    for (const n of nodes) expect(saved(n).sessions).toEqual([]);
  }, 40_000);
});
