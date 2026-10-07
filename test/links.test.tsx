import { mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { contextText } from '../src/agents/context.js';
import { journalEntries } from '../src/model/journal.js';
import {
  addLinkedNode,
  linksOf,
  normalizeRef,
  parseRef,
  refTo,
  resolveLink,
  setNeeds,
  sharedBranch,
} from '../src/model/links.js';
import { addNode, setStatus } from '../src/model/ops.js';
import { loadTree, nodeFromText, nodeToText } from '../src/model/store.js';
import { actionable } from '../src/model/tree.js';
import { ROOT, type Tree } from '../src/model/types.js';
import { createTree, getTemplate } from '../src/templates/templates.js';
import { NodeDetails } from '../src/tui/details.js';
import { TreeRow } from '../src/tui/rows.js';
import { tempDir, treeyardIn } from './helpers.js';

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

describe('needs inside one tree', () => {
  it('reads a bare id and #id as .#id, and leaves other refs alone', () => {
    expect(normalizeRef('y79a')).toBe('.#y79a');
    expect(normalizeRef(' #y79a ')).toBe('.#y79a');
    expect(normalizeRef('.#y79a')).toBe('.#y79a');
    expect(normalizeRef('../Brainyard#y79a')).toBe('../Brainyard#y79a');
    for (const odd of ['', '#', '../Brainyard', 'two words', '.', '..']) expect(normalizeRef(odd)).toBe(odd);
  });

  it('links a node of the same tree both ways, however the id is written', () => {
    const { here } = neighbours();
    const target = addNode(here, { title: 'Цель' });
    for (const ref of [target.id, `#${target.id}`, `.#${target.id}`]) {
      const waiter = addNode(here, { title: `Ждущий ${ref}` });
      const links = setNeeds(here, waiter.id, [ref], 'claude');
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ ref: `.#${target.id}`, project: 'Treeyard', node: { id: target.id } });
      // The tree in hand and the files agree.
      for (const tree of [here, loadTree(here.project.dir)]) {
        expect(tree.nodes.get(waiter.id)!.needs).toEqual([`.#${target.id}`]);
        expect(tree.nodes.get(target.id)!.neededBy).toContain(`.#${waiter.id}`);
      }
      expect(journalEntries(here.nodes.get(waiter.id)!.body).at(-1)).toContain(
        `ждёт: Treeyard › «Цель» (${target.id})`,
      );
    }
    // Written once per waiter, and unlinked from both sides.
    const [first] = [...here.nodes.values()].filter((node) => node.title.startsWith('Ждущий'));
    setNeeds(here, first!.id, [target.id, `#${target.id}`, `.#${target.id}`], 'claude');
    expect(loadTree(here.project.dir).nodes.get(first!.id)!.needs).toEqual([`.#${target.id}`]);
    setNeeds(here, first!.id, [], 'claude');
    expect(loadTree(here.project.dir).nodes.get(first!.id)!.needs).toBeUndefined();
    expect(loadTree(here.project.dir).nodes.get(target.id)!.neededBy).not.toContain(`.#${first!.id}`);
  });

  it('says so when the node is not in this tree, is the node itself, or the ref is nonsense', () => {
    const { here } = neighbours();
    const waiter = addNode(here, { title: 'Ждущий' });
    expect(() => setNeeds(here, waiter.id, ['zzzz'], 'claude')).toThrow('нет узла «zzzz» в этом дереве');
    expect(() => setNeeds(here, waiter.id, ['#zzzz'], 'claude')).toThrow('нет узла «zzzz» в этом дереве');
    expect(() => setNeeds(here, waiter.id, ['.#zzzz'], 'claude')).toThrow('нет узла «zzzz» в этом дереве');
    expect(() => setNeeds(here, waiter.id, [waiter.id], 'claude')).toThrow('не может ждать сам себя');
    expect(() => setNeeds(here, waiter.id, ['../Brainyard'], 'claude')).toThrow('нужен id узла этого дерева');
    expect(loadTree(here.project.dir).nodes.get(waiter.id)!.needs).toBeUndefined();
    // A node of another project that is not there yet is still kept, as before.
    expect(setNeeds(here, waiter.id, ['../Brainyard#abcd'], 'claude')[0]).toMatchObject({ missing: 'node' });
    expect(setNeeds(here, waiter.id, ['../Nowhere#abcd'], 'claude')[0]).toMatchObject({ missing: 'project' });
  });

  it('shows the link in the card and the tree row like a link to another project', () => {
    const { here } = neighbours();
    const target = addNode(here, { title: 'Цель' });
    const waiter = addNode(here, { title: 'Ждущий' });
    setNeeds(here, waiter.id, [`#${target.id}`], 'claude');
    const card = render(
      <NodeDetails tree={here} node={here.nodes.get(waiter.id)!} width={70} height={30} live={new Map()} frame={0} />,
    );
    expect(card.lastFrame()).toContain('ЖДЁТ');
    expect(card.lastFrame()).toContain('○ Treeyard › Цель · к работе');
    const other = loadTree(here.project.dir);
    const targetCard = render(
      <NodeDetails tree={other} node={other.nodes.get(target.id)} width={70} height={30} live={new Map()} frame={0} />,
    );
    expect(targetCard.lastFrame()).toContain('НУЖЕН ДЛЯ');
    expect(targetCard.lastFrame()).toContain('Treeyard › Ждущий · к работе');
  });

  it('does not close the node it waits for when it is done itself', () => {
    const { here } = neighbours();
    const target = addNode(here, { title: 'Цель' });
    const waiter = addNode(here, { title: 'Ждущий' });
    setNeeds(here, waiter.id, [target.id], 'claude');
    setStatus(here, waiter.id, 'done');
    expect(loadTree(here.project.dir).nodes.get(target.id)!.status).toBe('todo');
  });
});

