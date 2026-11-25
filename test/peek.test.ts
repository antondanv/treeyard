import { beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  startPane: vi.fn(),
  listPanes: vi.fn(),
  sessions: vi.fn(),
  setPaneSession: vi.fn(),
  closePane: vi.fn(),
  findPaneSession: vi.fn(),
  liveSessions: vi.fn(),
  capturePane: vi.fn(),
}));

vi.mock('@antondanv/brainyard', async (original) => ({
  ...(await original<typeof import('@antondanv/brainyard')>()),
  ...backend,
}));

import type { SessionInfo } from '@antondanv/brainyard';
import { type Pane, peekJson, peekNodePane, peekText } from '../src/agents/panes.js';
import { peekCommand } from '../src/cli/commands.js';
import { addNode, attachSession } from '../src/model/ops.js';
import { emptyTree, treeyardIn } from './helpers.js';

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const pane = (name: string, patch: Partial<Pane> = {}): Pane => ({
  pane: name,
  brain: 'claude',
  sessionId: name,
  cwd: '/project',
  startedAt: ago(30),
  activityAt: ago(5),
  attached: false,
  width: 80,
  height: 20,
  ...patch,
});

const live = (id: string, status = 'idle', extra: Record<string, unknown> = {}): SessionInfo =>
  ({
    brain: 'claude',
    id,
    interactive: true,
    live: { status, kind: 'interactive', ...extra },
  }) as SessionInfo;

beforeEach(() => {
  vi.clearAllMocks();
  backend.listPanes.mockResolvedValue([]);
  backend.sessions.mockResolvedValue([]);
  backend.setPaneSession.mockResolvedValue(true);
  backend.closePane.mockResolvedValue(true);
  backend.findPaneSession.mockResolvedValue(undefined);
  backend.liveSessions.mockResolvedValue([]);
  backend.capturePane.mockResolvedValue(undefined);
});

