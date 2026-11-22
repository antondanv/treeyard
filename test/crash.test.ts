import { closeSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  crashMessage,
  holdingTerminal,
  holdTerminal,
  REPORT_URL,
  restoreTerminal,
  TERMINAL_RESET,
  VERSION,
  writeCrashLog,
} from '../src/crash.js';
import { tempDir } from './helpers.js';

/** A terminal that is a file: what treeyard writes to it can be read back. */
function fakeTerminal() {
  const path = join(tempDir(), 'tty');
  writeFileSync(path, '');
  const fd = openSync(path, 'a');
  const stdin = { isTTY: true, setRawMode: vi.fn() };
  return {
    stdout: { isTTY: true, fd },
    stdin,
    written: () => readFileSync(path, 'utf8'),
    close: () => closeSync(fd),
  };
}

// Holds a test left behind go, with nothing written anywhere.
afterEach(() => restoreTerminal({ isTTY: false, fd: -1 }, { isTTY: false, setRawMode: () => process.stdin }));

describe('handing the terminal back', () => {
  it('turns off mouse and focus, turns on autowrap, leaves the alternate screen, shows the cursor', () => {
    for (const mode of ['?1000l', '?1002l', '?1006l', '?1004l', '?2004l', '?1049l', '?7h', '?25h'])
      expect(TERMINAL_RESET).toContain(`\u001b[${mode}`);
    // Apple Terminal resets autowrap when the screen switches: autowrap goes on after leaving.
    expect(TERMINAL_RESET.indexOf('?7h')).toBeGreaterThan(TERMINAL_RESET.indexOf('?1049l'));
  });

  it('while the tree holds the terminal: unmounts it, resets the modes, gives the keyboard back', () => {
    const term = fakeTerminal();
    const hold = holdTerminal();
    const order: string[] = [];
    hold.unmount = () => order.push(`unmount, written: ${term.written().length}`);
    expect(holdingTerminal()).toBe(true);
    restoreTerminal(term.stdout, term.stdin);
    term.close();
    expect(order).toEqual(['unmount, written: 0']);
    expect(term.written()).toBe(TERMINAL_RESET);
    expect(term.stdin.setRawMode).toHaveBeenCalledWith(false);
    expect(holdingTerminal()).toBe(false);
  });

  it('a plain command never changed the terminal: nothing to undo', () => {
    const term = fakeTerminal();
    restoreTerminal(term.stdout, term.stdin);
    term.close();
    expect(term.written()).toBe('');
    expect(term.stdin.setRawMode).not.toHaveBeenCalled();
  });

  it('listens for SIGTERM, SIGHUP and SIGINT only while the terminal is held', () => {
    const before = ['SIGTERM', 'SIGHUP', 'SIGINT'].map((signal) => process.listenerCount(signal));
    const first = holdTerminal();
    const second = holdTerminal();
    expect(['SIGTERM', 'SIGHUP', 'SIGINT'].map((signal) => process.listenerCount(signal))).toEqual(
      before.map((n) => n + 1),
    );
    first.release();
    expect(holdingTerminal()).toBe(true);
    second.release();
    expect(['SIGTERM', 'SIGHUP', 'SIGINT'].map((signal) => process.listenerCount(signal))).toEqual(before);
  });

  it('an app that fails to unmount still gets the terminal reset', () => {
    const term = fakeTerminal();
    holdTerminal().unmount = () => {
      throw new Error('broken');
    };
    restoreTerminal(term.stdout, term.stdin);
    term.close();
    expect(term.written()).toBe(TERMINAL_RESET);
  });
});

describe('the crash log', () => {
  it('keeps the version, the command and the whole stack with its cause', () => {
    const home = tempDir('treeyard-home-');
    const error = new Error('сломалось', { cause: new Error('корень беды') });
    const file = writeCrashLog(error, { env: { TREEYARD_HOME: home }, argv: ['show', 'ab12'] });
    expect(file).toBeDefined();
    expect(file!.startsWith(join(home, 'crashes'))).toBe(true);
    const text = readFileSync(file!, 'utf8');
    expect(text).toContain(`treeyard ${VERSION}`);
    expect(text).toContain(`node ${process.version}`);
    expect(text).toContain('command: treeyard show ab12');
    expect(text).toContain('Error: сломалось');
    expect(text).toContain('crash.test.ts');
    expect(text).toContain('Caused by: Error: корень беды');
  });

  it('keeps only the last 20 logs', () => {
    const home = tempDir('treeyard-home-');
    for (let n = 0; n < 23; n++)
      writeCrashLog(new Error(`#${n}`), { env: { TREEYARD_HOME: home }, now: new Date(Date.UTC(2026, 0, 1, 0, 0, n)) });
    const logs = readdirSync(join(home, 'crashes')).sort();
    expect(logs).toHaveLength(20);
    expect(readFileSync(join(home, 'crashes', logs[0]!), 'utf8')).toContain('Error: #3');
  });

  it('a home that cannot be written: no file, the stack goes into the message', () => {
    const home = join(tempDir(), 'file');
    writeFileSync(home, '');
    const error = new Error('сломалось');
    expect(writeCrashLog(error, { env: { TREEYARD_HOME: home } })).toBeUndefined();
    const message = crashMessage(error, undefined);
    expect(message).toContain('записать подробности в файл не удалось');
    expect(message).toContain('crash.test.ts');
    expect(message).toContain(`сообщи об ошибке: ${REPORT_URL}\n`);
  });

  it('the message says what broke, the version, where the file is and where to report', () => {
    const message = crashMessage(new Error('сломалось'), '/home/x/.treeyard/crashes/a.log');
    expect(message).toBe(
      [
        `✗ treeyard ${VERSION} упал: сломалось`,
        '  подробности — в /home/x/.treeyard/crashes/a.log',
        `  сообщи об ошибке: ${REPORT_URL} — приложи этот файл`,
        '',
      ].join('\n'),
    );
    expect(REPORT_URL).toBe('https://github.com/antondanv/treeyard/issues');
  });
});