describe('treeyard set needs= inside one tree', () => {
  it('takes an id, #id or an id prefix, shows the link, and refuses what is not here', async () => {
    const { here } = neighbours();
    const target = addNode(here, { title: 'Цель' });
    const waiter = addNode(here, { title: 'Ждущий' });
    const sh = treeyardIn(here.project.dir);

    const bare = await sh('set', waiter.id, `needs=${target.id}`);
    expect(bare.code).toBe(0);
    expect(bare.stderr).toBe('');
    expect(loadTree(here.project.dir).nodes.get(waiter.id)!.needs).toEqual([`.#${target.id}`]);
    expect((await sh('show', waiter.id)).stdout).toContain('ждёт: ○ Treeyard › Цель · к работе');
    expect((await sh('show')).stdout).toContain('→ Treeyard ○');

    expect((await sh('set', waiter.id, 'needs=')).code).toBe(0);
    expect(loadTree(here.project.dir).nodes.get(waiter.id)!.needs).toBeUndefined();
    expect((await sh('set', waiter.id, `needs=#${target.id}`)).code).toBe(0);
    expect((await sh('set', waiter.id, 'needs=')).code).toBe(0);
    expect((await sh('set', waiter.id, `needs=${target.id.slice(0, 3)}`)).code).toBe(0);
    expect(loadTree(here.project.dir).nodes.get(waiter.id)!.needs).toEqual([`.#${target.id}`]);

    const missing = await sh('set', waiter.id, 'needs=zzzz');
    expect(missing.code).not.toBe(0);
    expect(missing.stderr).toContain('нет узла «zzzz»');
    const self = await sh('set', waiter.id, `needs=${waiter.id}`);
    expect(self.code).not.toBe(0);
    expect(self.stderr).toContain('не может ждать сам себя');
    // The old link survived the refusals.
    expect(loadTree(here.project.dir).nodes.get(waiter.id)!.needs).toEqual([`.#${target.id}`]);
  });

  it('a node needed only from its own tree is still closed by a person, not by an agent', async () => {
    const { here } = neighbours();
    const target = addNode(here, { title: 'Цель' });
    const waiter = addNode(here, { title: 'Ждущий' });
    setNeeds(here, waiter.id, [target.id], 'claude');
    const sh = treeyardIn(here.project.dir);
    const closed = await sh('set', target.id, 'status=done', '--as', 'claude');
    expect(closed.stderr).toContain('готово ставит человек');
    expect(loadTree(here.project.dir).nodes.get(target.id)!.status).toBe('review');
  });

  it('shows needs=<id> in the help', async () => {
    const { here } = neighbours();
    const help = await treeyardIn(here.project.dir)('help');
    expect(help.stdout).toContain('needs=<id>|../X#id');
  });
});

describe('treeyard add --project --for', () => {
  it('makes the node there, links it, lets an agent close it, and survives a moved folder', async () => {
    const { here, there, root } = neighbours();
    const waiter = addNode(here, { title: 'Статус Codex' });
    const sh = treeyardIn(here.project.dir);
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
    const sh = treeyardIn(here.project.dir);
    expect((await sh('add', 'Y', '--for', waiter.id)).code).not.toBe(0);
    const empty = await sh('add', 'Y', '--project', '../Empty', '--for', waiter.id);
    expect(empty.code).not.toBe(0);
    expect(empty.stderr).toContain('нет дерева');
  });
});
