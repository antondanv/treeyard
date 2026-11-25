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
import { type Pane, sleepingRef, sleepNodePane, sleepNodePanes } from '../src/agents/panes.js';
import { sleepCommand } from '../src/cli/commands.js';
import { addNode, attachSession } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
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

describe('sleepNodePane and sleepNodePanes', () => {
  it('puts an idle pane to sleep and keeps the session on the node for waking', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Idle work' });
    attachSession(tree, node.id, {
      brain: 'claude',
      id: 'conv-123',
      pane: 'claude-1',
      mode: 'pane',
      started: ago(10),
    });

    const livePane = pane('claude-1', { sessionId: 'conv-123' });
    backend.listPanes.mockResolvedValue([livePane]);
    backend.liveSessions.mockResolvedValue([live('conv-123', 'idle')]);

    const result = await sleepNodePane(tree, node.id);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('slept');
    expect(result.pane).toBe('claude-1');
    expect(result.session).toBe('conv-123');
    expect(backend.closePane).toHaveBeenCalledWith('claude-1');

    // The session reference remains in the tree node for resuming/waking
    const saved = loadTree(tree.project.dir).nodes.get(node.id)!;
    expect(saved.sessions).toHaveLength(1);
    expect(saved.sessions[0]).toMatchObject({ id: 'conv-123', mode: 'pane' });

    // sleepingRef recognises the sleeping session
    expect(sleepingRef(saved, [])).toMatchObject({ id: 'conv-123' });
  });

  it('settles pending session id before closing the pane so conversation is not lost', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Pending session' });
    attachSession(tree, node.id, {
      brain: 'claude',
      id: 'pane:claude-1',
      pane: 'claude-1',
      mode: 'pane',
      started: ago(2),
    });

    const livePane = pane('claude-1', { sessionId: undefined });
    backend.listPanes.mockResolvedValue([livePane]);
    backend.findPaneSession.mockResolvedValue({ id: 'discovered-session-456' });
    backend.liveSessions.mockResolvedValue([live('discovered-session-456', 'idle')]);

    const result = await sleepNodePane(tree, node.id);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('slept');
    expect(result.session).toBe('discovered-session-456');
    expect(backend.setPaneSession).toHaveBeenCalledWith('claude-1', 'discovered-session-456');
    expect(backend.closePane).toHaveBeenCalledWith('claude-1');

    // Node is updated with settled session ID
    const saved = loadTree(tree.project.dir).nodes.get(node.id)!;
    expect(saved.sessions[0]!.id).toBe('discovered-session-456');
  });

  it('refuses to sleep an unsettled pending session without --force, but sleeps with --force', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Unsettled session' });
    attachSession(tree, node.id, {
      brain: 'claude',
      id: 'pane:claude-1',
      pane: 'claude-1',
      mode: 'pane',
      started: ago(1),
    });

    const livePane = pane('claude-1', { sessionId: undefined });
    backend.listPanes.mockResolvedValue([livePane]);
    backend.findPaneSession.mockResolvedValue(undefined);

    // Refusal without force
    const refused = await sleepNodePane(tree, node.id);
    expect(refused.ok).toBe(false);
    expect(refused.status).toBe('pending');
    expect(refused.error).toContain('у сессии ещё нет id');
    expect(backend.closePane).not.toHaveBeenCalled();

    // Closing with force
    const forced = await sleepNodePane(tree, node.id, { force: true });
    expect(forced.ok).toBe(true);
    expect(forced.status).toBe('slept');
    expect(backend.closePane).toHaveBeenCalledWith('claude-1');
  });

  it('refuses on busy, waiting, or attached pane without --force, and sleeps with --force', async () => {
    const tree = emptyTree();
    const busyNode = addNode(tree, { title: 'Busy' });
    attachSession(tree, busyNode.id, {
      brain: 'claude',
      id: 'conv-busy',
      pane: 'claude-busy',
      mode: 'pane',
    });

    const waitingNode = addNode(tree, { title: 'Waiting' });
    attachSession(tree, waitingNode.id, {
      brain: 'claude',
      id: 'conv-waiting',
      pane: 'claude-waiting',
      mode: 'pane',
    });

    const attachedNode = addNode(tree, { title: 'Attached' });
    attachSession(tree, attachedNode.id, {
      brain: 'claude',
      id: 'conv-attached',
      pane: 'claude-attached',
      mode: 'pane',
    });

    backend.listPanes.mockResolvedValue([
      pane('claude-busy', { sessionId: 'conv-busy' }),
      pane('claude-waiting', { sessionId: 'conv-waiting' }),
      pane('claude-attached', { sessionId: 'conv-attached', attached: true }),
    ]);

    backend.liveSessions.mockResolvedValue([
      live('conv-busy', 'busy'),
      live('conv-waiting', 'waiting'),
      live('conv-attached', 'idle'),
    ]);

    // 1. Busy refusal & force
    const busyRefused = await sleepNodePane(tree, busyNode.id);
    expect(busyRefused.ok).toBe(false);
    expect(busyRefused.status).toBe('busy');
    expect(busyRefused.error).toContain('панель сейчас работает');

    const busyForced = await sleepNodePane(tree, busyNode.id, { force: true });
    expect(busyForced.ok).toBe(true);
    expect(busyForced.status).toBe('slept');

    // 2. Waiting refusal & force
    const waitRefused = await sleepNodePane(tree, waitingNode.id);
    expect(waitRefused.ok).toBe(false);
    expect(waitRefused.status).toBe('waiting');
    expect(waitRefused.error).toContain('панель ждёт человека');

    const waitForced = await sleepNodePane(tree, waitingNode.id, { force: true });
    expect(waitForced.ok).toBe(true);
    expect(waitForced.status).toBe('slept');

    // 3. Attached refusal & force
    const attRefused = await sleepNodePane(tree, attachedNode.id);
    expect(attRefused.ok).toBe(false);
    expect(attRefused.status).toBe('attached');
    expect(attRefused.error).toContain('к панели подключён терминал');

    const attForced = await sleepNodePane(tree, attachedNode.id, { force: true });
    expect(attForced.ok).toBe(true);
    expect(attForced.status).toBe('slept');
  });

  it('handles nodes without live pane cleanly without failing', async () => {
    const tree = emptyTree();
    const sleepingNode = addNode(tree, { title: 'Sleeping node' });
    attachSession(tree, sleepingNode.id, {
      brain: 'claude',
      id: 'old-session',
      pane: 'old-pane',
      mode: 'pane',
    });

    const noPaneNode = addNode(tree, { title: 'Fresh node' });

    backend.listPanes.mockResolvedValue([]);

    // Sleeping session
    const resSleeping = await sleepNodePane(tree, sleepingNode.id);
    expect(resSleeping.ok).toBe(true);
    expect(resSleeping.status).toBe('already_sleeping');
    expect(resSleeping.message).toContain('панель уже спит');
    expect(resSleeping.session).toBe('old-session');

    // No sessions at all
    const resNoPane = await sleepNodePane(tree, noPaneNode.id);
    expect(resNoPane.ok).toBe(true);
    expect(resNoPane.status).toBe('no_pane');
    expect(resNoPane.message).toContain('нет живой панели');

    // Non-existent node
    const resNotFound = await sleepNodePane(tree, 'missing-id');
    expect(resNotFound.ok).toBe(false);
    expect(resNotFound.status).toBe('failed');
    expect(resNotFound.error).toContain('нет узла missing-id');
  });

  it('sleeps multiple nodes in a single call', async () => {
    const tree = emptyTree();
    const first = addNode(tree, { title: 'First' });
    attachSession(tree, first.id, { brain: 'claude', id: 's-1', pane: 'p-1', mode: 'pane' });

    const second = addNode(tree, { title: 'Second' });
    attachSession(tree, second.id, { brain: 'claude', id: 's-2', pane: 'p-2', mode: 'pane' });

    backend.listPanes.mockResolvedValue([pane('p-1', { sessionId: 's-1' }), pane('p-2', { sessionId: 's-2' })]);
    backend.liveSessions.mockResolvedValue([live('s-1', 'idle'), live('s-2', 'idle')]);

    const results = await sleepNodePanes(tree, [first.id, second.id]);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ node: first.id, ok: true, status: 'slept', pane: 'p-1' });
    expect(results[1]).toMatchObject({ node: second.id, ok: true, status: 'slept', pane: 'p-2' });
    expect(backend.closePane).toHaveBeenCalledWith('p-1');
    expect(backend.closePane).toHaveBeenCalledWith('p-2');
  });
});

