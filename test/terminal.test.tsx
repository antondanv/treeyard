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
  liveSessions: vi.fn(),
  sessions: vi.fn(),
  stopSession: vi.fn(),
}));
// Never the clipboard of the machine the tests run on.
const clipboard = vi.hoisted(() => ({ copyText: vi.fn(() => true) }));
vi.mock('../src/model/clipboard.js', async (original) => ({
  ...(await original<typeof import('../src/model/clipboard.js')>()),
  copyText: clipboard.copyText,
}));
vi.mock('@antondanv/brainyard', async (original) => ({
  ...(await original<typeof import('@antondanv/brainyard')>()),
  ...backend,
  panesAvailable: () => true,
  paneMemory: async () => new Map([['claude-one', 180 * 1024 * 1024]]),
}));

import { addNode, attachSession, setStatus, updateNode } from '../src/model/ops.js';
import * as store from '../src/model/store.js';
import { loadTree } from '../src/model/store.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { type Action, App } from '../src/tui/App.js';
import { TerminalInput } from '../src/tui/input.js';
import { CAPTURE_MS, cursorLine, paneInput, screenLine } from '../src/tui/terminal.js';
import { defaultUi } from '../src/tui/ui-state.js';
import { emptyTree } from './helpers.js';

class Output extends EventEmitter {
  isTTY = true;
  frame = '';
  writes = 0;
  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    super();
  }
  write = (text: string) => {
    this.writes++;
    // Bracketed paste switching is not a picture: the last frame stays the frame.
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
    this.emit('data', data);
  }
}
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(check: () => boolean, ms = 8000) {
  // Generous: the whole suite runs in parallel, and these wait for real timers.
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await pause(20);
  expect(check()).toBe(true);
}
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  resetSettings({ ...DEFAULTS, confirm: false, sleepAfter: 0, maxPanes: 0 });
  backend.sendToPane.mockResolvedValue(undefined);
  backend.resizePane.mockResolvedValue(true);
  backend.liveSessions.mockResolvedValue([]);
  // The conversation is in the CLI's history, so it can sleep and wake.
  backend.sessions.mockResolvedValue([{ brain: 'claude', id: 'conversation', interactive: true }]);
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

