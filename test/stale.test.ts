import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { projectContext } from '../src/agents/context.js';
import { nodeText, paint, treeJson, treeText } from '../src/cli/print.js';
import { addNode } from '../src/model/ops.js';
import { staleLabel, staleNodes, staleNote, staleOf } from '../src/model/stale.js';
import type { TreeNode } from '../src/model/types.js';
import { DEFAULTS, loadSettings, saveSettings } from '../src/settings.js';
import { emptyTree, tempDir, treeyardIn } from './helpers.js';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-11-06T18:00:00+03:00');
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString();

function node(patch: Partial<TreeNode> = {}): TreeNode {
  return {
    id: 'aaaa',
    title: 'Узел',
    parent: 'root',
    order: 10,
    status: 'active',
    sessions: [],
    body: '',
    extra: {},
    updated: ago(14),
    ...patch,
  };
}

describe('abandoned «in progress»', () => {
  it('an old active node with no live session is marked', () => {
    expect(staleOf(node(), { afterHours: 2, now: NOW })?.hours).toBe(14);
  });

  it('a fresh node is not marked: a subagent may be at work without a session', () => {
    expect(staleOf(node({ updated: ago(1) }), { afterHours: 2, now: NOW })).toBeUndefined();
  });

  it('a live session, another status or a zero threshold clear it', () => {
    expect(staleOf(node(), { afterHours: 2, live: true, now: NOW })).toBeUndefined();
    expect(staleOf(node({ status: 'review' }), { afterHours: 2, now: NOW })).toBeUndefined();
    expect(staleOf(node(), { afterHours: 0, now: NOW })).toBeUndefined();
  });

  it('the last journal line and an opened session count as activity', () => {
    const stamp = new Date(NOW - 30 * 60_000);
    const when = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')} ${String(stamp.getHours()).padStart(2, '0')}:${String(stamp.getMinutes()).padStart(2, '0')}`;
    const written = node({ body: `## Журнал\n\n- ${when} · агент · сделал шаг\n` });
    expect(staleOf(written, { afterHours: 2, now: NOW })).toBeUndefined();
    const opened = node({ sessions: [{ brain: 'claude', id: 's1', opened: ago(1) }] });
    expect(staleOf(opened, { afterHours: 2, now: NOW })).toBeUndefined();
    const started = node({ sessions: [{ brain: 'claude', id: 's1', started: ago(20), opened: ago(10) }] });
    expect(staleOf(started, { afterHours: 2, now: NOW })?.hours).toBe(10);
  });

  it('remembers the last journal line for the card', () => {
    const old = node({
      body: '## Журнал\n\n- 2026-11-05 10:00 · агент · первое\n- 2026-11-05 11:00 · агент · второе\n',
    });
    const stale = staleOf(old, { afterHours: 2, now: NOW });
    expect(stale?.lastEntry).toContain('второе');
    expect(staleLabel(stale!)).toBe('без сессии 14 ч');
    expect(staleNote(stale!)).toContain('последняя запись журнала: 2026-11-05 11:00');
  });

  it('lists the nodes of a tree, the longest quiet first, skipping those with a live session', () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'Давно', status: 'active' });
    const b = addNode(tree, { title: 'Давнее', status: 'active' });
    const c = addNode(tree, { title: 'Живой', status: 'active' });
    for (const [n, hours] of [
      [a, 10],
      [b, 30],
      [c, 40],
    ] as const)
      tree.nodes.get(n.id)!.updated = ago(hours);
    const found = staleNodes(tree, { afterHours: 2, now: NOW, live: (n) => n.id === c.id });
    expect(found.map((x) => x.node.id)).toEqual([b.id, a.id]);
  });

  it('a container with open children is not marked: its work lives in the children', () => {
    const tree = emptyTree();
    const parent = addNode(tree, { title: 'Направление', status: 'active' });
    const kid = addNode(tree, { title: 'Шаг', status: 'todo', parent: parent.id });
    tree.nodes.get(parent.id)!.updated = ago(30);
    expect(staleNodes(tree, { afterHours: 2, now: NOW }).map((x) => x.node.id)).toEqual([]);
    tree.nodes.get(kid.id)!.status = 'done';
    expect(staleNodes(tree, { afterHours: 2, now: NOW }).map((x) => x.node.id)).toEqual([parent.id]);
  });
});

describe('the threshold in the settings', () => {
  it('stale_after is read and written in snake case', () => {
    const home = tempDir('treeyard-home-');
    const env = { ...process.env, TREEYARD_HOME: home };
    expect(loadSettings(env).staleAfter).toBe(2);
    saveSettings({ ...DEFAULTS, staleAfter: 6 }, env);
    expect(JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')).stale_after).toBe(6);
    expect(loadSettings(env).staleAfter).toBe(6);
    writeFileSync(join(home, 'settings.json'), '{"stale_after": -3}');
    expect(loadSettings(env).staleAfter).toBe(2);
  });
});

describe('where it shows', () => {
  const old = (hours: number) => ({ hours, since: NOW - hours * HOUR });

  it('treeyard show: the status line, the card note, the tree and json', () => {
    const tree = emptyTree();
    const added = addNode(tree, { title: 'Брошенный', status: 'active' });
    const stale = { ...old(14), lastEntry: '2026-11-05 11:00 · агент · второе' };
    const p = paint(process.stdout);
    const text = nodeText(tree, tree.nodes.get(added.id)!, p, stale);
    expect(text).toContain('в работе · без сессии 14 ч');
    expect(text).toContain('последняя запись журнала');
    expect(treeText(tree, p, { stale: () => stale })).toContain('без сессии 14 ч');
    const json = treeJson(tree, () => stale) as { nodes: { stale?: { hours: number } }[] };
    expect(json.nodes[0]?.stale).toEqual({ hours: 14 });
  });

  it('the root review context lists them', () => {
    const tree = emptyTree();
    const added = addNode(tree, { title: 'Брошенный', status: 'active' });
    tree.nodes.get(added.id)!.updated = new Date(Date.now() - 14 * HOUR).toISOString();
    const context = projectContext(tree);
    expect(context).toContain('## В работе, но без живой сессии');
    expect(context).toContain('без сессии 14 ч');
    expect(context).toContain(`Брошенный (\`${added.id}\`)`);
  });

  it('the CLI reads the file: show and show --json, and the threshold from config', async () => {
    const tree = emptyTree();
    const added = addNode(tree, { title: 'Брошенный', status: 'active' });
    const file = join(tree.project.dir, '.tree', 'nodes', `${added.id}.md`);
    writeFileSync(file, readFileSync(file, 'utf8').replace(/updated: .*/, 'updated: 2026-10-01T10:00:00+03:00'));
    const sh = treeyardIn(tree.project.dir);
    expect((await sh('show', added.id)).stdout).toContain('в работе · без сессии');
    expect(JSON.parse((await sh('show', added.id, '--json')).stdout).stale.hours).toBeGreaterThan(24);
    expect((await sh('show')).stdout).toContain('без сессии');
    expect((await sh('config', 'stale_after', 'abc')).code).toBe(2);
    expect((await sh('config', 'stale_after', '0')).stdout).toContain('stale_after = 0');
    expect((await sh('show', added.id)).stdout).not.toContain('без сессии');
  });
});
