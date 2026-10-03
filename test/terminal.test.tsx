import { EventEmitter } from 'node:events';
import { render } from 'ink';
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
  paneMemory: async () => new Map([['claude-one', 180 * 1024 * 1024]]),
  liveSessions: async () => [],
  // The pane's conversation is in the CLI's history, so it can sleep and wake.
  sessions: async () => [{ brain: 'claude', id: 'conversation' }],
}));

import { addNode, attachSession } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { type Action, App } from '../src/tui/App.js';
import { TerminalInput } from '../src/tui/input.js';
import { cursorLine, paneInput, screenLine } from '../src/tui/terminal.js';
import { defaultUi } from '../src/tui/ui-state.js';
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
    this.frame = text;
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
    this.emit('data', data);
  }
}
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(check: () => boolean) {
  // Generous: the whole suite runs in parallel, and these wait for real timers.
  const end = Date.now() + 8000;
  while (!check() && Date.now() < end) await pause(20);
  expect(check()).toBe(true);
}
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  resetSettings({ ...DEFAULTS, confirm: false, sleepAfter: 0, maxPanes: 0 });
  backend.sendToPane.mockResolvedValue(undefined);
  backend.resizePane.mockResolvedValue(true);
  backend.capturePane.mockResolvedValue({
    lines: ['hello from the CLI', '', 'colours'],
    width: 60,
    height: 12,
    cursor: { x: 0, y: 1, visible: true },
    historySize: 100,
    scrollOffset: 0,
    mouseTracking: false,
    alternate: false,
  });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  resetSettings({ ...DEFAULTS });
});

