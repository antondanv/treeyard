import { execFile } from 'node:child_process';
import { mkdirSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { contextText } from '../src/agents/context.js';
import { journalEntries } from '../src/model/journal.js';
import { addLinkedNode, linksOf, parseRef, refTo, resolveLink, setNeeds, sharedBranch } from '../src/model/links.js';
import { NODE_VAR } from '../src/model/notes.js';
import { addNode, setStatus } from '../src/model/ops.js';
import { loadTree, nodeFromText, nodeToText } from '../src/model/store.js';
import { actionable } from '../src/model/tree.js';
import { ROOT, type Tree } from '../src/model/types.js';
import { createTree, getTemplate } from '../src/templates/templates.js';
import { NodeDetails } from '../src/tui/details.js';
import { TreeRow } from '../src/tui/rows.js';
import { tempDir } from './helpers.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

/** Two projects side by side, like ~/Projects/Treeyard and ~/Projects/Brainyard. */
function neighbours(): { here: Tree; there: Tree; root: string } {
  const root = tempDir('treeyard-links-');
  const plant = (name: string) => {
    const dir = join(root, name);
    mkdirSync(dir);
    createTree(dir, getTemplate('directions')!, { title: name, answers: { goal: 'работает' }, skeleton: false });
    return loadTree(dir);
  };
  return { here: plant('Treeyard'), there: plant('Brainyard'), root };
}

function shell(cwd: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TREEYARD_HOME: tempDir('treeyard-home-'),
    TREEYARD_LANG: 'ru',
    NO_COLOR: '1',
  };
  delete env[NODE_VAR];
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.FORCE_COLOR;
  return (...args: string[]) =>
    run(process.execPath, ['--import', tsx, cli, ...args], { cwd, env, timeout: 30_000 }).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error: { code: number; stdout: string; stderr: string }) => error,
    );
}

describe('links between trees', () => {
  it('reads and writes needs and for, not as unknown keys', () => {
    const text = '---\nid: g9ph\ntitle: X\nstatus: todo\nneeds: ../Brainyard#hv95\nfor:\n  - ../my-app#e2ep\n---\n';
    const node = nodeFromText(text, 'g9ph');
    expect(node.needs).toEqual(['../Brainyard#hv95']);
    expect(node.neededBy).toEqual(['../my-app#e2ep']);
    expect(node.extra).toEqual({});
    expect(nodeToText(node)).toContain('needs:\n  - ../Brainyard#hv95\nfor:\n  - ../my-app#e2ep');
  });

  it('parses refs and writes them from the project folder', () => {
    expect(parseRef('../Brainyard#hv95')).toEqual({ path: '../Brainyard', id: 'hv95' });
    expect(parseRef('hv95')).toBeUndefined();
    const { here, there } = neighbours();
    expect(refTo(here.project.dir, there.project.dir, 'hv95')).toBe('../Brainyard#hv95');
  });

  it('adds a node to «Совместные узлы» of the other tree and links both ways', () => {
    const { here, there } = neighbours();
    const waiter = addNode(here, { title: 'Статус Codex в панелях' });
    const made = addLinkedNode(here, waiter.id, there, { title: 'Codex: статус хода' }, 'claude');
    const branch = sharedBranch(loadTree(there.project.dir));
    expect(branch).toMatchObject({ title: 'Совместные узлы', parent: ROOT });

    const saved = loadTree(there.project.dir).nodes.get(made.id)!;
    expect(saved).toMatchObject({
      parent: branch.id,
      status: 'todo',
      who: 'agent',
      neededBy: [`../Treeyard#${waiter.id}`],
    });
    expect(saved.body).toContain(`Откуда: Treeyard › «Статус Codex в панелях» (${waiter.id})`);
    expect(journalEntries(saved.body).at(-1)).toContain(`нужен для: Treeyard › «Статус Codex в панелях»`);

    const back = loadTree(here.project.dir).nodes.get(waiter.id)!;
    expect(back.needs).toEqual([`../Brainyard#${made.id}`]);
    expect(journalEntries(back.body).at(-1)).toContain(`ждёт: Brainyard › «Codex: статус хода» (${made.id})`);
    // The branch is reused, not planted twice.
    addLinkedNode(here, waiter.id, loadTree(there.project.dir), { title: 'Ещё' }, 'claude');
    expect([...loadTree(there.project.dir).nodes.values()].filter((n) => n.title === 'Совместные узлы')).toHaveLength(
      1,
    );
  });

  it('a missing folder or node is «не найдено», not a crash', () => {
    const { here } = neighbours();
    expect(resolveLink(here.project.dir, '../Nowhere#abcd')).toMatchObject({ project: 'Nowhere', missing: 'project' });
    expect(resolveLink(here.project.dir, '../Brainyard#abcd')).toMatchObject({ project: 'Brainyard', missing: 'node' });
  });

  it('set needs= links by hand and unlinks the other side', () => {
    const { here, there } = neighbours();
    const waiter = addNode(here, { title: 'Ждущий' });
    const target = addNode(there, { title: 'Релиз' });
    setNeeds(here, waiter.id, [`../Brainyard#${target.id}`], 'claude');
    expect(loadTree(there.project.dir).nodes.get(target.id)!.neededBy).toEqual([`../Treeyard#${waiter.id}`]);
    setNeeds(here, waiter.id, [], 'claude');
    expect(loadTree(here.project.dir).nodes.get(waiter.id)!.needs).toBeUndefined();
    expect(loadTree(there.project.dir).nodes.get(target.id)!.neededBy).toBeUndefined();
  });

  it('the shared node closes itself when the node it was made for is done', () => {
    const { here, there } = neighbours();
    const first = addNode(here, { title: 'Первый' });
    const second = addNode(here, { title: 'Второй' });
    const made = addLinkedNode(here, first.id, there, { title: 'Правка' }, 'claude');
    setNeeds(here, second.id, [`../Brainyard#${made.id}`], 'claude');
    setStatus(here, first.id, 'done');
    // Still needed by the second one.
    expect(loadTree(there.project.dir).nodes.get(made.id)!.status).toBe('todo');
    setStatus(here, second.id, 'done');
    const closed = loadTree(there.project.dir).nodes.get(made.id)!;
    expect(closed.status).toBe('done');
    expect(journalEntries(closed.body).at(-1)).toContain('закрыт вместе с Treeyard › «Второй»');
  });

  it('a waiting node comes back to «Сейчас» when all it waits for is done', () => {
    const { here, there } = neighbours();
    const waiter = addNode(here, { title: 'Ждущий', status: 'waiting' });
    const made = addLinkedNode(here, waiter.id, there, { title: 'Правка' }, 'claude');
    expect(actionable(here).map((n) => n.id)).not.toContain(waiter.id);
    setStatus(loadTree(there.project.dir), made.id, 'done');
    expect(actionable(loadTree(here.project.dir)).map((n) => n.id)).toContain(waiter.id);
  });

  it('shows the links in the card, the tree row and the agent context', () => {
    const { here, there } = neighbours();
    const waiter = addNode(here, { title: 'Ждущий' });
    const made = addLinkedNode(here, waiter.id, there, { title: 'Правка в Brainyard' }, 'claude');
    const card = render(<NodeDetails tree={here} node={waiter} width={70} height={30} live={new Map()} frame={0} />);
    expect(card.lastFrame()).toContain('ЖДЁТ');
    expect(card.lastFrame()).toContain('○ Brainyard › Правка в Brainyard · к работе');
    const other = loadTree(there.project.dir);
    const otherCard = render(
      <NodeDetails tree={other} node={other.nodes.get(made.id)} width={70} height={30} live={new Map()} frame={0} />,
    );
    expect(otherCard.lastFrame()).toContain('НУЖЕН ДЛЯ');
    expect(otherCard.lastFrame()).toContain('Treeyard › Ждущий · к работе');

    const row = render(
      <TreeRow
        row={{
          node: waiter,
          depth: 0,
          hasChildren: false,
          expanded: false,
          last: true,
          guides: [],
          held: false,
          match: true,
        }}
        selected={false}
        width={70}
        badges={{ live: [], frame: 0, needs: linksOf(here, waiter).needs }}
      />,
    );
    expect(row.lastFrame()).toContain('→ Brainyard ○');
    expect(contextText(here, waiter.id)).toContain(
      `Ждёт: Brainyard › Правка в Brainyard (\`../Brainyard#${made.id}\`, к работе)`,
    );
  });
});

