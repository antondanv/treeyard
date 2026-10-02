import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { paint, treeJson, treeText } from '../src/cli/print.js';
import { addNode, attachSession, setStatus, shift } from '../src/model/ops.js';
import { GLYPH, overviewText } from '../src/model/overview.js';
import { loadTree, nodePath, TREE_DIR } from '../src/model/store.js';
import { childrenOf, pathTo, progress, STATUS_ORDERS } from '../src/model/tree.js';
import { ROOT, type Status, type Tree } from '../src/model/types.js';
import { DEFAULTS, loadSettings, resetSettings, saveSettings } from '../src/settings.js';
import { snapshot } from '../src/tui/snapshot.js';
import { doneGroupId, doneGroupsOnPath, treeViewRows } from '../src/tui/tree-view.js';
import { emptyTree, tempDir } from './helpers.js';

const SHIFT_UP = '\u001b[1;2A';
const SHIFT_DOWN = '\u001b[1;2B';
const RIGHT = '\u001b[C';
const DOWN = '\u001b[B';
const ESC = '\u001b';
/** «Порядок статусов» on the settings screen: language, confirm, theme, animation, marquee, then it. */
const STATUS_ORDER_ROW = 5;
const root = fileURLToPath(new URL('..', import.meta.url));

function sample() {
  const tree = emptyTree();
  const branch = addNode(tree, { title: 'Ветка' });
  const first = addNode(tree, { title: 'Первый', parent: branch.id });
  const second = addNode(tree, { title: 'Второй', parent: branch.id });
  const active = addNode(tree, { title: 'Работаю', status: 'active', parent: branch.id });
  const review = addNode(tree, { title: 'Проверяю', status: 'review', parent: branch.id });
  const done = addNode(tree, { title: 'Подтверждено', status: 'done', parent: branch.id });
  return { tree, branch, first, second, active, review, done };
}

describe('status and manual priority', () => {
  it('adds a new node last within its status even when closed siblings have smaller order values', () => {
    const { tree, branch, first, second } = sample();
    const added = addNode(tree, { title: 'А новая задача', parent: branch.id });
    expect(
      childrenOf(tree, branch.id)
        .filter((node) => node.status === 'todo')
        .map((node) => node.id),
    ).toEqual([first.id, second.id, added.id]);
  });

  it('orders every parent by status and persists manual order within that status in every output', () => {
    const tree = emptyTree();
    const statuses: Status[] = ['dropped', 'done', 'idea', 'waiting', 'todo', 'review', 'active'];
    for (const status of statuses) addNode(tree, { title: status, status });
    const another = addNode(tree, { title: 'other todo' });
    shift(tree, another.id, -1);
    const expected = ['active', 'review', 'other todo', 'todo', 'waiting', 'idea', 'done', 'dropped'];
    const reread = loadTree(tree.project.dir);
    expect(childrenOf(reread, ROOT).map((node) => node.title)).toEqual(expected);
    expect((treeJson(reread) as { nodes: { title: string }[] }).nodes.map((node) => node.title)).toEqual(expected);
    const text = treeText(reread, paint(process.stdout));
    const overview = overviewText(reread);
    const positions = childrenOf(reread, ROOT).map((node) => text.indexOf(`${GLYPH[node.status]} ${node.title}`));
    const overviewPositions = expected.map((title) => overview.indexOf(`[${title}]`));
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(overviewPositions.every((index) => index >= 0)).toBe(true);
    expect(overviewPositions).toEqual([...overviewPositions].sort((a, b) => a - b));
    setStatus(reread, another.id, 'active');
    expect(
      childrenOf(loadTree(tree.project.dir), ROOT)
        .slice(0, 2)
        .map((node) => node.status),
    ).toEqual(['active', 'active']);
  });

  it('does not cross statuses or change files at a priority boundary', () => {
    const { tree, branch, active, first } = sample();
    const before = childrenOf(tree, branch.id).map((node) => readFileSync(nodePath(tree.project.dir, node.id), 'utf8'));
    shift(tree, active.id, 1);
    shift(tree, first.id, -1);
    expect(
      childrenOf(tree, branch.id).map((node) => readFileSync(nodePath(tree.project.dir, node.id), 'utf8')),
    ).toEqual(before);
  });

  it.each(['graph', 'list'] as const)(
    'reorders with Shift+arrows in %s, keeps selection, and undoes',
    async (treeMode) => {
      const { tree, branch, first, second } = sample();
      const ui = { selected: second.id, expanded: [branch.id], treeMode };
      const frame = await snapshot(tree.project.dir, { columns: 100, rows: 30, ui, keys: [SHIFT_UP] });
      expect(
        childrenOf(loadTree(tree.project.dir), branch.id)
          .filter((node) => node.status === 'todo')
          .map((node) => node.id),
      ).toEqual([second.id, first.id]);
      expect(frame).toContain('Второй» выше');
      await snapshot(tree.project.dir, { ui, keys: [SHIFT_DOWN, 'u'] });
      expect(
        childrenOf(loadTree(tree.project.dir), branch.id)
          .filter((node) => node.status === 'todo')
          .map((node) => node.id),
      ).toEqual([second.id, first.id]);
      await snapshot(tree.project.dir, { ui, keys: [SHIFT_DOWN] });
      expect(
        childrenOf(loadTree(tree.project.dir), branch.id)
          .filter((node) => node.status === 'todo')
          .map((node) => node.id),
      ).toEqual([first.id, second.id]);
    },
  );

  it('offers priority in the node menu and palette', async () => {
    const { tree, branch, first, second } = sample();
    const ui = { selected: second.id, expanded: [branch.id] };
    await snapshot(tree.project.dir, { ui, keys: ['\r', 'K'] });
    expect(
      childrenOf(loadTree(tree.project.dir), branch.id)
        .filter((node) => node.status === 'todo')
        .map((node) => node.id),
    ).toEqual([second.id, first.id]);
    await snapshot(tree.project.dir, { ui, keys: [':', 'Опустить приоритет', '\r'] });
    expect(
      childrenOf(loadTree(tree.project.dir), branch.id)
        .filter((node) => node.status === 'todo')
        .map((node) => node.id),
    ).toEqual([first.id, second.id]);
  });
});

