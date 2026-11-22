/**
 * When treeyard falls, the terminal must not fall with it. While the tree is
 * on screen the terminal is in modes the shell does not expect: the alternate
 * screen, raw input, mouse and focus reports, no autowrap. An error nobody
 * caught, or a SIGTERM or SIGHUP, used to end the process right there — the
 * shell came back with the mouse printing escape codes and lines running off
 * the edge, and the stack trace vanished with the alternate screen. Here the
 * terminal is handed back first, then the error goes to a file with the
 * version, and the person is told where it is and where to report it.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, constants, platform } from 'node:os';
import { join } from 'node:path';

import { t } from './i18n/i18n.js';
import { homeFolder } from './settings.js';

const require = createRequire(import.meta.url);
const PACKAGE = require('../package.json') as { version: string; bugs?: { url?: string } };
export const VERSION = PACKAGE.version;
export const REPORT_URL = PACKAGE.bugs?.url ?? 'https://github.com/antondanv/treeyard/issues';

const ESC = '\u001b';
/**
 * Everything the tree turns on, turned off: mouse (SGR, drag, clicks), focus
 * reports, bracketed paste; then back to the main screen, autowrap on (Apple
 * Terminal resets it on the screen switch, so after it) and the cursor shown.
 */
export const TERMINAL_RESET = `${ESC}[?1006l${ESC}[?1002l${ESC}[?1000l${ESC}[?1004l${ESC}[?2004l${ESC}[?1049l${ESC}[?7h${ESC}[?25h`;

/** Keep the last crash logs, not every one ever. */
const KEEP_LOGS = 20;
const SIGNALS = ['SIGTERM', 'SIGHUP', 'SIGINT'] as const;

export interface TerminalHold {
  /** What to undo first on a crash: Ink unmounts, so it does not write over the shell afterwards. */
  unmount?: () => void;
  release: () => void;
}

const holds = new Set<TerminalHold>();

/**
 * The tree takes the terminal: until `release`, a crash or a signal hands the
 * terminal back before the process ends. Outside a hold nothing is written to
 * the terminal — a plain command never changed its modes.
 */
export function holdTerminal(): TerminalHold {
  const hold: TerminalHold = {
    release: () => {
      holds.delete(hold);
      if (!holds.size) for (const signal of SIGNALS) process.off(signal, onSignal);
    },
  };
  if (!holds.size) for (const signal of SIGNALS) process.on(signal, onSignal);
  holds.add(hold);
  return hold;
}

export function holdingTerminal(): boolean {
  return holds.size > 0;
}

/** Unmount whatever holds the terminal, then reset its modes and give the keyboard back; no hold — nothing to undo. */
export function restoreTerminal(
  stdout: { isTTY?: boolean; fd: number } = process.stdout,
  stdin: Pick<NodeJS.ReadStream, 'isTTY' | 'setRawMode'> = process.stdin,
): void {
  if (!holds.size) return;
  for (const hold of [...holds]) {
    try {
      hold.unmount?.();
    } catch {
      // A broken app may fail to unmount; the reset below still runs.
    }
    hold.release();
  }
  // Synchronous: the process ends right after, an async write may never reach the terminal.
  if (stdout.isTTY)
    try {
      writeSync(stdout.fd, TERMINAL_RESET);
    } catch {}
  if (stdin.isTTY)
    try {
      stdin.setRawMode?.(false);
    } catch {}
}

function onSignal(signal: NodeJS.Signals): void {
  restoreTerminal();
  // As if the signal had ended the process: the shell sees 128 + its number.
  process.exit(128 + (constants.signals[signal] ?? 0));
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  let text = error.stack ?? `${error.name}: ${error.message}`;
  let cause = error.cause;
  for (let depth = 0; cause !== undefined && depth < 5; depth++) {
    text += `\nCaused by: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}`;
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return text;
}

/** `~/.treeyard/crashes`: where crash logs go. */
export function crashFolder(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeFolder(env), 'crashes');
}

/** The error with what is needed to reproduce it, in `<home>/crashes/`; the path, or undefined if it cannot be written. */
export function writeCrashLog(
  error: unknown,
  options: { env?: NodeJS.ProcessEnv; argv?: string[]; now?: Date } = {},
): string | undefined {
  const now = options.now ?? new Date();
  const dir = crashFolder(options.env);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `${stamp}-${process.pid}.log`);
  const text = [
    `treeyard ${VERSION}`,
    `node ${process.version} · ${platform()} ${arch()}`,
    `time: ${now.toISOString()}`,
    `command: treeyard ${(options.argv ?? process.argv.slice(2)).join(' ')}`,
    `cwd: ${process.cwd()}`,
    '',
    describe(error),
    '',
  ].join('\n');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, text);
    const logs = readdirSync(dir)
      .filter((name) => name.endsWith('.log'))
      .sort();
    for (const old of logs.slice(0, -KEEP_LOGS)) rmSync(join(dir, old), { force: true });
    return file;
  } catch {
    return undefined;
  }
}

/** What the person reads after the fall: what broke, where the details are, where to report it. */
export function crashMessage(error: unknown, file: string | undefined): string {
  const message = error instanceof Error ? error.message : String(error);
  const lines = [`✗ ${t('treeyard {version} упал: {message}', { version: VERSION, message })}`];
  if (file)
    lines.push(
      `  ${t('подробности — в {file}', { file })}`,
      `  ${t('сообщи об ошибке: {url} — приложи этот файл', { url: REPORT_URL })}`,
    );
  else
    lines.push(
      `  ${t('записать подробности в файл не удалось:')}`,
      describe(error),
      `  ${t('сообщи об ошибке: {url}', { url: REPORT_URL })}`,
    );
  return `${lines.join('\n')}\n`;
}

/** Hand the terminal back, keep the error in a file and say where. Does not end the process. */
export function reportCrash(
  error: unknown,
  options: { env?: NodeJS.ProcessEnv; argv?: string[] } = {},
): string | undefined {
  restoreTerminal();
  const file = writeCrashLog(error, options);
  try {
    process.stderr.write(crashMessage(error, file));
  } catch {}
  return file;
}

/** Already reported by `reportCrash`: the caller only sets the exit code. */
export class CrashReported extends Error {
  constructor(readonly file: string | undefined) {
    super('crash reported');
  }
}

function onUncaught(error: unknown): void {
  // A reader that went away (`treeyard show | head`) is not a crash.
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'EPIPE') {
    restoreTerminal();
    process.exit(0);
  }
  reportCrash(error);
  process.exit(1);
}

let guarded = false;

/** For the whole process: an error nobody caught ends treeyard through `reportCrash`. */
export function guardCrashes(): void {
  if (guarded) return;
  guarded = true;
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onUncaught);
}
