import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capturePane, closePane, listPanes, panesAvailable } from '@antondanv/brainyard';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { launchInPane, readPanes, settlePending, sleepPane, wakeInPane } from '../src/agents/panes.js';
import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { emptyTree } from './helpers.js';

const socket = `treeyard-test-${process.pid}-opencode`;
const fixture = fileURLToPath(new URL('./fixtures/opencode-cli.mjs', import.meta.url));
const tsx = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
const main = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const bin = JSON.stringify([process.execPath, fixture]);
// OpenCode's store for the whole file: the tmux server hands it to every pane it starts.
const data = mkdtempSync(join(tmpdir(), 'treeyard-opencode-'));

async function until(check: () => Promise<boolean>, what = '') {
  const end = Date.now() + 10_000;
  while (!(await check()) && Date.now() < end) await new Promise((done) => setTimeout(done, 60));
  expect(await check(), what).toBe(true);
}

const ready = async (pane: string) =>
  (await capturePane(pane))?.lines.join('\n').includes('opencode stand-in ready') ?? false;

/** What the stand-in was started with, by session id. */
const recorded = (dir: string, id: string) =>
  JSON.parse(readFileSync(join(dir, `opencode-${id}.json`), 'utf8')) as { args: string[]; config: string | null };

describe.skipIf(!panesAvailable())('OpenCode in a pane', () => {
  beforeAll(() => {
    vi.stubEnv('BRAINYARD_TMUX_SOCKET', socket);
    vi.stubEnv('BRAINYARD_OPENCODE_BIN', bin);
    vi.stubEnv('XDG_DATA_HOME', data);
  });
  afterAll(async () => {
    for (const pane of await listPanes({ socket })) await closePane(pane.pane, { socket });
    spawnSync('tmux', ['-L', socket, 'kill-server']);
    vi.unstubAllEnvs();
    rmSync(data, { recursive: true, force: true });
  });

  it('starts from a node with its context, finds its session, sleeps and wakes the same conversation', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Корзина', doneWhen: 'товар доходит до оплаты' });
    const launched = await launchInPane(
      tree,
      node.id,
      { brain: 'opencode', start: 'plan', pane: true },
      { width: 70, height: 12 },
    );
    expect(launched.pane).toMatch(/^opencode-/);
    // OpenCode names its session once it has started: until then the node holds the pane.
    expect(launched.ref).toMatchObject({ brain: 'opencode', id: `pane:${launched.pane}`, mode: 'pane' });
    try {
      await until(() => ready(launched.pane), 'the pane shows OpenCode');
      const saved = loadTree(tree.project.dir);
      expect(await settlePending(saved, await readPanes())).toBe(true);
      const ref = loadTree(tree.project.dir).nodes.get(node.id)!.sessions[0]!;
      expect(ref).toMatchObject({ brain: 'opencode', mode: 'pane', pane: launched.pane });
      expect(ref.id).toMatch(/^ses_/);
      // A plan starts in OpenCode's plan agent; the context is the agent's system prompt,
      // the first message is only the task.
      const { args: first, config } = recorded(tree.project.dir, ref.id);
      expect(first).toContain('--agent');
      expect(first[first.indexOf('--agent') + 1]).toBe('plan');
      const prompt = first.find((arg) => arg.startsWith('--prompt='))!;
      expect(prompt).toContain(`Работаем над узлом «Корзина» (${node.id})`);
      expect(prompt).not.toContain('# Ты работаешь над узлом дерева проекта');
      const system = (JSON.parse(config!) as { agent: { plan: { prompt: string } } }).agent.plan.prompt;
      expect(system).toContain('# Ты работаешь над узлом дерева проекта');
      expect(system).toContain('Готово, когда: товар доходит до оплаты');

      const pane = (await readPanes()).find((p) => p.pane === launched.pane)!;
      expect(pane.sessionId).toBe(ref.id);
      expect(await sleepPane(loadTree(tree.project.dir), pane)).toBe('slept');
      expect((await listPanes()).some((p) => p.pane === launched.pane)).toBe(false);

      const woken = await wakeInPane(loadTree(tree.project.dir), node.id, ref, { width: 70, height: 12 });
      try {
        await until(() => ready(woken), 'the woken pane shows OpenCode');
        expect(recorded(tree.project.dir, ref.id).args).toEqual(['--session', ref.id]);
        const sessions = loadTree(tree.project.dir).nodes.get(node.id)!.sessions;
        expect(sessions).toHaveLength(1);
        expect(sessions[0]).toMatchObject({ brain: 'opencode', id: ref.id, pane: woken });
      } finally {
        await closePane(woken);
      }
    } finally {
      await closePane(launched.pane);
    }
  });

  it('treeyard open --brain opencode --pane starts it from the shell and the node keeps it', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Оплата' });
    const got = spawnSync(tsx, [main, 'open', node.id, '--brain', 'opencode', '--start', 'do', '--pane', '--yes'], {
      cwd: tree.project.dir,
      env: {
        ...process.env,
        BRAINYARD_TMUX_SOCKET: socket,
        BRAINYARD_OPENCODE_BIN: bin,
        XDG_DATA_HOME: data,
        TREEYARD_LANG: 'ru',
        NO_COLOR: '1',
      },
      encoding: 'utf8',
    });
    expect(got.status, got.stderr).toBe(0);
    const pane = /панели (opencode-[0-9a-f]+)/.exec(got.stdout)?.[1];
    expect(pane, got.stdout).toBeDefined();
    try {
      await until(() => ready(pane!), 'the pane shows OpenCode');
      const pending = loadTree(tree.project.dir).nodes.get(node.id)!;
      expect(pending.status).toBe('active');
      expect(pending.sessions).toMatchObject([{ brain: 'opencode', id: `pane:${pane}`, mode: 'pane', pane }]);
      // The tree learns the session id the next time it looks, as with Codex and Antigravity.
      const saved = loadTree(tree.project.dir);
      expect(await settlePending(saved, await readPanes())).toBe(true);
      const ref = loadTree(tree.project.dir).nodes.get(node.id)!.sessions[0]!;
      expect(ref.id).toMatch(/^ses_/);
      // `do` is not a plan: OpenCode keeps its own agent and its own permissions.
      const args = recorded(tree.project.dir, ref.id).args;
      expect(args).not.toContain('--agent');
      expect(args).not.toContain('--auto');
      expect(args.find((arg) => arg.startsWith('--prompt='))).toContain(`Сделай узел «Оплата» (${node.id})`);
      expect(existsSync(join(tree.project.dir, '.tree', 'nodes', `${node.id}.md`))).toBe(true);
    } finally {
      await closePane(pane!);
    }
  }, 30_000);
});
