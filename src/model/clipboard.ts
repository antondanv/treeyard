/**
 * The system clipboard: text goes onto it, and a picture comes from it.
 *
 * A picture from the clipboard. Terminals paste text only, so a screenshot
 * taken with ⌘⇧⌃4 never reaches the TUI as input: it is read from the system
 * clipboard instead — `osascript` on macOS, `wl-paste` or `xclip` elsewhere.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { isPng, looksLikeImage, scratchFile } from './images.js';

/** PNG bytes or the path of an image file copied in Finder; undefined when the clipboard holds no picture. */
export type ClipboardImage = { kind: 'png'; data: Buffer } | { kind: 'file'; path: string; scratch?: boolean };

export function clipboardImage(): ClipboardImage | undefined {
  return process.platform === 'darwin' ? macClipboard() : linuxClipboard();
}

function osascript(script: string): string | undefined {
  const result = spawnSync('osascript', ['-e', script], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

/** `«data PNGf89504E…»` — how AppleScript prints raw clipboard bytes. */
function dataOf(printed: string | undefined): Buffer | undefined {
  const hex = /^«data \w{4}([0-9A-Fa-f]+)»$/.exec(printed ?? '')?.[1];
  return hex ? Buffer.from(hex, 'hex') : undefined;
}

function macClipboard(): ClipboardImage | undefined {
  // A file copied in Finder comes with its icon as a picture: the file goes first.
  const path = osascript('POSIX path of (the clipboard as «class furl»)');
  if (path && looksLikeImage(path) && existsSync(path)) return { kind: 'file', path };
  const png = dataOf(osascript('the clipboard as «class PNGf»'));
  if (png && isPng(png)) return { kind: 'png', data: png };
  // Some apps copy TIFF only; it becomes PNG on the way in.
  const tiff = dataOf(osascript('the clipboard as «class TIFF»'));
  if (tiff) {
    const file = scratchFile('clipboard.tiff');
    writeFileSync(file, tiff);
    return { kind: 'file', path: file, scratch: true };
  }
  return undefined;
}

function linuxClipboard(): ClipboardImage | undefined {
  for (const [command, args] of [
    ['wl-paste', ['--type', 'image/png']],
    ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']],
  ] as const) {
    const result = spawnSync(command, args, { maxBuffer: 256 * 1024 * 1024 });
    if (result.status === 0 && result.stdout && isPng(result.stdout)) return { kind: 'png', data: result.stdout };
  }
  return undefined;
}

/** Removes a scratch file the clipboard was written to. */
export function forgetClipboard(image: ClipboardImage): void {
  if (image.kind === 'file' && image.scratch) rmSync(image.path, { force: true });
}

/**
 * Puts text on the system clipboard: `pbcopy` on macOS, `wl-copy`, `xclip` or
 * `xsel` elsewhere. False when none of them took it.
 */
export function copyText(text: string): boolean {
  const tools: [string, string[]][] =
    process.platform === 'darwin'
      ? [['pbcopy', []]]
      : [
          ['wl-copy', []],
          ['xclip', ['-selection', 'clipboard']],
          ['xsel', ['--clipboard', '--input']],
        ];
  for (const [command, args] of tools) {
    // pbcopy reads bytes in the locale's encoding: without a UTF-8 one, Cyrillic turns to garbage.
    const result = spawnSync(command, args, { input: text, env: { ...process.env, LC_ALL: 'en_US.UTF-8' } });
    if (result.status === 0) return true;
  }
  return false;
}

/** The same text for the terminal to copy (OSC 52), where no clipboard tool is there. */
export function terminalCopy(text: string): string {
  return `\u001b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\u0007`;
}
