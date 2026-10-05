import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import stringWidth from 'string-width';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  capturePane: vi.fn(),
  sendToPane: vi.fn(),
  resizePane: vi.fn(),
  listPanes: vi.fn(),
  startPane: vi.fn(),
  closePane: vi.fn(),
}));
vi.mock('@antondanv/brainyard', async (original) => ({
  ...(await original<typeof import('@antondanv/brainyard')>()),
  ...backend,
  panesAvailable: () => true,
  paneMemory: async () => new Map(),
  liveSessions: async () => [],
  sessions: async () => [{ brain: 'claude', id: 'conversation' }],
}));

import { addNode, attachSession } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import type { Tree } from '../src/model/types.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { App } from '../src/tui/App.js';
import { hintAt, hintPress } from '../src/tui/components/controls.js';
import { TerminalInput } from '../src/tui/input.js';
import { defaultUi, type UiState } from '../src/tui/ui-state.js';
import { emptyTree } from './helpers.js';

class Output extends EventEmitter {
  isTTY = true;
  frame = '';
  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    super();
  }
  write = (text: string) => {
    // Bracketed paste switching on and off is a mode, not a frame.
    if (text !== '\u001b[?2004h' && text !== '\u001b[?2004l') this.frame = text;
    return true;
  };
}
class Input extends EventEmitter {
  isTTY = true;
  data: string | null = null;
  setRawMode() {}
  setEncoding() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
  read = () => {
    const data = this.data;
    this.data = null;
    return data;
  };
  write(data: string) {
    this.data = data;
    this.emit('readable');
  }
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(check: () => boolean) {
  const end = Date.now() + 8000;
  while (!check() && Date.now() < end) await pause(20);
  expect(check()).toBe(true);
}
// biome-ignore lint/suspicious/noControlCharactersInRegex: the frame is coloured with SGR sequences.
const plain = (frame: string) => frame.replace(/\u001b\[[0-9;:]*m/gu, '');

const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  resetSettings({ ...DEFAULTS, confirm: false, sleepAfter: 0, maxPanes: 0 });
  backend.listPanes.mockResolvedValue([]);
  backend.sendToPane.mockResolvedValue(undefined);
  backend.resizePane.mockResolvedValue(true);
  backend.capturePane.mockResolvedValue({
    lines: ['hello from the CLI'],
    width: 60,
    height: 12,
    historySize: 0,
    scrollOffset: 0,
    mouseTracking: false,
    alternate: false,
    cursor: { x: 0, y: 0, visible: true },
  });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  resetSettings({ ...DEFAULTS });
});

