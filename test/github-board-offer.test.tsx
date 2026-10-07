import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Gh } from '../src/github.js';

// The wizard talks to gh and GitHub: here it never does.
const fake = vi.hoisted(() => ({
  ghState: vi.fn(async () => ({ installed: true, user: 'anton', scopes: ['repo', 'project'] })),
  listBoards: vi.fn(async (owner: string) => [{ number: 7, title: 'Дорожная карта', owner }]),
  repoOf: vi.fn((): undefined => undefined),
  syncIssues: vi.fn(async () => ({ added: [], pulled: [], pushed: [], failed: [], gone: [] })),
  syncBoard: vi.fn(async () => ({ added: [], pulled: [], pushed: [], failed: [], skipped: 0 })),
}));

vi.mock('../src/github.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/github.js')>()),
  ...fake,
}));

import { boardOf, boardOffered, hubNode, linkBoard, linkedRepo, linkRepo, offerShown } from '../src/github.js';
import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { snapshot } from '../src/tui/snapshot.js';
import { emptyTree } from './helpers.js';

const ESC = '\u001b';

/** gh as far as linking goes: the repository is there, the board has a Status field. */
const linkingGh: Gh = async (args) => {
  if (args[0] === 'repo') return '{"name":"app"}';
  if (args[1] === 'view') return '{"id":"PVT_1"}';
  return JSON.stringify({
    fields: [
      {
        id: 'F',
        name: 'Status',
        options: [
          { id: 'o1', name: 'Todo' },
          { id: 'o2', name: 'Done' },
        ],
      },
    ],
  });
};

async function withIssues() {
  const tree = emptyTree();
  await linkRepo(tree, 'anton/app', undefined, linkingGh);
  const linked = loadTree(tree.project.dir);
  return { tree: linked, hub: hubNode(linked)! };
}

beforeEach(() => {
  for (const mock of Object.values(fake)) mock.mockClear();
});

describe('connecting a board after the issues', () => {
  it('a board stays on offer while only the repository is linked', async () => {
    const tree = emptyTree();
    expect(boardOffered(tree)).toBe(false);
    await linkRepo(tree, 'anton/app', undefined, linkingGh);
    expect(boardOffered(tree)).toBe(true);
    // The virtual offer node is gone for the real «GitHub» one, which carries the offer on.
    expect(offerShown(tree)).toBe(false);
    expect(hubNode(tree)).toBeDefined();
    await linkBoard(tree, 'anton/1', undefined, linkingGh);
    expect(boardOffered(tree)).toBe(false);
    expect(linkedRepo(tree)).toEqual({ owner: 'anton', name: 'app' });
  });

  it('the «GitHub» node says so in its line and in the details', async () => {
    const { tree, hub } = await withIssues();
    const ui = { selected: hub.id };
    expect(await snapshot(tree.project.dir, { columns: 100, rows: 30, ui })).toContain('issues есть, доски нет');
    const details = await snapshot(tree.project.dir, { columns: 130, rows: 36, ui: { ...ui, inspector: true } });
    expect(details).toContain('ДОСКА GITHUB');
    expect(details).toContain('не подключена — issues anton/app уже в дереве');
    // Not on other nodes.
    const other = addNode(tree, { title: 'Другой узел' });
    const elsewhere = await snapshot(tree.project.dir, {
      columns: 130,
      rows: 36,
      ui: { selected: other.id, inspector: true },
    });
    expect(elsewhere).toContain('Другой узел');
    expect(elsewhere).not.toContain('ДОСКА GITHUB');
  });

  it('⏎ on the node and G ask: check against issues or connect a board; nothing is synced until you say', async () => {
    const { tree, hub } = await withIssues();
    const ui = { selected: hub.id };
    for (const keys of [['G'], ['\r']]) {
      const frame = await snapshot(tree.project.dir, { columns: 100, rows: 30, ui, keys });
      expect(frame).toContain('Подключены issues anton/app, доски нет');
      expect(frame).toContain('Свериться с issues');
      expect(frame).toContain('Подключить доску GitHub Project');
    }
    // The node's own menu is not lost: ⏎ offers it, G does not.
    expect(await snapshot(tree.project.dir, { columns: 100, rows: 30, ui, keys: ['\r'] })).toContain(
      'Действия узла «GitHub»',
    );
    expect(await snapshot(tree.project.dir, { columns: 100, rows: 30, ui, keys: ['G'] })).not.toContain(
      'Действия узла',
    );
    expect(await snapshot(tree.project.dir, { columns: 100, rows: 30, ui, keys: ['\r', 'a'] })).toContain(
      'Новая сессия',
    );
    const closed = await snapshot(tree.project.dir, { columns: 100, rows: 30, ui, keys: ['G', ESC] });
    expect(closed).not.toContain('доски нет. Что сделать');
    expect(fake.syncIssues).not.toHaveBeenCalled();
    expect(fake.ghState).not.toHaveBeenCalled();
  });

  it('«check against issues» syncs them', async () => {
    const { tree, hub } = await withIssues();
    await snapshot(tree.project.dir, {
      columns: 100,
      rows: 30,
      ui: { selected: hub.id },
      keys: ['G', 's'],
      settle: 300,
    });
    expect(fake.syncIssues).toHaveBeenCalledTimes(1);
    expect(fake.syncBoard).not.toHaveBeenCalled();
  });

  it('«connect a board» opens the wizard at its board step, and issues are not offered again', async () => {
    const { tree, hub } = await withIssues();
    const frame = await snapshot(tree.project.dir, {
      columns: 100,
      rows: 30,
      ui: { selected: hub.id },
      keys: ['G', 'b'],
      settle: 300,
    });
    expect(fake.ghState).toHaveBeenCalledTimes(1);
    expect(fake.listBoards).toHaveBeenCalledWith('anton');
    // The repository comes from the link, not from git remotes, and there is no repository step.
    expect(fake.repoOf).not.toHaveBeenCalled();
    expect(frame).toContain('Issues anton/app подключены и останутся');
    expect(frame).toContain('Дорожная карта');
    expect(frame).toContain('Создать доску');
    expect(frame).not.toContain('Только issues');
    expect(frame).not.toContain('шаг 3 из 3');
  });

  it('G with a board checks against GitHub at once; with nothing linked it starts the wizard from the repository', async () => {
    const tree = emptyTree();
    await linkBoard(tree, 'anton/1', undefined, linkingGh);
    const linked = loadTree(tree.project.dir);
    expect(boardOf(linked)).toBeDefined();
    const frame = await snapshot(tree.project.dir, { columns: 100, rows: 30, keys: ['G'], settle: 300 });
    expect(frame).not.toContain('Что сделать');
    expect(fake.syncBoard).toHaveBeenCalledTimes(1);
    expect(fake.ghState).not.toHaveBeenCalled();

    const bare = emptyTree();
    const wizard = await snapshot(bare.project.dir, { columns: 100, rows: 30, keys: ['G'], settle: 300 });
    expect(fake.ghState).toHaveBeenCalledTimes(1);
    expect(fake.repoOf).toHaveBeenCalled();
    expect(wizard).toContain('шаг 2 из 3');
  });
});
