/**
 * A PNG of the TUI, for design work and the README: renders a frame with
 * colours, turns its ANSI codes into HTML and has headless Chrome take the
 * picture. FORCE_COLOR=2 (the default here) shows what Apple Terminal gets —
 * 256 colours; FORCE_COLOR=3 shows a truecolor terminal.
 *
 *   FORCE_COLOR=2 npx tsx scripts/screenshot.ts <project dir> <out.png> [cols]x[rows] [keys…]
 *
 * `framePng()` is the same picture for a frame taken elsewhere
 * (scripts/readme-screenshots.ts).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** `<enter>`, `<down>`… as the bytes a terminal sends. */
export function keysOf(names: string[]): string[] {
  return names.map((key) =>
    key
      .replace(/<enter>/g, '\r')
      .replace(/<esc>/g, '\u001b')
      .replace(/<down>/g, '\u001b[B')
      .replace(/<up>/g, '\u001b[A')
      .replace(/<right>/g, '\u001b[C')
      .replace(/<left>/g, '\u001b[D')
      .replace(/<pgdn>/g, '\u001b[6~')
      .replace(/<pgup>/g, '\u001b[5~')
      .replace(/<tab>/g, '\t'),
  );
}

async function main(): Promise<void> {
  process.env.FORCE_COLOR ??= '2';
  const [dirArg, outArg, sizeArg = '130x38', ...keyArgs] = process.argv.slice(2);
  if (!dirArg || !outArg) {
    console.error('usage: screenshot.ts <project dir> <out.png> [cols]x[rows] [keys…]');
    process.exit(2);
  }
  const [columns, rows] = sizeArg.split('x').map(Number) as [number, number];
  let frame: string;
  if (dirArg.endsWith('.ans')) {
    frame = readFileSync(dirArg, 'utf8');
  } else {
    const { snapshot } = await import('../src/tui/snapshot.js');
    frame = await snapshot(resolve(dirArg), { columns, rows, keys: keysOf(keyArgs), settle: 200 });
  }
  console.log(framePng(frame, outArg, columns, rows));
}

// ── ANSI → HTML ─────────────────────────────────────────────────────────────

const BASE16 = [
  '#000000',
  '#c23621',
  '#25bc24',
  '#adad27',
  '#492ee1',
  '#d338d3',
  '#33bbc8',
  '#cbcccd',
  '#818383',
  '#fc391f',
  '#31e722',
  '#eaec23',
  '#5833ff',
  '#f935f8',
  '#14f0f0',
  '#e9ebeb',
];
function ansi256(n: number): string {
  if (n < 16) return BASE16[n]!;
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  const i = n - 16;
  const level = [0, 95, 135, 175, 215, 255];
  return `rgb(${level[Math.floor(i / 36)]},${level[Math.floor(i / 6) % 6]},${level[i % 6]})`;
}

interface Style {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strike?: boolean;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FG = '#d7d7d7';
const BG = '#16181c';

function toHtml(text: string): string {
  let style: Style = {};
  let html = '';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI parsing.
  const parts = text.split(/(\u001b\[[0-9;]*m)/);
  for (const part of parts) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI parsing.
    const sgr = /^\u001b\[([0-9;]*)m$/.exec(part);
    if (sgr) {
      const codes = (sgr[1] || '0').split(';').map(Number);
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i]!;
        if (c === 0) style = {};
        else if (c === 1) style.bold = true;
        else if (c === 2) style.dim = true;
        else if (c === 3) style.italic = true;
        else if (c === 4) style.underline = true;
        else if (c === 7) style.inverse = true;
        else if (c === 9) style.strike = true;
        else if (c === 22) style.bold = style.dim = false;
        else if (c === 23) style.italic = false;
        else if (c === 24) style.underline = false;
        else if (c === 27) style.inverse = false;
        else if (c === 29) style.strike = false;
        else if (c === 39) delete style.fg;
        else if (c === 49) delete style.bg;
        else if (c >= 30 && c <= 37) style.fg = BASE16[c - 30];
        else if (c >= 90 && c <= 97) style.fg = BASE16[c - 90 + 8];
        else if (c >= 40 && c <= 47) style.bg = BASE16[c - 40];
        else if (c >= 100 && c <= 107) style.bg = BASE16[c - 100 + 8];
        else if (c === 38 || c === 48) {
          let color: string | undefined;
          if (codes[i + 1] === 5) {
            color = ansi256(codes[i + 2]!);
            i += 2;
          } else if (codes[i + 1] === 2) {
            color = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
            i += 4;
          }
          if (c === 38) style.fg = color;
          else style.bg = color;
        }
      }
      continue;
    }
    if (!part) continue;
    let fg = style.fg ?? FG;
    let bg = style.bg;
    if (style.inverse) {
      [fg, bg] = [bg ?? BG, fg];
    }
    const css = [
      `color:${fg}`,
      bg ? `background:${bg}` : '',
      style.bold ? 'font-weight:700' : '',
      style.dim ? 'opacity:.6' : '',
      style.italic ? 'font-style:italic' : '',
      style.underline || style.strike
        ? `text-decoration:${[style.underline ? 'underline' : '', style.strike ? 'line-through' : ''].join(' ')}`
        : '',
    ]
      .filter(Boolean)
      .join(';');
    html += `<span style="${css}">${escapeHtml(part)}</span>`;
  }
  return html;
}

/** The frame as a PNG at `out` (headless Chrome, twice the pixels); returns its full path. */
export function framePng(frame: string, out: string, columns: number, rows: number): string {
  const page = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:${BG}}
pre{margin:0;padding:18px 20px;font:14px/1.0 'SF Mono','Menlo',monospace;color:${FG};white-space:pre;font-variant-ligatures:none}
</style><pre>${toHtml(frame)}</pre>`;
  const dir = mkdtempSync(join(tmpdir(), 'treeyard-shot-'));
  const htmlPath = join(dir, 'frame.html');
  writeFileSync(htmlPath, page);
  const width = Math.ceil(columns * 8.45 + 40);
  const height = Math.ceil(rows * 14.2 + 40);
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const got = spawnSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      `--window-size=${width},${height}`,
      `--screenshot=${resolve(out)}`,
      `file://${htmlPath}`,
    ],
    { encoding: 'utf8' },
  );
  rmSync(dir, { recursive: true, force: true });
  if (got.status !== 0) throw new Error(`Chrome could not take the picture: ${got.stderr}`);
  return resolve(out);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