function mount(tree: Tree, ui: Partial<UiState>, options: { offline?: boolean; rows?: number } = {}) {
  const stdout = new Output(120, options.rows ?? 30);
  const stdin = new Input();
  const input = new TerminalInput(stdin as unknown as NodeJS.ReadStream);
  const instance = render(
    <App
      dir={tree.project.dir}
      ui={{ ...defaultUi(), ...ui }}
      persist={false}
      offline={options.offline ?? true}
      onAction={() => undefined}
    />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: input as unknown as NodeJS.ReadStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  cleanups.push(() => {
    instance.unmount();
    instance.cleanup();
    input.destroy();
  });
  const screen = () => plain(stdout.frame);
  /** The screen cell where `text` starts: the `nth` match, rows from the top. */
  const find = (text: string, nth = 0) => {
    let seen = 0;
    for (const [y, line] of screen().split('\n').entries()) {
      for (let at = line.indexOf(text); at >= 0; at = line.indexOf(text, at + 1)) {
        if (seen++ === nth) return { x: stringWidth(line.slice(0, at)), y };
      }
    }
    throw new Error(`not on screen: ${text}\n${screen()}`);
  };
  const click = async (text: string, options: { nth?: number; dx?: number; double?: boolean } = {}) => {
    const { x, y } = find(text, options.nth);
    const report = `\u001b[<0;${x + (options.dx ?? 0) + 1};${y + 1}M`;
    stdin.write(report);
    stdin.write(report.replace(/M$/, 'm'));
    if (options.double) {
      // A person's double click: React has drawn the first one by then.
      await pause(60);
      stdin.write(report);
    }
    await pause(80);
  };
  const type = async (data: string) => {
    stdin.write(data);
    await pause(80);
  };
  return { screen, find, click, type };
}

function sample() {
  const tree = emptyTree();
  const product = addNode(tree, { title: 'Продукт', status: 'active' });
  const cart = addNode(tree, { title: 'Корзина', parent: product.id, status: 'active' });
  const payment = addNode(tree, { title: 'Оплата', parent: product.id });
  const release = addNode(tree, { title: 'Публикация' });
  return { tree, product, cart, payment, release };
}

describe('mouse in the tree', () => {
  it('folds a deep branch by its visible marker beside a wide session pane', async () => {
    const tree = emptyTree();
    const expanded: string[] = [];
    let parent = 'root';
    for (let depth = 0; depth < 8; depth++) {
      parent = addNode(tree, { title: `Уровень ${depth}`, parent }).id;
      expanded.push(parent);
    }
    const branch = addNode(tree, { title: 'Оплата', parent, status: 'active' });
    addNode(tree, { title: 'Лист', parent: branch.id });
    attachSession(tree, branch.id, { brain: 'claude', id: 'conversation', mode: 'pane', pane: 'claude-deep' });
    backend.listPanes.mockResolvedValue([
      {
        pane: 'claude-deep',
        brain: 'claude',
        sessionId: 'conversation',
        cwd: tree.project.dir,
        attached: false,
        width: 60,
        height: 12,
      },
    ]);
    const app = mount(tree, { treeMode: 'list', selected: branch.id, expanded, split: 0.8 }, { offline: false });
    await until(() => app.screen().includes('hello from the CLI'));
    expect(app.screen()).not.toContain('Лист');
    await app.click('▸');
    expect(app.screen()).toContain('Лист');
    await pause(350);
    await app.click('▾', { nth: 8 });
    expect(app.screen()).not.toContain('Лист');
    await app.type(' ');
    expect(app.screen()).toContain('Лист');
  });

  it('selects a row, opens a branch by its marker and opens the actions by a double click', async () => {
    const { tree, release } = sample();
    const app = mount(tree, { treeMode: 'list', selected: release.id });
    await until(() => app.screen().includes('Публикация'));
    await app.click('Продукт', { nth: 0 });
    expect(app.screen()).toMatch(/Тест › ◐ Продукт/);
    expect(app.screen()).not.toContain('Корзина');
    await app.click('▸');
    await until(() => app.screen().includes('Корзина'));
    await app.click('Оплата', { double: true });
    await until(() => app.screen().includes('Новая сессия'));
    expect(app.screen()).toMatch(/Продукт › ○ Оплата/);
  });

  it('picks a menu item by a double click and ignores the tree while a dialog is open', async () => {
    const { tree, product, payment } = sample();
    const app = mount(tree, { treeMode: 'list', selected: payment.id, expanded: [product.id] });
    await until(() => app.screen().includes('Оплата'));
    await app.type('s');
    await until(() => app.screen().includes('Статус · Оплата'));
    await app.click('Публикация');
    expect(app.screen()).toContain('Статус · Оплата');
    await app.click('✓ готово');
    expect(app.screen()).toContain('Статус · Оплата');
    // Long enough for the next click not to be the second half of this one.
    await pause(450);
    await app.click('✓ готово', { double: true });
    await until(() => !app.screen().includes('Статус · Оплата'));
    expect(loadTree(tree.project.dir).nodes.get(payment.id)?.status).toBe('done');
  });

  it('selects a node in the graph and opens a closed branch by its ›N', async () => {
    const { tree, release } = sample();
    const app = mount(tree, { treeMode: 'graph', selected: release.id });
    await until(() => app.screen().includes('Продукт ›2'));
    await app.click('Продукт');
    expect(app.screen()).toMatch(/Тест › ◐ Продукт/);
    await app.click('›2');
    await until(() => app.screen().includes('Оплата'));
    expect(app.screen()).toMatch(/Продукт › ◐ Корзина/);
  });

  it('selects the root by a click on ◆ in the graph and the list, and opens its menu by a double click', async () => {
    const { tree, release } = sample();
    const graph = mount(tree, { treeMode: 'graph', selected: release.id });
    await until(() => graph.screen().includes('◆ Тест'));
    await graph.click('◆ Тест');
    await until(() => graph.screen().includes('корень дерева'));
    await pause(450);
    await graph.click('◆ Тест', { double: true });
    await until(() => graph.screen().includes('Документы проекта'));
    for (const cleanup of cleanups.splice(0)) cleanup();

    const list = mount(tree, { treeMode: 'list', selected: release.id });
    await until(() => list.screen().includes('◆ Тест'));
    await list.click('◆ Тест');
    await until(() => list.screen().includes('корень дерева'));
  });

  it('switches tabs and presses the keys of the hints, the header and a dialog footer', async () => {
    const { tree, release } = sample();
    // The help is tall: its footer needs the room.
    const app = mount(tree, { treeMode: 'list', selected: release.id }, { rows: 50 });
    await until(() => app.screen().includes('Публикация'));
    await app.click('2 Сейчас');
    await until(() => app.screen().includes('верхний уровень'));
    await app.click('1 Дерево');
    await until(() => !app.screen().includes('верхний уровень'));
    await app.click('a добавить');
    await until(() => app.screen().includes('＋'));
    await app.type('\u001b');
    await until(() => !app.screen().includes('＋'));
    await app.click('клавиши');
    await until(() => app.screen().includes('Ходить'));
    await app.click('esc закрыть');
    await until(() => !app.screen().includes('Ходить'));
  });
});

describe('mouse and a help taller than the screen', () => {
  it('closes the help by the same button in the header', async () => {
    const { tree, release } = sample();
    const app = mount(tree, { treeMode: 'list', selected: release.id });
    await until(() => app.screen().includes('Публикация'));
    await app.click('клавиши');
    await until(() => app.screen().includes('Ходить'));
    await pause(450);
    await app.click('клавиши');
    await until(() => !app.screen().includes('Ходить'));
  });
});

describe('mouse in a session panel', () => {
  it('presses the panel buttons without starting to type, and types after a click inside', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Pane work', status: 'active' });
    attachSession(tree, node.id, { brain: 'claude', id: 'conversation', pane: 'claude-one', mode: 'pane' });
    backend.listPanes.mockResolvedValue([
      {
        pane: 'claude-one',
        brain: 'claude',
        sessionId: 'conversation',
        cwd: tree.project.dir,
        attached: false,
        width: 60,
        height: 12,
      },
    ]);
    const app = mount(tree, { treeMode: 'list', selected: node.id }, { offline: false });
    await until(() => app.screen().includes('hello from the CLI'));
    await app.click('f печатать');
    await until(() => app.screen().includes('печатаешь в Claude Code'));
    // ⌃Q takes the place of f: a quicker click there would be the second half of a double click.
    await pause(450);
    await app.click('⌃Q к дереву');
    await until(() => !app.screen().includes('печатаешь в Claude Code'));
    await app.click('hello from the CLI');
    await until(() => app.screen().includes('печатаешь в Claude Code'));
    await app.click('Pane work', { nth: 0 });
    await until(() => !app.screen().includes('печатаешь в Claude Code'));
    await app.click('p скрыть');
    await until(() => !app.screen().includes('hello from the CLI'));
    expect(app.screen()).not.toContain('печатаешь в Claude Code');
    expect(backend.sendToPane).not.toHaveBeenCalled();
  });
});

