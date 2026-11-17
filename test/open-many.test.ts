import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import type { TreeNode } from '../src/model/types.js';
import { emptyTree, tempDir, treeyardIn } from './helpers.js';

// A Claude Code stand-in with real background processes and its own state (CLAUDE_CONFIG_DIR).
const fixture = fileURLToPath(new URL('./fixtures/background-cli.mjs', import.meta.url));
const TASK = 'без платных вызовов; "завод" не перезапускать';
const homes: string[] = [];

const running = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

afterEach(async () => {
  // The stand-in's sessions are detached processes: stop every one a test started, and wait,
  // since each writes its state on the way out and the temp folders go right after this hook.
  for (const home of homes.splice(0)) {
    const state = join(home, 'background.json');
    if (!existsSync(state)) continue;
    const pids = (JSON.parse(readFileSync(state, 'utf8')) as { pid: number }[]).map((row) => row.pid);
    for (const pid of pids.filter(running)) process.kill(pid, 'SIGTERM');
    const end = Date.now() + 5000;
    while (pids.some(running) && Date.now() < end) await new Promise((done) => setTimeout(done, 20));
  }
});

/** Nodes with these titles in a fresh tree; `env` may name them (they get their ids first). */
function setup(titles: string[], env: (nodes: TreeNode[]) => NodeJS.ProcessEnv = () => ({})) {
  const tree = emptyTree();
  const nodes = titles.map((title) => addNode(tree, { title, doneWhen: `${title} работает` }));
  const home = tempDir('treeyard-claude-home-');
  homes.push(home);
  const sh = treeyardIn(tree.project.dir, {
    CLAUDE_CONFIG_DIR: home,
    BRAINYARD_CLAUDE_BIN: JSON.stringify([process.execPath, fixture]),
    ...env(nodes),
  });
  const log = join(home, 'launches.jsonl');
  const launches = (): { args: string[]; node: string }[] =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [];
  const saved = (node: TreeNode) => loadTree(tree.project.dir).nodes.get(node.id)!;
  return { nodes, sh, launches, saved };
}

const started = (node: TreeNode) => new RegExp(`^✓ ${node.id}  ${node.title} · сессия ([0-9a-f-]{36})$`);