describe('completed groups', () => {
  it('groups done siblings per parent without changing real parents, sessions, files or progress', () => {
    const { tree, branch, done, review } = sample();
    const topDone = addNode(tree, { title: 'Сверху готово', status: 'done' });
    const nested = addNode(tree, { title: 'Глубже', parent: done.id, status: 'done' });
    attachSession(tree, done.id, { brain: 'codex', id: 'kept-session' });
    const before = [...tree.nodes.values()].map((node) => readFileSync(nodePath(tree.project.dir, node.id), 'utf8'));
    const beforeProgress = progress(tree, ROOT);
    const expanded = new Set([branch.id]);
    const rows = treeViewRows(tree, { expanded, showClosed: true });
    expect(rows.map((row) => row.node.id)).toContain(doneGroupId(ROOT));
    expect(rows.map((row) => row.node.id)).toContain(doneGroupId(branch.id));
    expect(rows.map((row) => row.node.id)).toContain(review.id);
    expect(rows.map((row) => row.node.id)).not.toContain(done.id);
    expect(rows.map((row) => row.node.id)).not.toContain(topDone.id);
    const path = pathTo(tree, nested.id);
    const opened = new Set([...expanded, ...path.map((node) => node.id), ...doneGroupsOnPath(path)]);
    expect(treeViewRows(tree, { expanded: opened, showClosed: true }).map((row) => row.node.id)).toContain(nested.id);
    expect(tree.nodes.get(done.id)?.parent).toBe(branch.id);
    expect(tree.nodes.get(nested.id)?.parent).toBe(done.id);
    expect(tree.nodes.get(done.id)?.sessions[0]?.id).toBe('kept-session');
    expect(progress(tree, ROOT)).toEqual(beforeProgress);
    expect([...tree.nodes.values()].map((node) => readFileSync(nodePath(tree.project.dir, node.id), 'utf8'))).toEqual(
      before,
    );
  });

  it.each([
    { treeMode: 'graph', graphStyle: 'line' },
    { treeMode: 'graph', graphStyle: 'card' },
    { treeMode: 'list', graphStyle: 'line' },
  ] as const)('folds, opens with space and reaches sessions in $treeMode/$graphStyle', async (style) => {
    const { tree, branch, done } = sample();
    attachSession(tree, done.id, { brain: 'codex', id: 'kept-session', name: 'Готовый разговор' });
    const ui = { ...style, selected: doneGroupId(branch.id), expanded: [branch.id] };
    const opts = { columns: 100, rows: 30, ui };
    const folded = await snapshot(tree.project.dir, opts);
    expect(folded).toContain('Готовые · 1');
    expect(folded).not.toContain('Подтверждено');
    const opened = await snapshot(tree.project.dir, { ...opts, keys: [' '] });
    expect(opened).toContain('Подтверждено');
    const closed = await snapshot(tree.project.dir, { ...opts, keys: [' ', ' '] });
    expect(closed).not.toContain('Подтверждено');
    const menu = await snapshot(tree.project.dir, { ...opts, keys: [' ', RIGHT, '\r'] });
    expect(menu).toContain('Готовый разговор');
  });

  it('finds completed work through search and the palette, and opens its group on a jump', async () => {
    const { tree, branch, done } = sample();
    const ui = { selected: branch.id, expanded: [branch.id] };
    const search = await snapshot(tree.project.dir, { ui, keys: ['/', 'Подтверждено', '\r'] });
    expect(search).toContain('Подтверждено');
    const jump = await snapshot(tree.project.dir, { ui, keys: [':', 'Подтверждено', '\r'] });
    expect(jump).toContain('Готовые · 1');
    expect(jump).toContain('Подтверждено');
    expect(jump).toContain(done.id);
  });

  it('cannot edit a virtual group, hides it with dot and expands it with plus', async () => {
    const { tree, branch, done } = sample();
    const before = readFileSync(nodePath(tree.project.dir, done.id), 'utf8');
    const ui = { selected: doneGroupId(branch.id), expanded: [branch.id] };
    const frame = await snapshot(tree.project.dir, { ui, keys: ['r', 'd', 's', 'D', '\t', 'K', 'J'] });
    expect(frame).toContain('Готовые · 1');
    expect(readFileSync(nodePath(tree.project.dir, done.id), 'utf8')).toBe(before);
    const hidden = await snapshot(tree.project.dir, { ui, keys: ['.'] });
    expect(hidden).not.toContain('Готовые · 1');
    expect(hidden).not.toContain('Подтверждено');
    const expanded = await snapshot(tree.project.dir, { ui, keys: ['+'] });
    expect(expanded).toContain('Подтверждено');
  });
});