describe('peekNodePane unit tests', () => {
  it('peeks at a live busy pane with default 25 lines stripped of ANSI codes', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Busy worker' });
    attachSession(tree, node.id, {
      brain: 'claude',
      id: 'conv-101',
      pane: 'claude-1',
      mode: 'pane',
      started: ago(10),
    });

    backend.listPanes.mockResolvedValue([pane('claude-1', { sessionId: 'conv-101' })]);
    backend.liveSessions.mockResolvedValue([live('conv-101', 'busy')]);

    // Screen with 30 lines and ANSI color escape sequences
    const rawLines = Array.from({ length: 30 }, (_, i) => `\u001b[32mLine ${i + 1}\u001b[0m \u001b[1m(info)\u001b[0m`);
    backend.capturePane.mockResolvedValue({ lines: rawLines });

    const result = await peekNodePane(tree, node.id);

    expect(result.ok).toBe(true);
    expect(result.live).toBe(true);
    expect(result.node).toBe(node.id);
    expect(result.title).toBe('Busy worker');
    expect(result.status).toBe('todo');
    expect(result.pane).toBe('claude-1');
    expect(result.brain).toBe('claude');
    expect(result.session).toBe('conv-101');
    expect(result.state).toBe('busy');
    expect(result.waitingFor).toBeNull();
    // Default is 25 lines
    expect(result.lines).toHaveLength(25);
    expect(result.screen).toHaveLength(25);
    // ANSI codes stripped
    expect(result.lines[0]).toBe('Line 6 (info)');
    expect(result.lines[24]).toBe('Line 30 (info)');
  });

  it('respects options.lines count parameter', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Few lines' });
    attachSession(tree, node.id, {
      brain: 'claude',
      id: 'conv-102',
      pane: 'claude-2',
      mode: 'pane',
      started: ago(5),
    });

    backend.listPanes.mockResolvedValue([pane('claude-2', { sessionId: 'conv-102' })]);
    backend.liveSessions.mockResolvedValue([live('conv-102', 'busy')]);

    const rawLines = ['row 1', 'row 2', 'row 3', 'row 4', 'row 5', 'row 6', 'row 7'];
    backend.capturePane.mockResolvedValue({ lines: rawLines });

    const result = await peekNodePane(tree, node.id, { lines: 3 });

    expect(result.ok).toBe(true);
    expect(result.lines).toHaveLength(3);
    expect(result.lines).toEqual(['row 5', 'row 6', 'row 7']);
  });

  it('peeks at a waiting pane and captures waitingFor reason', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Waiting for person' });
    attachSession(tree, node.id, {
      brain: 'claude',
      id: 'conv-103',
      pane: 'claude-3',
      mode: 'pane',
      started: ago(5),
    });

    backend.listPanes.mockResolvedValue([pane('claude-3', { sessionId: 'conv-103' })]);
    backend.liveSessions.mockResolvedValue([live('conv-103', 'waiting', { waitingFor: 'human approval required' })]);
    backend.capturePane.mockResolvedValue({ lines: ['Please confirm action [y/n]'] });

    const result = await peekNodePane(tree, node.id);

    expect(result.ok).toBe(true);
    expect(result.live).toBe(true);
    expect(result.state).toBe('waiting');
    expect(result.waitingFor).toBe('human approval required');
    expect(result.lines).toEqual(['Please confirm action [y/n]']);
  });

  it('peeks at an idle pane', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Idle turn' });
    attachSession(tree, node.id, {
      brain: 'claude',
      id: 'conv-104',
      pane: 'claude-4',
      mode: 'pane',
      started: ago(15),
    });

    backend.listPanes.mockResolvedValue([pane('claude-4', { sessionId: 'conv-104' })]);
    backend.liveSessions.mockResolvedValue([live('conv-104', 'idle')]);
    backend.capturePane.mockResolvedValue({ lines: ['Turn completed. Awaiting commands.'] });

    const result = await peekNodePane(tree, node.id);

    expect(result.ok).toBe(true);
    expect(result.live).toBe(true);
    expect(result.state).toBe('idle');
    expect(result.lines).toEqual(['Turn completed. Awaiting commands.']);
  });

  it('reports politely when pane is sleeping', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Sleeping node' });
    attachSession(tree, node.id, {
      brain: 'claude',
      id: 'conv-105',
      pane: 'claude-5',
      mode: 'pane',
      started: ago(20),
    });

    // No live panes in backend: pane is closed, session is sleeping
    backend.listPanes.mockResolvedValue([]);

    const result = await peekNodePane(tree, node.id);

    expect(result.ok).toBe(true);
    expect(result.live).toBe(false);
    expect(result.pane).toBeNull();
    expect(result.brain).toBe('claude');
    expect(result.session).toBe('conv-105');
    expect(result.state).toBeNull();
    expect(result.waitingFor).toBeNull();
    expect(result.lines).toEqual([]);
    expect(result.screen).toEqual([]);
    expect(result.message).toContain('панель спит');
    expect(result.message).toContain(`treeyard send ${node.id}`);
  });

  it('reports politely when node has a background session instead of a pane', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Background node' });
    attachSession(tree, node.id, {
      brain: 'claude',
      id: 'bg-106',
      mode: 'background',
      started: ago(10),
    });

    const result = await peekNodePane(tree, node.id);

    expect(result.ok).toBe(true);
    expect(result.live).toBe(false);
    expect(result.pane).toBeNull();
    expect(result.lines).toEqual([]);
    expect(result.message).toContain('нет живой панели (сессия в фоне)');
  });

  it('reports politely when node has no sessions at all', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Fresh node' });

    const result = await peekNodePane(tree, node.id);

    expect(result.ok).toBe(true);
    expect(result.live).toBe(false);
    expect(result.pane).toBeNull();
    expect(result.brain).toBeNull();
    expect(result.session).toBeNull();
    expect(result.lines).toEqual([]);
    expect(result.message).toContain('нет живой панели');
  });

  it('returns error when node is not found', async () => {
    const tree = emptyTree();

    const result = await peekNodePane(tree, 'missing-99');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('нет узла missing-99');
    expect(result.node).toBe('missing-99');
    expect(result.live).toBe(false);
    expect(result.lines).toEqual([]);
  });
});