describe('key hints as buttons', () => {
  it('finds the hint under the pointer and the key it types', () => {
    const hints = [{ key: '⏎', label: 'открыть' }, { label: 'буква — сразу' }, { key: '< >', press: ['<', '>'] }];
    // `⏎ открыть · буква — сразу · < >`
    expect(hintAt(hints, 0)?.hint).toBe(hints[0]);
    expect(hintAt(hints, 9)).toBeUndefined();
    expect(hintPress(hintAt(hints, 4)!.hint, 4)).toBe('\r');
    expect(hintPress(hintAt(hints, 14)!.hint, 0)).toBeUndefined();
    expect(hintAt(hints, 28)).toEqual({ hint: hints[2], x: 0 });
    expect(hintPress(hints[2]!, 0)).toBe('<');
    expect(hintPress(hints[2]!, 2)).toBe('>');
    expect(hintPress({ key: 'esc', label: 'отмена' }, 0)).toBe('\u001b');
    expect(hintPress({ key: '← →', label: 'к другому CLI' }, 0)).toBeUndefined();
    expect(hintPress({ key: 'tab/↓', press: '\t' }, 0)).toBe('\t');
  });

  it('types a pressed key into the input as if from the keyboard', async () => {
    const source = new PassThrough();
    Object.assign(source, { isTTY: true, setRawMode: () => undefined });
    const input = new TerminalInput(source as unknown as NodeJS.ReadStream);
    input.setEncoding('utf8');
    const keys: string[] = [];
    const events: string[] = [];
    input.on('data', (data: string) => keys.push(data));
    input.on('terminal-input', (event: { data: string }) => events.push(event.data));
    input.press('\u0011');
    await pause(10);
    expect(keys).toEqual(['\u0011']);
    expect(events).toEqual(['\u0011']);
    input.destroy();
    source.destroy();
  });
});