describe('status order setting', () => {
  // The settings screen writes settings.json: keep it away from other test files.
  const sharedHome = process.env.TREEYARD_HOME;
  beforeEach(() => {
    process.env.TREEYARD_HOME = tempDir('treeyard-home-');
  });
  afterEach(() => {
    process.env.TREEYARD_HOME = sharedHome;
    resetSettings({ ...DEFAULTS });
  });

  const titles = (tree: Tree, parent = ROOT) => childrenOf(tree, parent).map((node) => node.title);
  /** Each text appears in `text`, in this order. */
  const inOrder = (text: string, list: string[]) => {
    const positions = list.map((item) => text.indexOf(item));
    expect(positions.every((index) => index >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  };
  /** One node per status at the root, plus a second todo moved above the first. */
  const everyStatus = () => {
    const tree = emptyTree();
    for (const status of ['dropped', 'done', 'idea', 'waiting', 'todo', 'review', 'active'] as Status[])
      addNode(tree, { title: status, status });
    const another = addNode(tree, { title: 'other todo' });
    shift(tree, another.id, -1);
    return tree;
  };
  const withTodos = (order: readonly Status[]) =>
    order.flatMap((status) => (status === 'todo' ? ['other todo', 'todo'] : [status]));
  const DOWN5 = Array.from({ length: STATUS_ORDER_ROW }, () => DOWN);

  it.each([
    ...Object.entries(STATUS_ORDERS).map(([name, order]) => ({
      name,
      statusOrder: name,
      customOrder: undefined,
      order,
    })),
    {
      name: 'custom',
      statusOrder: 'custom',
      customOrder: ['waiting', 'done', 'idea', 'todo', 'dropped', 'review', 'active'] as Status[],
      order: ['waiting', 'done', 'idea', 'todo', 'dropped', 'review', 'active'] as Status[],
    },
  ])('$name: siblings follow it in the CLI, JSON and the overview, the manual order within a status stays', (row) => {
    resetSettings({
      ...DEFAULTS,
      statusOrder: row.statusOrder as typeof DEFAULTS.statusOrder,
      ...(row.customOrder ? { customOrder: row.customOrder } : {}),
    });
    const tree = loadTree(everyStatus().project.dir);
    const expected = withTodos(row.order);
    expect(titles(tree)).toEqual(expected);
    expect((treeJson(tree) as { nodes: { title: string }[] }).nodes.map((node) => node.title)).toEqual(expected);
    inOrder(
      treeText(tree, paint(process.stdout)),
      childrenOf(tree, ROOT).map((node) => `${GLYPH[node.status]} ${node.title}`),
    );
    inOrder(
      overviewText(tree),
      expected.map((title) => `[${title}]`),
    );
  });

  it('is saved as status_order and custom_order in settings.json; a broken one reads as the default', () => {
    const env = process.env as NodeJS.ProcessEnv & { TREEYARD_HOME: string };
    const file = join(env.TREEYARD_HOME, 'settings.json');
    expect(loadSettings(env).statusOrder).toBe('active-first');
    const mine: Status[] = ['done', 'idea', 'waiting', 'todo', 'review', 'active', 'dropped'];
    saveSettings({ ...DEFAULTS, statusOrder: 'custom', customOrder: mine }, env);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ status_order: 'custom', custom_order: mine });
    expect(loadSettings(env)).toMatchObject({ statusOrder: 'custom', customOrder: mine });
    // A status twice, one missing, an unknown name: ignored.
    const broken = ['done', 'done', 'idea', 'waiting', 'todo', 'review', 'active'] as Status[];
    saveSettings({ ...DEFAULTS, statusOrder: 'sideways' as never, customOrder: broken }, env);
    expect(loadSettings(env)).toMatchObject({ statusOrder: 'active-first', customOrder: DEFAULTS.customOrder });
  });

  it.each(['graph', 'list'] as const)(
    'a preset from the settings screen shows at once in %s, and .tree/README.md follows: done on top',
    async (treeMode) => {
      const { tree, branch } = sample();
      addNode(tree, { title: 'Задумка', status: 'idea', parent: branch.id });
      const ui = { treeMode, expanded: [branch.id], selected: branch.id };
      const before = await snapshot(tree.project.dir, { columns: 100, rows: 30, ui });
      inOrder(before, ['Работаю', 'Проверяю', 'Первый', 'Задумка', 'Готовые · 1']);
      const keys = [',', ...DOWN5, RIGHT, ESC];
      const after = await snapshot(tree.project.dir, { columns: 100, rows: 30, ui, keys });
      inOrder(after, ['Готовые · 1', 'Работаю', 'Проверяю', 'Первый', 'Второй', 'Задумка']);
      expect(loadSettings().statusOrder).toBe('done-first');
      const overview = readFileSync(join(tree.project.dir, TREE_DIR, 'README.md'), 'utf8');
      inOrder(overview, ['[Подтверждено]', '[Работаю]', '[Проверяю]', '[Первый]', '[Второй]', '[Задумка]']);
    },
  );

  it('your own order: ⏎ on the row opens it, K/J (Л/О) and Shift+arrows move a status, ⏎ keeps it', async () => {
    const { tree, branch } = sample();
    addNode(tree, { title: 'Задумка', status: 'idea', parent: branch.id });
    const ui = { expanded: [branch.id], selected: branch.id };
    const opts = { columns: 100, rows: 30, ui };
    const editor = await snapshot(tree.project.dir, { ...opts, keys: [',', ...DOWN5, '\r'] });
    expect(editor).toContain('Свой порядок статусов');
    inOrder(editor, [
      '1  ◐ в работе',
      '2  ◎ на проверке',
      '3  ○ к работе',
      '4  ‖ ждёт',
      '5  ◇ идея',
      '6  ✓ готово',
      '7  ✗ отказ',
    ]);
    // esc leaves it as it was and goes back to the same row of the settings.
    const cancelled = await snapshot(tree.project.dir, { ...opts, keys: [',', ...DOWN5, '\r', 'J', ESC] });
    expect(cancelled).toContain('❯ Порядок статусов');
    expect(loadSettings().statusOrder).toBe('active-first');
    // «идея» (5th) up to the top with К in both layouts and Shift+↑, then «готово» one down.
    const keys = [
      ',',
      ...DOWN5,
      '\r',
      DOWN,
      DOWN,
      DOWN,
      DOWN,
      'K',
      'Л',
      SHIFT_UP,
      SHIFT_UP,
      DOWN,
      DOWN,
      DOWN,
      DOWN,
      DOWN,
    ];
    const saved = await snapshot(tree.project.dir, { ...opts, keys: [...keys, 'О', '\r'] });
    expect(saved).toContain('❯ Порядок статусов');
    expect(saved).toContain('идея → в работе → проверка → к работе → ждёт → отказ → готово');
    expect(loadSettings()).toMatchObject({
      statusOrder: 'custom',
      customOrder: ['idea', 'active', 'review', 'todo', 'waiting', 'dropped', 'done'],
    });
    const shown = await snapshot(tree.project.dir, { ...opts, settings: loadSettings() });
    inOrder(shown, ['Задумка', 'Работаю', 'Проверяю', 'Первый', 'Готовые · 1']);
  });

  it('keeps Shift+arrows and the menu within a status when done is on top', async () => {
    const { tree, branch, first, second, done } = sample();
    const onTop = { statusOrder: 'done-first' as const };
    const todo = () =>
      childrenOf(loadTree(tree.project.dir), branch.id)
        .filter((node) => node.status === 'todo')
        .map((node) => node.id);
    const ui = { selected: second.id, expanded: [branch.id] };
    await snapshot(tree.project.dir, { ui, settings: onTop, keys: [SHIFT_UP] });
    expect(todo()).toEqual([second.id, first.id]);
    await snapshot(tree.project.dir, { ui, settings: onTop, keys: ['\r', 'J'] });
    expect(todo()).toEqual([first.id, second.id]);
    resetSettings({ ...DEFAULTS, ...onTop });
    expect(childrenOf(loadTree(tree.project.dir), branch.id)[0]?.id).toBe(done.id);
  });

  it('treeyard config status_order takes a preset or a list, and show and the overview follow', () => {
    const { tree } = sample();
    const home = process.env.TREEYARD_HOME;
    const run = (...args: string[]) =>
      spawnSync(join(root, 'node_modules', '.bin', 'tsx'), [join(root, 'src', 'cli', 'main.ts'), ...args], {
        cwd: tree.project.dir,
        env: { ...process.env, TREEYARD_HOME: home, TREEYARD_LANG: '', NO_COLOR: '1' },
        encoding: 'utf8',
      });
    const overview = () => readFileSync(join(tree.project.dir, TREE_DIR, 'README.md'), 'utf8');
    expect(run('config').stdout).toMatch(/status_order\s+active-first\s+active,review,todo/);
    expect(run('config', 'status_order', 'done-first').stdout).toContain('status_order = done-first  done,active');
    inOrder(run('show').stdout, ['Подтверждено', 'Работаю', 'Проверяю', 'Первый']);
    inOrder(overview(), ['[Подтверждено]', '[Работаю]', '[Проверяю]', '[Первый]']);
    const mine = 'todo,review,active,waiting,idea,done,dropped';
    expect(run('config', 'status_order', mine).stdout).toContain(`status_order = custom  ${mine}`);
    inOrder(run('show').stdout, ['Первый', 'Проверяю', 'Работаю', 'Подтверждено']);
    inOrder(overview(), ['[Первый]', '[Проверяю]', '[Работаю]', '[Подтверждено]']);
    expect(run('config', 'status_order', 'active-first').status).toBe(0);
    expect(run('config', 'status_order', 'custom').stdout).toContain(`custom  ${mine}`);
    expect(run('config', 'status_order', 'todo,todo').status).toBe(2);
    expect(run('config', 'status_order', 'sideways').status).toBe(2);
  }, 40_000);
});