describe('peekText and peekJson formatting', () => {
  it('formats text for a live busy pane with │ prefix on screen lines', () => {
    const text = peekText({
      node: 'ab12',
      title: 'Implement feature',
      status: 'active',
      live: true,
      pane: 'claude-1',
      brain: 'claude',
      session: 'conv-12345678',
      state: 'busy',
      waitingFor: null,
      lines: ['running tests...', 'all passed!'],
      screen: ['running tests...', 'all passed!'],
      ok: true,
    });

    expect(text).toContain('◐ Implement feature  ab12  в работе');
    expect(text).toContain('сессия claude conv-123 · панель claude-1 · работает');
    expect(text).toContain('│ running tests...');
    expect(text).toContain('│ all passed!');
  });

  it('formats text for a waiting pane with attach hint', () => {
    const text = peekText({
      node: 'ab12',
      title: 'Need review',
      status: 'active',
      live: true,
      pane: 'claude-1',
      brain: 'claude',
      session: 'conv-12345678',
      state: 'waiting',
      waitingFor: 'permission',
      lines: ['Grant write access?'],
      screen: ['Grant write access?'],
      ok: true,
    });

    expect(text).toContain('сессия claude conv-123 · панель claude-1 · ждёт человека: permission');
    expect(text).toContain('ответить в панели: tmux -L brainyard attach -t claude-1');
    expect(text).toContain('│ Grant write access?');
  });

  it('formats text for sleeping pane cleanly', () => {
    const text = peekText({
      node: 'ab12',
      title: 'Slept node',
      status: 'active',
      live: false,
      pane: null,
      brain: 'claude',
      session: 'conv-12345678',
      state: null,
      waitingFor: null,
      lines: [],
      screen: [],
      message: 'панель спит · продолжить: treeyard send ab12 "…", журнал: treeyard show ab12',
      ok: true,
    });

    expect(text).toContain('◐ Slept node  ab12  в работе');
    expect(text).toContain('панель спит · продолжить: treeyard send ab12 "…", журнал: treeyard show ab12');
  });

  it('formats JSON correctly with all required fields', () => {
    const json = peekJson({
      node: 'ab12',
      title: 'Feature',
      status: 'active',
      live: true,
      pane: 'claude-1',
      brain: 'claude',
      session: 'conv-12345678',
      state: 'busy',
      waitingFor: null,
      lines: ['line 1', 'line 2'],
      screen: ['line 1', 'line 2'],
      ok: true,
    });

    expect(json).toEqual({
      node: 'ab12',
      title: 'Feature',
      status: 'active',
      live: true,
      pane: 'claude-1',
      brain: 'claude',
      session: 'conv-12345678',
      state: 'busy',
      waitingFor: null,
      lines: ['line 1', 'line 2'],
      screen: ['line 1', 'line 2'],
    });
  });
});