function mount(columns = 120, rows = 30, options: { nested?: boolean; background?: boolean; loose?: boolean } = {}) {
  const tree = emptyTree();
  // Nested: a milestone above, so ← has somewhere to go.
  const milestone = options.nested ? addNode(tree, { title: 'Milestone', status: 'active' }) : undefined;
  if (milestone) addNode(tree, { title: 'Quiet sibling', status: 'todo', parent: milestone.id });
  const node = addNode(tree, { title: 'Pane work', status: 'active', ...(milestone ? { parent: milestone.id } : {}) });
  if (!options.loose)
    attachSession(tree, node.id, {
      brain: 'claude',
      id: 'conversation',
      ...(options.background ? { mode: 'background' } : { pane: 'claude-one', mode: 'pane' }),
    });
  const pane = {
    pane: 'claude-one',
    brain: 'claude' as const,
    sessionId: 'conversation',
    cwd: tree.project.dir,
    attached: false,
    width: 60,
    height: 12,
  };
  backend.listPanes.mockResolvedValue(options.background ? [] : [pane]);
  if (options.background) {
    const session = {
      brain: 'claude',
      id: 'conversation',
      cwd: tree.project.dir,
      title: 'Background work',
      background: true,
      interactive: true,
    };
    backend.sessions.mockResolvedValue([session]);
    backend.liveSessions.mockResolvedValue([{ ...session, live: { kind: 'background', status: 'busy' } }]);
  }
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
  it('does not animate this tree for a busy agent in another project', async () => {
    backend.liveSessions.mockResolvedValue([
      { brain: 'claude', id: 'foreign', cwd: '/another-project', live: { status: 'busy' } },
    ]);
    const app = mount();
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    await pause(150);
    const writes = app.stdout.writes;
    await pause(350);
    expect(app.stdout.writes).toBe(writes);
  });

  it('without focus keeps drawing what changed, slowly and without animation', async () => {
    backend.liveSessions.mockResolvedValue([{ brain: 'claude', id: 'conversation', live: { status: 'busy' } }]);
    const app = mount();
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    app.stdin.write('f');
    await until(() => app.stdout.frame.includes('печатаешь в Claude Code'));
    app.stdin.write('\u001b[O');
    await pause(150);
    // Nothing changes: no frames and no spinner while the terminal is away.
    const quiet = app.stdout.writes;
    await pause(1200);
    expect(app.stdout.writes).toBe(quiet);
    // The pane's output reaches the screen without focus, within the background interval.
    backend.capturePane.mockResolvedValue({
      lines: ['changed while hidden'],
      width: 60,
      height: 12,
      cursor: { x: 0, y: 0, visible: false },
      historySize: 100,
      scrollOffset: 0,
    });
    await until(() => app.stdout.frame.includes('changed while hidden'), 4000);
    // A node edited by an agent does too.
    updateNode(app.tree, app.node.id, { title: 'Changed node' });
    await until(() => app.stdout.frame.includes('Changed node'), 4000);
    const discoveries = backend.liveSessions.mock.calls.length;
    await pause(3300);
    expect(backend.liveSessions.mock.calls.length).toBeGreaterThan(discoveries);
    expect(backend.closePane).not.toHaveBeenCalled();
    // Coming back shows the CLI's current screen at once, not after the background interval.
    backend.capturePane.mockResolvedValue({
      lines: ['changed again'],
      width: 60,
      height: 12,
      cursor: { x: 0, y: 0, visible: false },
      historySize: 100,
      scrollOffset: 0,
    });
    app.stdin.write('\u001b[I');
    await until(() => app.stdout.frame.includes('changed again'), 700);
    expect(backend.sendToPane).not.toHaveBeenCalled();
    app.stdin.write('x');
    await until(() => backend.sendToPane.mock.calls.length === 1);
    expect(backend.sendToPane).toHaveBeenCalledWith('claude-one', 'x');
  });

  it('shows a new status of a node without focus', async () => {
    const app = mount();
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    app.stdin.write('\u001b[O');
    await pause(150);
    setStatus(app.tree, app.node.id, 'review');
    await until(() => app.stdout.frame.includes('на проверке · '), 4000);
  });

  it('animates without rereading the tree and still notices external edits', async () => {
    const reads = vi.spyOn(store, 'loadTree');
    try {
      const app = mount(100, 30, { background: true });
      await until(() => app.stdout.frame.includes('работает агентов:'));
      const loaded = reads.mock.calls.length;
      await pause(350);
      expect(reads.mock.calls.length).toBe(loaded);
      // An agent writes a separate Tree instance while this App is animating.
      updateNode(app.tree, app.node.id, { title: 'External change' });
      await until(() => app.stdout.frame.includes('External change'));
      expect(reads.mock.calls.length).toBeGreaterThan(loaded);
    } finally {
      reads.mockRestore();
    }
  });

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
    // The tree takes keys again once its handlers resubscribe, a moment after the frame.
    await pause(50);
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

  it.each([false, true])('sleeps a background session in Sessions at 100×30 (unlinked: %s)', async (loose) => {
    const app = mount(100, 30, { background: true, loose });
    app.stdin.write('5');
    await until(() => app.stdout.frame.includes('Background work') && app.stdout.frame.includes('1 работает'));
    expect(app.stdout.frame).toContain('x усыпить');
    backend.stopSession.mockImplementation(async () => {
      backend.liveSessions.mockResolvedValue([]);
      return 'stopped';
    });
    app.stdin.write('x');
    await until(() => app.stdout.frame.includes('сессия спит · ⏎ — продолжить'));
    expect(app.stdout.frame).toContain('☾');
    expect(app.stdout.frame.split('\n').slice(5).join('\n')).not.toContain('работает');
    expect(app.stdout.frame.split('\n').length).toBeLessThanOrEqual(30);
    expect(backend.stopSession).toHaveBeenCalledWith({
      brain: 'claude',
      sessionId: 'conversation',
      cwd: app.tree.project.dir,
    });
    expect(backend.closePane).not.toHaveBeenCalled();
    expect(loadTree(app.tree.project.dir).nodes.get(app.node.id)!.sessions).toHaveLength(loose ? 0 : 1);
    app.stdin.write('\r');
    await until(() => app.action.mock.calls.length === 1);
    expect(app.action.mock.lastCall?.[0]).toMatchObject(
      loose
        ? { type: 'resume-loose', session: { id: 'conversation' } }
        : { type: 'resume', node: app.node.id, ref: { id: 'conversation', mode: 'background' } },
    );
  });

  it('keeps a background session live when the CLI refuses to stop it', async () => {
    const app = mount(100, 30, { background: true });
    app.stdin.write('5');
    await until(() => app.stdout.frame.includes('Background work') && app.stdout.frame.includes('1 работает'));
    backend.stopSession.mockRejectedValue(new Error('stop failed'));
    app.stdin.write('x');
    await until(() => app.stdout.frame.includes('stop failed'));
    expect(app.stdout.frame).toContain('1 работает');
    expect(app.stdout.frame).not.toContain('сессия спит');
  });

  it('keeps the selection on the sleeping conversation when other sessions move ahead of it', async () => {
    const app = mount(100, 30, { background: true });
    app.stdin.write('5');
    await until(() => app.stdout.frame.includes('1 работает'));
    const other = {
      brain: 'claude',
      id: 'other',
      title: 'Other background',
      interactive: true,
      background: true,
      live: { kind: 'background', status: 'busy' },
    };
    backend.stopSession.mockImplementation(async () => {
      backend.liveSessions.mockResolvedValue([other]);
      backend.sessions.mockResolvedValue([
        { ...other, id: 'conversation', title: 'Background work', live: undefined },
        other,
      ]);
      return 'stopped';
    });
    app.stdin.write('x');
    await until(() => app.stdout.frame.includes('сессия спит · ⏎ — продолжить'));
    expect(app.stdout.frame).toContain('❯☾ Background work');
    expect(app.stdout.frame).toContain('Other background');
    app.stdin.write('\r');
    await until(() => app.action.mock.calls.length === 1);
    expect(app.action.mock.lastCall?.[0]).toMatchObject({ type: 'resume', ref: { id: 'conversation' } });
  });

  it('sleeps the selected pane even when it is hidden in Sessions', async () => {
    const app = mount();
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    app.stdin.write('5');
    await pause(60);
    app.stdin.write('p');
    await until(() => !app.stdout.frame.includes('hello from the CLI'));
    backend.closePane.mockImplementation(async () => {
      backend.listPanes.mockResolvedValue([]);
      return true;
    });
    app.stdin.write('x');
    await until(() => app.stdout.frame.includes('сессия спит'));
    expect(backend.closePane).toHaveBeenCalledWith('claude-one');
    expect(backend.stopSession).not.toHaveBeenCalled();
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

  describe('without waiting for the next idle read', () => {
    const idle = CAPTURE_MS.idle;
    // An idle read that never comes within a test: whatever shows up was read because of the key.
    beforeEach(() => {
      CAPTURE_MS.idle = 60_000;
    });
    afterEach(() => {
      CAPTURE_MS.idle = idle;
    });

    it('a typed key brings its echo at once, and a late echo within the moment after it', async () => {
      const app = mount();
      await until(() => app.stdout.frame.includes('hello from the CLI'));
      app.stdin.write('f');
      await until(() => app.stdout.frame.includes('печатаешь в Claude Code'));
      const screen = (lines: string[]) => ({
        lines,
        width: 60,
        height: 12,
        cursor: { x: 0, y: 1, visible: true },
        historySize: 100,
        scrollOffset: 0,
      });
      backend.capturePane.mockResolvedValue(screen(['> x']));
      app.stdin.write('x');
      await until(() => app.stdout.frame.includes('> x'));

      // A CLI slower to echo: the first reads after the key still show the old screen.
      let reads = 0;
      backend.capturePane.mockImplementation(async () => screen([++reads > 3 ? '> xy' : '> x']));
      app.stdin.write('y');
      await until(() => app.stdout.frame.includes('> xy'));
      // The moment passes and the pane goes back to its idle pace.
      await pause(CAPTURE_MS.window + 100);
      const settled = backend.capturePane.mock.calls.length;
      await pause(200);
      expect(backend.capturePane.mock.calls.length).toBe(settled);
    });

    it('a wheel notch shows the history at once, its offset in the same frame as its rows', async () => {
      history();
      const app = mount();
      await until(() => app.stdout.frame.includes('hello from the CLI'));
      const frames: string[] = [];
      const write = app.stdout.write;
      app.stdout.write = (text: string) => {
        frames.push(text);
        return write(text);
      };
      app.stdin.write('\u001b[<64;80;10M');
      await until(() => app.stdout.frame.includes('old output 3'));
      app.stdin.write('\u001b[<64;80;10M');
      await until(() => app.stdout.frame.includes('old output 6'));
      // Never the new offset over the old rows: that frame would hold the real one back.
      expect(frames.filter((frame) => frame.includes('история ↑3')).every((f) => f.includes('old output 3'))).toBe(
        true,
      );
      expect(frames.filter((frame) => frame.includes('история ↑6')).every((f) => f.includes('old output 6'))).toBe(
        true,
      );
    });
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

  it('a drag over the screen selects and copies its text; a click copies nothing', async () => {
    const app = mount();
    await until(() => app.stdout.frame.includes('hello from the CLI'));
    // The screen's first cell is column 52, row 8: `hello from` is cells 0–9 of its first row.
    app.stdin.write('\u001b[<0;52;8M');
    app.stdin.write('\u001b[<32;58;8M\u001b[<32;61;8M');
    app.stdin.write('\u001b[<0;61;8m');
    await until(() => clipboard.copyText.mock.calls.length === 1);
    expect(clipboard.copyText).toHaveBeenLastCalledWith('hello from');
    await until(() => app.stdout.frame.includes('скопировано: 10 симв.'));
    // Over three rows: the blank one stays a line break.
    app.stdin.write('\u001b[<0;58;8M\u001b[<32;55;10M\u001b[<0;55;10m');
    await until(() => clipboard.copyText.mock.calls.length === 2);
    expect(clipboard.copyText).toHaveBeenLastCalledWith('from the CLI\n\ncolo');
    app.stdin.write('\u001b[<0;60;9M\u001b[<0;60;9m');
    await pause(100);
    expect(clipboard.copyText).toHaveBeenCalledTimes(2);
    expect(backend.sendToPane).not.toHaveBeenCalled();
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
