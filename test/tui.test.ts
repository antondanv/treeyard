import { describe, expect, it } from 'vitest';

import { addNode, setStatus } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { snapshot } from '../src/tui/snapshot.js';
import { emptyTree } from './helpers.js';

const UP = '\u001b[A';
const DOWN = '\u001b[B';
const RIGHT = '\u001b[C';
const LEFT = '\u001b[D';
const ENTER = '\r';
const ESC = '\u001b';
const TAB = '\t';

function sample() {
  const tree = emptyTree();
  const product = addNode(tree, { title: 'Продукт', doneWhen: 'сценарий работает' });
  const catalog = addNode(tree, { title: 'Каталог', parent: product.id, status: 'done' });
  const cart = addNode(tree, { title: 'Корзина', parent: product.id, status: 'active', check: 'true' });
  const deploy = addNode(tree, { title: 'Публикация', who: 'human' });
  addNode(tree, { title: 'Сторис в кабинете', status: 'idea' });
  return { tree, product, catalog, cart, deploy };
}

const shot = (dir: string, keys: string[] = [], rows = 26) => snapshot(dir, { columns: 110, rows, keys });

describe('TUI', () => {
  it('draws the mark, the goal, progress, tabs and the tree as a graph', async () => {
    const { tree } = sample();
    const frame = await shot(tree.project.dir);
    expect(frame).toContain('●   ●   ●');
    expect(frame).toContain('┗━━┳━━┛');
    expect(frame).toContain('treeyard · Тест');
    expect(frame).toContain('цель  всё работает');
    expect(frame).toMatch(/1 Дерево\s+2 Сейчас 2\s+3 Ждёт\s+4 Идеи 1\s+5 Сессии\s+6 Журнал/);
    expect(frame).toContain('◆ Тест');
    expect(frame).toContain('✓ Каталог');
    expect(frame).toContain('◐ Корзина');
    // It starts on the first thing to do, and says where that is.
    expect(frame).toMatch(/Тест › Продукт › ◐ Корзина/);
  });

  it('moves by arrows through the picture: up and down in the column, left to the parent', async () => {
    const { tree } = sample();
    const down = await shot(tree.project.dir, [DOWN]);
    expect(down).toMatch(/Тест › Продукт › ✓ Каталог/);
    const up = await shot(tree.project.dir, [DOWN, UP]);
    expect(up).toMatch(/Тест › Продукт › ◐ Корзина/);
    const left = await shot(tree.project.dir, [LEFT]);
    expect(left).toMatch(/Тест › ○ Продукт/);
    const back = await shot(tree.project.dir, [LEFT, RIGHT]);
    expect(back).toMatch(/Продукт › (✓ Каталог|◐ Корзина)/);
  });

  it('shows what done means for the selection, and its sessions', async () => {
    const { tree } = sample();
    const frame = await shot(tree.project.dir, [LEFT]);
    expect(frame).toContain('готово, когда  сценарий работает');
    expect(frame).toContain('сессий нет');
  });

  it('opens everything about a node with Enter', async () => {
    const { tree } = sample();
    const frame = await shot(tree.project.dir, [ENTER], 30);
    expect(frame).toContain('Новая сессия');
    expect(frame).toContain('▶ Claude Code · план');
    expect(frame).toContain('✂ Разбить на шаги');
    expect(frame).toContain('$ Запустить проверку · true');
  });

  it('adds a node with a: a line at the bottom, no form', async () => {
    const { tree, cart } = sample();
    await shot(tree.project.dir, ['a', 'Оплата', ENTER]);
    const added = [...loadTree(tree.project.dir).nodes.values()].find((node) => node.title === 'Оплата');
    expect(added?.parent).toBe(cart.id);
  });

  it('opens the full form from the quick line with tab', async () => {
    const { tree } = sample();
    const frame = await shot(tree.project.dir, ['A', 'Скидки', TAB], 30);
    expect(frame).toContain('Новый узел');
    expect(frame).toContain('Скидки');
    expect(frame).toContain('Готово, когда');
  });

  it('renames with r', async () => {
    const { tree, cart } = sample();
    await shot(tree.project.dir, ['r', '\u0015', 'Корзина и оплата', ENTER]);
    expect(loadTree(tree.project.dir).nodes.get(cart.id)?.title).toBe('Корзина и оплата');
  });

  it('marks a branch as waiting with a reason; it leaves «Сейчас» and shows in «Ждёт»', async () => {
    const { tree, deploy } = sample();
    const frame = await shot(tree.project.dir, ['2', DOWN, 'w', 'нет сервера', ENTER, '3']);
    expect(loadTree(tree.project.dir).nodes.get(deploy.id)).toMatchObject({
      status: 'waiting',
      waiting: 'нет сервера',
    });
    expect(frame).toContain('3 Ждёт 1');
    expect(frame).toContain('нет сервера');
  });

  it('marks done with d, and undoes it with u', async () => {
    const first = sample();
    await shot(first.tree.project.dir, ['d']);
    expect(loadTree(first.tree.project.dir).nodes.get(first.cart.id)?.status).toBe('done');
    const second = sample();
    const frame = await shot(second.tree.project.dir, ['d', 'u']);
    expect(loadTree(second.tree.project.dir).nodes.get(second.cart.id)?.status).toBe('active');
    expect(frame).toContain('↶ отменено');
  });

  it('finds a node in the palette and jumps to it', async () => {
    const { tree } = sample();
    const frame = await shot(tree.project.dir, [':', 'публик', ENTER]);
    expect(frame).toMatch(/Тест › ○ Публикация/);
  });

  it('filters the tree with /', async () => {
    const { tree } = sample();
    const frame = await shot(tree.project.dir, ['/', 'корз']);
    expect(frame).toContain('Корзина');
    expect(frame).not.toContain('Публикация');
    expect(frame).toContain('/ корз');
  });

  it('switches to a list with v and to cards with z', async () => {
    const { tree } = sample();
    const list = await shot(tree.project.dir, ['v']);
    expect(list).toContain('список');
    expect(list).toMatch(/├──|└──/);
    const cards = await shot(tree.project.dir, ['z'], 30);
    expect(cards).toContain('карточки');
    expect(cards).toMatch(/[┏╭]/);
  });

  it('runs the check of a node with t and offers to move it on', async () => {
    const { tree, cart } = sample();
    const frame = await snapshot(tree.project.dir, { columns: 110, rows: 26, keys: ['t'], settle: 600 });
    expect(frame).toContain('✓ Проверка прошла');
    await snapshot(tree.project.dir, { columns: 110, rows: 26, keys: ['t', 'r'], settle: 600 });
    const node = loadTree(tree.project.dir).nodes.get(cart.id);
    expect(node?.body).toContain('проверка прошла');
  });

  it('shows the journal of the whole tree in «Журнал»', async () => {
    const { tree, deploy } = sample();
    setStatus(tree, deploy.id, 'waiting', { waiting: 'нет сервера', source: 'claude' });
    const frame = await shot(tree.project.dir, ['6']);
    expect(frame).toContain('Публикация');
    expect(frame).toContain('к работе → ждёт: нет сервера');
    expect(frame).toContain('claude');
  });

  it('shows what an agent gets with Enter then p', async () => {
    const { tree } = sample();
    const frame = await shot(tree.project.dir, [ENTER, 'p'], 30);
    expect(frame).toContain('Что получит агент · Корзина');
    expect(frame).toContain('Ты работаешь над узлом дерева проекта');
  });

  it('keeps a deep selection in view in a narrow, short terminal', async () => {
    const { tree, product } = sample();
    const child = addNode(tree, { title: 'Платёж', parent: product.id });
    const leaf = addNode(tree, { title: 'Проверка оплаты', parent: child.id, who: 'human' });
    const frame = await snapshot(tree.project.dir, {
      columns: 60,
      rows: 20,
      ui: { selected: leaf.id, expanded: [product.id, child.id] },
    });
    expect(frame).toContain('◇');
    expect(frame).toContain('Проверка оплаты');
    expect(frame.split('\n').length).toBeLessThanOrEqual(20);
  });

  it('closes dialogs with esc and leaves the tree as it was', async () => {
    const { tree, cart } = sample();
    await shot(tree.project.dir, ['s', ESC, 'e', ESC]);
    expect(loadTree(tree.project.dir).nodes.get(cart.id)?.status).toBe('active');
  });
});