describe('peekCommand CLI tests', () => {
  it('executes peekCommand and prints formatted text', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'CLI Node' });
    attachSession(tree, node.id, {
      brain: 'claude',
      id: 'conv-201',
      pane: 'p-201',
      mode: 'pane',
    });

    backend.listPanes.mockResolvedValue([pane('p-201', { sessionId: 'conv-201' })]);
    backend.liveSessions.mockResolvedValue([live('conv-201', 'busy')]);
    backend.capturePane.mockResolvedValue({ lines: ['hello from terminal'] });

    const stdout: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    };

    try {
      const code = await peekCommand([node.id, '--project', tree.project.dir]);
      expect(code).toBe(0);
      const output = stdout.join('');
      expect(output).toContain(node.id);
      expect(output).toContain('CLI Node');
      expect(output).toContain('панель p-201');
      expect(output).toContain('│ hello from terminal');
    } finally {
      process.stdout.write = origOut;
    }
  });

  it('supports --json flag', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'JSON Node' });
    attachSession(tree, node.id, {
      brain: 'claude',
      id: 'conv-202',
      pane: 'p-202',
      mode: 'pane',
    });

    backend.listPanes.mockResolvedValue([pane('p-202', { sessionId: 'conv-202' })]);
    backend.liveSessions.mockResolvedValue([live('conv-202', 'busy')]);
    backend.capturePane.mockResolvedValue({ lines: ['first', 'second'] });

    const stdout: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    };

    try {
      const code = await peekCommand([node.id, '--json', '--project', tree.project.dir]);
      expect(code).toBe(0);
      const parsed = JSON.parse(stdout.join(''));
      expect(parsed).toMatchObject({
        node: node.id,
        title: 'JSON Node',
        live: true,
        pane: 'p-202',
        brain: 'claude',
        session: 'conv-202',
        state: 'busy',
        lines: ['first', 'second'],
        screen: ['first', 'second'],
      });
    } finally {
      process.stdout.write = origOut;
    }
  });

  it('fails with code 1 and writes to stderr on unknown node', async () => {
    const tree = emptyTree();

    const stderr: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    };

    try {
      const code = await peekCommand(['unknown-node', '--project', tree.project.dir]);
      expect(code).toBe(1);
      expect(stderr.join('')).toContain('нет узла unknown-node');
    } finally {
      process.stderr.write = origErr;
    }
  });

  it('outputs error in JSON when unknown node with --json', async () => {
    const tree = emptyTree();

    const stdout: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    };

    try {
      const code = await peekCommand(['unknown-node', '--json', '--project', tree.project.dir]);
      expect(code).toBe(1);
      const parsed = JSON.parse(stdout.join(''));
      expect(parsed).toMatchObject({
        node: 'unknown-node',
        live: false,
        ok: false,
        error: 'нет узла unknown-node',
      });
    } finally {
      process.stdout.write = origOut;
    }
  });

  it('validates --lines parameter', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Test' });

    await expect(peekCommand([node.id, '--lines', 'invalid', '--project', tree.project.dir])).rejects.toThrow(
      '--lines — положительное целое число',
    );
    await expect(peekCommand([node.id, '--lines', '0', '--project', tree.project.dir])).rejects.toThrow(
      '--lines — положительное целое число',
    );
    await expect(peekCommand([node.id, '--lines=-5', '--project', tree.project.dir])).rejects.toThrow(
      '--lines — положительное целое число',
    );
  });

  it('validates missing or multiple positional arguments', async () => {
    await expect(peekCommand([])).rejects.toThrow('укажи узел: treeyard peek <id>');
    await expect(peekCommand(['a', 'b'])).rejects.toThrow('укажи один узел: treeyard peek <id>');
  });
});

describe('treeyard peek from the shell', () => {
  it('reports cleanly when a node has no live pane and outputs json', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Shell Test' });
    const sh = treeyardIn(tree.project.dir);

    // Text output
    const textRes = await sh('peek', node.id);
    expect(textRes.code).toBe(0);
    expect(textRes.stdout).toContain(node.id);
    expect(textRes.stdout).toContain('Shell Test');
    expect(textRes.stdout).toContain('нет живой панели');

    // JSON output
    const jsonRes = await sh('peek', node.id, '--json');
    expect(jsonRes.code).toBe(0);
    const parsed = JSON.parse(jsonRes.stdout);
    expect(parsed).toMatchObject({
      node: node.id,
      title: 'Shell Test',
      live: false,
      pane: null,
      screen: [],
      lines: [],
    });

    // Unknown node
    const missingNodeRes = await sh('peek', 'non-existent');
    expect(missingNodeRes.code).toBe(1);
    expect(missingNodeRes.stderr).toContain('нет узла non-existent');

    // Missing positional argument
    const missingArgRes = await sh('peek');
    expect(missingArgRes.code).toBe(2);
    expect(missingArgRes.stderr).toContain('укажи узел: treeyard peek <id>');
  });
});
