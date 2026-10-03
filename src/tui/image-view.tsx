/**
 * A picture drawn with text: each cell is `▀`, its foreground the upper
 * pixel and its background the lower one. Any truecolor terminal shows it,
 * tmux included, and Ink lays it out like any other line — no graphics
 * protocol to negotiate and nothing left behind on the screen.
 */
import { readFileSync, statSync } from 'node:fs';
import { Box, Text } from 'ink';
import { PNG } from 'pngjs';

const ESC = '\u001b';
/** Below this alpha a pixel shows the terminal's own background. */
const OPAQUE = 128;

interface Pixels {
  width: number;
  height: number;
  data: Buffer;
}

/** Decoded pictures by path: a big screenshot is decoded once, and only a few are held. */
const decoded = new Map<string, { stamp: number; pixels: Pixels }>();
const rendered = new Map<string, string[]>();
const KEEP = 4;

function stampOf(path: string): number | undefined {
  try {
    const stat = statSync(path);
    return stat.mtimeMs + stat.size;
  } catch {
    return undefined;
  }
}

function pixelsOf(path: string, stamp: number): Pixels | undefined {
  const cached = decoded.get(path);
  if (cached?.stamp === stamp) return cached.pixels;
  let pixels: Pixels;
  try {
    const png = PNG.sync.read(readFileSync(path));
    pixels = { width: png.width, height: png.height, data: png.data };
  } catch {
    return undefined;
  }
  decoded.delete(path);
  decoded.set(path, { stamp, pixels });
  while (decoded.size > KEEP) decoded.delete(decoded.keys().next().value!);
  return pixels;
}

/** The size in cells a picture takes when fit into `cols × rows` with its proportions. */
export function fitCells(width: number, height: number, cols: number, rows: number): { cols: number; rows: number } {
  // A cell is about twice as tall as it is wide: two pixels per cell make them square.
  const scale = Math.min(cols / width, (rows * 2) / height);
  return {
    cols: Math.max(1, Math.min(cols, Math.round(width * scale))),
    rows: Math.max(1, Math.min(rows, Math.ceil((height * scale) / 2))),
  };
}

/** Averages the source box under each target pixel; transparent boxes stay undefined. */
export function downscale(pixels: Pixels, width: number, height: number): (number[] | undefined)[] {
  const out: (number[] | undefined)[] = [];
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * pixels.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * pixels.height) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * pixels.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * pixels.width) / width));
      // A big box is sampled on a grid: a 4K screenshot into a thumbnail need not touch every pixel.
      const step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 8));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy += step) {
        for (let sx = x0; sx < x1; sx += step) {
          const at = (sy * pixels.width + sx) * 4;
          const alpha = pixels.data[at + 3]!;
          r += pixels.data[at]! * alpha;
          g += pixels.data[at + 1]! * alpha;
          b += pixels.data[at + 2]! * alpha;
          a += alpha;
          n += 1;
        }
      }
      out.push(a / n < OPAQUE ? undefined : [Math.round(r / a), Math.round(g / a), Math.round(b / a)]);
    }
  }
  return out;
}

/** Lines of `▀` with truecolor escapes, each `cols` cells wide. */
export function halfBlocks(pixels: Pixels, cols: number, rows: number): string[] {
  const size = fitCells(pixels.width, pixels.height, cols, rows);
  const grid = downscale(pixels, size.cols, size.rows * 2);
  const lines: string[] = [];
  for (let row = 0; row < size.rows; row++) {
    let line = '';
    for (let col = 0; col < size.cols; col++) {
      const top = grid[row * 2 * size.cols + col];
      const bottom = grid[(row * 2 + 1) * size.cols + col];
      if (!top && !bottom) line += ' ';
      else if (!bottom) line += `${ESC}[38;2;${top!.join(';')}m▀${ESC}[39m`;
      else if (!top) line += `${ESC}[38;2;${bottom.join(';')}m▄${ESC}[39m`;
      else line += `${ESC}[38;2;${top.join(';')};48;2;${bottom.join(';')}m▀${ESC}[39;49m`;
    }
    lines.push(line);
  }
  return lines;
}

/** The picture at `path` as lines of text fit into `cols × rows`; undefined when it cannot be read. */
export function pictureLines(path: string, cols: number, rows: number): string[] | undefined {
  const stamp = stampOf(path);
  if (stamp === undefined || cols < 1 || rows < 1) return undefined;
  const key = `${path}\0${stamp}\0${cols}x${rows}`;
  const cached = rendered.get(key);
  if (cached) return cached;
  const pixels = pixelsOf(path, stamp);
  if (!pixels) return undefined;
  const lines = halfBlocks(pixels, cols, rows);
  rendered.set(key, lines);
  while (rendered.size > 64) rendered.delete(rendered.keys().next().value!);
  return lines;
}

/** Width and height in pixels, for the caption. */
export function pictureSize(path: string): { width: number; height: number } | undefined {
  const stamp = stampOf(path);
  const pixels = stamp === undefined ? undefined : pixelsOf(path, stamp);
  return pixels && { width: pixels.width, height: pixels.height };
}

/** A picture in a box of `cols × rows`, centred; a placeholder when the file cannot be read. */
export function Picture(props: { path: string; cols: number; rows: number; center?: boolean }) {
  const lines = pictureLines(props.path, props.cols, props.rows);
  if (!lines) {
    return (
      <Box width={props.cols} height={props.rows} justifyContent="center" alignItems="center">
        <Text dimColor>?</Text>
      </Box>
    );
  }
  return (
    <Box
      flexDirection="column"
      width={props.cols}
      height={props.rows}
      alignItems={props.center ? 'center' : 'flex-start'}
      justifyContent={props.center ? 'center' : 'flex-start'}
    >
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows of a picture are positions.
        <Text key={index}>{line}</Text>
      ))}
    </Box>
  );
}
