import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addNode, setStatus } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { childrenOf } from '../src/model/tree.js';
import { Menu } from '../src/tui/components/controls.js';
import { ConfirmDelete, ConfirmLaunch, CriterionDialog, StepsDialog, TextViewer } from '../src/tui/dialogs.js';
import { snapshot } from '../src/tui/snapshot.js';
import { emptyTree } from './helpers.js';

afterEach(cleanup);

const pause = () => new Promise((done) => setTimeout(done, 50));
async function press(app: ReturnType<typeof render>, ...keys: string[]) {
  await pause();
  for (const key of keys) {
    app.stdin.write(key);
    await pause();
  }
}

function sample() {
  const tree = emptyTree();
  const branch = addNode(tree, { title: 'Продукт' });
  const first = addNode(tree, { title: 'Каталог', parent: branch.id });
  const second = addNode(tree, { title: 'Корзина', parent: branch.id, status: 'active' });
  addNode(tree, { title: 'Публикация' });
  return { tree, branch, first, second };
}

describe('Russian keyboard shortcuts', () => {
  it.each([
    { setup: [], latin: ['k'], russian: ['л'] },
    { setup: [], latin: ['j'], russian: ['о'] },
    { setup: [], latin: ['h', 'l'], russian: ['р', 'д'] },
    { setup: ['v'], latin: ['k'], russian: ['л'] },
    { setup: ['2'], latin: ['j', 'k'], russian: ['о', 'л'] },
  ])('navigates with $russian like $latin after $setup', async ({ setup, latin, russian }) => {
    const { tree } = sample();
    const options = { columns: 100, rows: 30 };
    const expected = await snapshot(tree.project.dir, { ...options, keys: [...setup, ...latin] });
    expect(await snapshot(tree.project.dir, { ...options, keys: [...setup, ...russian] })).toBe(expected);
  });

  it('distinguishes adding a child with ф from adding a sibling with Ф', async () => {
    const { tree, branch, second } = sample();
    await snapshot(tree.project.dir, { keys: ['ф', ...'фйолд', '\r'] });
    await snapshot(tree.project.dir, {
      ui: { selected: second.id, expanded: [branch.id] },
      keys: ['Ф', 'Сосед', '\r'],
    });
    const nodes = [...loadTree(tree.project.dir).nodes.values()];
    expect(nodes.find((node) => node.title === 'фйолд')?.parent).toBe(second.id);
    expect(nodes.find((node) => node.title === 'Сосед')?.parent).toBe(branch.id);
  });

  it('reorders siblings with uppercase Л and О', async () => {
    const { tree, branch, first, second } = sample();
    setStatus(tree, second.id, 'todo');
    const options = { ui: { selected: second.id, expanded: [branch.id] } };
    await snapshot(tree.project.dir, { ...options, keys: ['Л'] });
    expect(childrenOf(loadTree(tree.project.dir), branch.id).map((node) => node.id)).toEqual([second.id, first.id]);
    await snapshot(tree.project.dir, { ...options, keys: ['О'] });
    expect(childrenOf(loadTree(tree.project.dir), branch.id).map((node) => node.id)).toEqual([first.id, second.id]);
  });

  it('keeps individual Russian letters in rename, forms, filter and palette', async () => {
    const { tree, branch, second } = sample();
    await snapshot(tree.project.dir, { keys: ['к', '\u0015', ...'фйолд', '\r'] });
    expect(loadTree(tree.project.dir).nodes.get(second.id)?.title).toBe('фйолд');
    await snapshot(tree.project.dir, {
      ui: { selected: second.id, expanded: [branch.id] },
      keys: ['у', '\u0015', ...'Фйолд', '\r'],
    });
    expect(loadTree(tree.project.dir).nodes.get(second.id)?.title).toBe('Фйолд');
    const filter = await snapshot(tree.project.dir, { keys: ['/', ...'йол'] });
    expect(filter).toContain('/ йол');
    expect(filter).toContain('Фйолд');
    expect(filter).not.toContain('Каталог');
    const palette = await snapshot(tree.project.dir, { keys: ['Ж', ...'йол', '\r'] });
    expect(palette).toContain('◐ Фйолд');
    expect(palette).not.toContain('Найти узел или действие');
  });

  it('picks a status with ы then к, and changes the view with м in either interface language', async () => {
    const { tree, second } = sample();
    await snapshot(tree.project.dir, { keys: ['ы', 'к'] });
    expect(loadTree(tree.project.dir).nodes.get(second.id)?.status).toBe('review');
    for (const lang of ['ru', 'en'] as const) {
      const frame = await snapshot(tree.project.dir, { keys: ['м'], settings: { lang } });
      expect(frame).toContain(lang === 'ru' ? 'список' : 'list');
    }
  });

  it('navigates menus and chooses uppercase hotkeys without changing text labels', async () => {
    const onPick = vi.fn();
    const app = render(
      <Menu
        active
        items={[
          { key: 'first', label: 'Первый', hotkey: 'a' },
          { key: 'second', label: 'Второй', hotkey: 'F' },
        ]}
        onPick={onPick}
        onCancel={vi.fn()}
      />,
    );
    await press(app, 'о');
    expect(app.lastFrame()).toContain('❯ Второй');
    await press(app, 'л');
    expect(app.lastFrame()).toContain('❯ Первый');
    await press(app, 'А');
    expect(onPick).toHaveBeenCalledExactlyOnceWith('second');
  });

  it('scrolls readers with о/л and closes with й', async () => {
    const onClose = vi.fn();
    const app = render(
      <TextViewer
        title="Текст"
        text={Array.from({ length: 12 }, (_, i) => `строка ${i}`).join('\n')}
        width={60}
        height={11}
        onClose={onClose}
      />,
    );
    await press(app, 'о');
    expect(app.lastFrame()).not.toContain('строка 0');
    expect(app.lastFrame()).toContain('строка 5');
    await press(app, 'л');
    expect(app.lastFrame()).toContain('строка 0');
    await press(app, 'й');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([
    { input: 'н', count: 0, confirmed: false },
    { input: 'д', count: 0, confirmed: false },
    { input: 'г', count: 1, confirmed: false },
    { input: 'п', count: 1, confirmed: false },
    { input: 'ф', count: 1, confirmed: true },
    { input: 'в', count: 1, confirmed: true },
  ])('confirms deletion with $input, retaining existing Russian answers', async ({ input, count, confirmed }) => {
    const { second } = sample();
    const onConfirm = vi.fn();
    const app = render(
      <ConfirmDelete node={second} count={count} width={80} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    await press(app, input);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(confirmed);
  });

  it('configures a launch with щ and cancels with т', async () => {
    const onConfigure = vi.fn();
    const onCancel = vi.fn();
    const app = render(
      <ConfirmLaunch
        title="Запуск"
        rows={[]}
        width={80}
        configurable
        onConfirm={vi.fn()}
        onConfigure={onConfigure}
        onCancel={onCancel}
        onNever={vi.fn()}
      />,
    );
    await press(app, 'щ');
    expect(onConfigure).toHaveBeenCalledOnce();
    app.unmount();
    const deletion = render(
      <ConfirmDelete node={sample().second} count={0} width={80} onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    await press(deletion, 'т');
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('selects proposed steps with о and toggles all with ф', async () => {
    const { second } = sample();
    const steps = [{ title: 'Первый' }, { title: 'Второй' }];
    const onAccept = vi.fn();
    const app = render(
      <StepsDialog node={second} steps={steps} width={80} height={30} onAccept={onAccept} onCancel={vi.fn()} />,
    );
    await press(app, 'ф', 'о', ' ', '\r');
    expect(onAccept).toHaveBeenCalledExactlyOnceWith([steps[1]]);
  });

  it('edits a proposed criterion with у', async () => {
    const onEdit = vi.fn();
    const app = render(
      <CriterionDialog
        node={sample().second}
        doneWhen="Можно запустить"
        width={80}
        onAccept={vi.fn()}
        onEdit={onEdit}
        onCancel={vi.fn()}
      />,
    );
    await press(app, 'у');
    expect(onEdit).toHaveBeenCalledOnce();
  });
});
