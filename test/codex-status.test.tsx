import { EventEmitter } from 'node:events';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { render } from 'ink';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({ liveSessions: vi.fn(), sessions: vi.fn(), readLive: vi.fn() }));
vi.mock('@antondanv/brainyard', async (original) => {
  const actual = await original<typeof import('@antondanv/brainyard')>();
  backend.readLive.mockImplementation(actual.liveSessions);
  return { ...actual, ...backend, panesAvailable: () => false };
});

import { addNode, attachSession } from '../src/model/ops.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { App } from '../src/tui/App.js';
import { TerminalInput } from '../src/tui/input.js';
import { defaultUi } from '../src/tui/ui-state.js';
import { emptyTree, tempDir } from './helpers.js';

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
  get text() {
    return stripVTControlCharacters(this.frame);
  }
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

const cleanups: (() => void)[] = [];
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(check: () => boolean) {
  const end = Date.now() + 8000;
  while (!check() && Date.now() < end) await pause(20);
  expect(check()).toBe(true);
}
const line = (type: string, payload: Record<string, unknown>) => `${JSON.stringify({ type, payload })}\n`;

beforeEach(() => {
  vi.clearAllMocks();
  resetSettings({ ...DEFAULTS, animation: false, live: true, sleepAfter: 0, maxPanes: 0 });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  resetSettings({ ...DEFAULTS });
});

describe('Codex status from Brainyard to the tree', () => {
  it.each([
    [130, 36],
    [100, 30],
  ])('counts work and clears questions at %d×%d', async (columns, rows) => {
    const tree = emptyTree();
    const codex = addNode(tree, { title: 'Codex task', status: 'active' });
    const claude = addNode(tree, { title: 'Claude task', status: 'active' });
    attachSession(tree, codex.id, { brain: 'codex', id: 'codex-session', name: 'Codex task' });
    attachSession(tree, claude.id, { brain: 'claude', id: 'claude-session', name: 'Claude task' });
    const home = tempDir();
    const day = join(home, 'sessions', '2026', '10', '03');
    mkdirSync(day, { recursive: true });
    const rollout = join(day, 'rollout-test-codex-session.jsonl');
    writeFileSync(
      rollout,
      line('session_meta', { id: 'codex-session', cwd: tree.project.dir, source: 'cli' }) +
        line('event_msg', { type: 'task_started' }) +
        line('response_item', { type: 'message', text: 'x'.repeat(100_000) }),
    );
    const other = {
      brain: 'claude',
      id: 'claude-session',
      interactive: true,
      title: 'Claude task',
      live: { status: 'busy', kind: 'interactive' },
    };
    backend.liveSessions.mockImplementation(async () => [
      ...(await backend.readLive({ brains: ['codex'], cwd: tree.project.dir, homes: { codex: home } })),
      other,
    ]);
    backend.sessions.mockResolvedValue([
      { brain: 'codex', id: 'codex-session', interactive: true, title: 'Codex task' },
      other,
    ]);

    const stdout = new Output(columns!, rows!);
    const stdin = new Input();
    const input = new TerminalInput(stdin as unknown as NodeJS.ReadStream);
    const instance = render(
      <App
        dir={tree.project.dir}
        ui={{ ...defaultUi(), selected: codex.id }}
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
    const capture = (name: string) => {
      expect(stdout.text.split('\n').length).toBeLessThanOrEqual(rows!);
      const dir = process.env.TREEYARD_CODEX_EVIDENCE_DIR;
      if (dir) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${columns}x${rows}-${name}.ans`), stdout.frame);
      }
    };

    await until(() => /работает агентов:\s*2/.test(stdout.text));
    expect(stdout.text).toContain('codex');
    expect(stdout.text).not.toContain('ждут тебя:');
    expect(backend.liveSessions).toHaveBeenCalledWith({ panes: {} });
    capture('working');

    appendFileSync(
      rollout,
      line('response_item', { type: 'function_call', name: 'request_user_input', call_id: 'question' }),
    );
    await until(() => /ждут тебя:\s*1/.test(stdout.text));
    expect(stdout.text).toMatch(/работает агентов:\s*1/);
    expect(stdout.text).toContain('ждёт тебя');
    capture('question');
    stdin.write('5');
    await pause(80);
    stdin.write('\u001b[C');
    await until(() => stdout.text.includes('ждёт тебя: input'));
    expect(stdout.text).toContain('Codex task');
    capture('sessions');

    appendFileSync(rollout, line('response_item', { type: 'function_call_output', call_id: 'question', output: '{}' }));
    await until(() => /работает агентов:\s*2/.test(stdout.text));
    expect(stdout.text).not.toContain('ждёт тебя');
    expect(stdout.text).not.toContain('ждут тебя:');
    capture('resumed');

    appendFileSync(rollout, line('event_msg', { type: 'task_complete' }));
    await until(() => /работает агентов:\s*1/.test(stdout.text));
    expect(stdout.text).not.toContain('ждут тебя:');
    capture('finished');
  });
});