describe('sleepCommand CLI unit tests', () => {
  it('formats text output on success and refusal, returning correct exit codes', async () => {
    const tree = emptyTree();
    const goodNode = addNode(tree, { title: 'Good work' });
    attachSession(tree, goodNode.id, { brain: 'claude', id: 's-good', pane: 'p-good', mode: 'pane' });

    const busyNode = addNode(tree, { title: 'Busy work' });
    attachSession(tree, busyNode.id, { brain: 'claude', id: 's-busy', pane: 'p-busy', mode: 'pane' });

    backend.listPanes.mockResolvedValue([
      pane('p-good', { sessionId: 's-good' }),
      pane('p-busy', { sessionId: 's-busy' }),
    ]);
    backend.liveSessions.mockResolvedValue([live('s-good', 'idle'), live('s-busy', 'busy')]);

    const stdout: string[] = [];
    const stderr: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);

    process.stdout.write = (chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    };
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    };

    try {
      // 1. Success on good node
      const code0 = await sleepCommand([goodNode.id, '--project', tree.project.dir]);
      expect(code0).toBe(0);
      expect(stdout.join('')).toContain(`✓ ${goodNode.id}  Good work · панель p-good уснула`);

      // 2. Refusal on busy node
      const code1 = await sleepCommand([busyNode.id, '--project', tree.project.dir]);
      expect(code1).toBe(1);
      expect(stderr.join('')).toContain(`✗ ${busyNode.id}  Busy work · панель сейчас работает`);

      // 3. Force on busy node
      stdout.length = 0;
      const codeForce = await sleepCommand([busyNode.id, '--force', '--project', tree.project.dir]);
      expect(codeForce).toBe(0);
      expect(stdout.join('')).toContain(`✓ ${busyNode.id}  Busy work · панель p-busy уснула`);
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
  });

  it('supports --json with single and multiple nodes', async () => {
    const tree = emptyTree();
    const n1 = addNode(tree, { title: 'Node 1' });
    attachSession(tree, n1.id, { brain: 'claude', id: 's-1', pane: 'p-1', mode: 'pane' });
    const n2 = addNode(tree, { title: 'Node 2' });
    attachSession(tree, n2.id, { brain: 'claude', id: 's-2', pane: 'p-2', mode: 'pane' });

    backend.listPanes.mockResolvedValue([pane('p-1', { sessionId: 's-1' }), pane('p-2', { sessionId: 's-2' })]);
    backend.liveSessions.mockResolvedValue([live('s-1', 'idle'), live('s-2', 'idle')]);

    const stdout: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    };

    try {
      // Single node JSON -> object
      const codeSingle = await sleepCommand([n1.id, '--json', '--project', tree.project.dir]);
      expect(codeSingle).toBe(0);
      const jsonSingle = JSON.parse(stdout.join(''));
      expect(jsonSingle).toMatchObject({ node: n1.id, ok: true, status: 'slept', pane: 'p-1' });

      // Multiple nodes JSON -> array
      stdout.length = 0;
      const codeMulti = await sleepCommand([n1.id, n2.id, '--json', '--project', tree.project.dir]);
      expect(codeMulti).toBe(0);
      const jsonMulti = JSON.parse(stdout.join(''));
      expect(Array.isArray(jsonMulti)).toBe(true);
      expect(jsonMulti).toHaveLength(2);
      expect(jsonMulti[0].node).toBe(n1.id);
      expect(jsonMulti[1].node).toBe(n2.id);
    } finally {
      process.stdout.write = origOut;
    }
  });
});

describe('treeyard sleep from the shell', () => {
  it('reports cleanly when a node has no live pane and outputs json', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Test CLI' });
    const sh = treeyardIn(tree.project.dir);

    // Text output
    const textRes = await sh('sleep', node.id);
    expect(textRes.code).toBe(0);
    expect(textRes.stdout).toContain(`· ${node.id}  Test CLI · нет живой панели`);

    // JSON output
    const jsonRes = await sh('sleep', node.id, '--json');
    expect(jsonRes.code).toBe(0);
    const parsed = JSON.parse(jsonRes.stdout);
    expect(parsed).toMatchObject({ node: node.id, ok: true, status: 'no_pane' });

    // Missing positional id
    const missingRes = await sh('sleep');
    expect(missingRes.code).toBe(2);
    expect(missingRes.stderr).toContain('укажи узел: treeyard sleep <id> [<id>…]');
  });
});
