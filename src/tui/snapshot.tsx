/**
 * One frame of the TUI as text, without a terminal: for tests, for docs, and
 * to look at the tree from a script (`treeyard snapshot`). Keys can be played
 * in first, as if typed.
 */
import { EventEmitter } from 'node:events';

import { render } from 'ink';

import { resetSettings, type Settings, settings } from '../settings.js';
import { App } from './App.js';
import { defaultUi, loadUi, type UiState } from './ui-state.js';

class FakeOut extends EventEmitter {
  frame = '';
  readonly isTTY = true;
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

class FakeIn extends EventEmitter {
  readonly isTTY = true;
  data: string | null = null;
  write(data: string) {
    this.data = data;
    this.emit('readable');
    this.emit('data', data);
  }
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
  read = () => {
    const { data } = this;
    this.data = null;
    return data;
  };
}

export interface SnapshotOptions {
  columns?: number;
  rows?: number;
  /** Keys to type before the frame is taken: `j`, `\r`, `\u001b[B`… */
  keys?: string[];
  /** Use the remembered view and selection instead of a fresh start. */
  remembered?: boolean;
  ui?: Partial<UiState>;
  /** Ask Claude Code for running sessions (slower; real state). */
  live?: boolean;
  settle?: number;
  /** Settings for this frame only (the language, confirmations…). */
  settings?: Partial<Settings>;
}

export async function snapshot(dir: string, options: SnapshotOptions = {}): Promise<string> {
  const stdout = new FakeOut(options.columns ?? 120, options.rows ?? 34);
  const stdin = new FakeIn();
  const ui = { ...(options.remembered ? loadUi(dir) : defaultUi()), ...options.ui };
  const before = settings();
  resetSettings({ ...before, ...options.settings });
  const instance = render(
    <App dir={dir} ui={ui} offline={!options.live} persist={false} onAction={() => undefined} />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
  await pause(options.live ? 1500 : 60);
  for (const key of options.keys ?? []) {
    stdin.write(key);
    await pause(40);
  }
  await pause(options.settle ?? 80);
  const frame = stdout.frame;
  resetSettings(before);
  instance.unmount();
  instance.cleanup();
  return frame;
}