function mount(columns = 120, rows = 30, options: { nested?: boolean } = {}) {
  const tree = emptyTree();
  // Nested: a milestone above, so ← has somewhere to go.
  const milestone = options.nested ? addNode(tree, { title: 'Milestone', status: 'active' }) : undefined;
  if (milestone) addNode(tree, { title: 'Quiet sibling', status: 'todo', parent: milestone.id });
  const node = addNode(tree, { title: 'Pane work', status: 'active', ...(milestone ? { parent: milestone.id } : {}) });
  attachSession(tree, node.id, { brain: 'claude', id: 'conversation', pane: 'claude-one', mode: 'pane' });
  const pane = {
    pane: 'claude-one',
    brain: 'claude' as const,
    sessionId: 'conversation',
    cwd: tree.project.dir,
    attached: false,
    width: 60,
    height: 12,
  };
  backend.listPanes.mockResolvedValue([pane]);
  const stdout = new Output(columns, rows);
  const stdin = new Input();
  const input = new TerminalInput(stdin as unknown as NodeJS.ReadStream);
  const action = vi.fn<(action: Action) => void>();
  const instance = render(
    <App
      dir={tree.project.dir}
      ui={{ ...defaultUi(), selected: node.id, ...(milestone ? { expanded: [milestone.id] } : {}) }}
      persist={false}
      onAction={action}
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
  return { tree, node, pane, stdout, stdin, action };
}

describe('terminal panes in the tree', () => {
  it('captures only the selected pane and sends raw UTF-8, arrows, paste and Ctrl+C in order', async () => {
    const app = mount();
    backend.listPanes.mockResolvedValue([app.pane, { ...app.pane, pane: 'claude-unwatched', sessionId: 'other' }]);
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    expect(app.stdout.frame).toContain('180 МБ');
    app.stdin.write('а');
    await until(() => app.stdout.frame.includes('печатаешь в Claude Code'));
    const chunks = ['привет', 'й', 'о', 'л', 'ф', '\u001b[A', '\u001b[200~paste\ntext\u001b[201~', '\u0003', 'q'];
    for (const chunk of chunks) app.stdin.write(chunk);
    await until(() => backend.sendToPane.mock.calls.length === chunks.length);
    expect(backend.sendToPane.mock.calls.map((call) => call[1])).toEqual(chunks);
    expect(app.action).not.toHaveBeenCalled();
    app.stdin.write('\u0011');
    await until(() => app.stdout.frame.includes('f печатать'));
    // The tree takes keys again once its handlers resubscribe, a moment after the frame.
    await pause(50);
    app.stdin.write('p');
    await until(() => !app.stdout.frame.includes('hello from the CLI'));
    await pause(30);
    backend.capturePane.mockClear();
    await pause(180);
    expect(backend.capturePane).not.toHaveBeenCalled();
    app.stdin.write('q');
    await until(() => app.action.mock.calls.length === 1);
    expect(app.action).toHaveBeenCalledWith({ type: 'quit' });
    expect(backend.closePane).not.toHaveBeenCalled();
    expect(loadTree(app.tree.project.dir).nodes.get(app.node.id)!.sessions[0]!.id).toBe('conversation');
  });

  it('the node menu shows a live pane to type into, or hands it over full screen, without asking', async () => {
    resetSettings({ ...DEFAULTS, confirm: true, sleepAfter: 0, maxPanes: 0 });
    const app = mount();
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    app.stdin.write('\r');
    await until(() => app.stdout.frame.includes('☾ Усыпить'));
    expect(app.stdout.frame).toContain('▣ в панели');
    app.stdin.write('\r');
    await until(() => app.stdout.frame.includes('печатаешь в Claude Code'));
    expect(app.stdout.frame).not.toContain('Продолжить сессию?');
    app.stdin.write('\u0011');
    await until(() => app.stdout.frame.includes('f печатать'));
    app.stdin.write('\r');
    await until(() => app.stdout.frame.includes('☾ Усыпить'));
    app.stdin.write('F');
    await until(() => app.action.mock.calls.length === 1);
    expect(app.action).toHaveBeenCalledWith({ type: 'attach-pane', pane: 'claude-one' });
    expect(backend.startPane).not.toHaveBeenCalled();
  });

  it('F, x and the header: full screen, sleep and what the panes cost, from the tree', async () => {
    const app = mount();
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    expect(app.stdout.frame).toContain('▣ 1 сессия · 180 МБ');
    expect(app.stdout.frame).toContain('в панели · 180 МБ');
    backend.closePane.mockImplementation(async () => {
      backend.listPanes.mockResolvedValue([]);
      return true;
    });
    app.stdin.write('x');
    await until(() => app.stdout.frame.includes('сессия спит — освободил 180 МБ · f — разбудить'));
    expect(backend.closePane).toHaveBeenCalledWith('claude-one');
  });

  it('puts a session to sleep from Sessions and wakes the same conversation', async () => {
    const app = mount();
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    app.stdin.write('5');
    await pause(60);
    backend.closePane.mockImplementation(async () => {
      backend.listPanes.mockResolvedValue([]);
      return true;
    });
    app.stdin.write('x');
    await until(() => app.stdout.frame.includes('спит'));
    expect(backend.closePane).toHaveBeenCalledWith('claude-one');
    backend.startPane.mockImplementation(async () => {
      backend.listPanes.mockResolvedValue([{ ...app.pane, pane: 'claude-woken' }]);
      return { pane: 'claude-woken', sessionId: 'conversation', startedAt: new Date().toISOString(), warnings: [] };
    });
    app.stdin.write('\r');
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    expect(backend.startPane.mock.lastCall?.[0]).toMatchObject({ resume: 'conversation' });
    expect(loadTree(app.tree.project.dir).nodes.get(app.node.id)!.sessions).toMatchObject([
      { id: 'conversation', pane: 'claude-woken' },
    ]);
  });

  it('fits the terminal panel inside a narrow screen', async () => {
    const app = mount(60, 20);
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    expect(app.stdout.frame.split('\n').length).toBeLessThanOrEqual(20);
    expect(backend.resizePane.mock.lastCall?.slice(1)).toEqual([57, 9]);
  });

  it('⇧← ⇧→ move the border of the pane and keep the selection on the node', async () => {
    const app = mount(120, 30, { nested: true });
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    expect(app.stdout.frame).toContain('⇧← ⇧→ ширина');
    const width = () => backend.resizePane.mock.lastCall?.[1];
    expect(width()).toBe(67);
    app.stdin.write('\u001b[1;2D');
    await until(() => width() === 76);
    app.stdin.write('\u001b[1;2C');
    app.stdin.write('\u001b[1;2C');
    await until(() => width() === 57);
    expect(app.stdout.frame).toContain('Milestone › ◐ Pane work');
    // The keys it had keep working; on the Russian layout too.
    app.stdin.write('Б');
    await until(() => width() === 67);
    app.stdin.write('>');
    await until(() => width() === 57);
    // A node without a session says so instead of walking away.
    app.stdin.write('\u001b[B');
    await until(() => app.stdout.frame.includes('◯ Quiet sibling') || !app.stdout.frame.includes('hello from the CLI'));
    app.stdin.write('\u001b[1;2D');
    await until(() => app.stdout.frame.includes('у узла нет живой сессии'));
    expect(app.stdout.frame).toContain('Milestone › ○ Quiet sibling');
  });

  it('clicks on ⇧← in one place keep widening: the button stays under the pointer', async () => {
    const app = mount(120, 30, { nested: true });
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strip colours to find the button.
    const lines = app.stdout.frame.replace(/\u001b\[[0-9;]*m/gu, '').split('\n');
    const y = lines.findIndex((line) => line.includes('⇧← ⇧→ ширина'));
    const x = [...lines[y]!].indexOf('⇧');
    const click = () => app.stdin.write(`\u001b[<0;${x + 1};${y + 1}M\u001b[<0;${x + 1};${y + 1}m`);
    click();
    await until(() => backend.resizePane.mock.lastCall?.[1] === 76);
    // Past the double-click window: two separate presses.
    await pause(450);
    click();
    await until(() => backend.resizePane.mock.lastCall?.[1] === 86);
    expect(app.stdout.frame).toContain('hello from the CLI');
    expect(app.stdout.frame).toContain('Milestone › ◐ Pane work');
    expect(backend.closePane).not.toHaveBeenCalled();
  });

  function history() {
    backend.capturePane.mockImplementation(async (_pane, options) => {
      const scrollOffset = Math.min(100, options?.scroll ?? 0);
      return {
        lines: [scrollOffset ? `old output ${scrollOffset}` : 'hello from the CLI'],
        width: 68,
        height: 19,
        historySize: 100,
        scrollOffset,
        mouseTracking: false,
        alternate: false,
        cursor: { x: 0, y: 1, visible: true },
      };
    });
  }

  it('scrolls only inside the panel without requiring keyboard focus', async () => {
    history();
    const app = mount();
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    app.stdin.write('\u001b[<64;10;10M'); // tree
    app.stdin.write('\u001b[<64;80;1M'); // header
    await pause(170);
    expect(app.stdout.frame).not.toContain('old output');
    app.stdin.write('\u001b[<64;80;10M');
    await until(() => app.stdout.frame.includes('old output 3'));
    expect(app.stdout.frame).toContain('история ↑3');
    expect(backend.sendToPane).not.toHaveBeenCalled();
    app.stdin.write('\u001b[<65;80;10M');
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    expect(app.action).not.toHaveBeenCalled();
  });

  it('pages through history, returns with End or typing, and preserves pasted escape sequences', async () => {
    history();
    const app = mount();
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    app.stdin.write('f');
    await until(() => app.stdout.frame.includes('печатаешь в Claude Code'));
    app.stdin.write('\u001b[5~');
    await until(() => app.stdout.frame.includes('old output 18'));
    app.stdin.write('\u001b[H');
    await until(() => app.stdout.frame.includes('old output 100'));
    app.stdin.write('\u001b[6~');
    await until(() => app.stdout.frame.includes('old output 82'));
    app.stdin.write('\u001b[F');
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    expect(backend.sendToPane).not.toHaveBeenCalled();
    app.stdin.write('\u001b[5~');
    await until(() => app.stdout.frame.includes('old output 18'));
    app.stdin.write('hello');
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    const paste = '\u001b[200~literal \u001b[5~ \u001b[<64;80;10M\u001b[201~';
    app.stdin.write(paste);
    await until(() => backend.sendToPane.mock.calls.length === 2);
    expect(backend.sendToPane.mock.calls.map((call) => call[1])).toEqual(['hello', paste]);
  });

  it('lets a mouse-aware CLI scroll its own screen with coordinates relative to the panel', async () => {
    backend.capturePane.mockResolvedValue({
      lines: ['hello from the CLI'],
      width: 68,
      height: 19,
      historySize: 0,
      scrollOffset: 0,
      mouseTracking: true,
      mouseSgr: true,
      alternate: true,
      cursor: { x: 0, y: 0, visible: true },
    });
    const app = mount();
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    app.stdin.write('\u001b[<64;80;10M');
    await until(() => backend.sendToPane.mock.calls.length === 1);
    // Panel starts at column 51, row 6; its content begins one column and two rows in.
    expect(backend.sendToPane.mock.lastCall?.[1]).toBe('\u001b[<64;29;3M');
    app.stdin.write('f');
    await until(() => app.stdout.frame.includes('печатаешь в Claude Code'));
    app.stdin.write('\u001b[5~');
    await until(() => backend.sendToPane.mock.calls.length === 2);
    expect(backend.sendToPane.mock.lastCall?.[1]).toBe('\u001b[5~');
  });

  it('keeps Ctrl+Q out of the CLI, including a coalesced input chunk', () => {
    expect(paneInput('hello\u0011q')).toEqual({ data: 'hello', leave: true });
    expect(paneInput('\u001b[A')).toEqual({ data: '\u001b[A', leave: false });
  });

  it('places the cursor at terminal columns while preserving colour and wide characters', () => {
    expect(cursorLine('\u001b[31m你abc\u001b[0m', 2)).toBe('\u001b[31m你\u001b[7ma\u001b[27mbc\u001b[0m');
    expect(cursorLine('a', 3)).toBe('a  \u001b[7m \u001b[27m');
  });

  it('keeps hyperlink text and colours without passing cursor movement to the host terminal', () => {
    expect(
      screenLine('\u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\\u001b[31mred\u001b[0m\u001b[2J'),
    ).toBe('link\u001b[31mred\u001b[0m');
  });
});
