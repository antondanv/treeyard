import { execFileSync, spawnSync } from 'node:child_process';
import { realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPanes, panesAvailable } from '@antondanv/brainyard';
import { afterEach, describe, expect, it } from 'vitest';

import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import type { BrainId } from '../src/model/types.js';
import { worktreeParent } from '../src/worktree.js';
import { accessHome, emptyTree, tempDir, treeyardIn } from './helpers.js';

const node = process.execPath;
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const sockets: string[] = [];
const projects: string[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) spawnSync('tmux', ['-L', socket, 'kill-server']);
  for (const dir of projects.splice(0)) rmSync(worktreeParent(dir), { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim();

// The four CLIs are stand-ins on a tmux server of their own: what is checked is where treeyard starts them.
const CASES: { brain: BrainId; bin: string; file: string }[] = [
  { brain: 'claude', bin: 'BRAINYARD_CLAUDE_BIN', file: 'pane-cli.mjs' },
  { brain: 'codex', bin: 'BRAINYARD_CODEX_BIN', file: 'codex-cli.mjs' },
  { brain: 'antigravity', bin: 'BRAINYARD_AGY_BIN', file: 'agy-cli.mjs' },
  { brain: 'opencode', bin: 'BRAINYARD_OPENCODE_BIN', file: 'opencode-cli.mjs' },
];

function setup(c: (typeof CASES)[number]) {
  const tree = emptyTree();
  const main = tree.project.dir;
  projects.push(main);
  const nodes = ['Бот', 'Сайт', 'Почта'].map((title) => addNode(tree, { title, doneWhen: `${title} работает` }));
  writeFileSync(join(main, '.gitignore'), '.tree/.local/\n');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'start');
  const socket = `treeyard-test-${process.pid}-wt-${c.brain}`;
  sockets.push(socket);
  const home = tempDir(`treeyard-${c.brain}-home-`);
  const sh = treeyardIn(main, {
    HOME: home,
    CODEX_HOME: join(home, '.codex'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    TREEYARD_HOME: accessHome(),
    BRAINYARD_TMUX_SOCKET: socket,
    BRAINYARD_CLAUDE_BIN: 'treeyard-test-no-claude',
    BRAINYARD_CODEX_BIN: 'treeyard-test-no-codex',
    BRAINYARD_AGY_BIN: 'treeyard-test-no-agy',
    BRAINYARD_OPENCODE_BIN: 'treeyard-test-no-opencode',
    [c.bin]: JSON.stringify([node, fixture(c.file)]),
  });
  return { main, nodes, socket, sh };
}

/** Where treeyard puts a node's worktree, as git names it (the real path: /private/var on macOS). */
const placeOf = (main: string, id: string) => join(realpathSync(dirname(main)), `${basename(main)}.worktrees`, id);

describe.skipIf(!panesAvailable())('open --pane with worktrees, in real tmux', () => {
  it.each(CASES)(
    '$brain: three nodes — the first stays in the project’s folder, the others start in a worktree each',
    async (c) => {
      const { main, nodes, socket, sh } = setup(c);
      const [a, b, d] = nodes as [(typeof nodes)[number], (typeof nodes)[number], (typeof nodes)[number]];
      const res = await sh('open', a.id, b.id, d.id, '--brain', c.brain, '--start', 'do', '--pane', '--json', '--yes');
      expect(res.code, res.stderr).toBe(0);
      const rows = JSON.parse(res.stdout) as { node: string; pane: string; warnings: string[] }[];
      const live = await listPanes({ socket });
      const where = (id: string) => {
        const pane = rows.find((row) => row.node === id)!.pane;
        return live.find((p) => p.pane === pane)?.cwd;
      };
      expect(realpathSync(where(a.id)!)).toBe(realpathSync(main));
      expect(realpathSync(where(b.id)!)).toBe(placeOf(main, b.id));
      expect(realpathSync(where(d.id)!)).toBe(placeOf(main, d.id));
      for (const row of rows) expect(row.warnings).toEqual([]);

      // The nodes remember where their sessions are; the branch of each is the node's.
      const saved = loadTree(main);
      expect(saved.nodes.get(a.id)!.sessions[0]!.dir).toBeUndefined();
      expect(saved.nodes.get(b.id)!.sessions[0]!.dir).toBe(placeOf(main, b.id));
      expect(git(main, 'branch', '--list', `treeyard/${b.id}`)).toContain(`treeyard/${b.id}`);
      expect(git(main, 'branch', '--list', `treeyard/${a.id}`)).toBe('');

      // The panes are the project's wherever they stand: the list of the tree's panes counts them.
      const list = await sh('worktree', '--json');
      expect((JSON.parse(list.stdout) as { node: string }[]).map((row) => row.node).sort()).toEqual(
        [b.id, d.id].sort(),
      );
      const refuse = await sh('worktree', 'rm', b.id);
      expect(refuse.code).toBe(1);
      expect(refuse.stderr).toContain('открыта сессия в панели');
    },
    60_000,
  );

  it('--no-worktree keeps every node in the project’s folder', async () => {
    const c = CASES[1]!;
    const { main, nodes, socket, sh } = setup(c);
    const res = await sh(
      'open',
      ...nodes.map((n) => n.id),
      '--brain',
      c.brain,
      '--start',
      'do',
      '--pane',
      '--no-worktree',
      '--json',
      '--yes',
    );
    expect(res.code, res.stderr).toBe(0);
    const live = await listPanes({ socket });
    expect(live).toHaveLength(3);
    for (const pane of live) expect(realpathSync(pane.cwd!)).toBe(realpathSync(main));
    expect((await sh('worktree')).stdout).toContain('worktree у узлов нет');
  }, 60_000);

  it('--worktree on one node starts it in its own worktree; a second open of the node goes there too', async () => {
    const c = CASES[3]!;
    const { main, nodes, socket, sh } = setup(c);
    const a = nodes[0]!;
    const first = await sh('open', a.id, '--brain', c.brain, '--start', 'do', '--pane', '--worktree', '--yes');
    expect(first.code, first.stderr).toBe(0);
    const again = await sh('open', a.id, '--brain', c.brain, '--start', 'do', '--pane', '--yes');
    expect(again.code, again.stderr).toBe(0);
    const live = await listPanes({ socket });
    expect(live).toHaveLength(2);
    for (const pane of live) expect(realpathSync(pane.cwd!)).toBe(placeOf(main, a.id));
  }, 60_000);
});
