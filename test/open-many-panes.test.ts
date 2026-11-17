import { afterEach, describe, expect, it, vi } from 'vitest';

import type { launchInPane } from '../src/agents/panes.js';
import { openInPanes } from '../src/cli/commands.js';
import { addNode } from '../src/model/ops.js';
import type { SessionRef } from '../src/model/types.js';
import { emptyTree } from './helpers.js';

// `open a b c --pane` without tmux: the launcher is a stand-in that fails for chosen nodes.
afterEach(() => vi.restoreAllMocks());

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  return { stdout: () => stdout.join(''), stderr: () => stderr.join('') };
}

/** A launcher that starts pane `p-<id>` for every node but those in `broken`; `pending` — a Codex-style ref. */
function launcher(broken: string[] = [], pending = false) {
  const asked: string[] = [];
  const launch: typeof launchInPane = async (_tree, id) => {
    asked.push(id);
    if (broken.includes(id)) throw new Error('tmux did not start the pane: no space for a new pane');
    const pane = `p-${id}`;
    const ref: SessionRef = {
      brain: 'claude',
      id: pending ? `pane:${pane}` : `session-${id}`,
      mode: 'pane',
      pane,
      started: '2026-11-17T12:00:00+03:00',
    };
    return { pane, ref, warnings: ['--worktree: only Claude Code'] };
  };
  return { launch, asked };
}

const OPTIONS = { brain: 'claude', start: 'do', pane: true } as const;

function threeNodes() {
  const tree = emptyTree();
  const nodes = ['Бот', 'Сайт', 'Почта'].map((title) => addNode(tree, { title }));
  return { tree, ids: nodes.map((n) => n.id), nodes };
}

describe('openInPanes', () => {
  it('prints a line per node, in order', async () => {
    const { tree, ids, nodes } = threeNodes();
    const said = capture();
    const { launch, asked } = launcher();
    expect(await openInPanes(tree, ids, OPTIONS, false, launch)).toBe(0);
    expect(asked).toEqual(ids);
    expect(said.stdout().trimEnd().split('\n')).toEqual(nodes.map((n) => `✓ ${n.id}  ${n.title} · панель p-${n.id}`));
    // A warning is the person's to read, not the program's to parse.
    expect(said.stderr().trimEnd().split('\n')).toEqual(ids.map(() => '! --worktree: only Claude Code'));
  });

  it('reports a pane that did not start and still starts the rest', async () => {
    const { tree, ids, nodes } = threeNodes();
    const said = capture();
    const { launch, asked } = launcher([ids[1]!]);
    expect(await openInPanes(tree, ids, OPTIONS, false, launch)).toBe(1);
    expect(asked).toEqual(ids);
    expect(said.stdout().trimEnd().split('\n')).toEqual([
      `✓ ${ids[0]}  ${nodes[0]!.title} · панель p-${ids[0]}`,
      `✓ ${ids[2]}  ${nodes[2]!.title} · панель p-${ids[2]}`,
    ]);
    expect(said.stderr()).toContain(
      `✗ ${ids[1]}  ${nodes[1]!.title} · tmux did not start the pane: no space for a new pane\n`,
    );
  });

  it('with --json prints one array on stdout, the failed node in it too', async () => {
    const { tree, ids } = threeNodes();
    const said = capture();
    const { launch } = launcher([ids[1]!], true);
    expect(await openInPanes(tree, ids, OPTIONS, true, launch)).toBe(1);
    const rows = JSON.parse(said.stdout()) as Record<string, unknown>[];
    // A pane of Codex, Antigravity or OpenCode has no session id until the CLI names it.
    expect(rows).toEqual([
      {
        node: ids[0],
        brain: 'claude',
        id: null,
        pane: `p-${ids[0]}`,
        startedAt: '2026-11-17T12:00:00+03:00',
        warnings: ['--worktree: only Claude Code'],
      },
      {
        node: ids[1],
        brain: 'claude',
        id: null,
        pane: null,
        startedAt: null,
        warnings: [],
        error: 'tmux did not start the pane: no space for a new pane',
      },
      expect.objectContaining({ node: ids[2], pane: `p-${ids[2]}` }),
    ]);
    // The diagnostics stay on stderr for a person; stdout is the JSON alone.
    expect(said.stderr()).toContain(`✗ ${ids[1]}`);
  });

  it('gives the session id when the CLI named it at once', async () => {
    const { tree, ids } = threeNodes();
    const said = capture();
    expect(await openInPanes(tree, ids.slice(0, 1), OPTIONS, true, launcher().launch)).toBe(0);
    expect(JSON.parse(said.stdout())).toEqual([expect.objectContaining({ id: `session-${ids[0]}` })]);
  });
});