describe('open <id> <id>… --bg', () => {
  it('starts a session in each node, one after another, and prints a line per node', async () => {
    const { nodes, sh, launches, saved } = setup(['Бот', 'Сайт', 'Почта']);
    const res = await sh('open', ...nodes.map((n) => n.id), '--bg', '--start', 'do', '--task', TASK, '--yes');
    expect(res.code, res.stderr).toBe(0);
    const lines = res.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    nodes.forEach((node, i) => {
      const session = started(node).exec(lines[i]!)?.[1];
      expect(session, lines[i]).toBeDefined();
      const now = saved(node);
      expect(now.sessions).toMatchObject([{ brain: 'claude', id: session, mode: 'background' }]);
      expect(now.status).toBe('active');
    });
    // Each session got its own node and the coordinator's task in its first message.
    expect(launches().map((l) => l.node)).toEqual(nodes.map((n) => n.id));
    for (const launch of launches())
      expect(launch.args.some((arg) => arg.includes(`Задание к узлу:\n${TASK}`))).toBe(true);
  }, 60_000);

  it('gives a repeated id or a prefix one session', async () => {
    const { nodes, sh, launches } = setup(['Бот', 'Сайт']);
    const [a, b] = nodes as [TreeNode, TreeNode];
    // A prefix only while it names one node.
    const prefix = b.id.startsWith(a.id.slice(0, 3)) ? a.id : a.id.slice(0, 3);
    const res = await sh('open', a.id, prefix, b.id, a.id, '--bg', '--yes');
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout.trimEnd().split('\n')).toHaveLength(2);
    expect(launches().map((l) => l.node)).toEqual([a.id, b.id]);
  }, 60_000);

  it('starts nothing when one id is wrong', async () => {
    const { nodes, sh, launches, saved } = setup(['Бот', 'Сайт']);
    const res = await sh('open', nodes[0]!.id, 'нет-такого', nodes[1]!.id, '--bg', '--yes');
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('нет узла «нет-такого»');
    expect(res.stdout).toBe('');
    expect(launches()).toEqual([]);
    for (const node of nodes) expect(saved(node).sessions).toEqual([]);
  });

  it('refuses several nodes without --bg or --pane', async () => {
    const { nodes, sh, launches } = setup(['Бот', 'Сайт']);
    const res = await sh('open', ...nodes.map((n) => n.id), '--yes');
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('несколько узлов — только с --bg или --pane');
    expect(launches()).toEqual([]);
  });

  it('--json prints one array of the started sessions and nothing else', async () => {
    const { nodes, sh, saved } = setup(['Бот', 'Сайт', 'Почта']);
    const res = await sh('open', ...nodes.map((n) => n.id), '--bg', '--json', '--yes');
    expect(res.code, res.stderr).toBe(0);
    const rows = JSON.parse(res.stdout) as Record<string, unknown>[];
    expect(rows).toHaveLength(3);
    rows.forEach((row, i) => {
      const node = nodes[i]!;
      expect(row).toEqual({
        node: node.id,
        brain: 'claude',
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        startedAt: expect.any(String),
        warnings: [],
      });
      expect(saved(node).sessions).toMatchObject([{ id: row.id, mode: 'background' }]);
    });
  }, 60_000);

  it('--json with one id is an object, as with --pane', async () => {
    const { nodes, sh } = setup(['Бот']);
    const res = await sh('open', nodes[0]!.id, '--bg', '--json', '--yes');
    expect(res.code, res.stderr).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({ node: nodes[0]!.id, brain: 'claude', warnings: [] });
  }, 60_000);

  it('--json keeps a session that did not start in the array, with error', async () => {
    const { nodes, sh, launches } = setup(['Бот', 'Сайт', 'Почта'], (made) => ({
      BACKGROUND_FAIL_NODE: made[1]!.id,
    }));
    const [a, b, c] = nodes as [TreeNode, TreeNode, TreeNode];
    const res = await sh('open', a.id, b.id, c.id, '--bg', '--json', '--yes');
    expect(res.code).toBe(1);
    const rows = JSON.parse(res.stdout) as Record<string, unknown>[];
    expect(rows.map((row) => row.node)).toEqual([a.id, b.id, c.id]);
    expect(rows[1]).toMatchObject({ id: null, startedAt: null, error: expect.stringContaining('not trusted') });
    expect(rows[0]!.error).toBeUndefined();
    expect(rows[2]!.id).toEqual(expect.any(String));
    expect(res.stderr).toContain(`✗ ${b.id}`);
    expect(launches().map((l) => l.node)).toEqual([a.id, b.id, c.id]);
  }, 60_000);

  it('reports a session that did not start and still starts the rest', async () => {
    // The stand-in fails the middle node's launch, as Claude Code does in an untrusted folder.
    const { nodes, sh, launches, saved } = setup(['Бот', 'Сайт', 'Почта'], (made) => ({
      BACKGROUND_FAIL_NODE: made[1]!.id,
    }));
    const [a, b, c] = nodes as [TreeNode, TreeNode, TreeNode];
    const res = await sh('open', a.id, b.id, c.id, '--bg', '--yes');
    expect(res.code).toBe(1);
    const lines = res.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(started(a));
    expect(lines[1]).toMatch(started(c));
    expect(res.stderr).toContain(`✗ ${b.id}  ${b.title} · this folder is not trusted`);
    expect(saved(b).sessions).toEqual([]);
    expect(saved(c).sessions).toHaveLength(1);
    expect(launches().map((l) => l.node)).toEqual([a.id, b.id, c.id]);
  }, 60_000);
});