describe('treeyard add --project --for', () => {
  it('makes the node there, links it, lets an agent close it, and survives a moved folder', async () => {
    const { here, there, root } = neighbours();
    const waiter = addNode(here, { title: 'Статус Codex' });
    const sh = shell(here.project.dir);
    const added = await sh(
      'add',
      'Codex: статус хода',
      '--project',
      '../Brainyard',
      '--for',
      waiter.id,
      '--as',
      'claude',
    );
    expect(added.code).toBe(0);
    const id = added.stdout.split(' ')[0]!.trim();
    expect(added.stdout).toContain(`Brainyard › Совместные узлы ← Treeyard › ${waiter.id}`);
    expect(loadTree(there.project.dir).nodes.get(id)!.neededBy).toEqual([`../Treeyard#${waiter.id}`]);

    const shown = await sh('show', waiter.id);
    expect(shown.stdout).toContain('ждёт: ○ Brainyard › Codex: статус хода · к работе');
    const tree = await sh('show');
    expect(tree.stdout).toContain('→ Brainyard ○');

    // Not from a TTY and not as a person — still done: the shared node is the agent's to close.
    const closed = await sh('set', id, 'status=done', '--project', '../Brainyard', '--as', 'claude');
    expect(closed.stdout).toContain('готово');
    expect((await sh('show', waiter.id)).stdout).toContain('✓ Brainyard › Codex: статус хода · готово');

    renameSync(there.project.dir, join(root, 'Moved'));
    const lost = await sh('show', waiter.id);
    expect(lost.code).toBe(0);
    expect(lost.stdout).toContain(`../Brainyard#${id} — не найдено`);
  });

  it('refuses --for without --project and a folder without a tree', async () => {
    const { here, root } = neighbours();
    const waiter = addNode(here, { title: 'X' });
    mkdirSync(join(root, 'Empty'));
    const sh = shell(here.project.dir);
    expect((await sh('add', 'Y', '--for', waiter.id)).code).not.toBe(0);
    const empty = await sh('add', 'Y', '--project', '../Empty', '--for', waiter.id);
    expect(empty.code).not.toBe(0);
    expect(empty.stderr).toContain('нет дерева');
  });
});
