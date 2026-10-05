import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { render } from 'ink';
import stringWidth from 'string-width';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  listPanes: vi.fn(),
  capturePane: vi.fn(),
  resizePane: vi.fn(),
  liveSessions: vi.fn(),
  sessions: vi.fn(),
}));
vi.mock('@antondanv/brainyard', async (original) => ({
  ...(await original<typeof import('@antondanv/brainyard')>()),
  ...backend,
  panesAvailable: () => true,
  paneMemory: async () => new Map(),
}));

import { addNode, attachSession } from '../src/model/ops.js';
import { ROOT } from '../src/model/types.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { App } from '../src/tui/App.js';
import { TerminalInput } from '../src/tui/input.js';
import { columns } from '../src/tui/marquee.js';
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

const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  resetSettings({ ...DEFAULTS, animation: false, marquee: false, sleepAfter: 0, maxPanes: 0 });
  backend.resizePane.mockResolvedValue(true);
  backend.capturePane.mockResolvedValue({
    lines: ['fixture screen'],
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

const cases = [
  ...(['line', 'card', 'list'] as const).flatMap((style) => [
    { style, columns: 100, rows: 30, depth: 3, lang: 'ru' as const, brain: 'claude' as const },
    { style, columns: 130, rows: 36, depth: 3, lang: 'ru' as const, brain: 'claude' as const },
    { style, columns: 100, rows: 30, depth: 9, lang: 'ru' as const, brain: 'claude' as const },
    { style, columns: 100, rows: 30, depth: 3, lang: 'en' as const, brain: 'claude' as const },
  ]),
  { style: 'line' as const, columns: 130, rows: 36, depth: 3, lang: 'ru' as const, brain: 'codex' as const },
  { style: 'card' as const, columns: 100, rows: 30, depth: 3, lang: 'ru' as const, brain: 'codex' as const },
];

describe('tree beside an open agent session', () => {
  it.each(cases)(
    '$brain $style at $columns×$rows, level $depth ($lang): keeps the node and agent states while resizing',
    async (size) => {
      resetSettings({ ...DEFAULTS, lang: size.lang, animation: false, marquee: false, sleepAfter: 0, maxPanes: 0 });
      const tree = emptyTree();
      const expanded: string[] = [];
      let parent = ROOT;
      for (let level = 1; level < size.depth; level++) {
        parent = addNode(tree, {
          title: `Промежуточная ветка ${level} с очень длинным названием на несколько десятков символов`,
          parent,
        }).id;
        expanded.push(parent);
      }
      const title = 'Оплата заказа после доставки и длинное продолжение для проверки';
      const node = addNode(tree, { title, parent, status: 'review' });
      attachSession(tree, node.id, {
        brain: size.brain,
        id: 'conversation',
        mode: 'pane',
        pane: `${size.brain}-layout`,
      });
      backend.sessions.mockResolvedValue([{ brain: size.brain, id: 'conversation', interactive: true }]);
      backend.listPanes.mockResolvedValue([
        {
          pane: `${size.brain}-layout`,
          brain: size.brain,
          sessionId: 'conversation',
          cwd: tree.project.dir,
          attached: false,
          width: 60,
          height: 12,
        },
      ]);
      const session = {
        brain: size.brain,
        id: 'conversation',
        interactive: true,
        live: { kind: 'interactive', status: 'busy' },
      };
      backend.liveSessions.mockResolvedValue([session]);
      const stdout = new Output(size.columns, size.rows);
      const stdin = new Input();
      const input = new TerminalInput(stdin as unknown as NodeJS.ReadStream);
      const instance = render(
        <App
          dir={tree.project.dir}
          ui={{
            ...defaultUi(),
            selected: node.id,
            expanded,
            treeMode: size.style === 'list' ? 'list' : 'graph',
            graphStyle: size.style === 'card' ? 'card' : 'line',
            cardWidth: 36,
          }}
          persist={false}
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
      const screen = () => stripVTControlCharacters(stdout.frame);
      const treeBody = () => {
        const paneWidth = backend.resizePane.mock.lastCall![1] + 2;
        const width = size.columns - paneWidth - 2;
        return screen()
          .split('\n')
          .slice(5, -2)
          .map((line) => columns(line, 0, width))
          .join('\n');
      };
      const check = (phase: string) => {
        const frame = screen();
        expect(frame.split('\n').length).toBeLessThanOrEqual(size.rows);
        for (const line of frame.split('\n')) expect(stringWidth(line)).toBeLessThan(size.columns);
        expect(treeBody()).toContain('◎ Оплата');
        expect(treeBody()).toContain(size.brain);
        expect(treeBody()).not.toContain('◆ Тест');
        expect(treeBody()).not.toMatch(/работа…|ждёт т…/);
        if (size.style === 'card') {
          expect(treeBody()).toMatch(/┏━+┓/);
          expect(treeBody()).toMatch(/┗━+┛/);
        }
        const strip = frame.split('\n').at(-2)!;
        expect(strip).toContain(title);
        expect(strip).toContain(size.lang === 'en' ? 'review' : 'на проверке');
        expect(strip).not.toContain('Промежуточная ветка');
        const evidence = process.env.TREEYARD_LAYOUT_EVIDENCE_DIR;
        if (evidence) {
          mkdirSync(evidence, { recursive: true });
          writeFileSync(
            join(
              evidence,
              `${size.brain}-${size.style}-${size.columns}x${size.rows}-level${size.depth}-${size.lang}-${phase}.ans`,
            ),
            stdout.frame,
          );
        }
      };
      await until(() => screen().includes('fixture screen') && backend.resizePane.mock.calls.length > 0);
      check('working');
      const initialWidth = backend.resizePane.mock.lastCall![1];
      stdin.write('<');
      await until(() => backend.resizePane.mock.lastCall![1] > initialWidth);
      stdin.write('<');
      await pause(80);
      check('wide-pane');
      backend.liveSessions.mockResolvedValue([{ ...session, live: { kind: 'interactive', status: 'waiting' } }]);
      await until(() => treeBody().includes(`? ${size.brain}`));
      check('waiting');
      stdin.write('>');
      await pause(80);
      check('narrower-pane');
      if (size.brain === 'codex') {
        backend.liveSessions.mockResolvedValue([{ ...session, live: { kind: 'interactive', status: 'idle' } }]);
        await until(() => treeBody().includes('▣ codex'));
        check('idle');
      }
      if (size.style !== 'list' && size.depth === 3) {
        for (let step = 0; step < 24 && !treeBody().includes('◆ Тест'); step++) {
          stdin.write('\u001b[1;3D');
          await pause(50);
        }
        await until(() => treeBody().includes('◆ Тест'));
        await pause(1100);
        expect(treeBody()).toContain('◆ Тест');
        const evidence = process.env.TREEYARD_LAYOUT_EVIDENCE_DIR;
        if (evidence) {
          writeFileSync(
            join(
              evidence,
              `${size.brain}-${size.style}-${size.columns}x${size.rows}-level${size.depth}-${size.lang}-root.ans`,
            ),
            stdout.frame,
          );
        }
      }
    },
  );
});
