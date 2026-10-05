import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TREE_DOC } from '../src/docs.js';
import { setLang } from '../src/i18n/i18n.js';
import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { App } from '../src/tui/App.js';
import { defaultUi, type UiState } from '../src/tui/ui-state.js';
import { emptyTree } from './helpers.js';

const LEFT = '\u001b[D';
const RIGHT = '\u001b[C';
const UP = '\u001b[A';
const ESC = '\u001b';
const pause = (ms = 60) => new Promise((done) => setTimeout(done, ms));

beforeEach(() => {
  resetSettings({ ...DEFAULTS, animation: false, marquee: false });
  setLang('ru');
});
afterEach(() => cleanup());

function sample() {
  const tree = emptyTree();
  writeFileSync(join(tree.project.dir, 'README.md'), '# Тест\n\nо проекте\n');
  const product = addNode(tree, { title: 'Продукт', status: 'active' });
  addNode(tree, { title: 'Корзина', parent: product.id });
  const release = addNode(tree, { title: 'Публикация' });
  return { tree, product, release };
}

function mount(tree: ReturnType<typeof sample>['tree'], ui: Partial<UiState>) {
  const app = render(
    <App dir={tree.project.dir} ui={{ ...defaultUi(), ...ui }} offline persist={false} onAction={() => {}} />,
  );
  const waitFor = (text: string) =>
    vi.waitFor(() => expect(app.lastFrame()).toContain(text), { timeout: 5000, interval: 20 });
  const key = async (data: string) => {
    app.stdin.write(data);
    await pause();
  };
  return { app, waitFor, key };
}

describe('the root of the tree', () => {
  it('is reached with ← in the graph, has no node actions, and ⏎ opens the project menu and its documents', async () => {
    const { tree, product } = sample();
    const { app, waitFor, key } = mount(tree, { selected: product.id, treeMode: 'graph' });
    await waitFor('Продукт');
    await key(LEFT);
    await waitFor('корень дерева');
    expect(app.lastFrame()).toContain('P документы');
    // d marks a node done; on the root there is no node to mark.
    await key('d');
    expect(loadTree(tree.project.dir).nodes.get(product.id)?.status).toBe('active');
    await key(RIGHT);
    await vi.waitFor(() => expect(app.lastFrame()).not.toContain('корень дерева'));
    await key(LEFT);
    await waitFor('корень дерева');
    await key('\r');
    await waitFor('Документы проекта');
    expect(app.lastFrame()).toContain('Цель, правила и решения');
    await key('P');
    await waitFor('2 .md проекта');
    expect(app.lastFrame()).toContain('README.md');
    await key(ESC);
    await vi.waitFor(() => expect(app.lastFrame()).not.toContain('.md проекта'));
  });

  it('heads the list: ↑ from the first row and ← from the top level select it, → goes back down', async () => {
    const { tree, product, release } = sample();
    const { app, waitFor, key } = mount(tree, { selected: product.id, treeMode: 'list' });
    await waitFor('◆ Тест');
    await key(UP);
    await waitFor('корень дерева');
    await key(RIGHT);
    await vi.waitFor(() => expect(app.lastFrame()).toMatch(/Тест › ◐ Продукт/));
    await key('j');
    await vi.waitFor(() => expect(app.lastFrame()).toMatch(/Тест › ○ Публикация/));
    expect(release.parent).toBe('root');
    await key(LEFT);
    await waitFor('корень дерева');
  });

  it('opens the documents from any node with P, and with З in the Russian layout', async () => {
    const { tree, release } = sample();
    const { app, waitFor, key } = mount(tree, { selected: release.id });
    await waitFor('Публикация');
    await key('З');
    await waitFor('2 .md проекта');
    await key(ESC);
    await vi.waitFor(() => expect(app.lastFrame()).not.toContain('.md проекта'));
    await key('P');
    await waitFor('2 .md проекта');
  });

  it('edits tree.md from the menu, and u takes the edit back', async () => {
    const { tree, product } = sample();
    const before = readFileSync(join(tree.project.dir, TREE_DOC), 'utf8');
    const { app, waitFor, key } = mount(tree, { selected: product.id, treeMode: 'graph' });
    await waitFor('Продукт');
    await key(LEFT);
    await key('\r');
    await waitFor('Цель, правила и решения');
    await key('e');
    await waitFor(`✎ ${TREE_DOC}`);
    await key('\u001b[1;5F');
    await key('Новое решение');
    await key('\u0013');
    await waitFor('сохранено');
    expect(readFileSync(join(tree.project.dir, TREE_DOC), 'utf8')).toContain('Новое решение');
    expect(loadTree(tree.project.dir).project.body).toContain('Новое решение');
    await key(ESC);
    await waitFor('изменён');
    await key(ESC);
    await waitFor('.md проекта');
    await key(ESC);
    await vi.waitFor(() => expect(app.lastFrame()).not.toContain('.md проекта'));
    await key('u');
    await waitFor('отменено: правка .tree/tree.md');
    expect(readFileSync(join(tree.project.dir, TREE_DOC), 'utf8')).toBe(before);
  });
});
